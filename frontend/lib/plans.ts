/**
 * The locked plans, as a signed-out visitor or a pricing table sees them.
 *
 * The server's `PLANS` in `lib/server/entitlements.ts` is server-only, and the
 * database is the authority over both. These numbers are repeated here because
 * a public page has no backend state to read, and a test asserts they match
 * the server's — so a price change that misses this file fails CI instead of
 * shipping a pricing page that disagrees with checkout.
 *
 * Nothing about a business's *current* subscription is read from here.
 */

export type PublicPlanId = "starter" | "growth" | "pro";

export interface PublicPlan {
  id: PublicPlanId;
  name: string;
  priceUsd: number;
  locations: number;
  tags: number;
  sms: number;
  /** Days of free trial before the first charge, or null when charged at checkout. */
  trialDays: number | null;
  audience: string;
}

export const PUBLIC_PLANS: ReadonlyArray<PublicPlan> = [
  {
    id: "starter",
    name: "Starter",
    priceUsd: 49,
    locations: 1,
    tags: 3,
    sms: 150,
    trialDays: 7,
    audience: "For a single-location business getting ReviewBoost running.",
  },
  {
    id: "growth",
    name: "Growth",
    priceUsd: 79,
    locations: 2,
    tags: 8,
    sms: 500,
    trialDays: null,
    audience: "For a busier business, or one with a second location.",
  },
  {
    id: "pro",
    name: "Pro",
    priceUsd: 129,
    locations: 5,
    tags: 25,
    sms: 1500,
    trialDays: null,
    audience: "For larger local businesses that need more capacity.",
  },
];

/** What a trial includes. Mirrors `TRIAL_LIMITS` on the server. */
export const PUBLIC_TRIAL_LIMITS = { locations: 1, tags: 1, sms: 0 } as const;
