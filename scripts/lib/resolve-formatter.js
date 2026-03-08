/**
 * Shared formatter resolution utilities with caching.
 *
 * Extracts project-root discovery, formatter detection, and binary
 * resolution into a single module so that post-edit-format.js and
 * quality-gate.js avoid duplicating work and filesystem lookups.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Caches (per-process, cleared on next hook invocation) ───────────
const projectRootCache = new Map();
const formatterCache = new Map();
const binCache = new Map();

// ── Public helpers ──────────────────────────────────────────────────

/**
 * Walk up from `startDir` until a directory containing package.json is found.
 * Returns `startDir` as fallback when no package.json exists above it.
 *
 * @param {string} startDir - Absolute directory path to start from
 * @returns {string} Absolute path to the project root
 */
function findProjectRoot(startDir) {
  if (projectRootCache.has(startDir)) return projectRootCache.get(startDir);

  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      projectRootCache.set(startDir, dir);
      return dir;
    }
    dir = path.dirname(dir);
  }

  projectRootCache.set(startDir, startDir);
  return startDir;
}

/**
 * Detect the formatter configured in the project.
 * Biome takes priority over Prettier.
 *
 * @param {string} projectRoot - Absolute path to the project root
 * @returns {'biome' | 'prettier' | null}
 */
function detectFormatter(projectRoot) {
  if (formatterCache.has(projectRoot)) return formatterCache.get(projectRoot);

  const biomeConfigs = ['biome.json', 'biome.jsonc'];
  for (const cfg of biomeConfigs) {
    if (fs.existsSync(path.join(projectRoot, cfg))) {
      formatterCache.set(projectRoot, 'biome');
      return 'biome';
    }
  }

  const prettierConfigs = [
    '.prettierrc',
    '.prettierrc.json',
    '.prettierrc.js',
    '.prettierrc.cjs',
    '.prettierrc.mjs',
    '.prettierrc.yml',
    '.prettierrc.yaml',
    '.prettierrc.toml',
    'prettier.config.js',
    'prettier.config.cjs',
    'prettier.config.mjs',
  ];
  for (const cfg of prettierConfigs) {
    if (fs.existsSync(path.join(projectRoot, cfg))) {
      formatterCache.set(projectRoot, 'prettier');
      return 'prettier';
    }
  }

  formatterCache.set(projectRoot, null);
  return null;
}

/**
 * Resolve the formatter binary, preferring the local node_modules/.bin
 * installation over npx to avoid package-resolution overhead.
 *
 * @param {string} projectRoot - Absolute path to the project root
 * @param {'biome' | 'prettier'} formatter - Detected formatter name
 * @returns {{ bin: string, prefix: string[] }}
 *   `bin`    – executable path (absolute local path or npx/npx.cmd)
 *   `prefix` – extra args to prepend (e.g. ['@biomejs/biome'] when using npx)
 */
function resolveFormatterBin(projectRoot, formatter) {
  const cacheKey = `${projectRoot}:${formatter}`;
  if (binCache.has(cacheKey)) return binCache.get(cacheKey);

  const isWin = process.platform === 'win32';
  const npxBin = isWin ? 'npx.cmd' : 'npx';

  if (formatter === 'biome') {
    const localBin = path.join(
      projectRoot,
      'node_modules',
      '.bin',
      isWin ? 'biome.cmd' : 'biome',
    );
    if (fs.existsSync(localBin)) {
      const result = { bin: localBin, prefix: [] };
      binCache.set(cacheKey, result);
      return result;
    }
    const result = { bin: npxBin, prefix: ['@biomejs/biome'] };
    binCache.set(cacheKey, result);
    return result;
  }

  if (formatter === 'prettier') {
    const localBin = path.join(
      projectRoot,
      'node_modules',
      '.bin',
      isWin ? 'prettier.cmd' : 'prettier',
    );
    if (fs.existsSync(localBin)) {
      const result = { bin: localBin, prefix: [] };
      binCache.set(cacheKey, result);
      return result;
    }
    const result = { bin: npxBin, prefix: ['prettier'] };
    binCache.set(cacheKey, result);
    return result;
  }

  const result = { bin: npxBin, prefix: [] };
  binCache.set(cacheKey, result);
  return result;
}

/**
 * Clear all caches. Useful for testing.
 */
function clearCaches() {
  projectRootCache.clear();
  formatterCache.clear();
  binCache.clear();
}

module.exports = {
  findProjectRoot,
  detectFormatter,
  resolveFormatterBin,
  clearCaches,
};