import {
  DEFAULT_PLAN_ID,
  PLAN_CATALOG,
  type EntitlementStatus,
  type PlanDefinition,
  type PlanId,
  isPlanId,
  planOf,
} from "@/lib/owner/plan-catalog";

/**
 * What the owner UI is allowed to do. Components read this object only.
 * They must not switch on plan names or copy limits from PLAN_CATALOG.
 */

export type CapabilityState = "available" | "locked" | "limit-reached" | "cancelled";

export interface EntitlementSnapshot {
  planId: PlanId;
  planName: string;
  status: EntitlementStatus;
  locationLimit: number;
  tagLimit: number;
  smsIncluded: 0;
  locationsUsed: number;
  tagsUsed: number;
  locations: CapabilityState;
  tags: CapabilityState;
  sms: CapabilityState;
  canCreateLocation: boolean;
  canCreateTag: boolean;
  canUseSoftware: boolean;
}

export function buildEntitlementSnapshot(input: {
  planId?: string | null;
  status?: string | null;
  locationsUsed: number;
  tagsUsed: number;
}): EntitlementSnapshot {
  const plan: PlanDefinition = planOf(input.planId);
  const status: EntitlementStatus =
    input.status === "cancelled" || input.status === "past_due" ? input.status : "active";

  const locations = capabilityState(status, input.locationsUsed, plan.locationLimit);
  const tags = capabilityState(status, input.tagsUsed, plan.tagLimit);
  // Pipe A never includes SMS. Locked until a Pipe B pack exists — not a plan bump.
  const sms: CapabilityState = status === "cancelled" ? "cancelled" : "locked";

  return {
    planId: isPlanId(input.planId) ? input.planId : DEFAULT_PLAN_ID,
    planName: plan.name,
    status,
    locationLimit: plan.locationLimit,
    tagLimit: plan.tagLimit,
    smsIncluded: 0,
    locationsUsed: input.locationsUsed,
    tagsUsed: input.tagsUsed,
    locations,
    tags,
    sms,
    canCreateLocation: locations === "available",
    canCreateTag: tags === "available",
    canUseSoftware: status !== "cancelled",
  };
}

export function capabilityLabel(state: CapabilityState): string {
  if (state === "available") return "Available";
  if (state === "locked") return "Upgrade to unlock";
  if (state === "limit-reached") return "Limit reached";
  return "Cancelled";
}

function capabilityState(
  status: EntitlementStatus,
  used: number,
  limit: number,
): CapabilityState {
  if (status === "cancelled") return "cancelled";
  if (used >= limit) return "limit-reached";
  return "available";
}

export { PLAN_CATALOG };

/** What an owner at the Tag limit is told, on the Tags screen and by the API. */
export function tagLimitMessage(limit: number): string {
  return `This plan includes ${limit} ${limit === 1 ? "Tag" : "Tags"}. You are at the limit.`;
}
