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
  smsSegmentsIncluded: number;
  locationsUsed: number;
  tagsUsed: number;
  smsSegmentsUsed: number;
  locations: CapabilityState;
  tags: CapabilityState;
  sms: CapabilityState;
  canCreateLocation: boolean;
  canCreateTag: boolean;
  canSendSms: boolean;
  canUseSoftware: boolean;
  isTrial: boolean;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
}

export function buildEntitlementSnapshot(input: {
  planId?: string | null;
  status?: string | null;
  locationsUsed: number;
  tagsUsed: number;
  smsSegmentsUsed?: number;
  trialEndsAt?: string | null;
}): EntitlementSnapshot {
  const plan: PlanDefinition = planOf(input.planId);
  const status: EntitlementStatus =
    input.status === "cancelled" || input.status === "past_due" ? input.status : "active";

  const locations = capabilityState(status, input.locationsUsed, plan.locationLimit);
  const tags = capabilityState(status, input.tagsUsed, plan.tagLimit);
  const smsUsed = input.smsSegmentsUsed ?? 0;
  const sms = capabilityState(status, smsUsed, plan.smsSegmentsIncluded);

  const isTrial = isTrialActive(input.trialEndsAt ?? null);
  const trialDaysLeft = computeTrialDaysLeft(input.trialEndsAt ?? null);

  return {
    planId: isPlanId(input.planId) ? input.planId : DEFAULT_PLAN_ID,
    planName: plan.name,
    status,
    locationLimit: plan.locationLimit,
    tagLimit: plan.tagLimit,
    smsSegmentsIncluded: plan.smsSegmentsIncluded,
    locationsUsed: input.locationsUsed,
    tagsUsed: input.tagsUsed,
    smsSegmentsUsed: smsUsed,
    locations,
    tags,
    sms,
    canCreateLocation: locations === "available",
    canCreateTag: tags === "available",
    canSendSms: sms === "available",
    canUseSoftware: status !== "cancelled",
    isTrial,
    trialEndsAt: input.trialEndsAt ?? null,
    trialDaysLeft,
  };
}

function isTrialActive(endsAt: string | null): boolean {
  if (!endsAt) return false;
  return new Date(endsAt) > new Date();
}

function computeTrialDaysLeft(endsAt: string | null): number | null {
  if (!endsAt) return null;
  const diff = new Date(endsAt).getTime() - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / 86_400_000);
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
