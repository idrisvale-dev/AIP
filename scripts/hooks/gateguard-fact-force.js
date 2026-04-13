#!/usr/bin/env node
/**
 * PreToolUse Hook: GateGuard Fact-Forcing Gate
 *
 * Forces Claude to investigate before editing files or running commands.
 * Instead of asking "are you sure?" (which LLMs always answer "yes"),
 * this hook demands concrete facts: importers, public API, data schemas.
 *
 * The act of investigation creates awareness that self-evaluation never did.
 *
 * Gates:
 *   - Edit/Write: list importers, affected API, verify data schemas, quote instruction
 *   - Bash (destructive): list targets, rollback plan, quote instruction
 *   - Bash (routine): quote current instruction (once per session)
 *
 * Compatible with run-with-flags.js via module.exports.run().
 * Cross-platform (Windows, macOS, Linux).
 *
 * Full package with config support: pip install gateguard-ai
 * Repo: https://github.com/zunoworks/gateguard
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Session state — scoped per session to avoid cross-session races.
// Uses CLAUDE_SESSION_ID (set by Claude Code) or falls back to PID-based isolation.
const STATE_DIR = process.env.GATEGUARD_STATE_DIR || path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.gateguard');
const SESSION_ID = process.env.CLAUDE_SESSION_ID || process.env.ECC_SESSION_ID || `pid-${process.ppid || process.pid}`;
const STATE_FILE = path.join(STATE_DIR, `state-${SESSION_ID.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);

// State expires after 30 minutes of inactivity
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

// Maximum checked entries to prevent unbounded growth
const MAX_CHECKED_ENTRIES = 500;

const DESTRUCTIVE_BASH = /\b(rm\s+-rf|git\s+reset\s+--hard|git\s+checkout\s+--|git\s+clean\s+-f|drop\s+table|delete\s+from|truncate|git\s+push\s+--force|dd\s+if=)\b/i;

// --- State management (per-session, atomic writes, bounded) ---

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      const lastActive = state.last_active || 0;
      if (Date.now() - lastActive > SESSION_TIMEOUT_MS) {
        try { fs.unlinkSync(STATE_FILE); } catch (_) { /* ignore */ }
        return { checked: [], last_active: Date.now() };
      }
      return state;
    }
  } catch (_) { /* ignore */ }
  return { checked: [], last_active: Date.now() };
}

function saveState(state) {
  try {
    state.last_active = Date.now();
    // Prune checked list if it exceeds the cap
    if (state.checked.length > MAX_CHECKED_ENTRIES) {
      state.checked = state.checked.slice(-MAX_CHECKED_ENTRIES);
    }
    fs.mkdirSync(STATE_DIR, { recursive: true });
    // Atomic write: temp file + rename prevents partial reads
    const tmpFile = STATE_FILE + '.tmp.' + process.pid;
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmpFile, STATE_FILE);
  } catch (_) { /* ignore */ }
}

function markChecked(key) {
  const state = loadState();
  if (!state.checked.includes(key)) {
    state.checked.push(key);
    saveState(state);
  }
}

function isChecked(key) {
  const state = loadState();
  saveState(state);
  return state.checked.includes(key);
}

// Prune stale session files older than 1 hour
(function pruneStaleFiles() {
  try {
    const files = fs.readdirSync(STATE_DIR);
    const now = Date.now();
    for (const f of files) {
      if (!f.startsWith('state-') || !f.endsWith('.json')) continue;
      const fp = path.join(STATE_DIR, f);
      const stat = fs.statSync(fp);
      if (now - stat.mtimeMs > SESSION_TIMEOUT_MS * 2) {
        fs.unlinkSync(fp);
      }
    }
  } catch (_) { /* ignore */ }
})();

// --- Sanitize file path against injection ---

function sanitizePath(filePath) {
  return filePath.replace(/[\n\r]/g, ' ').trim().slice(0, 500);
}

// --- Gate messages ---

function editGateMsg(filePath) {
  const safe = sanitizePath(filePath);
  return [
    '[Fact-Forcing Gate]',
    '',
    `Before editing ${safe}, present these facts:`,
    '',
    '1. List ALL files that import/require this file (use Grep)',
    '2. List the public functions/classes affected by this change',
    '3. If this file reads/writes data files, cat one real record and show actual field names, structure, and date format',
    '4. Quote the user\'s current instruction verbatim',
    '',
    'Present the facts, then retry the same operation.'
  ].join('\n');
}

function writeGateMsg(filePath) {
  const safe = sanitizePath(filePath);
  return [
    '[Fact-Forcing Gate]',
    '',
    `Before creating ${safe}, present these facts:`,
    '',
    '1. Name the file(s) and line(s) that will call this new file',
    '2. Confirm no existing file serves the same purpose (use Glob)',
    '3. If this file reads/writes data files, cat one real record and show actual field names, structure, and date format',
    '4. Quote the user\'s current instruction verbatim',
    '',
    'Present the facts, then retry the same operation.'
  ].join('\n');
}

function destructiveBashMsg() {
  return [
    '[Fact-Forcing Gate]',
    '',
    'Destructive command detected. Before running, present:',
    '',
    '1. List all files/data this command will modify or delete',
    '2. Write a one-line rollback procedure',
    '3. Quote the user\'s current instruction verbatim',
    '',
    'Present the facts, then retry the same operation.'
  ].join('\n');
}

function routineBashMsg() {
  return [
    '[Fact-Forcing Gate]',
    '',
    'Quote the user\'s current instruction verbatim.',
    'Then retry the same operation.'
  ].join('\n');
}

// --- Deny helper ---

function denyResult(reason) {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason
      }
    }),
    exitCode: 0
  };
}

// --- Core logic (exported for run-with-flags.js) ---

function run(rawInput) {
  let data;
  try {
    data = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
  } catch (_) {
    return rawInput; // allow on parse error
  }

  const toolName = data.tool_name || '';
  const toolInput = data.tool_input || {};

  if (toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'Write') {
    const filePath = toolInput.file_path || '';
    if (!filePath) {
      return rawInput; // allow
    }

    if (!isChecked(filePath)) {
      markChecked(filePath);
      const msg = (toolName === 'Edit' || toolName === 'MultiEdit')
        ? editGateMsg(filePath) : writeGateMsg(filePath);
      return denyResult(msg);
    }

    return rawInput; // allow
  }

  if (toolName === 'Bash') {
    const command = toolInput.command || '';

    if (DESTRUCTIVE_BASH.test(command)) {
      // Gate destructive commands on first attempt; allow retry after facts presented
      const key = '__destructive__' + command.slice(0, 200);
      if (!isChecked(key)) {
        markChecked(key);
        return denyResult(destructiveBashMsg());
      }
      return rawInput; // allow retry after facts presented
    }

    if (!isChecked('__bash_session__')) {
      markChecked('__bash_session__');
      return denyResult(routineBashMsg());
    }

    return rawInput; // allow
  }

  return rawInput; // allow
}

module.exports = { run };
