import {
  DEFAULT_PLAN_ID,
  PLAN_CATALOG,
  type EntitlementStatus,
  type PlanDefinition,
  type PlanId,
  isPlanId,
  planOf,
} from "@/lib/owner/plan-catalog";

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
