/**
 * Tests for scripts/lib/resolve-formatter.js
 *
 * Run with: node tests/lib/resolve-formatter.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  findProjectRoot,
  detectFormatter,
  resolveFormatterBin,
  clearCaches,
} = require('../../scripts/lib/resolve-formatter');

// Test helper
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-fmt-'));
}

function runTests() {
  console.log('\n=== Testing resolve-formatter.js ===\n');

  let passed = 0;
  let failed = 0;

  function run(name, fn) {
    clearCaches();
    if (test(name, fn)) passed++;
    else failed++;
  }

  // ── findProjectRoot ───────────────────────────────────────────

  run('findProjectRoot: finds package.json in parent dir', () => {
    const root = makeTmpDir();
    const sub = path.join(root, 'src', 'lib');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{}');

    assert.strictEqual(findProjectRoot(sub), root);
  });

  run('findProjectRoot: returns startDir when no package.json', () => {
    const root = makeTmpDir();
    const sub = path.join(root, 'deep');
    fs.mkdirSync(sub, { recursive: true });

    // No package.json anywhere in tmp → falls back to startDir
    assert.strictEqual(findProjectRoot(sub), sub);
  });

  run('findProjectRoot: caches result for same startDir', () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, 'package.json'), '{}');

    const first = findProjectRoot(root);
    // Remove package.json — cache should still return the old result
    fs.unlinkSync(path.join(root, 'package.json'));
    const second = findProjectRoot(root);

    assert.strictEqual(first, second);
  });

  // ── detectFormatter ───────────────────────────────────────────

  run('detectFormatter: detects biome.json', () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, 'biome.json'), '{}');
    assert.strictEqual(detectFormatter(root), 'biome');
  });

  run('detectFormatter: detects biome.jsonc', () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, 'biome.jsonc'), '{}');
    assert.strictEqual(detectFormatter(root), 'biome');
  });

  run('detectFormatter: detects .prettierrc', () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, '.prettierrc'), '{}');
    assert.strictEqual(detectFormatter(root), 'prettier');
  });

  run('detectFormatter: detects prettier.config.js', () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, 'prettier.config.js'), 'module.exports = {}');
    assert.strictEqual(detectFormatter(root), 'prettier');
  });

  run('detectFormatter: biome takes priority over prettier', () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, 'biome.json'), '{}');
    fs.writeFileSync(path.join(root, '.prettierrc'), '{}');
    assert.strictEqual(detectFormatter(root), 'biome');
  });

  run('detectFormatter: returns null when no config found', () => {
    const root = makeTmpDir();
    assert.strictEqual(detectFormatter(root), null);
  });

  // ── resolveFormatterBin ───────────────────────────────────────

  run('resolveFormatterBin: uses local biome binary when available', () => {
    const root = makeTmpDir();
    const binDir = path.join(root, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    const binName = process.platform === 'win32' ? 'biome.cmd' : 'biome';
    fs.writeFileSync(path.join(binDir, binName), '');

    const result = resolveFormatterBin(root, 'biome');
    assert.strictEqual(result.bin, path.join(binDir, binName));
    assert.deepStrictEqual(result.prefix, []);
  });

  run('resolveFormatterBin: falls back to npx for biome', () => {
    const root = makeTmpDir();
    const result = resolveFormatterBin(root, 'biome');
    const expectedBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    assert.strictEqual(result.bin, expectedBin);
    assert.deepStrictEqual(result.prefix, ['@biomejs/biome']);
  });

  run('resolveFormatterBin: uses local prettier binary when available', () => {
    const root = makeTmpDir();
    const binDir = path.join(root, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    const binName = process.platform === 'win32' ? 'prettier.cmd' : 'prettier';
    fs.writeFileSync(path.join(binDir, binName), '');

    const result = resolveFormatterBin(root, 'prettier');
    assert.strictEqual(result.bin, path.join(binDir, binName));
    assert.deepStrictEqual(result.prefix, []);
  });

  run('resolveFormatterBin: falls back to npx for prettier', () => {
    const root = makeTmpDir();
    const result = resolveFormatterBin(root, 'prettier');
    const expectedBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    assert.strictEqual(result.bin, expectedBin);
    assert.deepStrictEqual(result.prefix, ['prettier']);
  });

  run('resolveFormatterBin: caches resolved binary', () => {
    const root = makeTmpDir();
    const binDir = path.join(root, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    const binName = process.platform === 'win32' ? 'biome.cmd' : 'biome';
    fs.writeFileSync(path.join(binDir, binName), '');

    const first = resolveFormatterBin(root, 'biome');
    fs.unlinkSync(path.join(binDir, binName));
    const second = resolveFormatterBin(root, 'biome');

    assert.strictEqual(first.bin, second.bin);
  });

  // ── clearCaches ───────────────────────────────────────────────

  run('clearCaches: clears all cached values', () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    fs.writeFileSync(path.join(root, 'biome.json'), '{}');

    findProjectRoot(root);
    detectFormatter(root);
    resolveFormatterBin(root, 'biome');

    clearCaches();

    // After clearing, removing config should change detection
    fs.unlinkSync(path.join(root, 'biome.json'));
    assert.strictEqual(detectFormatter(root), null);
  });

  // ── Summary ───────────────────────────────────────────────────

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
