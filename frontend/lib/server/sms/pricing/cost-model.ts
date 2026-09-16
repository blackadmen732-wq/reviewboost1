import "server-only";

import type { EffectiveRate } from "@/lib/server/sms/pricing/rates";

/**
 * True expected cost of one SMS, broken into separately auditable components.
 *
 * A single "cost" number hides where money goes and makes margin policy
 * unfalsifiable. So every contributor to expected cost is its own line: the
 * per-segment provider price, the carrier surcharge, and a set of per-message
 * allocations (fixed provider cost, number/registration amortisation, messaging
 * infrastructure, and a risk/reconciliation reserve). Payment-processing is a
 * placeholder line, zero until a billing integration supplies a real fee — never
 * a guessed one.
 *
 * All money is integer micro-units of a single currency; a currency mismatch is
 * a hard error, not a silent conversion.
 */

export interface CostAllocationPolicy {
  /** Fixed provider cost amortised onto each message (e.g. API overhead), micro-units. */
  providerFixedMicros: number;
  /** Number lease + registration (10DLC/TFN) amortised per message, micro-units. */
  numberRegistrationMicros: number;
  /** Messaging infrastructure (queues, logging, storage) per message, micro-units. */
  infrastructureMicros: number;
  /**
   * Risk / reconciliation reserve as basis points of the raw provider+carrier
   * spend — covers the gap between estimated and settled cost. Integer bps.
   */
  reconciliationReserveBps: number;
  /**
   * Payment-processing allocation per message, micro-units. Zero until a billing
   * integration provides a real fee; never estimated.
   */
  paymentProcessingMicros: number;
}

export const ZERO_ALLOCATION_POLICY: CostAllocationPolicy = {
  providerFixedMicros: 0,
  numberRegistrationMicros: 0,
  infrastructureMicros: 0,
  reconciliationReserveBps: 0,
  paymentProcessingMicros: 0,
};

export interface ExpectedCostBreakdown {
  segments: number;
  currency: string;
  /** perSegment × segments. */
  providerSegmentMicros: number;
  /** carrierSurcharge × segments. */
  carrierSurchargeMicros: number;
  providerFixedMicros: number;
  numberRegistrationMicros: number;
  infrastructureMicros: number;
  reconciliationReserveMicros: number;
  paymentProcessingMicros: number;
  /** Sum of every line above. */
  totalMicros: number;
  /** Whether the provider's account-specific current price was used. */
  usedCurrentPrice: boolean;
}

function assertSafeNonNegativeInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

function safeMul(a: number, b: number): number {
  const p = a * b;
  if (!Number.isSafeInteger(p)) throw new Error("SMS cost exceeds the safe integer range (micro-units).");
  return p;
}

function safeAdd(...values: number[]): number {
  let sum = 0;
  for (const v of values) {
    sum += v;
    if (!Number.isSafeInteger(sum)) {
      throw new Error("SMS cost exceeds the safe integer range (micro-units).");
    }
  }
  return sum;
}

export function assertAllocationPolicy(policy: CostAllocationPolicy): void {
  assertSafeNonNegativeInt(policy.providerFixedMicros, "providerFixedMicros");
  assertSafeNonNegativeInt(policy.numberRegistrationMicros, "numberRegistrationMicros");
  assertSafeNonNegativeInt(policy.infrastructureMicros, "infrastructureMicros");
  assertSafeNonNegativeInt(policy.paymentProcessingMicros, "paymentProcessingMicros");
  if (!Number.isSafeInteger(policy.reconciliationReserveBps) || policy.reconciliationReserveBps < 0) {
    throw new Error("reconciliationReserveBps must be a non-negative integer.");
  }
}

/**
 * Compute the true expected cost of one message at a given per-segment rate and
 * allocation policy. The reconciliation reserve is a ceiling-rounded percentage
 * of raw provider+carrier spend, so the reserve can never round to less than the
 * policy intends.
 */
export function expectedCost(
  segments: number,
  rate: EffectiveRate,
  policy: CostAllocationPolicy = ZERO_ALLOCATION_POLICY,
): ExpectedCostBreakdown {
  if (!Number.isSafeInteger(segments) || segments <= 0) {
    throw new Error("segments must be a positive safe integer.");
  }
  assertSafeNonNegativeInt(rate.perSegmentMicros, "perSegmentMicros");
  assertSafeNonNegativeInt(rate.carrierSurchargeMicros, "carrierSurchargeMicros");
  assertAllocationPolicy(policy);

  const providerSegment = safeMul(segments, rate.perSegmentMicros);
  const carrierSurcharge = safeMul(segments, rate.carrierSurchargeMicros);

  const rawSpend = safeAdd(providerSegment, carrierSurcharge);
  // Reserve rounds UP so it is never short of the intended percentage.
  const reserveNumerator = safeMul(rawSpend, policy.reconciliationReserveBps);
  const reconciliationReserve = Math.floor((reserveNumerator + (10_000 - 1)) / 10_000);
  if (!Number.isSafeInteger(reconciliationReserve)) {
    throw new Error("Reconciliation reserve exceeds the safe integer range.");
  }

  const total = safeAdd(
    providerSegment,
    carrierSurcharge,
    policy.providerFixedMicros,
    policy.numberRegistrationMicros,
    policy.infrastructureMicros,
    reconciliationReserve,
    policy.paymentProcessingMicros,
  );

  return {
    segments,
    currency: rate.currency,
    providerSegmentMicros: providerSegment,
    carrierSurchargeMicros: carrierSurcharge,
    providerFixedMicros: policy.providerFixedMicros,
    numberRegistrationMicros: policy.numberRegistrationMicros,
    infrastructureMicros: policy.infrastructureMicros,
    reconciliationReserveMicros: reconciliationReserve,
    paymentProcessingMicros: policy.paymentProcessingMicros,
    totalMicros: total,
    usedCurrentPrice: rate.usedCurrentPrice,
  };
}
