'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyInstallPlan } = require('../../scripts/lib/install/apply');
const { readInstallState } = require('../../scripts/lib/install-state');
const { uninstallInstalledStates } = require('../../scripts/lib/install-lifecycle');

function makePlan(root, moduleId, fileName) {
  const targetRoot = path.join(root, '.cursor');
  const installStatePath = path.join(targetRoot, 'ecc-install-state.json');
  const sourcePath = path.join(root, 'source', moduleId, fileName);
  const destinationPath = path.join(targetRoot, 'skills', moduleId, fileName);
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, `${moduleId}\n`);
  const operation = {
    kind: 'copy-file',
    moduleId,
    sourcePath,
    sourceRelativePath: path.join('skills', moduleId, fileName),
    destinationPath,
    strategy: 'preserve-relative-path',
    ownership: 'managed',
    scaffoldOnly: false,
  };
  return {
    mode: 'manifest',
    target: 'cursor',
    adapter: { id: 'cursor-project', target: 'cursor', kind: 'project' },
    targetRoot,
    installRoot: targetRoot,
    installStatePath,
    operations: [operation],
    statePreview: {
      schemaVersion: 'ecc.install.v1',
      installedAt: new Date().toISOString(),
      target: {
        id: 'cursor-project',
        target: 'cursor',
        kind: 'project',
        root: targetRoot,
        installStatePath,
      },
      request: {
        profile: null,
        modules: [moduleId],
        includeComponents: [],
        excludeComponents: [],
        legacyLanguages: [],
        legacyMode: false,
      },
      resolution: { selectedModules: [moduleId], skippedModules: [] },
      source: { manifestVersion: 1 },
      operations: [operation],
    },
    warnings: [],
  };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-selective-reinstall-'));
try {
  const first = makePlan(root, 'first-module', 'FIRST.md');
  const second = makePlan(root, 'second-module', 'SECOND.md');
  applyInstallPlan(first);
  applyInstallPlan(second);

  const state = readInstallState(first.installStatePath);
  assert.deepStrictEqual(
    new Set(state.operations.map(operation => operation.moduleId)),
    new Set(['first-module', 'second-module']),
    'a later selective install must preserve earlier managed ownership'
  );

  const result = uninstallInstalledStates({ projectRoot: root, targets: ['cursor'] });
  assert.strictEqual(result.summary.errorCount, 0);
  assert.ok(!fs.existsSync(first.operations[0].destinationPath));
  assert.ok(!fs.existsSync(second.operations[0].destinationPath));
  console.log('  ✓ selective reinstall preserves cumulative ownership and uninstall removes it');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
