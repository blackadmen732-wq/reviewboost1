import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CUSTOMER_CANVAS } from "@/lib/owner/customer-canvas";
import { clampHeroTransform, heroTransformStyle } from "@/lib/owner/hero-transform";
import { buildEntitlementSnapshot, capabilityLabel } from "@/lib/owner/entitlements";
import { PLAN_CATALOG } from "@/lib/owner/plan-catalog";
import { lastUsedLabel, tagReadiness, tagReadinessLabel } from "@/lib/owner/tag-readiness";
import { payloadContainsTenantIds } from "@/lib/owner/public-customer";
import { NFC_SCENE_COPY } from "@/lib/owner/nfc-presentation";
import { PROGRAM_PHASE_COPY } from "@/lib/owner/nfc-phases";
import { ratingsHeadline } from "@/features/dashboard/home-model";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("hero transform", () => {
  it("clamps the crop so the photo cannot leave the frame", () => {
    // The travel available is the overhang the scale creates, (s - 1) / 2. At
    // the maximum scale of 3 that is ±100, so ±90 is genuinely still covered.
    // This used to assert a flat ±50 at every scale, which was both too tight
    // here and — the reason it mattered — far too loose at scale 1, where it
    // let the artwork slide off and show empty background behind it.
    expect(clampHeroTransform({ x: 90, y: -90, scale: 9 })).toEqual({
      x: 90,
      y: -90,
      scale: 3,
    });
    expect(clampHeroTransform({ x: 150, y: -150, scale: 3 })).toEqual({
      x: 100,
      y: -100,
      scale: 3,
    });
    expect(clampHeroTransform({ x: 30, y: -30, scale: 1 })).toEqual({ x: 0, y: 0, scale: 1 });
    expect(heroTransformStyle({ x: 10, y: -4, scale: 1.5 })).toBe(
      "translate(10%, -4%) scale(1.5)",
    );
  });
});

describe("tag readiness", () => {
  it("is Needs NFC for a new Tag, Both after a code change, Ready when programmed", () => {
    expect(tagReadiness({ nfcProvisionedAt: null, tokenRotatedAt: null })).toBe("needs-nfc");
    expect(
      tagReadiness({
        nfcProvisionedAt: "2026-09-01T00:00:00.000Z",
        tokenRotatedAt: "2026-09-08T00:00:00.000Z",
      }),
    ).toBe("both");
    expect(
      tagReadiness({
        nfcProvisionedAt: "2026-09-08T00:00:00.000Z",
        tokenRotatedAt: "2026-09-01T00:00:00.000Z",
      }),
    ).toBe("ready");
    expect(tagReadinessLabel("needs-nfc")).toBe("Needs NFC");
    expect(lastUsedLabel(null)).toBe("Not used yet");
  });
});

describe("entitlements", () => {
  it("uses catalog limits and never includes SMS on a plan", () => {
    expect(PLAN_CATALOG.starter).toMatchObject({
      locationLimit: 1,
      tagLimit: 3,
      smsIncluded: 0,
    });
    const starter = buildEntitlementSnapshot({
      planId: "starter",
      status: "active",
      locationsUsed: 1,
      tagsUsed: 3,
    });
    expect(starter.canCreateTag).toBe(false);
    expect(starter.tags).toBe("limit-reached");
    expect(starter.sms).toBe("locked");
    expect(capabilityLabel("locked")).toBe("Upgrade to unlock");

    const cancelled = buildEntitlementSnapshot({
      planId: "pro",
      status: "cancelled",
      locationsUsed: 1,
      tagsUsed: 1,
    });
    expect(cancelled.canUseSoftware).toBe(false);
    expect(cancelled.canCreateTag).toBe(false);
    expect(cancelled.tags).toBe("cancelled");
  });
});

describe("public customer hygiene", () => {
  it("flags org, location, and stand ids", () => {
    expect(
      payloadContainsTenantIds({
        business: { name: "Mario’s" },
        locationId: "22222222-2222-2222-2222-222222222222",
      }),
    ).toBe(true);
    expect(
      payloadContainsTenantIds({
        heroUrl: "/api/v1/public/q/abcdefghijklmnop/artwork",
        transform: { x: 0, y: 0, scale: 1 },
      }),
    ).toBe(false);
  });

  it("customer visit view never renders location or ids", () => {
    const view = source("features/customer-page/customer-visit-view.tsx");
    expect(view).not.toMatch(/location\.name|locationName|orgId|standId|locationId/);
    expect(view).toContain("visit-card");
    expect(view).toContain("data-hero-layer");
    expect(view).toContain("data-card-fixed");
    expect(view).not.toMatch(/visit-tagline|tagline \?/);
  });
});

describe("WYSIWYG canvas (SoT v1.9 / v1.10)", () => {
  it("locks the Mario iPhone canvas", () => {
    expect(CUSTOMER_CANVAS).toMatchObject({
      width: 390,
      height: 844,
      aspectRatio: "390 / 844",
      heroShare: 0.56,
      cardShare: 0.44,
    });
  });

  it("owner phone and live /q share the Mario canvas", () => {
    const css = source("styles/customer-page.css");
    const editor = source("features/customer-page/customer-page-editor.tsx");
    const live = source("features/customer-flow/customer-flow.tsx");
    expect(css).toContain("aspect-ratio: 390 / 844");
    // The sheet is sized by screen width (320pt at 390 wide, measured from the
    // approved reference); the artwork takes whatever height is left.
    expect(css).toContain("height: calc(82.05cqi");
    expect(css).not.toContain("flex: 0 0 42%");
    expect(css).not.toContain("height: 640px");
    expect(editor).toContain("CustomerVisitView");
    expect(live).toContain("CustomerVisitView");
    expect(editor).toContain("footerLine");
    expect(live).toContain("footerLine");
  });
});

describe("program Tag words", () => {
  it("is a human sequence with no jargon", () => {
    const joined = Object.values(PROGRAM_PHASE_COPY)
      .map((item) => `${item.title} ${item.body}`)
      .join(" ");
    expect(joined).not.toMatch(/NDEF|RPC|token hash/i);
    const sheet = source("features/tags/program-tag-sheet.tsx");
    expect(sheet).not.toMatch(/\bNDEF\b/);
  });

  /**
   * The success scene used to offer "Test customer page" beside "Done", which
   * made the end of a finished operation a choice between two buttons. It now
   * shows the check and leaves on its own, so this asserts the opposite of what
   * it originally did — deliberately.
   */
  it("ends on a check rather than another decision", () => {
    const sheet = source("features/tags/program-tag-sheet.tsx");
    expect(sheet).not.toContain("Test customer page");
    expect(NFC_SCENE_COPY.success.action).toBeUndefined();
    expect(NFC_SCENE_COPY.success.dismiss).toBeUndefined();
  });
});

describe("Owner Systems SoT v1.7", () => {
  it("locks design philosophy and keeps Home slots", () => {
    const spec = readFileSync(
      join(process.cwd(), "..", "product-design/2026-09-09-OWNER-SYSTEMS-SPEC-v1.md"),
      "utf8",
    );
    expect(spec).toContain("Owner Systems Spec v1.7");
    expect(spec).toContain("v1.6");
    expect(spec).toContain("v1.5");
    expect(spec).toContain("no corporate jargon");
    expect(spec).toContain("Home never changes layout");
  });
});

describe("Home muscle memory", () => {
  it("keeps the same Home slots — name, action, unread, Tags", () => {
    const home = source("features/dashboard/owner-home.tsx");
    expect(home).toContain("businessName");
    expect(home).toContain("EmptyHome");
    expect(home).toContain("ActiveHome");
    expect(home).toContain("FeedbackList");
    expect(home).toContain("PreviewCustomerPage");
    expect(home).toContain("tagStatusLine");
    expect(home).toContain('variant="action"');
    expect(home).not.toMatch(/entitlement|KPI|analytics|optimize|configure/i);
  });
});

describe("Home headline", () => {
  it("is one number and one arrow", () => {
    expect(ratingsHeadline({ ratingsThisWeek: 12, ratingsLastWeek: 9 })).toBe(
      "12 ratings this week, up 3",
    );
    expect(ratingsHeadline({ ratingsThisWeek: 1, ratingsLastWeek: 0 })).toBe("1 rating this week");
  });
});

describe("customer page discoverability", () => {
  it("is reached from Settings, and never from the bottom bar", () => {
    expect(source("app/(owner)/settings/page.tsx")).toContain('href="/customer-page"');
    expect(source("features/dashboard/nav-items.ts")).not.toContain("/customer-page");
  });
});


it("asks for a reprint when rotation has cleared the NFC programmed date", () => {
  expect(tagReadiness({ nfcProvisionedAt: null, tokenRotatedAt: "2026-09-28T12:00:00Z" })).toBe("both");
});
