#!/usr/bin/env node
/**
 * Session Activity Tracker Hook
 *
 * PostToolUse hook that records sanitized per-tool activity to
 * ~/.claude/metrics/tool-usage.jsonl for ECC2 metric sync.
 */

'use strict';

const crypto = require('crypto');
const path = require('path');
const {
  appendFile,
  getClaudeDir,
  stripAnsi,
} = require('../lib/utils');

const MAX_STDIN = 1024 * 1024;
const METRICS_FILE_NAME = 'tool-usage.jsonl';
const FILE_PATH_KEYS = new Set([
  'file_path',
  'file_paths',
  'source_path',
  'destination_path',
  'old_file_path',
  'new_file_path',
]);

function redactSecrets(value) {
  return String(value || '')
    .replace(/\n/g, ' ')
    .replace(/--token[= ][^ ]*/g, '--token=<REDACTED>')
    .replace(/Authorization:[: ]*[^ ]*[: ]*[^ ]*/gi, 'Authorization:<REDACTED>')
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, '<REDACTED>')
    .replace(/\bASIA[A-Z0-9]{16}\b/g, '<REDACTED>')
    .replace(/password[= ][^ ]*/gi, 'password=<REDACTED>')
    .replace(/\bghp_[A-Za-z0-9_]+\b/g, '<REDACTED>')
    .replace(/\bgho_[A-Za-z0-9_]+\b/g, '<REDACTED>')
    .replace(/\bghs_[A-Za-z0-9_]+\b/g, '<REDACTED>')
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, '<REDACTED>');
}

function truncateSummary(value, maxLength = 220) {
  const normalized = stripAnsi(redactSecrets(value)).trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function pushPathCandidate(paths, value) {
  const candidate = String(value || '').trim();
  if (!candidate) {
    return;
  }
  if (/^(https?:\/\/|app:\/\/|plugin:\/\/|mcp:\/\/)/i.test(candidate)) {
    return;
  }
  if (!paths.includes(candidate)) {
    paths.push(candidate);
  }
}

function collectFilePaths(value, paths) {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectFilePaths(entry, paths);
    }
    return;
  }

  if (typeof value === 'string') {
    pushPathCandidate(paths, value);
    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (FILE_PATH_KEYS.has(key)) {
      collectFilePaths(nested, paths);
    }
  }
}

function extractFilePaths(toolInput) {
  const paths = [];
  if (!toolInput || typeof toolInput !== 'object') {
    return paths;
  }
  collectFilePaths(toolInput, paths);
  return paths;
}

function summarizeInput(toolName, toolInput, filePaths) {
  if (toolName === 'Bash') {
    return truncateSummary(toolInput?.command || 'bash');
  }

  if (filePaths.length > 0) {
    return truncateSummary(`${toolName} ${filePaths.join(', ')}`);
  }

  if (toolInput && typeof toolInput === 'object') {
    const shallow = {};
    for (const [key, value] of Object.entries(toolInput)) {
      if (value == null) {
        continue;
      }
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        shallow[key] = value;
      }
    }
    const serialized = Object.keys(shallow).length > 0 ? JSON.stringify(shallow) : toolName;
    return truncateSummary(serialized);
  }

  return truncateSummary(toolName);
}

function summarizeOutput(toolOutput) {
  if (toolOutput == null) {
    return '';
  }

  if (typeof toolOutput === 'string') {
    return truncateSummary(toolOutput);
  }

  if (typeof toolOutput === 'object' && typeof toolOutput.output === 'string') {
    return truncateSummary(toolOutput.output);
  }

  return truncateSummary(JSON.stringify(toolOutput));
}

function buildActivityRow(input, env = process.env) {
  const hookEvent = String(env.CLAUDE_HOOK_EVENT_NAME || '').trim();
  if (hookEvent && hookEvent !== 'PostToolUse') {
    return null;
  }

  const toolName = String(input?.tool_name || '').trim();
  const sessionId = String(env.ECC_SESSION_ID || env.CLAUDE_SESSION_ID || '').trim();
  if (!toolName || !sessionId) {
    return null;
  }

  const toolInput = input?.tool_input || {};
  const filePaths = extractFilePaths(toolInput);

  return {
    id: `tool-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`,
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    tool_name: toolName,
    input_summary: summarizeInput(toolName, toolInput, filePaths),
    output_summary: summarizeOutput(input?.tool_output),
    duration_ms: 0,
    file_paths: filePaths,
  };
}

function run(rawInput) {
  try {
    const input = rawInput.trim() ? JSON.parse(rawInput) : {};
    const row = buildActivityRow(input);
    if (row) {
      appendFile(
        path.join(getClaudeDir(), 'metrics', METRICS_FILE_NAME),
        `${JSON.stringify(row)}\n`
      );
    }
  } catch {
    // Keep hook non-blocking.
  }

  return rawInput;
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (raw.length < MAX_STDIN) {
      const remaining = MAX_STDIN - raw.length;
      raw += chunk.substring(0, remaining);
    }
  });
  process.stdin.on('end', () => {
    process.stdout.write(run(raw));
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  buildActivityRow,
  extractFilePaths,
  summarizeInput,
  summarizeOutput,
  run,
};
