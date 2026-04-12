/**
 * Tests for scripts/hooks/gateguard-fact-force.js via run-with-flags.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const runner = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'run-with-flags.js');
const stateDir = path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.gateguard');
const stateFile = path.join(stateDir, '.session_state.json');

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
  } catch (_) { /* ignore */ }
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
    const output = parseOutput(result.stdout);
    if (output && output.hookSpecificOutput) {
      assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny',
        'should not deny second edit on same file');
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
    const output = parseOutput(result.stdout);
    assert.ok(output, 'should produce JSON output');
    assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
    assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('creating'));
    assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('call this new file'));
  })) passed++; else failed++;

  // --- Test 4: denies destructive Bash ---
  clearState();
  if (test('denies destructive Bash commands', () => {
    const input = {
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /important/data' }
    };
    const result = runBashHook(input);
    const output = parseOutput(result.stdout);
    assert.ok(output, 'should produce JSON output');
    assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
    assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Destructive'));
    assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('rollback'));
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
    const output1 = parseOutput(result1.stdout);
    assert.ok(output1, 'first call should produce JSON output');
    assert.strictEqual(output1.hookSpecificOutput.permissionDecision, 'deny');

    // Second call: should allow
    const result2 = runBashHook(input);
    const output2 = parseOutput(result2.stdout);
    if (output2 && output2.hookSpecificOutput) {
      assert.notStrictEqual(output2.hookSpecificOutput.permissionDecision, 'deny');
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
    const output = parseOutput(result.stdout);
    if (output && output.hookSpecificOutput) {
      assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
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
    const output = parseOutput(result.stdout);
    assert.ok(output, 'should produce JSON output');
    assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
    const reason = output.hookSpecificOutput.permissionDecisionReason;
    assert.ok(!reason.includes('injected content\n'), 'newline injection should be sanitized');
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

    const output = parseOutput(result.stdout);
    if (output && output.hookSpecificOutput) {
      assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny',
        'should not deny when hook is disabled');
    }
  })) passed++; else failed++;

  // Cleanup
  clearState();

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
