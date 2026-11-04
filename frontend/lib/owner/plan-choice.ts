import { PLAN_CATALOG, type PlanId } from "@/lib/owner/plan-catalog";

/** A remembered choice only. Billing still asks the owner before charging. */
export function parsePlanChoice(value: unknown): PlanId | null {
  return typeof value === "string" && Object.hasOwn(PLAN_CATALOG, value)
    ? (value as PlanId)
    : null;
}

export function startForPlan(plan: PlanId): string {
  return `/login?next=${encodeURIComponent(`/onboarding?plan=${plan}`)}`;
}

export function billingForPlan(plan: PlanId | null): string {
  return plan ? `/settings/billing?plan=${plan}` : "/settings/billing";
}
