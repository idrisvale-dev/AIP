/**
 * Contract and lifecycle tests for the opt-in Nasiko control-plane bridge.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

async function runTest(name, testFunction) {
  try {
    await testFunction();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    return false;
  }
}

function sha256Digest(value) {
  const crypto = require('crypto');
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

async function main() {
  console.log('\n=== Testing Nasiko control-plane integration ===\n');

  const tests = [
    ['qualifies only pinned platform releases and rejects latest', () => {
      const {
        getQualifiedRelease,
        normalizePlatform,
      } = require('../../scripts/lib/nasiko-release');

      assert.deepStrictEqual(normalizePlatform('darwin', 'arm64'), {
        os: 'darwin',
        arch: 'arm64',
        binaryName: 'nasiko',
      });
      assert.deepStrictEqual(normalizePlatform('win32', 'x64'), {
        os: 'windows',
        arch: 'amd64',
        binaryName: 'nasiko.exe',
      });
      assert.match(getQualifiedRelease('v0.1.0', 'linux', 'x64').manifestDigest, /^sha256:[a-f0-9]{64}$/);
      assert.throws(() => getQualifiedRelease('latest', 'darwin', 'arm64'), /pinned version/i);
      assert.throws(() => getQualifiedRelease('v1.0.0', 'darwin', 'arm64'), /not qualified/i);
      assert.throws(() => normalizePlatform('freebsd', 'x64'), /unsupported platform/i);
      assert.throws(() => normalizePlatform('darwin', 'ia32'), /unsupported architecture/i);
    }],
    ['requires explicit consent while dry-run remains offline and read-only', async () => {
      const { installNasiko } = require('../../scripts/lib/nasiko-release');
      let fetchCount = 0;
      const dependencies = {
        fetchBytes: async () => {
          fetchCount += 1;
          throw new Error('dry-run fetched the network');
        },
        platform: 'darwin',
        arch: 'arm64',
      };

      await assert.rejects(
        installNasiko({ version: 'v0.1.0', yes: false }, dependencies),
        /explicit --yes/i
      );
      const plan = await installNasiko({ version: 'v0.1.0', dryRun: true }, dependencies);
      assert.strictEqual(plan.dryRun, true);
      assert.strictEqual(plan.version, 'v0.1.0');
      assert.strictEqual(plan.registryOrigin, 'https://registry.nasiko.dev');
      assert.strictEqual(fetchCount, 0);
    }],
    ['verifies manifest and blob digests before an atomic install', async () => {
      const { installNasiko } = require('../../scripts/lib/nasiko-release');
      const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-nasiko-green-'));
      const manifest = Buffer.from(JSON.stringify({
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        layers: [{
          mediaType: 'application/gzip',
          digest: sha256Digest(Buffer.from('verified archive')),
          size: 16,
        }],
      }));
      const archive = Buffer.from('verified archive');

      try {
        const result = await installNasiko({
          version: 'v0.1.0',
          yes: true,
          installDir: installRoot,
        }, {
          platform: 'darwin',
          arch: 'arm64',
          releaseOverride: { manifestDigest: sha256Digest(manifest) },
          fetchBytes: async (url) => url.includes('/manifests/') ? manifest : archive,
          inspectArchive: () => [{ path: 'nasiko', type: 'file' }],
          extractArchive: (_archivePath, destination) => {
            fs.writeFileSync(path.join(destination, 'nasiko'), '#!/bin/sh\necho nasiko v0.1.0\n', { mode: 0o755 });
          },
          runVersion: executable => ({ status: 0, stdout: `${executable}: nasiko v0.1.0\n`, stderr: '' }),
        });
        assert.strictEqual(result.installed, true);
        assert.strictEqual(result.version, 'v0.1.0');
        assert.strictEqual(fs.existsSync(path.join(installRoot, 'nasiko')), true);
        assert.strictEqual(fs.existsSync(path.join(installRoot, '.ecc-nasiko-install.json')), true);
      } finally {
        fs.rmSync(installRoot, { recursive: true, force: true });
      }
    }],
    ['rejects digest mismatch and unsafe archive entries without installing', async () => {
      const { installNasiko, validateArchiveEntries } = require('../../scripts/lib/nasiko-release');
      const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-nasiko-reject-'));
      const manifest = Buffer.from('{"schemaVersion":2,"layers":[]}');
      try {
        await assert.rejects(
          installNasiko({ version: 'v0.1.0', yes: true, installDir: installRoot }, {
            platform: 'darwin',
            arch: 'arm64',
            releaseOverride: { manifestDigest: `sha256:${'0'.repeat(64)}` },
            fetchBytes: async () => manifest,
          }),
          /manifest digest mismatch/i
        );
        assert.strictEqual(fs.existsSync(path.join(installRoot, 'nasiko')), false);
        assert.throws(
          () => validateArchiveEntries([{ path: '../nasiko', type: 'file' }], 'nasiko'),
          /unsafe archive/i
        );
        assert.throws(
          () => validateArchiveEntries([{ path: 'nasiko', type: 'symlink' }], 'nasiko'),
          /regular file/i
        );
      } finally {
        fs.rmSync(installRoot, { recursive: true, force: true });
      }
    }],
    ['routes read-only status through an explicit absolute executable', () => {
      const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-nasiko-status-'));
      const executable = path.join(fixtureRoot, 'nasiko');
      fs.writeFileSync(executable, '#!/bin/sh\nprintf "nasiko v0.1.0\\n"\n', { mode: 0o755 });
      try {
        const result = spawnSync(process.execPath, [
          path.join(REPO_ROOT, 'scripts', 'ecc.js'),
          'nasiko',
          'status',
          '--json',
        ], {
          encoding: 'utf8',
          env: { ...process.env, ECC_NASIKO_CLI_EXECUTABLE: executable },
        });
        assert.strictEqual(result.status, 0, result.stderr);
        const status = JSON.parse(result.stdout);
        assert.strictEqual(status.installed, true);
        assert.strictEqual(status.version, 'v0.1.0');
        assert.strictEqual(status.executable, executable);
      } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
      }
    }],
    ['ships a canonical opt-in skill without silently bundling Nasiko', () => {
      const skill = read('skills/nasiko-control-plane/SKILL.md');
      assert.match(skill, /^name: nasiko-control-plane$/m);
      assert.match(skill, /ecc nasiko status/i);
      assert.match(skill, /explicit.*consent|explicit.*--yes/i);
      assert.match(skill, /pinned.*v0\.1\.0/i);
      assert.match(skill, /telemetry.*opt-in/i);
      assert.match(skill, /never.*secrets|never.*credentials/i);
      assert.match(skill, /install.*does not prove/i);
      assert.doesNotMatch(skill, /curl[^\n]*\|[^\n]*bash|irm[^\n]*\|[^\n]*iex/i);

      const modules = readJson('manifests/install-modules.json').modules;
      const module = modules.find(candidate => candidate.id === 'nasiko-control-plane');
      assert.ok(module, 'nasiko-control-plane module is missing');
      assert.deepStrictEqual(module.paths, ['skills/nasiko-control-plane']);
      assert.deepStrictEqual(module.dependencies, ['platform-configs']);
      assert.strictEqual(module.defaultInstall, false);
      assert.strictEqual(module.stability, 'experimental');

      const components = readJson('manifests/install-components.json').components;
      assert.deepStrictEqual(
        components.find(candidate => candidate.id === 'capability:nasiko-control-plane'),
        {
          id: 'capability:nasiko-control-plane',
          family: 'capability',
          description: 'Explicitly gated Nasiko control-plane installation, status, and agent-operations guidance with pinned artifact verification and opt-in telemetry boundaries.',
          modules: ['nasiko-control-plane'],
        }
      );

      const profiles = readJson('manifests/install-profiles.json').profiles;
      for (const profile of Object.values(profiles)) {
        assert.ok(!profile.modules.includes('nasiko-control-plane'));
      }

      const packageJson = readJson('package.json');
      assert.ok(packageJson.files.includes('skills/nasiko-control-plane/'));
      assert.ok(packageJson.files.includes('scripts/nasiko.js'));
      assert.ok(packageJson.files.includes('scripts/lib/nasiko-release.js'));
      assert.ok(!packageJson.dependencies?.nasiko);
      assert.ok(!packageJson.optionalDependencies?.nasiko);
    }],
  ];

  let passed = 0;
  let failed = 0;
  for (const [name, testFunction] of tests) {
    if (await runTest(name, testFunction)) passed += 1;
    else failed += 1;
  }

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
