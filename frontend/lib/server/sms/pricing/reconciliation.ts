import "server-only";

import { realisedMarginBps } from "@/lib/server/sms/pricing/margin";

/**
 * Actual-cost reconciliation.
 *
 * A quote is an *estimate*. What a message truly cost is only known when the
 * provider settles — often days later, sometimes never at that granularity. So
 * estimated and actual are stored side by side and never conflated: the estimate
 * is what we charged against; the actual replaces it only when the provider
 * supplies it. We never fabricate an "actual" to close the books — an unsettled
 * message stays explicitly unsettled.
 *
 * All money is integer micro-units of one currency.
 */

export interface ReconciliationInputs {
  estimatedProviderCostMicros: number;
  estimatedCarrierCostMicros: number;
  /** Present only once the provider settles; null means not yet known. */
  actualProviderCostMicros: number | null;
  /** Present only when the provider itemises carrier cost; null otherwise. */
  actualCarrierCostMicros: number | null;
  /** Credits debited from the org for this send. */
  chargedCredits: number;
  /** Revenue recognised for this send, micro-units. */
  customerRevenueMicros: number;
  currency: string;
}

export type ReconciliationState = "estimated" | "partially_settled" | "settled";

export interface ReconciliationResult {
  state: ReconciliationState;
  currency: string;
  chargedCredits: number;
  customerRevenueMicros: number;
  /** Best cost figure available: actual where settled, else estimate. */
  effectiveCostMicros: number;
  /** revenue − effective cost. Can be negative (a loss), which is not hidden. */
  actualContributionMicros: number | null;
  /** Realised gross margin in bps, only when fully settled; null otherwise. */
  actualGrossMarginBps: number | null;
}

function assertSafeNonNegativeInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

/**
 * Reconcile a send. Returns a settled contribution/margin only when the provider
 * has supplied the actual cost; while an actual is missing the result is marked
 * `estimated`/`partially_settled` and margin is left null rather than guessed.
 */
export function reconcile(inputs: ReconciliationInputs): ReconciliationResult {
  if (!/^[A-Z]{3}$/.test(inputs.currency)) {
    throw new Error("currency must be an uppercase ISO-4217 code.");
  }
  assertSafeNonNegativeInt(inputs.estimatedProviderCostMicros, "estimatedProviderCostMicros");
  assertSafeNonNegativeInt(inputs.estimatedCarrierCostMicros, "estimatedCarrierCostMicros");
  assertSafeNonNegativeInt(inputs.customerRevenueMicros, "customerRevenueMicros");
  if (!Number.isSafeInteger(inputs.chargedCredits) || inputs.chargedCredits < 0) {
    throw new Error("chargedCredits must be a non-negative integer.");
  }
  if (inputs.actualProviderCostMicros !== null) {
    assertSafeNonNegativeInt(inputs.actualProviderCostMicros, "actualProviderCostMicros");
  }
  if (inputs.actualCarrierCostMicros !== null) {
    assertSafeNonNegativeInt(inputs.actualCarrierCostMicros, "actualCarrierCostMicros");
  }

  const providerSettled = inputs.actualProviderCostMicros !== null;
  const carrierSettled = inputs.actualCarrierCostMicros !== null;

  const providerCost = inputs.actualProviderCostMicros ?? inputs.estimatedProviderCostMicros;
  const carrierCost = inputs.actualCarrierCostMicros ?? inputs.estimatedCarrierCostMicros;
  const effectiveCost = providerCost + carrierCost;
  if (!Number.isSafeInteger(effectiveCost)) {
    throw new Error("Effective cost exceeds the safe integer range.");
  }

  let state: ReconciliationState;
  if (providerSettled && carrierSettled) state = "settled";
  else if (providerSettled || carrierSettled) state = "partially_settled";
  else state = "estimated";

  const contribution = inputs.customerRevenueMicros - effectiveCost;
  if (!Number.isSafeInteger(contribution)) {
    throw new Error("Contribution computation exceeds the safe integer range.");
  }

  // Margin is a *realised* figure — only meaningful once cost is actually known.
  // Fully settled → compute it; otherwise leave it null rather than report an
  // estimate as if it were realised.
  const actualGrossMarginBps =
    state === "settled" && inputs.customerRevenueMicros > 0
      ? realisedMarginBps(inputs.customerRevenueMicros, effectiveCost)
      : null;

  return {
    state,
    currency: inputs.currency,
    chargedCredits: inputs.chargedCredits,
    customerRevenueMicros: inputs.customerRevenueMicros,
    effectiveCostMicros: effectiveCost,
    actualContributionMicros: contribution,
    actualGrossMarginBps,
  };
}
