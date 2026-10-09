import { describe, expect, it } from "vitest";

import { PUBLIC_PLANS } from "@/features/public/pricing-plans";
import { START_HREF, planHref } from "@/features/public/public-copy";
import { safeInternalPath } from "@/lib/security/safe-redirect";

const ORIGIN = "https://app.reviewboost.fit";

/**
 * The buying flow: pricing page -> sign in -> setup -> billing.
 *
 * Every plan button used to point at the same START_HREF, so the one thing
 * worth knowing — which plan somebody picked while comparing prices — was
 * discarded on the click that signalled it. They finished setup, landed on
 * Home, and had to find Billing and choose the same plan a second time.
 *
 * These tests pin the two things that make carrying it safe: the id survives
 * the redirect validator, and a forged one cannot reach anything.
 */
describe("the chosen plan survives the trip to billing", () => {
  it("gives every plan its own start link", () => {
    const links = PUBLIC_PLANS.map((plan) => planHref(plan.id));
    expect(new Set(links).size).toBe(PUBLIC_PLANS.length);
    // The bug this replaces: all three buttons pointing at one URL.
    expect(links).not.toContain(START_HREF);
  });

  it("keeps the plan through safeInternalPath, which the login page runs", () => {
    for (const plan of PUBLIC_PLANS) {
      const next = new URL(planHref(plan.id), ORIGIN).searchParams.get("next");
      expect(next).toBe(`/onboarding?plan=${plan.id}`);
      // safeInternalPath returns pathname + search + hash, so the query lives.
      expect(safeInternalPath(next, ORIGIN)).toBe(`/onboarding?plan=${plan.id}`);
    }
  });

  it("still refuses an off-origin destination that carries a plan", () => {
    // Carrying a plan must not become a way to smuggle a destination: these
    // fall back to /home rather than following the URL.
    expect(safeInternalPath("https://evil.example/onboarding?plan=pro", ORIGIN)).toBe("/home");
    expect(safeInternalPath("//evil.example/onboarding?plan=pro", ORIGIN)).toBe("/home");
    expect(safeInternalPath("/\\evil.example?plan=pro", ORIGIN)).toBe("/home");
  });

  it("names a plan the product actually sells", () => {
    // Both pages validate `?plan=` against this list before using it, so a
    // forged id is dropped rather than echoed into a page or a query.
    const ids = PUBLIC_PLANS.map((plan) => plan.id);
    expect(ids).not.toContain("");
    for (const id of ids) expect(id).toMatch(/^[a-z]+$/);
    expect(ids.includes("free" as (typeof ids)[number])).toBe(false);
  });
});
