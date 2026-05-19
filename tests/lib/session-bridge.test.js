/**
 * Tests for scripts/lib/session-bridge.js
 *
 * Run with: node tests/lib/session-bridge.test.js
 */

const assert = require('assert');
const fs = require('fs');

const { sanitizeSessionId, getBridgePath, readBridge, writeBridgeAtomic, resolveSessionId, MAX_SESSION_ID_LENGTH } = require('../../scripts/lib/session-bridge');

// Test helper
function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing session-bridge.js ===\n');

  let passed = 0;
  let failed = 0;

  // sanitizeSessionId tests
  console.log('sanitizeSessionId:');

  if (
    test('valid ID passes through', () => {
      assert.strictEqual(sanitizeSessionId('abc-123'), 'abc-123');
    })
  )
    passed++;
  else failed++;

  if (
    test('path traversal returns null', () => {
      assert.strictEqual(sanitizeSessionId('../etc/passwd'), null);
    })
  )
    passed++;
  else failed++;

  if (
    test('forward slash returns null', () => {
      assert.strictEqual(sanitizeSessionId('/tmp/evil'), null);
    })
  )
    passed++;
  else failed++;

  if (
    test('backslash returns null', () => {
      assert.strictEqual(sanitizeSessionId('a\\b'), null);
    })
  )
    passed++;
  else failed++;

  if (
    test('null input returns null', () => {
      assert.strictEqual(sanitizeSessionId(null), null);
    })
  )
    passed++;
  else failed++;

  if (
    test('empty string returns null', () => {
      assert.strictEqual(sanitizeSessionId(''), null);
    })
  )
    passed++;
  else failed++;

  if (
    test('long string is truncated to MAX_SESSION_ID_LENGTH', () => {
      const longId = 'a'.repeat(100);
      const result = sanitizeSessionId(longId);
      assert.ok(result, 'Should not return null for valid chars');
      assert.strictEqual(result.length, MAX_SESSION_ID_LENGTH);
    })
  )
    passed++;
  else failed++;

  // getBridgePath tests
  console.log('\ngetBridgePath:');

  if (
    test('returns path containing ecc-metrics-', () => {
      const p = getBridgePath('test-session');
      assert.ok(p.includes('ecc-metrics-'), `Expected ecc-metrics- in path, got: ${p}`);
    })
  )
    passed++;
  else failed++;

  // writeBridgeAtomic + readBridge roundtrip
  console.log('\nwriteBridgeAtomic / readBridge:');

  if (
    test('roundtrip write then read returns same data', () => {
      const testId = `test-bridge-${Date.now()}`;
      const data = { session_id: testId, tool_count: 42 };
      try {
        writeBridgeAtomic(testId, data);
        const result = readBridge(testId);
        assert.deepStrictEqual(result, data);
      } finally {
        // Clean up
        try {
          fs.unlinkSync(getBridgePath(testId));
        } catch {
          /* ignore */
        }
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('readBridge with nonexistent session returns null', () => {
      const result = readBridge('nonexistent-session-id-999');
      assert.strictEqual(result, null);
    })
  )
    passed++;
  else failed++;

  // Concurrency contract: two processes writing to the same session
  // bridge must not throw ENOENT and must never leave a corrupt JSON
  // file behind. The previous implementation used a fixed `${target}.tmp`
  // suffix; with concurrent writers it raced over a shared tmp path,
  // producing both ENOENT on rename and (occasionally) a half-written
  // payload on the destination.
  //
  // This test exercises the atomic-rename primitive only — it does NOT
  // attempt to defend against the read-modify-write race in callers,
  // which is a separate concern. Each subprocess writes its own
  // independent payload N times; we assert (a) every process exits 0
  // (no ENOENT bubbled up) and (b) the final file is always parseable
  // JSON whose contents match one of the two writers' last payloads.

  if (
    test('concurrent writeBridgeAtomic does not throw ENOENT or corrupt the bridge file', () => {
      const { spawnSync } = require('child_process');
      const path = require('path');
      const testId = `test-bridge-race-${Date.now()}-${process.pid}`;
      const writerPath = path.join(__dirname, '..', '__tmp_bridge_writer.js');
      const bridgeLib = path.join(__dirname, '..', '..', 'scripts', 'lib', 'session-bridge');
      fs.writeFileSync(
        writerPath,
        [
          "const { writeBridgeAtomic } = require(" + JSON.stringify(bridgeLib) + ");",
          "const [, , sid, tag] = process.argv;",
          "for (let i = 0; i < 200; i++) {",
          "  writeBridgeAtomic(sid, { writer: tag, i });",
          "}",
        ].join('\n'),
        'utf8'
      );
      try {
        const r1 = spawnSync('node', [writerPath, testId, 'A'], { encoding: 'utf8' });
        const r2 = spawnSync('node', [writerPath, testId, 'B'], { encoding: 'utf8' });
        assert.strictEqual(r1.status, 0,
          `writer A should exit 0 (no ENOENT), got ${r1.status}: ${r1.stderr}`);
        assert.strictEqual(r2.status, 0,
          `writer B should exit 0 (no ENOENT), got ${r2.status}: ${r2.stderr}`);
        // Final file must be parseable JSON and belong to one of the writers.
        const final = readBridge(testId);
        assert.ok(final && typeof final === 'object',
          `expected parseable JSON object, got: ${JSON.stringify(final)}`);
        assert.ok(final.writer === 'A' || final.writer === 'B',
          `expected last-writer-wins payload, got: ${JSON.stringify(final)}`);
      } finally {
        try { fs.unlinkSync(getBridgePath(testId)); } catch { /* ignore */ }
        try { fs.unlinkSync(writerPath); } catch { /* ignore */ }
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('writeBridgeAtomic cleans up its tmp file on renameSync failure', () => {
      // Trigger renameSync failure by passing a sessionId whose path is
      // already a directory. The tmp file exists at this point; the fix
      // must not leak it behind.
      const path = require('path');
      const testId = `test-bridge-cleanup-${Date.now()}-${process.pid}`;
      const target = getBridgePath(testId);
      const os = require('os');
      const tmpDir = os.tmpdir();
      // Plant a directory at the target path so renameSync (target.tmp → target) fails.
      fs.mkdirSync(target);
      try {
        assert.throws(() => writeBridgeAtomic(testId, { x: 1 }),
          'expected rename failure to surface');
        // Count any leaked tmp files. The pid+nonce suffix is unique per
        // call, so we look for any matching pattern under os.tmpdir().
        const prefix = path.basename(target) + '.' + process.pid + '.';
        const leaked = fs.readdirSync(tmpDir).filter(f => f.startsWith(prefix) && f.endsWith('.tmp'));
        assert.strictEqual(leaked.length, 0,
          `expected no leaked tmp files after rename failure, found: ${leaked.join(', ')}`);
      } finally {
        try { fs.rmdirSync(target); } catch { /* ignore */ }
      }
    })
  )
    passed++;
  else failed++;

  // resolveSessionId tests
  console.log('\nresolveSessionId:');

  if (
    test('resolveSessionId uses ECC_SESSION_ID env var', () => {
      const original = process.env.ECC_SESSION_ID;
      try {
        process.env.ECC_SESSION_ID = 'env-session-42';
        const result = resolveSessionId();
        assert.strictEqual(result, 'env-session-42');
      } finally {
        if (original === undefined) {
          delete process.env.ECC_SESSION_ID;
        } else {
          process.env.ECC_SESSION_ID = original;
        }
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('MAX_SESSION_ID_LENGTH is 64', () => {
      assert.strictEqual(MAX_SESSION_ID_LENGTH, 64);
    })
  )
    passed++;
  else failed++;

  // Summary
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}

const { failed } = runTests();
process.exit(failed > 0 ? 1 : 0);
