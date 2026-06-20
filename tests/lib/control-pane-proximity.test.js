'use strict';
/**
 * Tests for the control-pane proximity integration (sessions -> airspace scan).
 */

const assert = require('assert');

const { buildProximitySnapshot, sessionsToAgents } = require('../../scripts/lib/control-pane/proximity');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    passed += 1;
  } catch (e) {
    console.log(`  FAIL ${name}`);
    console.log(`    ${e.message}`);
    failed += 1;
  }
}

const sessions = [
  {
    id: 'lead-hermes',
    task: 'Build the API',
    createdAt: '2026-06-19T10:00:00Z',
    worktree: { path: '/wt/lead', base: 'main' }
  },
  {
    id: 'worker-kb',
    task: 'Also touch the API',
    createdAt: '2026-06-19T10:05:00Z',
    worktree: { path: '/wt/worker', base: 'main' }
  },
  {
    id: 'docs-bot',
    task: 'Write docs',
    createdAt: '2026-06-19T10:06:00Z',
    worktree: { path: '/wt/docs', base: 'main' }
  },
  { id: 'no-worktree', task: 'idle', createdAt: '2026-06-19T10:07:00Z', worktree: null }
];

// Injected working sets: lead + worker both edit the same API file (collision);
// docs-bot edits an unrelated file (clear).
const changedFilesFor = session =>
  ({
    'lead-hermes': ['src/api/users.js'],
    'worker-kb': ['src/api/users.js'],
    'docs-bot': ['docs/guide.md'],
    'no-worktree': []
  })[session.id] || [];

test('sessionsToAgents: only worktree sessions with edits participate', () => {
  const agents = sessionsToAgents(sessions, { changedFilesFor });
  assert.deepStrictEqual(agents.map(a => a.agentId).sort(), ['docs-bot', 'lead-hermes', 'worker-kb']);
  assert.strictEqual(agents.find(a => a.agentId === 'lead-hermes').files[0].path, 'src/api/users.js');
});

test('buildProximitySnapshot: same-file editors get a resolution; the later one steers', () => {
  const prox = buildProximitySnapshot(sessions, { changedFilesFor, graph: { adjacency: {} } });
  assert.strictEqual(prox.enabled, true);
  assert.strictEqual(prox.counts.agents, 3);
  const collision = prox.advisories.find(a => [a.a, a.b].includes('lead-hermes') && [a.a, a.b].includes('worker-kb'));
  assert.ok(collision, 'lead/worker should produce an advisory');
  assert.strictEqual(collision.level, 'resolution', `level ${collision.level} risk ${collision.risk}`);
  // lead started earlier ⇒ holds; worker steers.
  assert.strictEqual(collision.steer, 'worker-kb');
  assert.strictEqual(collision.hold, 'lead-hermes');
  // docs-bot is clear of both.
  assert.ok(!prox.advisories.some(a => a.a === 'docs-bot' || a.b === 'docs-bot'));
  // every participating agent gets a 3D position.
  assert.strictEqual(prox.positions.length, 3);
});

test('buildProximitySnapshot: fewer than two participants ⇒ no advisories', () => {
  const single = buildProximitySnapshot([sessions[0]], { changedFilesFor });
  assert.strictEqual(single.counts.agents, 1);
  assert.strictEqual(single.advisories.length, 0);
});

test('buildProximitySnapshot: advisories carry human-readable labels', () => {
  const prox = buildProximitySnapshot(sessions, { changedFilesFor, graph: { adjacency: {} } });
  const collision = prox.advisories[0];
  assert.ok(collision.aLabel && collision.bLabel, 'labels present');
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
