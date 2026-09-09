/**
 * Pipe A software plans. Server-authoritative. UI reads entitlements, never
 * this file directly for limits.
 *
 * Prices match docs/MONEY.md ($49 / $79 / $129). Limits are the locked
 * illustrative caps: Starter 1/3, Growth 2/8, Pro 5/25. SMS included is
 * always 0 — Pipe A never mints texts.
 *
 * Amounts are integer micros. No floats.
 */

export type PlanId = "starter" | "growth" | "pro";

export type EntitlementStatus = "active" | "cancelled" | "past_due";

export interface PlanDefinition {
  id: PlanId;
  name: string;
  priceMicros: number;
  locationLimit: number;
  tagLimit: number;
  smsIncluded: 0;
}

export const PLAN_CATALOG: Record<PlanId, PlanDefinition> = {
  starter: {
    id: "starter",
    name: "Starter",
    priceMicros: 49_000_000,
    locationLimit: 1,
    tagLimit: 3,
    smsIncluded: 0,
  },
  growth: {
    id: "growth",
    name: "Growth",
    priceMicros: 79_000_000,
    locationLimit: 2,
    tagLimit: 8,
    smsIncluded: 0,
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceMicros: 129_000_000,
    locationLimit: 5,
    tagLimit: 25,
    smsIncluded: 0,
  },
};

export const DEFAULT_PLAN_ID: PlanId = "starter";

export function isPlanId(value: string | null | undefined): value is PlanId {
  return value === "starter" || value === "growth" || value === "pro";
}

export function planOf(id: string | null | undefined): PlanDefinition {
  return isPlanId(id) ? PLAN_CATALOG[id] : PLAN_CATALOG[DEFAULT_PLAN_ID];
}
