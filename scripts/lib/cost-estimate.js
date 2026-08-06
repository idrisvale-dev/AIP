'use strict';

/**
 * Shared cost estimation for ECC hooks.
 *
 * Published per-1M-token rates. Input and output only: callers pass two token
 * counts, so cache tiers are out of scope here.
 */

// The previous table priced every `opus` model at $15/$75, which are Claude 3
// Opus era rates. Opus 4.5 and later bill at $5/$25, so every current-
// generation Opus estimate was exactly 3x real spend. `haiku` was $0.80/$4.00,
// which is Claude 3.5 Haiku: Haiku 4.5 bills at $1/$5, so Haiku was understated
// 1.25x. Fable and Mythos had no bucket at all and fell through to `sonnet`,
// understating them 3.3x.
//
// The legacy rows exist so that correcting the current generation does not
// reprice the old one. Claude 3 Haiku ($0.25/$1.25) is deliberately not
// modelled: Claude Code never ran it.
const RATE_TABLE = {
  haiku: { in: 1.0, out: 5.0 },
  haikuLegacy: { in: 0.8, out: 4.0 },
  sonnet: { in: 3.0, out: 15.0 },
  opus: { in: 5.0, out: 25.0 },
  opusLegacy: { in: 15.0, out: 75.0 },
  fable: { in: 10.0, out: 50.0 }
};

// The only Opus models that really billed at $15/$75: Claude 3 Opus, Opus 4.0
// and Opus 4.1. Every spelling of each has to match, alias and dated snapshot
// alike, which is why the bare `opus-4-<date>` form is listed on its own:
// Opus 4.0's snapshot is `claude-opus-4-20250514`, with no minor segment, so
// an `opus-4-0` substring alone misses it and reprices a legacy estimate at a
// third of its real cost. The `[-@]` covers Vertex AI, which joins the date
// with `@` (`claude-opus-4@20250514`); Bedrock's
// `anthropic.claude-3-opus-20240229-v1:0` is caught by the first alternative.
//
// Opus 4.5 through Opus 5 are $5/$25 and take the default bucket, which also
// means a future Opus is assumed to be $5/$25. That assumption is the same
// shape of silent staleness this change fixes, so if Opus is ever repriced
// again, a new row belongs here rather than a rediscovery of this comment.
const LEGACY_OPUS_RE = /claude-3-opus|opus-4-0(?!\d)|opus-4-1(?!\d)|opus-4[-@]\d{8}/;

// Claude 3.5 Haiku, whose $0.80/$4.00 this table used to apply to all Haiku.
const LEGACY_HAIKU_RE = /3-5-haiku|haiku-3-5/;

/**
 * Estimate USD cost from token counts.
 * @param {string} model - Model name (may contain "haiku", "sonnet", "opus",
 *   "fable" or "mythos"); anything else is priced at sonnet rates.
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @returns {number} Estimated cost in USD (rounded to 6 decimal places)
 */
function estimateCost(model, inputTokens, outputTokens) {
  const normalized = String(model || '').toLowerCase();
  let rates = RATE_TABLE.sonnet;
  if (normalized.includes('haiku')) {
    rates = LEGACY_HAIKU_RE.test(normalized) ? RATE_TABLE.haikuLegacy : RATE_TABLE.haiku;
  } else if (normalized.includes('fable') || normalized.includes('mythos')) {
    rates = RATE_TABLE.fable;
  } else if (normalized.includes('opus')) {
    rates = LEGACY_OPUS_RE.test(normalized) ? RATE_TABLE.opusLegacy : RATE_TABLE.opus;
  }

  const cost = (inputTokens / 1_000_000) * rates.in + (outputTokens / 1_000_000) * rates.out;
  return Math.round(cost * 1e6) / 1e6;
}

module.exports = { estimateCost, RATE_TABLE };
