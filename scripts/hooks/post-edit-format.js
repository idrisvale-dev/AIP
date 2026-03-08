#!/usr/bin/env node
/**
 * PostToolUse Hook: Auto-format JS/TS files after edits
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Runs after Edit tool use. If the edited file is a JS/TS file,
 * auto-detects the project formatter (Biome or Prettier) by looking
 * for config files, then formats accordingly.
 *
 * For Biome, uses `check --write` (format + lint in one pass) to
 * avoid a redundant second invocation from quality-gate.js.
 *
 * Prefers the local node_modules/.bin binary over npx to skip
 * package-resolution overhead (~200-500ms savings per invocation).
 *
 * Fails silently if no formatter is found or installed.
 */

const { execFileSync } = require('child_process');
const path = require('path');

const {
  findProjectRoot,
  detectFormatter,
  resolveFormatterBin,
} = require('../lib/resolve-formatter');

const MAX_STDIN = 1024 * 1024; // 1MB limit

/**
 * Core logic — exported so run-with-flags.js can call directly
 * without spawning a child process.
 *
 * @param {string} rawInput - Raw JSON string from stdin
 * @returns {string} The original input (pass-through)
 */
function run(rawInput) {
  try {
    const input = JSON.parse(rawInput);
    const filePath = input.tool_input?.file_path;

    if (filePath && /\.(ts|tsx|js|jsx)$/.test(filePath)) {
      try {
        const projectRoot = findProjectRoot(path.dirname(path.resolve(filePath)));
        const formatter = detectFormatter(projectRoot);
        if (!formatter) return rawInput;

        const resolved = resolveFormatterBin(projectRoot, formatter);

        // Biome: `check --write` = format + lint in one pass
        // Prettier: `--write` = format only
        const args =
          formatter === 'biome'
            ? [...resolved.prefix, 'check', '--write', filePath]
            : [...resolved.prefix, '--write', filePath];

        execFileSync(resolved.bin, args, {
          cwd: projectRoot,
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 15000,
        });
      } catch {
        // Formatter not installed, file missing, or failed — non-blocking
      }
    }
  } catch {
    // Invalid input — pass through
  }

  return rawInput;
}

// ── stdin entry point (backwards-compatible) ────────────────────
if (require.main === module) {
  let data = '';
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', (chunk) => {
    if (data.length < MAX_STDIN) {
      const remaining = MAX_STDIN - data.length;
      data += chunk.substring(0, remaining);
    }
  });

  process.stdin.on('end', () => {
    const result = run(data);
    process.stdout.write(result);
    process.exit(0);
  });
}

module.exports = { run };
