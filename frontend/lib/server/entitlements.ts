import "server-only";

import type { AuthenticatedContext } from "@/lib/server/auth";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { logger } from "@/lib/server/logger";

/**
 * What a business is entitled to.
 *
 * THE DATABASE IS THE AUTHORITY, NOT THIS FILE.
 * `rpc_create_stand` and `rpc_create_location` take a lock on the
 * organization's entitlement row and re-check every limit inside the create
 * transaction. That is what makes two simultaneous requests at the cap produce
 * one Tag instead of two, and it is what a caller who skips this API still
 * runs into.
 *
 * What lives here is the pre-check that turns a database exception into a
 * sentence an owner can act on — "your plan allows 3 Tags" rather than a 500.
 * The numbers are duplicated deliberately and are asserted against the product
 * rules by a test; if they ever disagree with the database, the database wins
 * and the worst case is a friendly message that is wrong, never a limit that
 * is not enforced.
 */

export const PLAN_IDS = ["starter", "growth", "pro"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const ENTITLEMENT_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "cancelled",
  "suspended",
] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

export interface PlanLimits {
  locations: number;
  tags: number;
  monthlySmsSegments: number;
  priceUsdCents: number;
}

/** The locked V1 plans. Prices are integer minor units; there are no floats. */
export const PLANS: Record<PlanId, PlanLimits> = {
  starter: { locations: 1, tags: 3, monthlySmsSegments: 150, priceUsdCents: 4900 },
  growth: { locations: 2, tags: 8, monthlySmsSegments: 500, priceUsdCents: 7900 },
  pro: { locations: 5, tags: 25, monthlySmsSegments: 1500, priceUsdCents: 12900 },
};

/** A 7-day trial costs nothing, requires a card, and includes no SMS at all. */
export const TRIAL_LIMITS: PlanLimits = {
  locations: 1,
  tags: 1,
  monthlySmsSegments: 0,
  priceUsdCents: 0,
};

export const TRIAL_DAYS = 7;

export interface Entitlement {
  planId: PlanId | null;
  status: EntitlementStatus;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
}

const NOTHING: PlanLimits = { locations: 0, tags: 0, monthlySmsSegments: 0, priceUsdCents: 0 };

function limitsFor(planId: PlanId | null, status: EntitlementStatus): PlanLimits {
  if (status === "trialing") return TRIAL_LIMITS;
  // Never subscribed: the setup allowance. One location and one Tag, so a
  // business can be set up and looked at before it is asked for a card — and
  // no service at all, because `allowsService` still says no. A business
  // suspended at the end of dunning has a plan, and gets none of this.
  if (status === "suspended" && planId === null) return TRIAL_LIMITS;
  if (status !== "active") return NOTHING;
  if (planId === null) return NOTHING;
  return PLANS[planId];
}

export function tagLimit(planId: PlanId | null, status: EntitlementStatus): number {
  return limitsFor(planId, status).tags;
}

export function locationLimit(planId: PlanId | null, status: EntitlementStatus): number {
  return limitsFor(planId, status).locations;
}

export function monthlySmsSegments(planId: PlanId | null): number {
  return planId === null ? 0 : PLANS[planId].monthlySmsSegments;
}

/**
 * Whether the public door opens.
 *
 * `past_due` keeps it open: a failed card must not cost a business a day of
 * reviews before anyone has had a chance to fix it. Suspension and
 * cancellation close it, and neither deletes anything, so paying again reopens
 * the same physical Tag.
 */
export function allowsService(status: EntitlementStatus): boolean {
  return status === "trialing" || status === "active" || status === "past_due";
}

/** A trial that ended more than this long ago is over, whatever the row says. */
const TRIAL_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * The status that actually governs, given the clock.
 *
 * A stored `trialing` is a claim about a date, and a date passes. Without this
 * an ended trial keeps its limits — and its open door — until something
 * sweeps it, which makes a maintenance job that did not run into a free plan.
 *
 * The day of grace is deliberate and matches the database rule: Stripe's own
 * "the trial converted" event arrives moments after the trial ends, and
 * closing a paying business's door over a webhook's latency is the worse
 * failure. This mirrors `app.entitlement_effective_status`; the database is
 * still the authority, and this exists so an owner is told the same thing.
 */
export function effectiveStatus(
  status: EntitlementStatus,
  trialEndsAt: string | null,
  now: Date = new Date(),
): EntitlementStatus {
  if (status !== "trialing" || trialEndsAt === null) return status;
  const ends = new Date(trialEndsAt);
  if (Number.isNaN(ends.getTime())) return status;
  return ends.getTime() <= now.getTime() - TRIAL_GRACE_MS ? "suspended" : status;
}

function unavailable(): never {
  throw new ApiError(
    503,
    ERROR_CODE.serviceUnavailable,
    "Plan limits are temporarily unavailable. Please try again shortly.",
  );
}

export async function readEntitlement(
  context: AuthenticatedContext,
  orgId: string,
  requestId: string,
): Promise<Entitlement> {
  const { data, error } = await context.db
    .from("entitlement_snapshots")
    .select("plan_id, status, cancel_at_period_end, trial_ends_at, current_period_end")
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) {
    logger.error("entitlements.lookup_failed", { requestId, orgId, error });
    unavailable();
  }

  // A missing entitlement is never read as "unlimited". The database refuses
  // the write regardless; this refuses to guess on the way there.
  if (!data) {
    logger.error("entitlements.missing", { requestId, orgId });
    unavailable();
  }

  const row = data as {
    plan_id: PlanId | null;
    status: EntitlementStatus;
    cancel_at_period_end: boolean;
    trial_ends_at: string | null;
    current_period_end: string | null;
  };

  return {
    planId: row.plan_id,
    status: effectiveStatus(row.status, row.trial_ends_at),
    cancelAtPeriodEnd: row.cancel_at_period_end,
    trialEndsAt: row.trial_ends_at,
    currentPeriodEnd: row.current_period_end,
  };
}

async function countOrThrow(
  context: AuthenticatedContext,
  table: "review_stands" | "locations",
  orgId: string,
  requestId: string,
): Promise<number> {
  const query = context.db
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);

  const { count, error } =
    table === "review_stands"
      ? await query.neq("status", "retired")
      : await query.eq("status", "active");

  if (error) {
    logger.error("entitlements.count_failed", { requestId, orgId, table, error });
    unavailable();
  }

  return count ?? 0;
}

export async function assertCanCreateTag(
  context: AuthenticatedContext,
  orgId: string,
  requestId: string,
): Promise<void> {
  const entitlement = await readEntitlement(context, orgId, requestId);
  const limit = tagLimit(entitlement.planId, entitlement.status);

  if (limit <= 0) {
    throw new ApiError(
      403,
      ERROR_CODE.forbidden,
      "Your plan is not active, so a new Tag cannot be created.",
    );
  }

  const used = await countOrThrow(context, "review_stands", orgId, requestId);
  if (used >= limit) {
    throw new ApiError(
      403,
      ERROR_CODE.forbidden,
      `Your plan includes ${limit} ${limit === 1 ? "Tag" : "Tags"}. Retire one, or move to a larger plan, to add another.`,
    );
  }
}

export async function assertCanCreateLocation(
  context: AuthenticatedContext,
  orgId: string,
  requestId: string,
): Promise<void> {
  const entitlement = await readEntitlement(context, orgId, requestId);
  const limit = locationLimit(entitlement.planId, entitlement.status);

  if (limit <= 0) {
    throw new ApiError(
      403,
      ERROR_CODE.forbidden,
      "Your plan is not active, so a new place cannot be added.",
    );
  }

  const used = await countOrThrow(context, "locations", orgId, requestId);
  if (used >= limit) {
    throw new ApiError(
      403,
      ERROR_CODE.forbidden,
      `Your plan includes ${limit} ${limit === 1 ? "place" : "places"}. Move to a larger plan to add another.`,
    );
  }
}

/** Turn the database's own refusals into something an owner can act on. */
export function entitlementApiError(message: string | undefined): ApiError | null {
  if (!message) return null;
  if (message.includes("tag_limit_reached")) {
    return new ApiError(
      403,
      ERROR_CODE.forbidden,
      "That would be one Tag more than your plan includes.",
    );
  }
  if (message.includes("location_limit_reached")) {
    return new ApiError(
      403,
      ERROR_CODE.forbidden,
      "That would be one place more than your plan includes.",
    );
  }
  if (message.includes("entitlement_inactive")) {
    return new ApiError(
      403,
      ERROR_CODE.forbidden,
      "Your plan is not active. Update your billing to continue.",
    );
  }
  if (message.includes("entitlement_missing")) {
    return new ApiError(
      503,
      ERROR_CODE.serviceUnavailable,
      "Plan limits are temporarily unavailable. Please try again shortly.",
    );
  }
  return null;
}
