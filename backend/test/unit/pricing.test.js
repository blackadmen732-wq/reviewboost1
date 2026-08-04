import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MoneyError,
  allocateCents,
  formatCents,
  parseAmountToCents,
  priceCampaign,
  priceMessage,
  usagePercent,
} from '../../src/domain/pricing.js';

/**
 * Money is integer cents everywhere. These tests exist to make a float
 * impossible to introduce without a failure, and to prove that rounding never
 * loses or invents a cent.
 */

describe('priceMessage', () => {
  it('prices a single-segment message', () => {
    const result = priceMessage('Short message', 2);
    assert.equal(result.segments, 1);
    assert.equal(result.costInCents, 2);
    assert.ok(Number.isInteger(result.costInCents));
  });

  it('prices multipart at the concatenated rate', () => {
    // 200 GSM-7 characters is 2 segments, not ceil(200/160) applied naively
    // to a per-segment price of one.
    const result = priceMessage('a'.repeat(200), 2);
    assert.equal(result.segments, 2);
    assert.equal(result.costInCents, 4);
  });

  it('charges emoji messages what they actually cost', () => {
    const plain = priceMessage('a'.repeat(100), 2);
    const withEmoji = priceMessage(`${'a'.repeat(99)}🙏`, 2);

    assert.equal(plain.segments, 1);
    // The same length in UCS-2 needs two segments — double the cost.
    assert.equal(withEmoji.segments, 2);
    assert.ok(withEmoji.costInCents > plain.costInCents);
  });

  it('costs nothing for an empty body', () => {
    assert.equal(priceMessage('', 2).costInCents, 0);
  });

  it('supports a zero price without complaint', () => {
    assert.equal(priceMessage('hello', 0).costInCents, 0);
  });

  it('refuses a fractional price rather than rounding it', () => {
    assert.throws(() => priceMessage('hello', 1.5), MoneyError);
    assert.throws(() => priceMessage('hello', 0.02), MoneyError);
  });

  it('refuses a negative price', () => {
    assert.throws(() => priceMessage('hello', -1), MoneyError);
  });
});

describe('priceCampaign', () => {
  it('sums a mixed-encoding campaign correctly', () => {
    // One GSM-7 segment plus three UCS-2 segments.
    const total = priceCampaign(['short', `${'a'.repeat(199)}🙏`], 2);
    assert.equal(total.messages, 2);
    assert.equal(total.segments, 4);
    assert.equal(total.costInCents, 8);
  });

  it('does not estimate from an average', () => {
    // Ten short messages and one very long one. An average-based estimate
    // would materially under-quote the total.
    const bodies = [...Array(10).fill('hi'), 'a'.repeat(600)];
    const total = priceCampaign(bodies, 1);
    assert.equal(total.segments, 10 + 4);
  });

  it('handles an empty campaign', () => {
    const total = priceCampaign([], 2);
    assert.deepEqual(total, { messages: 0, segments: 0, costInCents: 0 });
  });
});

describe('formatCents', () => {
  it('formats whole and partial amounts', () => {
    assert.equal(formatCents(1250), '$12.50');
    assert.equal(formatCents(0), '$0.00');
    assert.equal(formatCents(5), '$0.05');
    assert.equal(formatCents(100), '$1.00');
    assert.equal(formatCents(99999), '$999.99');
  });

  it('places the sign before the symbol', () => {
    assert.equal(formatCents(-1250), '-$12.50');
  });

  it('refuses a float, which would mean cents were lost upstream', () => {
    assert.throws(() => formatCents(12.5), MoneyError);
  });
});

describe('parseAmountToCents', () => {
  it('parses amounts without floating point drift', () => {
    assert.equal(parseAmountToCents('12.50'), 1250);
    assert.equal(parseAmountToCents('0.07'), 7);
    assert.equal(parseAmountToCents('100'), 10000);
    assert.equal(parseAmountToCents('$12.50'), 1250);
    assert.equal(parseAmountToCents('-5.25'), -525);
  });

  it('is exact where naive float maths is not', () => {
    // Number('0.29') * 100 is 28.999999999999996 in IEEE 754.
    assert.equal(parseAmountToCents('0.29'), 29);
    assert.equal(parseAmountToCents('1.10'), 110);
    assert.equal(parseAmountToCents('8.20'), 820);
  });

  it('treats a single decimal place as tenths', () => {
    assert.equal(parseAmountToCents('12.5'), 1250);
  });

  it('rejects more precision than a cent rather than rounding silently', () => {
    assert.throws(() => parseAmountToCents('12.505'), MoneyError);
    assert.throws(() => parseAmountToCents('abc'), MoneyError);
    assert.throws(() => parseAmountToCents(''), MoneyError);
  });
});

describe('allocateCents', () => {
  it('never loses or invents a cent', () => {
    for (const [total, parts] of [
      [100, 3],
      [1000, 7],
      [1, 3],
      [999, 4],
      [0, 5],
    ]) {
      const allocation = allocateCents(total, parts);
      assert.equal(allocation.length, parts);
      assert.equal(
        allocation.reduce((sum, value) => sum + value, 0),
        total,
        `allocation of ${total} across ${parts} must sum back to the total`,
      );
      assert.ok(allocation.every(Number.isInteger));
    }
  });

  it('distributes the remainder one cent at a time', () => {
    // 100/3 leaves a remainder of 1, which goes to exactly one part.
    assert.deepEqual(allocateCents(100, 3), [34, 33, 33]);
  });

  it('handles negative totals symmetrically', () => {
    const allocation = allocateCents(-100, 3);
    assert.equal(allocation.reduce((sum, value) => sum + value, 0), -100);
  });

  it('rejects invalid part counts', () => {
    assert.throws(() => allocateCents(100, 0), MoneyError);
    assert.throws(() => allocateCents(100, 1.5), MoneyError);
  });
});

describe('usagePercent', () => {
  it('reports usage against an allowance', () => {
    assert.equal(usagePercent(50, 100), 50);
    assert.equal(usagePercent(0, 100), 0);
    assert.equal(usagePercent(100, 100), 100);
  });

  it('clamps overage at 100 rather than showing 340%', () => {
    assert.equal(usagePercent(340, 100), 100);
  });

  it('treats a zero allowance as zero rather than dividing by it', () => {
    assert.equal(usagePercent(10, 0), 0);
  });
});
