'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REGISTRY_ORIGIN = 'https://registry.nasiko.dev';
const REPOSITORY = 'nasiko/nasiko';
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

const QUALIFIED_RELEASES = Object.freeze({
  'v0.1.0': Object.freeze({
    'linux/amd64': 'sha256:0df748a40f3d714b6b6a3376a1d13a224c05bdb8d1628f31ace5a7bee8ceb9de',
    'linux/arm64': 'sha256:655021a129c7df4621a80d16ea4eab38018530bfe9a20da646641d9f4ac5c249',
    'darwin/amd64': 'sha256:b4188482621efd7da5a2ab630f653665ab5f80b9aceae448b6bb5fc93e003f06',
    'darwin/arm64': 'sha256:ce7e54fa19f989a5d125c4409b3587ca9503bb5a07bc5ff223c60e0fbad437f0',
    'windows/amd64': 'sha256:0760fe1fc98e8fedb66796aaf891a1de9268af1338c5e88b949656fda5d9f045',
  }),
});

function normalizePlatform(platform = process.platform, architecture = process.arch) {
  const osName = platform === 'win32' ? 'windows' : platform;
  if (!['linux', 'darwin', 'windows'].includes(osName)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  const arch = architecture === 'x64' ? 'amd64' : architecture;
  if (!['amd64', 'arm64'].includes(arch)) {
    throw new Error(`Unsupported architecture: ${architecture}`);
  }
  if (osName === 'windows' && arch !== 'amd64') {
    throw new Error(`Unsupported architecture for Windows: ${architecture}`);
  }
  return {
    os: osName,
    arch,
    binaryName: osName === 'windows' ? 'nasiko.exe' : 'nasiko',
  };
}

function getQualifiedRelease(version, platform = process.platform, architecture = process.arch) {
  if (!/^v\d+\.\d+\.\d+$/.test(String(version || ''))) {
    throw new Error('Nasiko installation requires a pinned version such as v0.1.0; latest is not allowed.');
  }
  const release = QUALIFIED_RELEASES[version];
  if (!release) {
    throw new Error(`Nasiko ${version} is not qualified by this ECC release.`);
  }
  const normalized = normalizePlatform(platform, architecture);
  const manifestDigest = release[`${normalized.os}/${normalized.arch}`];
  if (!manifestDigest) {
    throw new Error(`Nasiko ${version} is not qualified for ${normalized.os}/${normalized.arch}.`);
  }
  return { version, ...normalized, manifestDigest };
}

function digestBytes(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function assertDigest(bytes, expectedDigest, label) {
  if (!SHA256_PATTERN.test(expectedDigest)) {
    throw new Error(`${label} has an invalid expected digest.`);
  }
  const actualDigest = digestBytes(bytes);
  if (actualDigest !== expectedDigest) {
    throw new Error(`${label} digest mismatch: expected ${expectedDigest}, got ${actualDigest}.`);
  }
}

function validateManifest(manifestBytes) {
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch (_error) {
    throw new Error('Nasiko manifest is not valid JSON.');
  }
  if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.layers) || manifest.layers.length !== 1) {
    throw new Error('Nasiko manifest must contain exactly one OCI layer.');
  }
  const layer = manifest.layers[0];
  if (layer.mediaType !== 'application/gzip' || !SHA256_PATTERN.test(layer.digest)) {
    throw new Error('Nasiko manifest layer is not a qualified gzip artifact.');
  }
  if (!Number.isSafeInteger(layer.size) || layer.size <= 0 || layer.size > MAX_ARCHIVE_BYTES) {
    throw new Error('Nasiko manifest layer size is outside the allowed range.');
  }
  return { digest: layer.digest, size: layer.size };
}

function validateArchiveEntries(entries, expectedBinaryName) {
  if (!Array.isArray(entries) || entries.length !== 1) {
    throw new Error('Unsafe archive: expected exactly one binary file.');
  }
  const [entry] = entries;
  const normalizedPath = String(entry.path || '').replace(/^\.\//, '');
  if (normalizedPath !== expectedBinaryName || normalizedPath.includes('..') || path.isAbsolute(normalizedPath)) {
    throw new Error('Unsafe archive path: expected only the Nasiko binary.');
  }
  if (entry.type !== 'file') {
    throw new Error('Nasiko archive entry must be a regular file.');
  }
  return true;
}

function fetchBytes(url, options = {}) {
  const maxBytes = options.maxBytes || MAX_ARCHIVE_BYTES;
  const timeoutMs = options.timeoutMs || 15000;
  const parsed = new URL(url);
  if (parsed.origin !== REGISTRY_ORIGIN || parsed.protocol !== 'https:') {
    return Promise.reject(new Error('Nasiko download origin is not allowed.'));
  }
  return new Promise((resolve, reject) => {
    const request = https.get(parsed, {
      headers: options.accept ? { Accept: options.accept } : {},
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400) {
        response.resume();
        reject(new Error('Nasiko registry redirects are not allowed.'));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Nasiko registry returned HTTP ${response.statusCode}.`));
        return;
      }
      const chunks = [];
      let totalBytes = 0;
      response.on('data', chunk => {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          request.destroy(new Error('Nasiko registry response exceeded the size limit.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('Nasiko registry request timed out.')));
    request.on('error', reject);
  });
}

function inspectArchive(archivePath) {
  const result = spawnSync('tar', ['-tvzf', archivePath], {
    encoding: 'utf8',
    shell: false,
    timeout: 15000,
  });
  if (result.status !== 0) {
    throw new Error('Nasiko archive inspection failed.');
  }
  return result.stdout.split(/\r?\n/).filter(Boolean).map(line => {
    const typeMarker = line[0];
    const entryPath = line.trim().split(/\s+/).at(-1);
    return {
      path: entryPath,
      type: typeMarker === '-' ? 'file' : typeMarker === 'l' ? 'symlink' : 'other',
    };
  });
}

function extractArchive(archivePath, destination) {
  const result = spawnSync('tar', ['-xzf', archivePath, '-C', destination], {
    encoding: 'utf8',
    shell: false,
    timeout: 30000,
  });
  if (result.status !== 0) {
    throw new Error('Nasiko archive extraction failed.');
  }
}

function runVersion(executable) {
  return spawnSync(executable, ['--version'], {
    encoding: 'utf8',
    shell: false,
    timeout: 10000,
  });
}

function defaultInstallDirectory(normalized, environment = process.env, homeDirectory = os.homedir()) {
  if (normalized.os === 'windows') {
    if (!environment.LOCALAPPDATA) throw new Error('LOCALAPPDATA is required on Windows.');
    return path.join(environment.LOCALAPPDATA, 'nasiko', 'bin');
  }
  return path.join(homeDirectory, '.local', 'bin');
}

function validateInstallDirectory(installDirectory) {
  if (typeof installDirectory !== 'string' || installDirectory.includes('\0') || !path.isAbsolute(installDirectory)) {
    throw new Error('Nasiko install directory must be an absolute path.');
  }
  const resolved = path.resolve(installDirectory);
  if (resolved === path.parse(resolved).root) {
    throw new Error('Nasiko cannot install directly into a filesystem root.');
  }
  return resolved;
}

function assertDirectoryNotSymlink(directoryPath) {
  if (!fs.existsSync(directoryPath)) return;
  const stats = fs.lstatSync(directoryPath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('Nasiko install directory must be a real directory, not a symlink.');
  }
}

async function installNasiko(options = {}, dependencies = {}) {
  const version = options.version || 'v0.1.0';
  const qualified = getQualifiedRelease(
    version,
    dependencies.platform || process.platform,
    dependencies.arch || process.arch
  );
  const release = dependencies.releaseOverride
    ? { ...qualified, ...dependencies.releaseOverride }
    : qualified;
  const installDirectory = validateInstallDirectory(options.installDir || defaultInstallDirectory(
    release,
    dependencies.environment || process.env,
    dependencies.homeDirectory || os.homedir()
  ));
  const destination = path.join(installDirectory, release.binaryName);
  const plan = {
    dryRun: Boolean(options.dryRun),
    version,
    platform: release.os,
    architecture: release.arch,
    manifestDigest: release.manifestDigest,
    registryOrigin: REGISTRY_ORIGIN,
    destination,
  };
  if (options.dryRun) return plan;
  if (!options.yes) throw new Error('Nasiko installation requires explicit --yes consent.');

  assertDirectoryNotSymlink(installDirectory);
  fs.mkdirSync(installDirectory, { recursive: true, mode: 0o755 });
  assertDirectoryNotSymlink(installDirectory);
  if (fs.existsSync(destination)) {
    if (fs.lstatSync(destination).isSymbolicLink()) {
      throw new Error('Refusing to replace a symlinked Nasiko executable.');
    }
    const existing = (dependencies.runVersion || runVersion)(destination);
    const output = `${existing.stdout || ''}\n${existing.stderr || ''}`;
    if (existing.status === 0 && output.includes(version)) {
      return { ...plan, dryRun: false, installed: true, reused: true };
    }
    throw new Error('An incompatible Nasiko executable already exists at the destination.');
  }

  const retrieve = dependencies.fetchBytes || fetchBytes;
  const manifestUrl = `${REGISTRY_ORIGIN}/v2/${REPOSITORY}/manifests/${release.manifestDigest}`;
  const manifestBytes = await retrieve(manifestUrl, {
    accept: 'application/vnd.oci.image.manifest.v1+json',
    maxBytes: MAX_MANIFEST_BYTES,
  });
  assertDigest(manifestBytes, release.manifestDigest, 'Nasiko manifest');
  const layer = validateManifest(manifestBytes);
  const archiveUrl = `${REGISTRY_ORIGIN}/v2/${REPOSITORY}/blobs/${layer.digest}`;
  const archiveBytes = await retrieve(archiveUrl, { maxBytes: MAX_ARCHIVE_BYTES });
  if (archiveBytes.length !== layer.size) throw new Error('Nasiko archive size mismatch.');
  assertDigest(archiveBytes, layer.digest, 'Nasiko archive');

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-nasiko-install-'));
  try {
    const archivePath = path.join(temporaryDirectory, 'nasiko.tar.gz');
    const extractionDirectory = path.join(temporaryDirectory, 'extract');
    fs.mkdirSync(extractionDirectory, { mode: 0o700 });
    fs.writeFileSync(archivePath, archiveBytes, { mode: 0o600 });
    const inspect = dependencies.inspectArchive || inspectArchive;
    validateArchiveEntries(inspect(archivePath), release.binaryName);
    (dependencies.extractArchive || extractArchive)(archivePath, extractionDirectory);
    const extractedBinary = path.join(extractionDirectory, release.binaryName);
    const extractedStats = fs.lstatSync(extractedBinary);
    if (!extractedStats.isFile() || extractedStats.isSymbolicLink()) {
      throw new Error('Extracted Nasiko binary is not a regular file.');
    }
    fs.chmodSync(extractedBinary, 0o755);
    const stagedDestination = path.join(installDirectory, `.${release.binaryName}.tmp-${process.pid}`);
    fs.copyFileSync(extractedBinary, stagedDestination, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(stagedDestination, 0o755);
    fs.renameSync(stagedDestination, destination);
    const versionResult = (dependencies.runVersion || runVersion)(destination);
    const versionOutput = `${versionResult.stdout || ''}\n${versionResult.stderr || ''}`;
    if (versionResult.status !== 0 || !versionOutput.includes(version)) {
      fs.rmSync(destination, { force: true });
      throw new Error('Installed Nasiko binary did not report the qualified version.');
    }
    const metadata = {
      version,
      platform: release.os,
      architecture: release.arch,
      manifestDigest: release.manifestDigest,
      artifactDigest: layer.digest,
      installedPath: destination,
    };
    const metadataPath = path.join(installDirectory, '.ecc-nasiko-install.json');
    const temporaryMetadata = `${metadataPath}.tmp-${process.pid}`;
    fs.writeFileSync(temporaryMetadata, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryMetadata, metadataPath);
    return { ...plan, dryRun: false, installed: true, reused: false, artifactDigest: layer.digest };
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

module.exports = {
  QUALIFIED_RELEASES,
  REGISTRY_ORIGIN,
  digestBytes,
  fetchBytes,
  getQualifiedRelease,
  installNasiko,
  normalizePlatform,
  validateArchiveEntries,
  validateInstallDirectory,
};
