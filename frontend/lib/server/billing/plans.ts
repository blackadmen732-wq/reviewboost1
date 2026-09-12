import "server-only";

/**
 * Plan definitions — the single source of truth for what each tier includes.
 *
 * Limits are enforced server-side via entitlement checks, never by frontend
 * `if (plan === ...)` guards. The frontend reads entitlements; only this
 * module defines what they are.
 */

export type PlanId = "starter" | "growth" | "pro";

export interface PlanDefinition {
  id: PlanId;
  name: string;
  monthlyPriceCents: number;
  limits: {
    locations: number;
    tags: number;
    smsCreditsPerMonth: number;
    teamMembers: number;
  };
  features: {
    customBranding: boolean;
    smsTextRequests: boolean;
    apiAccess: boolean;
    prioritySupport: boolean;
  };
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  starter: {
    id: "starter",
    name: "Starter",
    monthlyPriceCents: 4900,
    limits: {
      locations: 1,
      tags: 3,
      smsCreditsPerMonth: 0,
      teamMembers: 2,
    },
    features: {
      customBranding: false,
      smsTextRequests: false,
      apiAccess: false,
      prioritySupport: false,
    },
  },
  growth: {
    id: "growth",
    name: "Growth",
    monthlyPriceCents: 7900,
    limits: {
      locations: 3,
      tags: 10,
      smsCreditsPerMonth: 100,
      teamMembers: 5,
    },
    features: {
      customBranding: true,
      smsTextRequests: true,
      apiAccess: false,
      prioritySupport: false,
    },
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyPriceCents: 12900,
    limits: {
      locations: 10,
      tags: 50,
      smsCreditsPerMonth: 500,
      teamMembers: 20,
    },
    features: {
      customBranding: true,
      smsTextRequests: true,
      apiAccess: true,
      prioritySupport: true,
    },
  },
};

export function getPlan(id: PlanId): PlanDefinition {
  return PLANS[id];
}

export function getPlanByPriceId(priceId: string): PlanDefinition | undefined {
  const mapping = stripePriceMapping();
  const planId = mapping.get(priceId);
  return planId ? PLANS[planId] : undefined;
}

function stripePriceMapping(): Map<string, PlanId> {
  const map = new Map<string, PlanId>();

  const starterPrice = process.env.STRIPE_PRICE_ID_STARTER;
  const growthPrice = process.env.STRIPE_PRICE_ID_GROWTH;
  const proPrice = process.env.STRIPE_PRICE_ID_PRO;

  if (starterPrice) map.set(starterPrice, "starter");
  if (growthPrice) map.set(growthPrice, "growth");
  if (proPrice) map.set(proPrice, "pro");

  return map;
}

export function stripePriceId(planId: PlanId): string {
  const envKey = `STRIPE_PRICE_ID_${planId.toUpperCase()}`;
  const value = process.env[envKey];
  if (!value) {
    throw new Error(`${envKey} is not configured. Create a Price in Stripe and set it.`);
  }
  return value;
}
