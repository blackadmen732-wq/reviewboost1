export type PlanId = "starter" | "growth" | "pro";

export type EntitlementStatus = "active" | "cancelled" | "past_due";

export const TRIAL_DAYS = 7;

export interface PlanDefinition {
  id: PlanId;
  name: string;
  priceMicros: number;
  locationLimit: number;
  tagLimit: number;
  smsSegmentsIncluded: number;
  description: string;
}

export const PLAN_CATALOG: Record<PlanId, PlanDefinition> = {
  starter: {
    id: "starter",
    name: "Starter",
    priceMicros: 49_000_000,
    locationLimit: 1,
    tagLimit: 3,
    smsSegmentsIncluded: 150,
    description: "One location, three tags, 150 text segments",
  },
  growth: {
    id: "growth",
    name: "Growth",
    priceMicros: 79_000_000,
    locationLimit: 2,
    tagLimit: 8,
    smsSegmentsIncluded: 500,
    description: "Two locations, eight tags, 500 text segments",
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceMicros: 129_000_000,
    locationLimit: 5,
    tagLimit: 25,
    smsSegmentsIncluded: 1500,
    description: "Five locations, twenty-five tags, 1,500 text segments",
  },
};

export const DEFAULT_PLAN_ID: PlanId = "starter";

export function isPlanId(value: string | null | undefined): value is PlanId {
  return value === "starter" || value === "growth" || value === "pro";
}

export function planOf(id: string | null | undefined): PlanDefinition {
  return isPlanId(id) ? PLAN_CATALOG[id] : PLAN_CATALOG[DEFAULT_PLAN_ID];
}

export function formatPlanPrice(plan: PlanDefinition): string {
  return `$${plan.priceMicros / 1_000_000}`;
}

export function formatPlanPricePerMonth(plan: PlanDefinition): string {
  return `${formatPlanPrice(plan)}/mo`;
}

export const ALL_PLAN_IDS: readonly PlanId[] = ["starter", "growth", "pro"] as const;
