/**
 * Tests for scripts/lib/cost-estimate.js
 *
 * Run with: node tests/lib/cost-estimate.test.js
 */

const assert = require('assert');

const { estimateCost, RATE_TABLE } = require('../../scripts/lib/cost-estimate');

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
  console.log('\n=== Testing cost-estimate.js ===\n');

  let passed = 0;
  let failed = 0;

  // RATE_TABLE structure
  console.log('RATE_TABLE:');

  if (
    test('RATE_TABLE has a bucket per billing tier', () => {
      for (const key of ['haiku', 'haikuLegacy', 'sonnet', 'opus', 'opusLegacy', 'fable']) {
        assert.ok(RATE_TABLE[key], `Missing ${key}`);
        assert.strictEqual(typeof RATE_TABLE[key].in, 'number', `${key}.in not a number`);
        assert.strictEqual(typeof RATE_TABLE[key].out, 'number', `${key}.out not a number`);
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('RATE_TABLE carries current published rates, not Claude 3 era rates', () => {
      assert.deepStrictEqual(RATE_TABLE.opus, { in: 5.0, out: 25.0 });
      assert.deepStrictEqual(RATE_TABLE.opusLegacy, { in: 15.0, out: 75.0 });
      assert.deepStrictEqual(RATE_TABLE.haiku, { in: 1.0, out: 5.0 });
      assert.deepStrictEqual(RATE_TABLE.haikuLegacy, { in: 0.8, out: 4.0 });
      assert.deepStrictEqual(RATE_TABLE.sonnet, { in: 3.0, out: 15.0 });
      assert.deepStrictEqual(RATE_TABLE.fable, { in: 10.0, out: 50.0 });
    })
  )
    passed++;
  else failed++;

  // estimateCost tests
  console.log('\nestimateCost:');

  if (
    test('opus 1M/1M tokens returns 30', () => {
      const cost = estimateCost('opus', 1_000_000, 1_000_000);
      assert.strictEqual(cost, 30);
    })
  )
    passed++;
  else failed++;

  if (
    test('sonnet 1M/1M tokens returns 18', () => {
      const cost = estimateCost('sonnet', 1_000_000, 1_000_000);
      assert.strictEqual(cost, 18);
    })
  )
    passed++;
  else failed++;

  if (
    test('haiku 1M/1M tokens returns 6', () => {
      const cost = estimateCost('haiku', 1_000_000, 1_000_000);
      assert.strictEqual(cost, 6);
    })
  )
    passed++;
  else failed++;

  if (
    test('null model with 0 tokens returns 0', () => {
      const cost = estimateCost(null, 0, 0);
      assert.strictEqual(cost, 0);
    })
  )
    passed++;
  else failed++;

  if (
    test('full model name claude-opus-4-6 uses current opus rates', () => {
      const cost = estimateCost('claude-opus-4-6', 500, 200);
      // (500 / 1_000_000) * 5 + (200 / 1_000_000) * 25 = 0.0025 + 0.005 = 0.0075
      const expected = Math.round(0.0075 * 1e6) / 1e6;
      assert.strictEqual(cost, expected);
    })
  )
    passed++;
  else failed++;

  // Every spelling of the three Opus models that really billed at $15/$75 has
  // to keep doing so. Opus 4.0's snapshot is `claude-opus-4-20250514`, with no
  // minor segment, so a bare `opus-4-0` substring misses it.
  for (const legacy of [
    'claude-3-opus-20240229',
    'anthropic.claude-3-opus-20240229-v1:0',
    'claude-opus-4-20250514',
    'claude-opus-4@20250514',
    'claude-opus-4-0',
    'claude-opus-4-1'
  ]) {
    if (
      test(`${legacy} keeps legacy opus rates`, () => {
        assert.strictEqual(estimateCost(legacy, 1_000_000, 1_000_000), 90);
      })
    )
      passed++;
    else failed++;
  }

  for (const current of ['claude-opus-4-5', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-opus-5']) {
    if (
      test(`${current} uses current opus rates`, () => {
        assert.strictEqual(estimateCost(current, 1_000_000, 1_000_000), 30);
      })
    )
      passed++;
    else failed++;
  }

  if (
    test('claude-3-5-haiku keeps legacy haiku rates', () => {
      assert.strictEqual(estimateCost('claude-3-5-haiku-20241022', 1_000_000, 1_000_000), 4.8);
    })
  )
    passed++;
  else failed++;

  if (
    test('claude-haiku-4-5 uses current haiku rates', () => {
      assert.strictEqual(estimateCost('claude-haiku-4-5-20251001', 1_000_000, 1_000_000), 6);
    })
  )
    passed++;
  else failed++;

  // Fable and Mythos had no bucket at all and fell through to sonnet, which
  // understated them 3.3x.
  for (const model of ['claude-fable-5', 'claude-mythos-5']) {
    if (
      test(`${model} uses fable rates`, () => {
        assert.strictEqual(estimateCost(model, 1_000_000, 1_000_000), 60);
      })
    )
      passed++;
    else failed++;
  }

  if (
    test('unknown model falls back to sonnet rates', () => {
      const cost = estimateCost('unknown-model', 1_000_000, 1_000_000);
      assert.strictEqual(cost, 18);
    })
  )
    passed++;
  else failed++;

  // A negative count yields a negative cost and a non-finite one yields NaN,
  // and `NaN > budget` is false — so bad input defeats a budget check silently
  // rather than loudly. Pin the throw so a regression fails here.
  for (const bad of [-1, -0.5, NaN, Infinity, -Infinity, undefined, null, '100']) {
    if (
      test(`rejects ${String(bad)} as an input token count`, () => {
        assert.throws(() => estimateCost('sonnet', bad, 100), RangeError);
      })
    )
      passed++;
    else failed++;

    if (
      test(`rejects ${String(bad)} as an output token count`, () => {
        assert.throws(() => estimateCost('sonnet', 100, bad), RangeError);
      })
    )
      passed++;
    else failed++;
  }

  if (
    test('accepts zero and fractional token counts', () => {
      assert.strictEqual(estimateCost('sonnet', 0, 0), 0);
      assert.strictEqual(estimateCost('sonnet', 500_000, 0), 1.5);
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
