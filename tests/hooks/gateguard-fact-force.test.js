/**
 * Tests for scripts/hooks/gateguard-fact-force.js via run-with-flags.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const runner = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'run-with-flags.js');
const stateDir = process.env.GATEGUARD_STATE_DIR || path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.gateguard-test-' + process.pid);
// State files are per-session. In tests, falls back to pid-based name.
const sessionId = process.env.CLAUDE_SESSION_ID || process.env.ECC_SESSION_ID || `pid-${process.ppid || process.pid}`;
const stateFile = path.join(stateDir, `state-${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function clearState() {
  try {
    if (fs.existsSync(stateFile)) {
      fs.unlinkSync(stateFile);
    }
  } catch (err) {
    console.error(`  [clearState] failed to remove ${stateFile}: ${err.message}`);
  }
}

function writeExpiredState() {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    const expired = {
      checked: ['some_file.js', '__bash_session__'],
      last_active: Date.now() - (31 * 60 * 1000) // 31 minutes ago
    };
    fs.writeFileSync(stateFile, JSON.stringify(expired), 'utf8');
  } catch (_) { /* ignore */ }
}

function runHook(input, env = {}) {
  const rawInput = typeof input === 'string' ? input : JSON.stringify(input);
  const result = spawnSync('node', [
    runner,
    'pre:edit-write:gateguard-fact-force',
    'scripts/hooks/gateguard-fact-force.js',
    'standard,strict'
  ], {
    input: rawInput,
    encoding: 'utf8',
    env: {
      ...process.env,
      ECC_HOOK_PROFILE: 'standard',
      GATEGUARD_STATE_DIR: stateDir,
      ...env
    },
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  return {
    code: Number.isInteger(result.status) ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function runBashHook(input, env = {}) {
  const rawInput = typeof input === 'string' ? input : JSON.stringify(input);
  const result = spawnSync('node', [
    runner,
    'pre:bash:gateguard-fact-force',
    'scripts/hooks/gateguard-fact-force.js',
    'standard,strict'
  ], {
    input: rawInput,
    encoding: 'utf8',
    env: {
      ...process.env,
      ECC_HOOK_PROFILE: 'standard',
      GATEGUARD_STATE_DIR: stateDir,
      ...env
    },
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  return {
    code: Number.isInteger(result.status) ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function parseOutput(stdout) {
  try {
    return JSON.parse(stdout);
  } catch (_) {
    return null;
  }
}

function runTests() {
  console.log('\n=== Testing gateguard-fact-force ===\n');

  let passed = 0;
  let failed = 0;

  // --- Test 1: denies first Edit per file ---
  clearState();
  if (test('denies first Edit per file with fact-forcing message', () => {
    const input = {
      tool_name: 'Edit',
      tool_input: { file_path: '/src/app.js', old_string: 'foo', new_string: 'bar' }
    };
    const result = runHook(input);
    assert.strictEqual(result.code, 0, 'exit code should be 0');
    const output = parseOutput(result.stdout);
    assert.ok(output, 'should produce JSON output');
    assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
    assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Fact-Forcing Gate'));
    assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('import/require'));
    assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('/src/app.js'));
  })) passed++; else failed++;

  // --- Test 2: allows second Edit on same file ---
  if (test('allows second Edit on same file (gate already passed)', () => {
    const input = {
      tool_name: 'Edit',
      tool_input: { file_path: '/src/app.js', old_string: 'foo', new_string: 'bar' }
    };
    const result = runHook(input);
    assert.strictEqual(result.code, 0, 'exit code should be 0');
    const output = parseOutput(result.stdout);
    assert.ok(output, 'should produce valid JSON output');
    // When allowed, the hook passes through the raw input (no hookSpecificOutput)
    // OR if hookSpecificOutput exists, it must not be deny
    if (output.hookSpecificOutput) {
      assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny',
        'should not deny second edit on same file');
    } else {
      // Pass-through: output matches original input (allow)
      assert.strictEqual(output.tool_name, 'Edit', 'pass-through should preserve input');
    }
  })) passed++; else failed++;

  // --- Test 3: denies first Write per file ---
  clearState();
  if (test('denies first Write per file with fact-forcing message', () => {
    const input = {
      tool_name: 'Write',
      tool_input: { file_path: '/src/new-file.js', content: 'console.log("hello")' }
    };
    const result = runHook(input);
    assert.strictEqual(result.code, 0, 'exit code should be 0');
    const output = parseOutput(result.stdout);
    assert.ok(output, 'should produce JSON output');
    assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
    assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('creating'));
    assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('call this new file'));
  })) passed++; else failed++;

  // --- Test 4: denies destructive Bash, allows retry ---
  clearState();
  if (test('denies destructive Bash commands, allows retry after facts presented', () => {
    const input = {
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /important/data' }
    };

    // First call: should deny
    const result1 = runBashHook(input);
    assert.strictEqual(result1.code, 0, 'first call exit code should be 0');
    const output1 = parseOutput(result1.stdout);
    assert.ok(output1, 'first call should produce JSON output');
    assert.strictEqual(output1.hookSpecificOutput.permissionDecision, 'deny');
    assert.ok(output1.hookSpecificOutput.permissionDecisionReason.includes('Destructive'));
    assert.ok(output1.hookSpecificOutput.permissionDecisionReason.includes('rollback'));

    // Second call (retry after facts presented): should allow
    const result2 = runBashHook(input);
    assert.strictEqual(result2.code, 0, 'second call exit code should be 0');
    const output2 = parseOutput(result2.stdout);
    assert.ok(output2, 'second call should produce valid JSON output');
    if (output2.hookSpecificOutput) {
      assert.notStrictEqual(output2.hookSpecificOutput.permissionDecision, 'deny',
        'should not deny destructive bash retry after facts presented');
    } else {
      assert.strictEqual(output2.tool_name, 'Bash', 'pass-through should preserve input');
    }
  })) passed++; else failed++;

  // --- Test 5: denies first routine Bash, allows second ---
  clearState();
  if (test('denies first routine Bash, allows second', () => {
    const input = {
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' }
    };

    // First call: should deny
    const result1 = runBashHook(input);
    assert.strictEqual(result1.code, 0, 'first call exit code should be 0');
    const output1 = parseOutput(result1.stdout);
    assert.ok(output1, 'first call should produce JSON output');
    assert.strictEqual(output1.hookSpecificOutput.permissionDecision, 'deny');

    // Second call: should allow
    const result2 = runBashHook(input);
    assert.strictEqual(result2.code, 0, 'second call exit code should be 0');
    const output2 = parseOutput(result2.stdout);
    assert.ok(output2, 'second call should produce valid JSON output');
    if (output2.hookSpecificOutput) {
      assert.notStrictEqual(output2.hookSpecificOutput.permissionDecision, 'deny',
        'should not deny second routine bash');
    } else {
      assert.strictEqual(output2.tool_name, 'Bash', 'pass-through should preserve input');
    }
  })) passed++; else failed++;

  // --- Test 6: session state resets after timeout ---
  if (test('session state resets after 30-minute timeout', () => {
    writeExpiredState();
    const input = {
      tool_name: 'Edit',
      tool_input: { file_path: 'some_file.js', old_string: 'a', new_string: 'b' }
    };
    const result = runHook(input);
    assert.strictEqual(result.code, 0, 'exit code should be 0');
    const output = parseOutput(result.stdout);
    assert.ok(output, 'should produce JSON output after expired state');
    assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny',
      'should deny again after session timeout (state was reset)');
  })) passed++; else failed++;

  // --- Test 7: allows unknown tool names ---
  clearState();
  if (test('allows unknown tool names through', () => {
    const input = {
      tool_name: 'Read',
      tool_input: { file_path: '/src/app.js' }
    };
    const result = runHook(input);
    assert.strictEqual(result.code, 0, 'exit code should be 0');
    const output = parseOutput(result.stdout);
    assert.ok(output, 'should produce valid JSON output');
    if (output.hookSpecificOutput) {
      assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny',
        'should not deny unknown tool');
    } else {
      assert.strictEqual(output.tool_name, 'Read', 'pass-through should preserve input');
    }
  })) passed++; else failed++;

  // --- Test 8: sanitizes file paths with newlines ---
  clearState();
  if (test('sanitizes file paths containing newlines', () => {
    const input = {
      tool_name: 'Edit',
      tool_input: { file_path: '/src/app.js\ninjected content', old_string: 'a', new_string: 'b' }
    };
    const result = runHook(input);
    assert.strictEqual(result.code, 0, 'exit code should be 0');
    const output = parseOutput(result.stdout);
    assert.ok(output, 'should produce JSON output');
    assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
    const reason = output.hookSpecificOutput.permissionDecisionReason;
    // The file path portion of the reason must not contain any raw newlines
    // (sanitizePath replaces \n and \r with spaces)
    const pathLine = reason.split('\n').find(l => l.includes('/src/app.js'));
    assert.ok(pathLine, 'reason should mention the file path');
    assert.ok(!pathLine.includes('\n'), 'file path line must not contain raw newlines');
    assert.ok(!reason.includes('/src/app.js\n'), 'newline after file path should be sanitized');
    assert.ok(!reason.includes('\ninjected'), 'injected content must not appear on its own line');
  })) passed++; else failed++;

  // --- Test 9: respects ECC_DISABLED_HOOKS ---
  clearState();
  if (test('respects ECC_DISABLED_HOOKS (skips when disabled)', () => {
    const input = {
      tool_name: 'Edit',
      tool_input: { file_path: '/src/disabled.js', old_string: 'a', new_string: 'b' }
    };
    const result = runHook(input, {
      ECC_DISABLED_HOOKS: 'pre:edit-write:gateguard-fact-force'
    });

    assert.strictEqual(result.code, 0, 'exit code should be 0');
    const output = parseOutput(result.stdout);
    assert.ok(output, 'should produce valid JSON output');
    if (output.hookSpecificOutput) {
      assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny',
        'should not deny when hook is disabled');
    } else {
      // When disabled, hook passes through raw input
      assert.strictEqual(output.tool_name, 'Edit', 'pass-through should preserve input');
    }
  })) passed++; else failed++;

  // Cleanup: remove test-isolated state directory
  clearState();
  try {
    if (fs.existsSync(stateDir)) {
      fs.rmdirSync(stateDir);
    }
  } catch (err) {
    console.error(`  [cleanup] failed to remove ${stateDir}: ${err.message}`);
  }

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
