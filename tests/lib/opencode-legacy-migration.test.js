'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyInstallPlan } = require('../../scripts/lib/install/apply');
const { createManifestInstallPlan } = require('../../scripts/lib/install-executor');
const {
  buildDoctorReport,
  discoverInstalledStates,
  repairInstalledStates,
  uninstallInstalledStates,
} = require('../../scripts/lib/install-lifecycle');
const { createInstallState, writeInstallState } = require('../../scripts/lib/install-state');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SOURCE_RELATIVE_PATH = path.join('skills', 'skill-comply', 'SKILL.md');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

function digest(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function seedLegacyInstall(homeDir, options = {}) {
  const targetRoot = path.join(homeDir, '.opencode');
  const installStatePath = path.join(targetRoot, 'ecc-install-state.json');
  const destinationPath = path.join(targetRoot, SOURCE_RELATIVE_PATH);
  const sourceContent = fs.readFileSync(path.join(REPO_ROOT, SOURCE_RELATIVE_PATH));
  const installedContent = options.modified ? Buffer.from('user-modified\n') : sourceContent;
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.writeFileSync(destinationPath, installedContent);

  const operation = {
    kind: 'copy-file',
    moduleId: 'workflow-quality',
    sourceRelativePath: SOURCE_RELATIVE_PATH,
    destinationPath,
    strategy: 'preserve-relative-path',
    ownership: 'managed',
    scaffoldOnly: false,
    contentSha256: digest(sourceContent),
  };
  const state = createInstallState({
    adapter: { id: 'opencode-home', target: 'opencode', kind: 'home' },
    targetRoot,
    installStatePath,
    request: {
      profile: null,
      modules: ['workflow-quality'],
      includeComponents: [],
      excludeComponents: [],
      legacyLanguages: [],
      legacyMode: false,
    },
    resolution: { selectedModules: ['workflow-quality'], skippedModules: [] },
    source: {
      repoVersion: require('../../package.json').version,
      repoCommit: 'legacy-opencode-test',
      manifestVersion: require('../../manifests/install-modules.json').version,
    },
    operations: [operation],
  });
  writeInstallState(installStatePath, state);
  return { targetRoot, installStatePath, destinationPath };
}

function canonicalPlan(homeDir) {
  return createManifestInstallPlan({
    sourceRoot: REPO_ROOT,
    target: 'opencode',
    moduleIds: ['workflow-quality'],
    projectRoot: homeDir,
    homeDir,
  });
}

console.log('\n=== Testing OpenCode legacy migration ===\n');

test('discovery and doctor surface the legacy managed root', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-legacy-discover-'));
  try {
    const legacy = seedLegacyInstall(homeDir);
    const records = discoverInstalledStates({ homeDir, projectRoot: homeDir, targets: ['opencode'] });
    assert.strictEqual(records.length, 2);
    assert.strictEqual(records[0].exists, false);
    assert.strictEqual(records[1].installStatePath, legacy.installStatePath);
    assert.strictEqual(records[1].legacyLayout, 'opencode');

    const doctor = buildDoctorReport({
      repoRoot: REPO_ROOT,
      homeDir,
      projectRoot: homeDir,
      targets: ['opencode'],
    });
    assert.ok(doctor.results.some(result => (
      result.issues.some(issue => issue.code === 'legacy-opencode-layout')
    )));
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('uninstall removes unchanged legacy-managed files and preserves user content', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-legacy-uninstall-'));
  try {
    const legacy = seedLegacyInstall(homeDir);
    const sentinelPath = path.join(legacy.targetRoot, 'user.txt');
    fs.writeFileSync(sentinelPath, 'keep\n');
    const result = uninstallInstalledStates({ homeDir, projectRoot: homeDir, targets: ['opencode'] });
    assert.strictEqual(result.summary.errorCount, 0);
    assert.ok(!fs.existsSync(legacy.destinationPath));
    assert.ok(!fs.existsSync(legacy.installStatePath));
    assert.strictEqual(fs.readFileSync(sentinelPath, 'utf8'), 'keep\n');
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('a canonical install migrates unchanged legacy ownership', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-legacy-apply-'));
  try {
    const legacy = seedLegacyInstall(homeDir);
    const result = applyInstallPlan(canonicalPlan(homeDir));
    assert.ok(result.applied);
    assert.ok(fs.existsSync(path.join(homeDir, '.config', 'opencode', 'ecc-install-state.json')));
    assert.ok(!fs.existsSync(legacy.installStatePath));
    assert.ok(!fs.existsSync(legacy.destinationPath));
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('repair migrates a legacy install while preserving modified legacy files', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-legacy-repair-'));
  try {
    const legacy = seedLegacyInstall(homeDir, { modified: true });
    const result = repairInstalledStates({
      repoRoot: REPO_ROOT,
      homeDir,
      projectRoot: homeDir,
      targets: ['opencode'],
    });
    assert.strictEqual(result.summary.errorCount, 0);
    assert.ok(fs.existsSync(path.join(homeDir, '.config', 'opencode', 'ecc-install-state.json')));
    assert.strictEqual(fs.readFileSync(legacy.destinationPath, 'utf8'), 'user-modified\n');
    assert.ok(fs.existsSync(legacy.installStatePath));
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
