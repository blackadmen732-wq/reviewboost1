import "server-only";

/**
 * Margin arithmetic for ReviewBoost SMS pricing.
 *
 * Every value here is an integer: money is micro-units of the currency (the same
 * unit the send-cost engine in `cost.ts` uses), and a margin is basis points
 * (bps) — hundredths of a percent, out of 10 000. Nothing is a float, ever: a
 * sell price computed through floating point can land a fraction of a micro-unit
 * below the price that protects the minimum margin, and that fraction is exactly
 * the bug this module refuses to allow.
 *
 * THE PRICE FORMULA, AND WHY IT ROUNDS UP
 * ---------------------------------------
 *   sell = expected_cost / (1 - target_margin)
 *
 * With margin as bps that is `sell = cost * 10000 / (10000 - margin_bps)`. A real
 * quotient almost never lands on an integer micro-unit, so we round the sell
 * price *up*: a higher price can only raise the realised margin, never lower it,
 * so ceiling division is the direction that keeps a rounding step from silently
 * pricing below target. Rounding down (or to nearest) could shave the realised
 * margin under the floor by up to one micro-unit — small per message, wrong at
 * scale, and a policy violation regardless of size.
 *
 * FAIL CLOSED
 * -----------
 * After pricing to the target we recompute the realised margin the pessimistic
 * way (floor, so it can only understate) and assert it still clears the hard
 * minimum. It always should — target ≥ minimum and we rounded up — but a bug in
 * a caller-supplied policy must surface as a thrown error, never as an underpriced
 * message that quietly loses money.
 */

/** Basis points denominator: 100% = 10 000 bps. */
export const BPS_DENOMINATOR = 10_000;

/**
 * Approved margin policy band. A gross margin outside [hard minimum, maximum]
 * is never a valid target; the default sits comfortably inside the band.
 */
export const HARD_MIN_MARGIN_BPS = 7_000; // 70.00% — never price below this
export const DEFAULT_TARGET_MARGIN_BPS = 7_800; // 78.00%
export const MAX_TARGET_MARGIN_BPS = 8_500; // 85.00%

export interface MarginPolicy {
  /** Never let the realised gross margin fall below this. */
  hardMinBps: number;
  /** The margin the engine aims for absent any adjustment. */
  defaultTargetBps: number;
  /** The most margin the engine may target under normal policy. */
  maxTargetBps: number;
}

export const DEFAULT_MARGIN_POLICY: MarginPolicy = {
  hardMinBps: HARD_MIN_MARGIN_BPS,
  defaultTargetBps: DEFAULT_TARGET_MARGIN_BPS,
  maxTargetBps: MAX_TARGET_MARGIN_BPS,
};

export interface PricedResult {
  /** Integer micro-units the customer is charged. */
  sellMicros: number;
  /** Integer micro-units the send is expected to cost. */
  expectedCostMicros: number;
  /** Contribution = sell − cost, in micro-units. */
  contributionMicros: number;
  /** The margin actually realised at the rounded sell price, in bps (floored). */
  realisedMarginBps: number;
  /** The margin we aimed for, in bps. */
  targetMarginBps: number;
}

function assertSafeNonNegativeInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

/**
 * A margin target is only valid inside the policy band. `hardMinBps` and
 * `maxTargetBps` bound it; anything at or above 100% (10 000 bps) is nonsense
 * because the divisor `10000 − margin` would be zero or negative.
 */
export function assertMarginPolicy(policy: MarginPolicy): void {
  const { hardMinBps, defaultTargetBps, maxTargetBps } = policy;
  for (const [v, label] of [
    [hardMinBps, "hardMinBps"],
    [defaultTargetBps, "defaultTargetBps"],
    [maxTargetBps, "maxTargetBps"],
  ] as const) {
    if (!Number.isSafeInteger(v) || v <= 0 || v >= BPS_DENOMINATOR) {
      throw new Error(`${label} must be an integer in (0, ${BPS_DENOMINATOR}) bps.`);
    }
  }
  if (!(hardMinBps <= defaultTargetBps && defaultTargetBps <= maxTargetBps)) {
    throw new Error("Margin policy must satisfy hardMin ≤ defaultTarget ≤ maxTarget.");
  }
}

/** Ceiling division for non-negative integers, overflow-checked. */
function ceilDiv(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new Error("Margin divisor must be positive.");
  // numerator is already proven safe by the caller; +denominator−1 cannot push a
  // safe integer past the ceiling because denominator ≤ BPS_DENOMINATOR.
  const q = Math.floor((numerator + (denominator - 1)) / denominator);
  if (!Number.isSafeInteger(q)) {
    throw new Error("Sell price exceeds the safe integer range (micro-units).");
  }
  return q;
}

/**
 * Realised gross margin in bps at a given sell/cost, floored so it can only
 * understate. A zero sell price has no meaningful margin and is rejected.
 */
export function realisedMarginBps(sellMicros: number, expectedCostMicros: number): number {
  assertSafeNonNegativeInt(sellMicros, "sellMicros");
  assertSafeNonNegativeInt(expectedCostMicros, "expectedCostMicros");
  if (sellMicros === 0) throw new Error("A zero sell price has no defined margin.");
  const contribution = sellMicros - expectedCostMicros;
  const scaled = contribution * BPS_DENOMINATOR;
  if (!Number.isSafeInteger(scaled)) {
    throw new Error("Margin computation exceeds the safe integer range.");
  }
  // floor toward negative infinity for a negative contribution, so a loss reads
  // as a negative margin rather than rounding toward zero.
  return Math.floor(scaled / sellMicros);
}

/**
 * Price a known expected cost to a target margin, guaranteeing the realised
 * margin clears the policy floor. Throws rather than returning an underpriced
 * result.
 */
export function priceToMargin(
  expectedCostMicros: number,
  targetMarginBps: number,
  policy: MarginPolicy = DEFAULT_MARGIN_POLICY,
): PricedResult {
  assertMarginPolicy(policy);
  assertSafeNonNegativeInt(expectedCostMicros, "expectedCostMicros");
  if (!Number.isSafeInteger(targetMarginBps)) {
    throw new Error("targetMarginBps must be an integer.");
  }
  // The target must sit inside the approved band. Pricing outside it — even
  // above the maximum — is a policy break the engine must not silently make.
  if (targetMarginBps < policy.hardMinBps || targetMarginBps > policy.maxTargetBps) {
    throw new Error(
      `targetMarginBps ${targetMarginBps} is outside the policy band [${policy.hardMinBps}, ${policy.maxTargetBps}].`,
    );
  }

  // A zero-cost message is free: sell 0, no contribution, and no margin to
  // violate. Short-circuit before the divide so realisedMargin isn't asked to
  // reason about a zero sell price.
  if (expectedCostMicros === 0) {
    return {
      sellMicros: 0,
      expectedCostMicros: 0,
      contributionMicros: 0,
      realisedMarginBps: targetMarginBps,
      targetMarginBps,
    };
  }

  const divisor = BPS_DENOMINATOR - targetMarginBps;
  const numerator = expectedCostMicros * BPS_DENOMINATOR;
  if (!Number.isSafeInteger(numerator)) {
    throw new Error("Sell price computation exceeds the safe integer range (micro-units).");
  }
  const sellMicros = ceilDiv(numerator, divisor);

  const realised = realisedMarginBps(sellMicros, expectedCostMicros);
  // The invariant. Rounding up cannot breach it; a caller policy bug could, and
  // must fail closed here rather than reach the customer as an underpriced send.
  if (realised < policy.hardMinBps) {
    throw new Error(
      `Realised margin ${realised} bps fell below the hard minimum ${policy.hardMinBps} bps.`,
    );
  }

  return {
    sellMicros,
    expectedCostMicros,
    contributionMicros: sellMicros - expectedCostMicros,
    realisedMarginBps: realised,
    targetMarginBps,
  };
}
