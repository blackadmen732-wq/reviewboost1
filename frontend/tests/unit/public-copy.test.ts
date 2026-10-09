import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PLAN_CATALOG } from "@/lib/owner/plan-catalog";

import {
  HOW_IT_WORKS,
  INTEGRITY,
  isGetStartedNext,
  PRICING,
  PRODUCT,
  PUBLIC_FOOTER,
  PUBLIC_HERO,
  START_HREF,
} from "@/features/public/public-copy";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(dir: string): string[] {
  return readdirSync(join(process.cwd(), dir), { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts") || entry.endsWith(".tsx"))
    .map((entry) => join(dir, entry));
}

const PUBLIC_SOURCES = [
  ...walk("features/public"),
  ...walk("app/(public)"),
  "app/page.tsx",
  "features/auth/sign-in-flow.tsx",
  "features/onboarding/onboarding-flow.tsx",
  "features/onboarding/onboarding-model.ts",
];

const FORBIDDEN = [
  /reviews?\s+prevented/i,
  /reviews?\s+intercepted/i,
  /intercept(?:ed|ion)?\s*rate/i,
  /only\s+[45][-\s]/i,
  /£\d/,
  /€\d/,
  /trusted by/i,
  /testimonial/i,
];

describe("public + activation copy", () => {
  it("sends Get started into onboarding after login", () => {
    expect(START_HREF).toBe("/login?next=/onboarding");
    expect(PUBLIC_HERO.primary.href).toBe(START_HREF);
    expect(isGetStartedNext("/onboarding")).toBe(true);
    expect(isGetStartedNext("/home")).toBe(false);
    expect(PUBLIC_FOOTER.map((item) => item.href)).toContain("/how-it-works");
    expect(PUBLIC_FOOTER.map((item) => item.href)).toContain("/privacy");
  });

  it("states the rating-blind Google opportunity", () => {
    expect(INTEGRITY.headline.toLowerCase()).toContain("same google opportunity");
    // Was "Private notes are extra — never instead", describing a note field
    // V1 does not have. The claim that matters is the one about routing.
    expect(INTEGRITY.body.toLowerCase()).toContain("do not hide, delay, or filter");
    expect(INTEGRITY.body.toLowerCase()).not.toMatch(/private note|words they left/);
    expect(HOW_IT_WORKS[2]?.title.toLowerCase()).toContain("google");
  });

  it("describes Tags without inventing a price", () => {
    expect(PRODUCT.headline.toLowerCase()).toContain("tag");
    // Was "Billing is not live yet" — true when written, false since Stripe
    // shipped, and the kind of stale line that makes a visitor doubt the rest
    // of the page. The caveat still has to say a card is needed up front.
    expect(PRICING.caveat.toLowerCase()).not.toContain("not live");
    expect(PRICING.caveat.toLowerCase()).toContain("card");
    expect(PRICING.caveat.toLowerCase()).toContain("trial");
    expect(`${PRICING.headline} ${PRICING.lede} ${PRICING.caveat}`).not.toMatch(/\$\d/);
  });

  it("keeps forbidden marketing claims out of public and activation sources", () => {
    expect(PUBLIC_SOURCES.length).toBeGreaterThan(8);

    for (const path of PUBLIC_SOURCES) {
      const text = code(path);
      for (const pattern of FORBIDDEN) {
        expect(text, `${path} matched ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  /**
   * Dollar amounts used to be banned outright, because the product had no
   * published price and an invented one is worse than none. The offer is frozen
   * now, so the rule inverts: a price may appear, but only a real one.
   *
   * `pricing-plans.test.ts` pins those numbers to PLAN_CATALOG and to
   * `app.entitlement_monthly_sms` in the migration. This stops a different
   * number being typed into prose somewhere else on the site.
   */
  it("quotes no price that the plan catalog does not charge", () => {
    const real = new Set(Object.values(PLAN_CATALOG).map((plan) => plan.priceMicros / 1_000_000));

    for (const path of PUBLIC_SOURCES) {
      for (const [, amount] of code(path).matchAll(/\$(\d[\d,]*)/g)) {
        const value = Number(amount!.replace(/,/g, ""));
        expect(real.has(value), `${path} quotes $${amount}, which no plan charges`).toBe(true);
      }
    }
  });

  it("does not restyle the frozen customer page in onboarding", () => {
    const flow = code("features/onboarding/onboarding-flow.tsx");
    expect(flow).toContain("standUrl");
    expect(flow).not.toMatch(/customer-flow/);
    expect(flow).not.toMatch(/\bLooks\b/);
  });
});
