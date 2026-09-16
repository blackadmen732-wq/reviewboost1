import "server-only";

import { createHash } from "node:crypto";

import { computeSegments } from "@/lib/server/sms/segments";
import { expectedCost, type CostAllocationPolicy, ZERO_ALLOCATION_POLICY, type ExpectedCostBreakdown } from "@/lib/server/sms/pricing/cost-model";
import { priceToMargin, type MarginPolicy, DEFAULT_MARGIN_POLICY, DEFAULT_TARGET_MARGIN_BPS } from "@/lib/server/sms/pricing/margin";
import { selectRoute, type RouteCandidate, type RouterOptions, type RoutingDecision } from "@/lib/server/sms/pricing/router";
import { toEffectiveRate } from "@/lib/server/sms/pricing/rates";

/**
 * Quote engine — the single path from a rendered message to a price a customer
 * can be charged.
 *
 *   render → segment count → route candidates → true expected cost →
 *   margin → sell price → expiry
 *
 * A quote is *immutable and reproducible*: it carries a content hash over the
 * inputs that determined the price, so the charge can be re-derived and audited
 * later, and any drift is detectable. The quote never re-prices itself; a new
 * price is a new quote. Pricing fails closed — a stale/empty route set, a
 * currency mismatch, or arithmetic out of safe bounds throws rather than
 * returning a number that isn't defensible.
 */

export interface QuoteInput {
  /** The exact rendered message body that will be sent. */
  body: string;
  /** Candidate routes for this message (already scoped to the destination). */
  candidates: RouteCandidate[];
  requiredCurrency: string;
  marginTargetBps?: number;
  marginPolicy?: MarginPolicy;
  allocation?: CostAllocationPolicy;
  reliability?: RouterOptions["reliability"];
  /** Seconds the quote stays chargeable. */
  ttlSeconds: number;
  now?: Date;
}

export interface Quote {
  quoteHash: string;
  encoding: string;
  segments: number;
  currency: string;
  provider: string;
  routing: RoutingDecision;
  cost: ExpectedCostBreakdown;
  expectedCostMicros: number;
  sellMicros: number;
  contributionMicros: number;
  targetMarginBps: number;
  realisedMarginBps: number;
  createdAt: string; // ISO
  expiresAt: string; // ISO
}

/**
 * Build one immutable quote. Throws (fails closed) when no acceptable route
 * exists, so a caller can never charge for a message it cannot cost.
 */
export function buildQuote(input: QuoteInput): Quote {
  if (!/^[A-Z]{3}$/.test(input.requiredCurrency)) {
    throw new Error("requiredCurrency must be an uppercase ISO-4217 code.");
  }
  if (!Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds <= 0) {
    throw new Error("ttlSeconds must be a positive integer.");
  }
  const now = input.now ?? new Date();
  const marginTargetBps = input.marginTargetBps ?? DEFAULT_TARGET_MARGIN_BPS;
  const marginPolicy = input.marginPolicy ?? DEFAULT_MARGIN_POLICY;
  const allocation = input.allocation ?? ZERO_ALLOCATION_POLICY;

  const seg = computeSegments(input.body);

  const routing = selectRoute(input.candidates, {
    requiredCurrency: input.requiredCurrency,
    allocation,
    now,
    ...(input.reliability ? { reliability: input.reliability } : {}),
  });
  if (!routing.chosen) {
    throw new Error(`No route available to quote: ${routing.rationale}`);
  }

  // Re-derive the cost breakdown from the winning candidate so the quote carries
  // the full itemised cost, not just the router's total. Use the winner's
  // `candidateIndex` — two candidates can share a provider name, so a lookup
  // by provider could grab an inferior rate and produce a sell price the
  // routing decision would not agree with.
  const winnerIndex = routing.chosen.candidateIndex;
  const winner = input.candidates[winnerIndex];
  if (!winner) throw new Error("Chosen route not found among candidates (internal).");
  const effective = toEffectiveRate(winner.rate);
  const cost = expectedCost(seg.segments, effective, allocation);

  const priced = priceToMargin(cost.totalMicros, marginTargetBps, marginPolicy);

  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000).toISOString();

  // Hash over exactly the inputs that determined the price. Re-running the quote
  // on the same inputs yields the same hash; any change is visible.
  const material = JSON.stringify({
    body: input.body,
    encoding: seg.encoding,
    segments: seg.segments,
    currency: input.requiredCurrency,
    provider: routing.chosen.provider,
    rateVersion: winner.rate.rateVersion,
    cost,
    marginTargetBps,
    marginPolicy,
    allocation,
    sellMicros: priced.sellMicros,
    createdAt,
    expiresAt,
  });
  const quoteHash = createHash("sha256").update(material).digest("hex");

  return {
    quoteHash,
    encoding: seg.encoding,
    segments: seg.segments,
    currency: input.requiredCurrency,
    provider: routing.chosen.provider,
    routing,
    cost,
    expectedCostMicros: cost.totalMicros,
    sellMicros: priced.sellMicros,
    contributionMicros: priced.contributionMicros,
    targetMarginBps: priced.targetMarginBps,
    realisedMarginBps: priced.realisedMarginBps,
    createdAt,
    expiresAt,
  };
}

/** Is a quote still chargeable at `now`? Expiry is inclusive of the boundary. */
export function isQuoteExpired(quote: Quote, now: Date = new Date()): boolean {
  return new Date(quote.expiresAt).getTime() <= now.getTime();
}
