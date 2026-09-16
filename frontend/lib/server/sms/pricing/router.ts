import "server-only";

import { expectedCost, type CostAllocationPolicy, ZERO_ALLOCATION_POLICY } from "@/lib/server/sms/pricing/cost-model";
import { isRateStale, toEffectiveRate, type NormalizedRate } from "@/lib/server/sms/pricing/rates";

/**
 * Provider router.
 *
 * Given the candidate routes that could carry one message, pick the cheapest one
 * that is actually usable. "Usable" is checked FIRST and hard: a route to an
 * unsupported country/carrier/sender, without required registration, on a stale
 * rate, or on an unhealthy provider is rejected before price is even considered —
 * the cheapest broken route is not a route. Only among the survivors, and only
 * those meeting the reliability floor, does price decide.
 *
 * Every decision records why the winner won and why each loser lost, so a charge
 * can be explained months later. Failover is never *claimed*: `multiProvider` is
 * true only when at least two distinct providers are actually eligible.
 */

export interface RouteReliabilityPolicy {
  /** Minimum provider health score (0–10000 bps) to be eligible. */
  minHealthBps: number;
  /** Minimum recent delivery rate (0–10000 bps) to be eligible. */
  minDeliveryRateBps: number;
}

export const DEFAULT_RELIABILITY_POLICY: RouteReliabilityPolicy = {
  minHealthBps: 9_000, // 90% healthy
  minDeliveryRateBps: 9_500, // 95% delivered recently
};

export interface RouteCandidate {
  provider: string;
  rate: NormalizedRate;
  segments: number;
  /** Provider health, bps (0–10000). */
  healthBps: number;
  /** Recent delivery success rate, bps (0–10000). */
  recentDeliveryRateBps: number;
  /** Does the provider support this country/carrier/sender combination? */
  supportsDestination: boolean;
  /** Is the sender registration (10DLC/TFN) in place for this route? */
  registrationReady: boolean;
  /** Remaining throughput headroom this window (messages); 0 means saturated. */
  throughputHeadroom: number;
}

export type RouteRejectionReason =
  | "unsupported_destination"
  | "registration_missing"
  | "rate_stale"
  | "unhealthy"
  | "low_delivery_rate"
  | "no_throughput"
  | "currency_mismatch"
  | "arithmetic_unsafe";

export interface EvaluatedRoute {
  /**
   * Index into the caller's `candidates` array. This is the unambiguous
   * identity of the route: `expected_cost` and `sell_price` on the quote must
   * be recomputed from `candidates[candidateIndex]` exactly, never by
   * re-finding by provider name (two candidates can share a provider).
   */
  candidateIndex: number;
  provider: string;
  eligible: boolean;
  rejection: RouteRejectionReason | null;
  expectedDeliveredCostMicros: number | null;
  currency: string | null;
  healthBps: number;
  recentDeliveryRateBps: number;
  usedCurrentPrice: boolean;
  rateVersion: number;
}

export interface RoutingDecision {
  chosen: EvaluatedRoute | null;
  candidates: EvaluatedRoute[];
  /** True only when ≥2 providers were actually eligible — real failover breadth. */
  multiProvider: boolean;
  /** Plain-language explanation of the outcome, for the persisted audit row. */
  rationale: string;
}

export interface RouterOptions {
  reliability?: RouteReliabilityPolicy;
  allocation?: CostAllocationPolicy;
  /** All candidates must price in this currency; a mismatch rejects the route. */
  requiredCurrency: string;
  now?: Date;
}

function evaluate(candidate: RouteCandidate, candidateIndex: number, opts: Required<Omit<RouterOptions, "now">> & { now: Date }): EvaluatedRoute {
  const base: EvaluatedRoute = {
    candidateIndex,
    provider: candidate.provider,
    eligible: false,
    rejection: null,
    expectedDeliveredCostMicros: null,
    currency: candidate.rate.currency,
    healthBps: candidate.healthBps,
    recentDeliveryRateBps: candidate.recentDeliveryRateBps,
    usedCurrentPrice: false,
    rateVersion: candidate.rate.rateVersion,
  };

  // Validity gates FIRST — order matters only for which reason is reported; any
  // one of them disqualifies the route outright.
  if (!candidate.supportsDestination) return { ...base, rejection: "unsupported_destination" };
  if (!candidate.registrationReady) return { ...base, rejection: "registration_missing" };
  if (isRateStale(candidate.rate, opts.now)) return { ...base, rejection: "rate_stale" };
  if (candidate.rate.currency !== opts.requiredCurrency) return { ...base, rejection: "currency_mismatch" };
  if (candidate.throughputHeadroom <= 0) return { ...base, rejection: "no_throughput" };

  // Reliability floor.
  if (candidate.healthBps < opts.reliability.minHealthBps) return { ...base, rejection: "unhealthy" };
  if (candidate.recentDeliveryRateBps < opts.reliability.minDeliveryRateBps) {
    return { ...base, rejection: "low_delivery_rate" };
  }

  // Only now does cost matter.
  try {
    const effective = toEffectiveRate(candidate.rate);
    const breakdown = expectedCost(candidate.segments, effective, opts.allocation);
    return {
      ...base,
      eligible: true,
      expectedDeliveredCostMicros: breakdown.totalMicros,
      usedCurrentPrice: breakdown.usedCurrentPrice,
    };
  } catch {
    return { ...base, rejection: "arithmetic_unsafe" };
  }
}

/**
 * Select the cheapest acceptable route. Returns a decision even when nothing is
 * eligible (chosen = null) so the caller can fail closed with a recorded reason.
 * Ties on cost break toward the higher recent delivery rate, then the fresher
 * rate version.
 */
export function selectRoute(candidates: RouteCandidate[], options: RouterOptions): RoutingDecision {
  if (!/^[A-Z]{3}$/.test(options.requiredCurrency)) {
    throw new Error("requiredCurrency must be an uppercase ISO-4217 code.");
  }
  const opts = {
    reliability: options.reliability ?? DEFAULT_RELIABILITY_POLICY,
    allocation: options.allocation ?? ZERO_ALLOCATION_POLICY,
    requiredCurrency: options.requiredCurrency,
    now: options.now ?? new Date(),
  };

  const evaluated = candidates.map((c, i) => evaluate(c, i, opts));
  const eligible = evaluated.filter((e) => e.eligible);

  const eligibleProviders = new Set(eligible.map((e) => e.provider));
  const multiProvider = eligibleProviders.size >= 2;

  if (eligible.length === 0) {
    return {
      chosen: null,
      candidates: evaluated,
      multiProvider: false,
      rationale: "No eligible route: every candidate was rejected before pricing.",
    };
  }

  const chosen = eligible.reduce((best, cur) => {
    const a = cur.expectedDeliveredCostMicros as number;
    const b = best.expectedDeliveredCostMicros as number;
    if (a !== b) return a < b ? cur : best;
    if (cur.recentDeliveryRateBps !== best.recentDeliveryRateBps) {
      return cur.recentDeliveryRateBps > best.recentDeliveryRateBps ? cur : best;
    }
    return cur.rateVersion > best.rateVersion ? cur : best;
  });

  const rationale =
    `Chose ${chosen.provider} at ${chosen.expectedDeliveredCostMicros} µ${chosen.currency} ` +
    `(health ${chosen.healthBps}bps, delivery ${chosen.recentDeliveryRateBps}bps` +
    `${chosen.usedCurrentPrice ? ", account price" : ", list price"}); ` +
    `${eligible.length} eligible of ${evaluated.length} candidate(s)` +
    `${multiProvider ? "; multi-provider failover available" : "; single-provider"}.`;

  return { chosen, candidates: evaluated, multiProvider, rationale };
}
