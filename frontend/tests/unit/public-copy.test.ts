import { describe, expect, it } from "vitest";

import {
  CLOSE,
  HOW_IT_WORKS,
  INTEGRITY,
  isGetStartedNext,
  PRICING,
  PRIVACY,
  PRODUCT,
  PUBLIC_FOOTER,
  PUBLIC_HERO,
  PUBLIC_NAV,
  SECURITY,
  SIGN_IN_HREF,
  START_HREF,
} from "@/features/public/public-copy";

describe("START_HREF and SIGN_IN_HREF", () => {
  it("starts with /login", () => {
    expect(START_HREF).toMatch(/^\/login/);
    expect(SIGN_IN_HREF).toBe("/login");
  });

  it("START_HREF directs to onboarding", () => {
    expect(START_HREF).toContain("next=/onboarding");
  });
});

describe("isGetStartedNext", () => {
  it("matches /onboarding", () => {
    expect(isGetStartedNext("/onboarding")).toBe(true);
  });

  it("matches /onboarding with query", () => {
    expect(isGetStartedNext("/onboarding?step=2")).toBe(true);
  });

  it("does not match other paths", () => {
    expect(isGetStartedNext("/login")).toBe(false);
    expect(isGetStartedNext("/")).toBe(false);
    expect(isGetStartedNext("/onboarding-extra")).toBe(false);
  });
});

describe("PUBLIC_NAV", () => {
  it("has at least 3 entries", () => {
    expect(PUBLIC_NAV.length).toBeGreaterThanOrEqual(3);
  });

  it("every entry has href and label", () => {
    for (const item of PUBLIC_NAV) {
      expect(item.href).toBeTruthy();
      expect(item.label).toBeTruthy();
    }
  });
});

describe("PUBLIC_FOOTER", () => {
  it("has at least as many entries as nav", () => {
    expect(PUBLIC_FOOTER.length).toBeGreaterThanOrEqual(PUBLIC_NAV.length);
  });

  it("includes security and privacy", () => {
    const labels = PUBLIC_FOOTER.map((f) => f.label.toLowerCase());
    expect(labels).toContain("security");
    expect(labels).toContain("privacy");
  });
});

describe("PUBLIC_HERO", () => {
  it("has title and lede", () => {
    expect(PUBLIC_HERO.title).toBeTruthy();
    expect(PUBLIC_HERO.lede).toBeTruthy();
  });

  it("has primary and secondary CTAs", () => {
    expect(PUBLIC_HERO.primary.href).toBeTruthy();
    expect(PUBLIC_HERO.secondary.href).toBeTruthy();
  });
});

describe("section copy blocks", () => {
  it("HOW_IT_WORKS has 3 steps", () => {
    expect(HOW_IT_WORKS).toHaveLength(3);
  });

  it("every step has title and body", () => {
    for (const step of HOW_IT_WORKS) {
      expect(step.title).toBeTruthy();
      expect(step.body).toBeTruthy();
    }
  });

  it("PRODUCT has headline and items", () => {
    expect(PRODUCT.headline).toBeTruthy();
    expect(PRODUCT.items.length).toBeGreaterThanOrEqual(1);
  });

  it("INTEGRITY has headline and body", () => {
    expect(INTEGRITY.headline).toBeTruthy();
    expect(INTEGRITY.body).toBeTruthy();
  });

  it("PRICING has headline and caveat", () => {
    expect(PRICING.headline).toBeTruthy();
    expect(PRICING.caveat).toBeTruthy();
  });

  it("SECURITY has headline", () => {
    expect(SECURITY.headline).toBeTruthy();
  });

  it("PRIVACY has headline", () => {
    expect(PRIVACY.headline).toBeTruthy();
  });

  it("CLOSE has headline", () => {
    expect(CLOSE.headline).toBeTruthy();
  });
});

describe("no fabricated data", () => {
  const allText = [
    PUBLIC_HERO.title,
    PUBLIC_HERO.lede,
    ...HOW_IT_WORKS.map((s) => s.body),
    INTEGRITY.body,
    PRICING.caveat,
    SECURITY.lede,
    PRIVACY.lede,
    CLOSE.lede,
  ].join(" ");

  it("does not mention specific review counts", () => {
    expect(allText).not.toMatch(/\d{2,}\s*reviews/i);
  });

  it("does not contain testimonials", () => {
    expect(allText).not.toMatch(/said|testimonial|quote/i);
  });

  it("does not invent revenue or analytics", () => {
    expect(allText).not.toMatch(/revenue|\$\d|analytics|dashboard/i);
  });
});
