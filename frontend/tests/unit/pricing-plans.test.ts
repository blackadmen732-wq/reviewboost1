import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EVERY_PLAN, PUBLIC_PLANS, TRIAL } from "@/features/public/pricing-plans";
import { PLAN_CATALOG } from "@/lib/owner/plan-catalog";

/**
 * The price list a visitor reads has to be the one the product enforces.
 *
 * Price, locations and Tags come straight from `PLAN_CATALOG`. The monthly text
 * allowance cannot: a plan mints no texts, a paid invoice does, and the real
 * figure lives in `app.entitlement_monthly_sms` in Postgres. So this reads the
 * migration and compares. Selling "150 texts a month" while the database grants
 * a different number is the one mistake on this page that costs money and
 * trust at the same time.
 */

const MIGRATION = join(
  process.cwd(),
  "..",
  "supabase/migrations/20260915000400_entitlements.sql",
);

/** The allowances as the database actually defines them. */
function databaseMonthlySms(): Record<string, number> {
  const sql = readFileSync(MIGRATION, "utf8");
  const body = sql.slice(sql.indexOf("function app.entitlement_monthly_sms"));
  const found: Record<string, number> = {};
  for (const [, plan, amount] of body
    .slice(0, body.indexOf("$$;"))
    .matchAll(/when '(\w+)' then (\d+)/g)) {
    found[plan!] = Number(amount);
  }
  return found;
}

describe("the public price list matches the product", () => {
  it("quotes the catalog's prices, not its own", () => {
    for (const plan of PUBLIC_PLANS) {
      expect(plan.price * 1_000_000).toBe(PLAN_CATALOG[plan.id].priceMicros);
    }
    // The frozen offer, stated plainly so a change is deliberate.
    expect(PUBLIC_PLANS.map((p) => p.price)).toEqual([49, 79, 129]);
  });

  it("quotes the catalog's limits", () => {
    for (const plan of PUBLIC_PLANS) {
      expect(plan.locations).toBe(PLAN_CATALOG[plan.id].locationLimit);
      expect(plan.tags).toBe(PLAN_CATALOG[plan.id].tagLimit);
    }
    expect(PUBLIC_PLANS.map((p) => p.tags)).toEqual([3, 8, 25]);
    expect(PUBLIC_PLANS.map((p) => p.locations)).toEqual([1, 2, 5]);
  });

  it("advertises the text allowance the database actually grants", () => {
    const database = databaseMonthlySms();
    // Guard the reader itself: an empty parse would make this vacuously pass.
    expect(Object.keys(database).sort()).toEqual(["growth", "pro", "starter"]);

    for (const plan of PUBLIC_PLANS) {
      expect(plan.monthlyTexts, `${plan.id} is advertised wrong`).toBe(database[plan.id]);
    }
    expect(PUBLIC_PLANS.map((p) => p.monthlyTexts)).toEqual([150, 500, 1500]);
  });
});

describe("the trial is a trial, not a free plan", () => {
  it("is seven days, one Tag, and no texts", () => {
    expect(TRIAL).toMatchObject({ days: 7, locations: 1, tags: 1, monthlyTexts: 0 });
  });

  it("says a card is needed up front", () => {
    expect(TRIAL.note.toLowerCase()).toContain("card");
    expect(TRIAL.note.toLowerCase()).toContain("nothing is charged");
  });

  it("is Starter's alone, and says Growth and Pro are charged at once", () => {
    expect(TRIAL.plan).toBe("Starter");
    expect(PUBLIC_PLANS.filter((p) => p.trialDays > 0).map((p) => p.id)).toEqual(["starter"]);
    expect(TRIAL.note).toMatch(/Growth and Pro are charged when you subscribe/);
  });

  it("never offers a free plan", () => {
    const words = [...PUBLIC_PLANS.map((p) => `${p.name} ${p.fit}`), ...EVERY_PLAN].join(" ");
    expect(words.toLowerCase()).not.toMatch(/\bfree\b|forever/);
    expect(PUBLIC_PLANS.every((plan) => plan.price > 0)).toBe(true);
  });
});
