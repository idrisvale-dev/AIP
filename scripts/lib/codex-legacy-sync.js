'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCHEMA = 'ecc.codex-legacy-sync.v1';
const BEGIN_MARKER = '<!-- BEGIN ECC -->';
const END_MARKER = '<!-- END ECC -->';

function getStatePath(codexHome) {
  return path.join(codexHome, 'ecc', 'legacy-sync-state.json');
}

function digestFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

function readState(statePath) {
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (state.schema !== SCHEMA || !Array.isArray(state.paths)) {
    throw new Error(`Invalid legacy Codex sync state at ${statePath}`);
  }
  return state;
}

function hasUnsafeManagedAncestor(filePath, codexHome) {
  const relativePath = path.relative(codexHome, filePath);
  if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return relativePath !== '';
  }
  const segments = relativePath.split(path.sep).slice(0, -1);
  let currentPath = codexHome;
  for (const segment of [null, ...segments]) {
    if (segment !== null) currentPath = path.join(currentPath, segment);
    try {
      const stat = fs.lstatSync(currentPath);
      if (stat.isSymbolicLink() || !stat.isDirectory()) return true;
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
  return false;
}

function isWithinRoot(filePath, rootPath) {
  const relativePath = path.relative(rootPath, filePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function getTrustedRoot(state, filePath) {
  const roots = Array.isArray(state.trustedRoots) && state.trustedRoots.length > 0
    ? state.trustedRoots
    : [state.codexHome];
  return roots
    .map(rootPath => path.resolve(rootPath))
    .find(rootPath => isWithinRoot(filePath, rootPath)) || null;
}

function snapshotLegacyPath(filePath) {
  let previousContentBase64 = null;
  let previousMode = null;
  let previousType = 'missing';
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isFile()) {
      previousType = 'file';
      previousContentBase64 = fs.readFileSync(filePath).toString('base64');
      previousMode = stat.mode & 0o777;
    } else {
      previousType = stat.isSymbolicLink() ? 'symlink' : 'other';
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (previousType === 'symlink' || previousType === 'other') {
    throw new Error(`Refusing to manage non-regular legacy sync path: ${filePath}`);
  }
  return {
    path: filePath,
    installedSha256: null,
    previousType,
    previousContentBase64,
    previousMode,
  };
}

function assertInstalledStateUnmodified(state) {
  for (const entry of state.paths) {
    const filePath = path.resolve(entry.path);
    const trustedRoot = getTrustedRoot(state, filePath);
    if (!trustedRoot || hasUnsafeManagedAncestor(filePath, trustedRoot)) {
      throw new Error(`Refusing to reuse unsafe legacy Codex ownership path: ${filePath}`);
    }
    let stat = null;
    try {
      stat = fs.lstatSync(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!entry.installedSha256) {
      if (stat) throw new Error(`Refusing to replace modified legacy Codex artifact: ${filePath}`);
      continue;
    }
    if (!stat || !stat.isFile() || digestFile(filePath) !== entry.installedSha256) {
      throw new Error(`Refusing to replace modified legacy Codex artifact: ${filePath}`);
    }
  }
}

function beginLegacySyncState(options) {
  const codexHome = path.resolve(options.codexHome);
  const statePath = getStatePath(codexHome);
  const configPath = path.join(codexHome, 'config.toml');
  const agentsPath = path.join(codexHome, 'AGENTS.md');
  const installedHooksPath = options.installedHooksPath ? path.resolve(options.installedHooksPath) : null;
  const priorState = fs.existsSync(statePath) ? readState(statePath) : null;
  if (priorState && priorState.status !== 'installed') {
    throw new Error(`Legacy Codex sync state requires recovery before reinstall: ${statePath}`);
  }
  if (priorState) assertInstalledStateUnmodified(priorState);
  const trustedRoots = [...new Set([
    codexHome,
    ...(Array.isArray(priorState?.trustedRoots) ? priorState.trustedRoots : []),
    ...(priorState?.installedHooksPath ? [priorState.installedHooksPath] : []),
    ...(installedHooksPath ? [installedHooksPath] : []),
  ].map(rootPath => path.resolve(rootPath)))];
  const state = priorState ? {
    ...priorState,
    status: 'applying',
    updatedAt: new Date().toISOString(),
    backupDir: options.backupDir ? path.resolve(options.backupDir) : priorState.backupDir,
    installedHooksPath,
    trustedRoots,
    rollbackPreviousHooksPath: options.previousHooksPath || null,
    rollbackPaths: priorState.paths.map(entry => snapshotLegacyPath(path.resolve(entry.path))),
    previousInstalledState: priorState,
  } : {
    schema: SCHEMA,
    status: 'applying',
    createdAt: new Date().toISOString(),
    codexHome,
    backupDir: options.backupDir ? path.resolve(options.backupDir) : null,
    previousHooksPath: options.previousHooksPath || null,
    installedHooksPath,
    trustedRoots,
    before: {},
    paths: [],
    rollbackPaths: [],
  };

  for (const [key, filePath] of [['config', configPath], ['agents', agentsPath]]) {
    if (priorState) break;
    if (fs.existsSync(filePath)) {
      const stat = fs.lstatSync(filePath);
      if (!stat.isFile()) {
        throw new Error(`Refusing to snapshot non-regular legacy sync path: ${filePath}`);
      }
      state.before[key] = fs.readFileSync(filePath, 'utf8');
    } else {
      state.before[key] = null;
    }
  }
  atomicWriteJson(statePath, state);
  return statePath;
}

function recordLegacySyncPath(options) {
  const state = readState(options.statePath);
  const filePath = path.resolve(options.filePath);
  const trustedRoot = getTrustedRoot(state, filePath);
  if (!trustedRoot) {
    throw new Error(`Refusing to record a legacy sync path outside trusted roots: ${filePath}`);
  }
  if (hasUnsafeManagedAncestor(filePath, trustedRoot)) {
    throw new Error(`Refusing to manage legacy sync path through symlinked ancestor: ${filePath}`);
  }
  if (!state.paths.some(entry => entry.path === filePath)) {
    const snapshot = snapshotLegacyPath(filePath);
    state.paths.push(snapshot);
    state.rollbackPaths = [...(state.rollbackPaths || []), { ...snapshot }];
    atomicWriteJson(options.statePath, state);
  }
}

function rollbackLegacyCodexSync(options) {
  const state = readState(options.statePath);
  const restoredPaths = [];
  const retainedPaths = [];

  const rollbackPaths = Array.isArray(state.rollbackPaths) ? state.rollbackPaths : state.paths;
  for (const entry of [...rollbackPaths].reverse()) {
    const filePath = path.resolve(entry.path);
    const trustedRoot = getTrustedRoot(state, filePath);
    if (!trustedRoot) {
      retainedPaths.push(filePath);
      continue;
    }
    if (hasUnsafeManagedAncestor(filePath, trustedRoot)) {
      retainedPaths.push(filePath);
      continue;
    }
    let currentStat = null;
    try {
      currentStat = fs.lstatSync(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (currentStat && !currentStat.isFile() && !currentStat.isSymbolicLink()) {
      retainedPaths.push(filePath);
      continue;
    }
    if (entry.previousType === 'file' && typeof entry.previousContentBase64 === 'string') {
      if (currentStat && currentStat.isSymbolicLink()) {
        retainedPaths.push(filePath);
        continue;
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(filePath, Buffer.from(entry.previousContentBase64, 'base64'), {
        mode: entry.previousMode || 0o600,
      });
      if (entry.previousMode) fs.chmodSync(filePath, entry.previousMode);
      restoredPaths.push(filePath);
    } else if (entry.previousType === 'missing' || entry.previousType === undefined) {
      if (currentStat) fs.rmSync(filePath, { force: true });
      restoredPaths.push(filePath);
    } else {
      retainedPaths.push(filePath);
    }
  }

  if (state.installedHooksPath) {
    const getHooks = options.getGlobalHooksPath || defaultGetHooksPath;
    const setHooks = options.setGlobalHooksPath || defaultSetHooksPath;
    const currentHooks = getHooks();
    if (currentHooks && path.resolve(currentHooks) === path.resolve(state.installedHooksPath)) {
      setHooks(state.rollbackPreviousHooksPath ?? state.previousHooksPath ?? '');
    } else if (currentHooks && currentHooks !== (state.rollbackPreviousHooksPath ?? state.previousHooksPath)) {
      retainedPaths.push(`git:core.hooksPath=${currentHooks}`);
    }
  }

  if (retainedPaths.length === 0) {
    if (state.previousInstalledState) {
      atomicWriteJson(options.statePath, state.previousInstalledState);
    } else {
      fs.rmSync(options.statePath, { force: true });
    }
  }
  return {
    status: retainedPaths.length === 0 ? 'rolled-back' : 'partial',
    statePath: options.statePath,
    restoredPaths,
    retainedPaths: [...new Set(retainedPaths)].sort(),
  };
}

function finalizeLegacySyncState(options) {
  const state = readState(options.statePath);
  state.status = 'installed';
  state.installedAt = new Date().toISOString();
  delete state.rollbackPaths;
  delete state.rollbackPreviousHooksPath;
  delete state.previousInstalledState;
  state.paths = state.paths.map(entry => ({
    ...entry,
    installedSha256: getTrustedRoot(state, path.resolve(entry.path))
      && !hasUnsafeManagedAncestor(entry.path, getTrustedRoot(state, path.resolve(entry.path)))
      && fs.existsSync(entry.path)
      && fs.lstatSync(entry.path).isFile()
      ? digestFile(entry.path)
      : null,
  }));
  atomicWriteJson(options.statePath, state);
  return state;
}

function stripMarkerBlock(content) {
  const markers = [];
  let fence = null;
  let offset = 0;
  for (const lineWithEnding of content.match(/.*(?:\r?\n|$)/g) || []) {
    if (lineWithEnding === '') continue;
    const line = lineWithEnding.replace(/\r?\n$/, '');
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const run = fenceMatch[1];
      const marker = run[0];
      if (!fence) {
        fence = { marker, length: run.length };
      } else if (
        marker === fence.marker
        && run.length >= fence.length
        && fenceMatch[2].trim() === ''
      ) {
        fence = null;
      }
    } else if (!fence && (line === BEGIN_MARKER || line === END_MARKER)) {
      markers.push({ marker: line, index: offset });
    }
    offset += lineWithEnding.length;
  }
  const begins = markers.filter(match => match.marker === BEGIN_MARKER);
  const ends = markers.filter(match => match.marker === END_MARKER);
  if (begins.length !== 1 || ends.length !== 1 || ends[0].index < begins[0].index) {
    return content;
  }
  const suffixStart = ends[0].index + END_MARKER.length;
  const suffixWithLineEnding = content.slice(suffixStart).replace(/^\r?\n/, '');
  return `${content.slice(0, begins[0].index)}${suffixWithLineEnding}`;
}

function defaultGetHooksPath() {
  try {
    return execFileSync('git', ['config', '--global', '--get', 'core.hooksPath'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
    }).trim();
  } catch (_error) {
    return '';
  }
}

function defaultSetHooksPath(value) {
  const args = value
    ? ['config', '--global', 'core.hooksPath', value]
    : ['config', '--global', '--unset-all', 'core.hooksPath'];
  try {
    execFileSync('git', args, { stdio: 'ignore', timeout: 5000 });
  } catch (error) {
    if (value || error.status !== 5) throw error;
  }
}

function listLegacyCandidates(codexHome) {
  const candidates = [];
  const promptsDir = path.join(codexHome, 'prompts');
  if (fs.existsSync(promptsDir)) {
    for (const entry of fs.readdirSync(promptsDir)) {
      if (entry.startsWith('ecc-') || entry.startsWith('ecc_') || entry.includes('ecc-rules-pack')) {
        candidates.push(path.join(promptsDir, entry));
      }
    }
  }
  for (const relativePath of [
    'docs/CODEX-NAVIGATION-GUIDE.md',
    'docs/COMMAND-AGENT-MAP.md',
    'COMMANDS-QUICK-REF.md',
    'CONTRIBUTING.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    'ecc-prompts-manifest.txt',
    'ecc-extension-prompts-manifest.txt',
  ]) {
    const candidate = path.join(codexHome, relativePath);
    if (fs.existsSync(candidate)) candidates.push(candidate);
  }
  return candidates;
}

function uninstallLegacyCodexSync(options = {}) {
  const codexHome = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(process.env.HOME || os.homedir(), '.codex'));
  const statePath = getStatePath(codexHome);
  const dryRun = options.dryRun === true;
  const retainedPaths = [];
  const plannedRemovals = [];
  const removedPaths = [];
  const agentsPath = path.join(codexHome, 'AGENTS.md');
  const state = fs.existsSync(statePath) ? readState(statePath) : null;

  if (!state) {
    if (fs.existsSync(agentsPath)) {
      const agentsStat = fs.lstatSync(agentsPath);
      if (!agentsStat.isFile()) {
        retainedPaths.push(agentsPath);
      } else {
        const content = fs.readFileSync(agentsPath, 'utf8');
        const stripped = stripMarkerBlock(content);
        if (stripped !== content) {
          plannedRemovals.push(`${agentsPath}#ecc-marker-block`);
          if (!dryRun) fs.writeFileSync(agentsPath, stripped, 'utf8');
        }
      }
    }
    retainedPaths.push(...listLegacyCandidates(codexHome));
    return {
      status: dryRun ? 'planned' : retainedPaths.length > 0 ? 'partial' : plannedRemovals.length > 0 ? 'uninstalled' : 'not-found',
      statePath: null,
      plannedRemovals,
      removedPaths,
      retainedPaths: [...new Set(retainedPaths)].sort(),
      warnings: retainedPaths.length > 0
        ? ['Legacy Codex artifacts without an ownership manifest were preserved for manual review.']
        : [],
    };
  }

  for (const entry of state.paths) {
    const filePath = path.resolve(entry.path);
    const trustedRoot = getTrustedRoot(state, filePath);
    if (!trustedRoot) {
      retainedPaths.push(filePath);
      continue;
    }
    if (hasUnsafeManagedAncestor(filePath, trustedRoot)) {
      retainedPaths.push(filePath);
      continue;
    }
    if (!fs.existsSync(filePath)) continue;
    const currentStat = fs.lstatSync(filePath);
    const matches = entry.installedSha256 && currentStat.isFile()
      ? digestFile(filePath) === entry.installedSha256
      : false;
    if (!matches) {
      retainedPaths.push(filePath);
      continue;
    }
    plannedRemovals.push(filePath);
    if (!dryRun) {
      if (entry.previousType === 'file' && typeof entry.previousContentBase64 === 'string') {
        fs.writeFileSync(filePath, Buffer.from(entry.previousContentBase64, 'base64'), {
          mode: entry.previousMode || 0o600,
        });
      } else if (entry.previousType === 'missing' || entry.previousType === undefined) {
        fs.rmSync(filePath, { force: true });
      } else {
        retainedPaths.push(filePath);
        continue;
      }
      removedPaths.push(filePath);
    }
  }

  if (state.installedHooksPath) {
    const getHooks = options.getGlobalHooksPath || defaultGetHooksPath;
    const setHooks = options.setGlobalHooksPath || defaultSetHooksPath;
    const currentHooks = getHooks();
    if (path.resolve(currentHooks || '.') === path.resolve(state.installedHooksPath)) {
      if (!dryRun) setHooks(state.previousHooksPath || '');
    } else if (currentHooks) {
      retainedPaths.push(`git:core.hooksPath=${currentHooks}`);
    }
  }

  if (!dryRun && retainedPaths.length === 0) {
    fs.rmSync(statePath, { force: true });
  }
  return {
    status: dryRun ? 'planned' : retainedPaths.length > 0 ? 'partial' : 'uninstalled',
    statePath,
    plannedRemovals: [...new Set(plannedRemovals)],
    removedPaths,
    retainedPaths: [...new Set(retainedPaths)].sort(),
    warnings: retainedPaths.length > 0
      ? ['Modified or unverifiable legacy Codex artifacts were preserved.']
      : [],
  };
}

module.exports = {
  BEGIN_MARKER,
  END_MARKER,
  SCHEMA,
  beginLegacySyncState,
  finalizeLegacySyncState,
  getStatePath,
  recordLegacySyncPath,
  rollbackLegacyCodexSync,
  stripMarkerBlock,
  uninstallLegacyCodexSync,
};
