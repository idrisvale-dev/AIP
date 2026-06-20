'use strict';

/**
 * Control-pane integration for the agent-space proximity metric.
 *
 * Turns live sessions into agent working sets (the files each session's worktree
 * has changed), builds the dependency graph over those files, and runs the
 * TCAS-style airspace scan — so the board can surface "two agents are converging"
 * advisories and a 3D position per agent. See docs/design/agent-proximity.md.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const { scanAirspace } = require('../agent-proximity');
const { buildDependencyGraph } = require('../agent-proximity/graph');

/**
 * Default working-set source: `git diff --name-only <base>` inside a session's
 * worktree, returning repo-relative changed files. Returns [] on any failure so
 * proximity degrades gracefully (never throws into the snapshot path).
 */
function defaultChangedFilesFor(session) {
  const wt = session && session.worktree;
  if (!wt || !wt.path) return [];
  const base = wt.base || 'HEAD';
  try {
    const out = execFileSync('git', ['-C', wt.path, 'diff', '--name-only', `${base}...HEAD`], {
      encoding: 'utf8',
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return out
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Map sessions to agent working sets. Only sessions with a worktree and at least
 * one changed file participate (an agent with no edits cannot collide).
 */
function sessionsToAgents(sessions, deps = {}) {
  const changedFilesFor = deps.changedFilesFor || defaultChangedFilesFor;
  const agents = [];
  for (const session of sessions || []) {
    const files = changedFilesFor(session).map(p => ({ path: p, weight: 1 }));
    if (files.length === 0) continue;
    agents.push({
      agentId: session.id,
      label: session.task || session.id,
      startedAt: session.createdAt || null,
      files
    });
  }
  return agents;
}

/**
 * Compute the proximity snapshot from the control-pane sessions.
 *
 * @param {Array} sessions normalized control-pane sessions
 * @param {object} [options] { repoRoot, changedFilesFor, ...scanOptions }
 * @returns {{ enabled, advisories, positions, links, counts }}
 */
function buildProximitySnapshot(sessions, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..', '..', '..'));
  const agents = sessionsToAgents(sessions, options);

  // Need at least two participating agents for a collision to be possible.
  if (agents.length < 2) {
    return {
      enabled: true,
      advisories: [],
      positions: agents.map(a => ({ agentId: a.agentId, position: [0, 0, 0], fileCount: a.files.length })),
      links: [],
      counts: { agents: agents.length, advisories: 0, resolutions: 0 }
    };
  }

  const touched = [...new Set(agents.flatMap(a => a.files.map(f => f.path)))];
  let graph = { adjacency: {}, files: [] };
  try {
    graph = options.graph || buildDependencyGraph(repoRoot, touched, options.graphDeps || {});
  } catch {
    graph = { adjacency: {}, files: [] };
  }

  const scan = scanAirspace(agents, graph, options);
  const labels = new Map(agents.map(a => [a.agentId, a.label]));
  return {
    enabled: true,
    advisories: scan.advisories.map(adv => ({
      ...adv,
      aLabel: labels.get(adv.a) || adv.a,
      bLabel: labels.get(adv.b) || adv.b
    })),
    positions: scan.positions,
    links: scan.links,
    counts: scan.counts
  };
}

module.exports = {
  buildProximitySnapshot,
  sessionsToAgents,
  defaultChangedFilesFor
};
