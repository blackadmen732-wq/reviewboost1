import { PLAN_CATALOG, type PlanId } from "@/lib/owner/plan-catalog";

/**
 * The public price list.
 *
 * Price, locations and Tags come from `PLAN_CATALOG`, which the owner app and
 * the entitlement checks already read, so the marketing page cannot quote a
 * number the product does not enforce.
 *
 * The monthly text allowance is the one figure that is not in that catalog.
 * `PLAN_CATALOG.smsIncluded` is `0` on every plan and that is correct: a plan
 * does not mint texts. A *paid invoice* does, once per billing period, using
 * `app.entitlement_monthly_sms(plan)` in the database — which is where the real
 * 150 / 500 / 1,500 live. They are repeated here because a marketing page
 * cannot query Postgres, and `pricing-plans.test.ts` reads the migration and
 * fails if these two ever disagree. Advertising an allowance the database does
 * not grant is the worst bug this page could have.
 */

export interface PublicPlan {
  id: PlanId;
  name: string;
  /** Whole dollars per month. The catalog stores integer micros. */
  price: number;
  locations: number;
  tags: number;
  /** Texts included each paid month. Pinned to the database by test. */
  monthlyTexts: number;
  /** Free days before the first charge. Only Starter has any. */
  trialDays: number;
  /** The one line that says who this plan is for. */
  fit: string;
}

function dollars(id: PlanId): number {
  return PLAN_CATALOG[id].priceMicros / 1_000_000;
}

export const PUBLIC_PLANS: readonly PublicPlan[] = [
  {
    id: "starter",
    name: PLAN_CATALOG.starter.name,
    price: dollars("starter"),
    locations: PLAN_CATALOG.starter.locationLimit,
    tags: PLAN_CATALOG.starter.tagLimit,
    trialDays: PLAN_CATALOG.starter.trialDays,
    monthlyTexts: 150,
    fit: "One shop, one counter.",
  },
  {
    id: "growth",
    name: PLAN_CATALOG.growth.name,
    price: dollars("growth"),
    locations: PLAN_CATALOG.growth.locationLimit,
    tags: PLAN_CATALOG.growth.tagLimit,
    trialDays: PLAN_CATALOG.growth.trialDays,
    monthlyTexts: 500,
    fit: "A second location, or a busy one.",
  },
  {
    id: "pro",
    name: PLAN_CATALOG.pro.name,
    price: dollars("pro"),
    locations: PLAN_CATALOG.pro.locationLimit,
    tags: PLAN_CATALOG.pro.tagLimit,
    trialDays: PLAN_CATALOG.pro.trialDays,
    monthlyTexts: 1_500,
    fit: "Several locations under one roof.",
  },
] as const;

/**
 * Starter's trial. Growth and Pro have none — they are charged at checkout.
 * Nothing mints texts during it.
 *
 * One Tag is deliberate — enough to put a real code on a real counter and see
 * real ratings, which is the only thing that decides whether someone subscribes.
 */
export const TRIAL = {
  days: PLAN_CATALOG.starter.trialDays,
  plan: PLAN_CATALOG.starter.name,
  locations: 1,
  tags: 1,
  monthlyTexts: 0,
  note: "Starter only. A card is required to start, and nothing is charged until the seven days are up. Growth and Pro are charged when you subscribe.",
} as const;

/** What every paid plan includes, so the cards do not repeat nine lines each. */
export const EVERY_PLAN = [
  "Your own customer page",
  "QR and NFC on the same Tag",
  "Every rating, including the quiet ones",
  "The same Google link for every rating",
] as const;
