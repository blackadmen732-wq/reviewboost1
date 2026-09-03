import "server-only";

import { computeSegments, type SmsEncoding } from "@/lib/server/sms/segments";

/**
 * Cost preview arithmetic.
 *
 * Money is integer micro-units of the currency (millionths), never a float and
 * never cents: providers quote SMS at fractions of a cent per segment, so cents
 * cannot represent a price without rounding it into being wrong, and a float
 * would drift. The per-segment rate is configuration supplied by the caller —
 * this module invents no prices.
 */

export interface ProviderRate {
  /** Price per segment in micro-units (1e-6 of the currency). */
  perSegmentMicros: number;
  /** ISO-4217, uppercase. */
  currency: string;
}

export interface MessageCostEstimate {
  encoding: SmsEncoding;
  unitCount: number;
  segments: number;
  perSegmentMicros: number;
  totalMicros: number;
  currency: string;
}

function assertRate(rate: ProviderRate): void {
  // A safe integer, not merely an integer: values above 2^53 silently lose
  // precision under JS multiplication, so a large-but-"integer" rate would
  // produce a wrong charge. Reject them before any arithmetic.
  if (!Number.isSafeInteger(rate.perSegmentMicros) || rate.perSegmentMicros < 0) {
    throw new Error("perSegmentMicros must be a non-negative safe integer.");
  }
  if (!/^[A-Z]{3}$/.test(rate.currency)) {
    throw new Error("currency must be an uppercase ISO-4217 code.");
  }
}

// Money is integer micro-units in JS numbers, which are exact only up to
// Number.MAX_SAFE_INTEGER (2^53 − 1). Prove every product and sum stays inside
// that range rather than silently returning a rounded, wrong total. Callers
// treat this as a hard failure — the value would otherwise be handed to a
// Postgres bigint and misrepresent the charge.
function safeMul(a: number, b: number): number {
  const product = a * b;
  if (!Number.isSafeInteger(product)) {
    throw new Error("SMS cost exceeds the safe integer range (micro-units).");
  }
  return product;
}

function safeAdd(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) {
    throw new Error("SMS cost exceeds the safe integer range (micro-units).");
  }
  return sum;
}

/** Estimate the cost of one message body at a given provider rate. */
export function estimateMessageCost(text: string, rate: ProviderRate): MessageCostEstimate {
  assertRate(rate);
  const info = computeSegments(text);
  return {
    encoding: info.encoding,
    unitCount: info.unitCount,
    segments: info.segments,
    perSegmentMicros: rate.perSegmentMicros,
    totalMicros: safeMul(info.segments, rate.perSegmentMicros),
    currency: rate.currency,
  };
}

export interface CostPreview {
  recipients: number;
  totalSegments: number;
  totalMicros: number;
  currency: string;
  perRecipient: MessageCostEstimate[];
}

/**
 * Aggregate a preview across recipients. Each recipient may render to a
 * different body (a different link token), so segments are summed per message
 * rather than assumed uniform.
 */
export function previewCost(bodies: string[], rate: ProviderRate): CostPreview {
  assertRate(rate);
  const perRecipient = bodies.map((b) => estimateMessageCost(b, rate));
  return {
    recipients: perRecipient.length,
    totalSegments: perRecipient.reduce((s, e) => safeAdd(s, e.segments), 0),
    totalMicros: perRecipient.reduce((s, e) => safeAdd(s, e.totalMicros), 0),
    currency: rate.currency,
    perRecipient,
  };
}
