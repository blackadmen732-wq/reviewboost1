import { calculateSegments } from './sms.js';

/**
 * Money.
 *
 * Every monetary value in ReviewBoost is an integer count of cents. $12.50 is
 * `1250`. Floats are never used for money anywhere in this codebase, because
 * `0.1 + 0.2 !== 0.3` in IEEE 754 and those errors accumulate across millions
 * of message-level charges into real discrepancies with the provider invoice.
 *
 * Every function here rejects a non-integer input rather than silently
 * rounding, so a float can never enter the system unnoticed.
 */

export class MoneyError extends TypeError {
  constructor(message) {
    super(message);
    this.name = 'MoneyError';
  }
}

function assertIntegerCents(name, value) {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${name} must be an integer number of cents, received ${value}.`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${name} exceeds the safe integer range.`);
  }
  return value;
}

/**
 * Cost of sending one rendered message body.
 *
 * @param {string} body
 * @param {number} pricePerSegmentCents integer cents charged per segment
 * @returns {{segments: number, encoding: string, units: number, costInCents: number}}
 */
export function priceMessage(body, pricePerSegmentCents) {
  assertIntegerCents('pricePerSegmentCents', pricePerSegmentCents);
  if (pricePerSegmentCents < 0) {
    throw new MoneyError('pricePerSegmentCents cannot be negative.');
  }

  const { segments, encoding, units } = calculateSegments(body);

  return {
    segments,
    encoding,
    units,
    costInCents: segments * pricePerSegmentCents,
  };
}

/**
 * Cost of a whole campaign.
 *
 * Summed per message rather than estimated from an average, so a campaign
 * mixing plain-ASCII and emoji bodies prices correctly instead of being
 * systematically under-quoted.
 *
 * @param {string[]} bodies
 * @param {number} pricePerSegmentCents
 */
export function priceCampaign(bodies, pricePerSegmentCents) {
  assertIntegerCents('pricePerSegmentCents', pricePerSegmentCents);

  return bodies.reduce(
    (total, body) => {
      const { segments, costInCents } = priceMessage(body, pricePerSegmentCents);
      return {
        messages: total.messages + 1,
        segments: total.segments + segments,
        costInCents: total.costInCents + costInCents,
      };
    },
    { messages: 0, segments: 0, costInCents: 0 },
  );
}

/**
 * Format cents for display.
 *
 * Presentation only — never feed the result back into arithmetic.
 */
export function formatCents(cents, currency = 'USD') {
  assertIntegerCents('cents', cents);

  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const symbol = currency === 'USD' ? '$' : '';

  return `${sign}${symbol}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

/**
 * Parse a user-entered amount into integer cents.
 *
 * Rejects more than two decimal places rather than rounding, because silently
 * turning "10.005" into 1000 or 1001 is a bug someone will find in an invoice.
 */
export function parseAmountToCents(input) {
  const text = String(input ?? '').trim().replace(/^\$/, '');

  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) {
    throw new MoneyError(
      `"${input}" is not a valid amount. Use up to two decimal places, e.g. 12.50`,
    );
  }

  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

  return negative ? -cents : cents;
}

/**
 * Split an amount across n parts without losing or inventing a cent.
 *
 * Naive division leaves a remainder that either vanishes or is double-counted;
 * this distributes it one cent at a time so the parts always sum to the total.
 */
export function allocateCents(totalCents, parts) {
  assertIntegerCents('totalCents', totalCents);
  if (!Number.isInteger(parts) || parts < 1) {
    throw new MoneyError('parts must be a positive integer.');
  }

  const base = Math.trunc(totalCents / parts);
  let remainder = totalCents - base * parts;

  return Array.from({ length: parts }, () => {
    if (remainder === 0) return base;
    const extra = remainder > 0 ? 1 : -1;
    remainder -= extra;
    return base + extra;
  });
}

/** Percentage of an allowance consumed, clamped and integer-rounded for display. */
export function usagePercent(used, allowance) {
  if (!Number.isInteger(used) || !Number.isInteger(allowance)) {
    throw new MoneyError('usage figures must be integers.');
  }
  if (allowance <= 0) return 0;
  return Math.min(100, Math.round((used / allowance) * 100));
}
