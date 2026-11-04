import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CENTS_PER_EXTRA_TEXT,
  EVERY_PLAN,
  PUBLIC_PLANS,
  TEXT_PACKS,
  TRIAL,
} from "@/features/public/pricing-plans";
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

/**
 * Extra texts are sold from the same card the database grants from.
 *
 * `app.sms_pack_catalog` mints a pack only when Stripe collected exactly its
 * price, so a public page quoting a different price would sell packs the
 * database then refuses to credit.
 */
const PACK_MIGRATION = join(
  process.cwd(),
  "..",
  "supabase/migrations/20261103000100_sms_pack_money.sql",
);

function databasePacks(): Record<string, { segments: number; cents: number; currency: string }> {
  const sql = readFileSync(PACK_MIGRATION, "utf8");
  const body = sql.slice(sql.indexOf("function app.sms_pack_catalog"));
  const found: Record<string, { segments: number; cents: number; currency: string }> = {};
  for (const [, id, segments, cents, currency] of body
    .slice(0, body.indexOf("$$;"))
    .matchAll(/\('(\w+)',\s*(\d+)::bigint,\s*(\d+)::bigint,\s*'(\w+)'\)/g)) {
    found[id!] = { segments: Number(segments), cents: Number(cents), currency: currency! };
  }
  return found;
}

describe("extra texts are priced the way the database grants them", () => {
  it("quotes exactly the packs the database sells", () => {
    const database = databasePacks();
    // Guard the reader itself: an empty parse would make this vacuously pass.
    expect(Object.keys(database).sort()).toEqual(["pack_200", "pack_50", "pack_500"]);

    for (const pack of TEXT_PACKS) {
      expect(database[pack.id], `${pack.id} is advertised wrong`).toEqual({
        segments: pack.texts,
        cents: pack.price * 100,
        currency: "usd",
      });
    }
    expect(TEXT_PACKS.map((p) => [p.texts, p.price])).toEqual([
      [50, 4],
      [200, 16],
      [500, 40],
    ]);
  });

  it("charges every extra text the same 8 cents, in whole cents", () => {
    for (const pack of TEXT_PACKS) {
      expect((pack.price * 100) / pack.texts).toBe(CENTS_PER_EXTRA_TEXT);
    }
    expect(CENTS_PER_EXTRA_TEXT).toBe(8);
  });
});
