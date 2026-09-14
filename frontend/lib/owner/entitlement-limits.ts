/**
 * What each plan and status allows.
 *
 * No "server-only": the Tags screen needs these to render "2 of 3" without a
 * round trip, and that screen is a client component.
 *
 * THE DATABASE IS THE AUTHORITY
 * -----------------------------
 * These mirror `app.plan_tag_limit`, `app.plan_location_limit`, and
 * `app.entitlement_tag_limit` in
 * supabase/migrations/20260914000300_entitlements_and_tag_limits.sql, and
 * `tests/unit/entitlements.test.ts` reads that file and fails if the two ever
 * disagree. Nothing here decides whether a Tag may be created --
 * `rpc_create_stand` does that under a row lock, because two requests can pass
 * any check made here at the same instant.
 *
 * DELIBERATELY NOT HERE
 * ---------------------
 * Prices, SMS allowances, and credit packs. The money change lands the catalog,
 * Stripe, and the ledger together; a number copied here ahead of it is a number
 * that will disagree with the one that charges people.
 */

export type PlanId = "starter" | "growth" | "pro";

export type EntitlementStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "cancelled"
  | "suspended";

const PLAN_LIMITS: Record<PlanId, { tags: number; locations: number }> = {
  starter: { tags: 3, locations: 1 },
  growth: { tags: 8, locations: 2 },
  pro: { tags: 25, locations: 5 },
};

/** A trial is one Tag and one location, whatever plan is named alongside it. */
const TRIAL_LIMITS = { tags: 1, locations: 1 };

export function isPlanId(value: unknown): value is PlanId {
  return value === "starter" || value === "growth" || value === "pro";
}

export function isEntitlementStatus(value: unknown): value is EntitlementStatus {
  return (
    value === "trialing" ||
    value === "active" ||
    value === "past_due" ||
    value === "cancelled" ||
    value === "suspended"
  );
}

export function tagLimitOf(planId: PlanId | null, status: EntitlementStatus): number {
  if (status === "trialing") return TRIAL_LIMITS.tags;
  if (status === "active") return planId ? PLAN_LIMITS[planId].tags : 0;
  // past_due, suspended, cancelled: the Tags already printed keep working --
  // they are physical objects sitting in a shop, and breaking them would
  // punish the customer standing in front of one -- but no new ones are minted.
  return 0;
}

export function locationLimitOf(planId: PlanId | null, status: EntitlementStatus): number {
  if (status === "trialing") return TRIAL_LIMITS.locations;
  if (status === "active") return planId ? PLAN_LIMITS[planId].locations : 0;
  return 0;
}
