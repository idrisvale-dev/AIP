/**
 * Tests for session-activity-tracker.js hook.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.join(
  __dirname,
  '..',
  '..',
  'scripts',
  'hooks',
  'session-activity-tracker.js'
);

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

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'session-activity-tracker-test-'));
}

function withTempHome(homeDir) {
  return {
    HOME: homeDir,
    USERPROFILE: homeDir,
  };
}

function runScript(input, envOverrides = {}) {
  const inputStr = typeof input === 'string' ? input : JSON.stringify(input);
  const result = spawnSync('node', [script], {
    encoding: 'utf8',
    input: inputStr,
    timeout: 10000,
    env: { ...process.env, ...envOverrides },
  });
  return { code: result.status || 0, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function runTests() {
  console.log('\n=== Testing session-activity-tracker.js ===\n');

  let passed = 0;
  let failed = 0;

  (test('passes through input on stdout', () => {
    const input = {
      tool_name: 'Read',
      tool_input: { file_path: 'README.md' },
      tool_output: { output: 'ok' },
    };
    const inputStr = JSON.stringify(input);
    const result = runScript(input, {
      CLAUDE_HOOK_EVENT_NAME: 'PostToolUse',
      ECC_SESSION_ID: 'sess-123',
    });
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout, inputStr);
  }) ? passed++ : failed++);

  (test('creates tool activity metrics rows with file paths', () => {
    const tmpHome = makeTempDir();
    const input = {
      tool_name: 'Write',
      tool_input: {
        file_path: 'src/app.rs',
      },
      tool_output: { output: 'wrote src/app.rs' },
    };
    const result = runScript(input, {
      ...withTempHome(tmpHome),
      CLAUDE_HOOK_EVENT_NAME: 'PostToolUse',
      ECC_SESSION_ID: 'ecc-session-1234',
    });
    assert.strictEqual(result.code, 0);

    const metricsFile = path.join(tmpHome, '.claude', 'metrics', 'tool-usage.jsonl');
    assert.ok(fs.existsSync(metricsFile), `Expected metrics file at ${metricsFile}`);

    const row = JSON.parse(fs.readFileSync(metricsFile, 'utf8').trim());
    assert.strictEqual(row.session_id, 'ecc-session-1234');
    assert.strictEqual(row.tool_name, 'Write');
    assert.deepStrictEqual(row.file_paths, ['src/app.rs']);
    assert.ok(row.id, 'Expected stable event id');
    assert.ok(row.timestamp, 'Expected timestamp');

    fs.rmSync(tmpHome, { recursive: true, force: true });
  }) ? passed++ : failed++);

  (test('prefers ECC_SESSION_ID over CLAUDE_SESSION_ID and redacts bash summaries', () => {
    const tmpHome = makeTempDir();
    const input = {
      tool_name: 'Bash',
      tool_input: {
        command: 'curl --token abc123 -H "Authorization: Bearer topsecret" https://example.com',
      },
      tool_output: { output: 'done' },
    };
    const result = runScript(input, {
      ...withTempHome(tmpHome),
      CLAUDE_HOOK_EVENT_NAME: 'PostToolUse',
      ECC_SESSION_ID: 'ecc-session-1',
      CLAUDE_SESSION_ID: 'claude-session-2',
    });
    assert.strictEqual(result.code, 0);

    const metricsFile = path.join(tmpHome, '.claude', 'metrics', 'tool-usage.jsonl');
    const row = JSON.parse(fs.readFileSync(metricsFile, 'utf8').trim());
    assert.strictEqual(row.session_id, 'ecc-session-1');
    assert.ok(row.input_summary.includes('<REDACTED>'));
    assert.ok(!row.input_summary.includes('abc123'));
    assert.ok(!row.input_summary.includes('topsecret'));

    fs.rmSync(tmpHome, { recursive: true, force: true });
  }) ? passed++ : failed++);

  (test('handles invalid JSON gracefully', () => {
    const tmpHome = makeTempDir();
    const invalidInput = 'not valid json {{{';
    const result = runScript(invalidInput, {
      ...withTempHome(tmpHome),
      CLAUDE_HOOK_EVENT_NAME: 'PostToolUse',
      ECC_SESSION_ID: 'sess-123',
    });
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout, invalidInput);

    fs.rmSync(tmpHome, { recursive: true, force: true });
  }) ? passed++ : failed++);

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
