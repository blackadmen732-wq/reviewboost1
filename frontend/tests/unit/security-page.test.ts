import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A security page is the easiest page on a site to lie on.
 *
 * Nobody checks it, every sentence sounds reassuring, and the cost of a false
 * claim only arrives during someone else's compliance review. These tests tie
 * each claim to the code that makes it true, so a control being removed breaks
 * a test rather than silently turning the page into marketing.
 */

const ROOT = process.cwd();
const page = readFileSync(join(ROOT, "app/(public)/security/page.tsx"), "utf8");

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("the security page claims nothing it has not earned", () => {
  it("names no certification, audit or guarantee", () => {
    // It may say these do NOT exist — that sentence is the point of the page.
    const claims = page.replace(/There is no SOC 2 report,[\s\S]*?on it\./, "");
    expect(claims).not.toMatch(/SOC ?2|ISO ?\d|HIPAA|PCI[- ]DSS compliant/i);
    expect(claims).not.toMatch(/bank[- ]level|military[- ]grade|unhackable|100% secure/i);
  });

  it("keeps the section that refuses badges", () => {
    expect(page).toContain("do not claim");
    expect(page.toLowerCase()).toContain("have not earned");
  });
});

describe("every claim points at something real", () => {
  it("the customer page really is rate limited, and fails closed", () => {
    const flow = source("lib/server/customer-flow-service.ts");
    expect(flow).toContain("rateLimited");
    // The page says the limiter refuses when it cannot be reached. That is
    // `onUnavailable === "refuse"`, not a comment.
    expect(flow).toContain('onUnavailable === "refuse"');
    expect(page.toLowerCase()).toContain("rate limited");
  });

  it("the review destination really is validated before a customer sees it", () => {
    const validator = source("lib/server/google-review-url.ts");
    expect(validator).toContain("isValidGoogleReviewUrl");
    // The specific attack the page describes: credentials in the authority.
    expect(validator.toLowerCase()).toContain("credentials in the authority");
    expect(page.toLowerCase()).toContain("credentials smuggled into the host");
  });

  it("billing really is applied from verified webhooks only", () => {
    const billing = source("lib/server/billing-service.ts");
    expect(billing.toLowerCase()).toContain("signature is verified before anything is written");
    expect(page.toLowerCase()).toContain("signature is verified");
  });

  it("the privileged key really is server-only and guarded by name", () => {
    const env = source("lib/server/env.ts");
    expect(env).toContain('import "server-only"');
    // The page says the build fails if it could reach a browser. This is that.
    expect(env).toContain("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY");
    expect(page.toLowerCase()).toContain("server-only");
  });

  it("lists the owner surfaces that exist, and not ones that do not", () => {
    // It used to say "Team", which is not a V1 surface, and omitted Text
    // Requests, which is one of the four.
    expect(page).toContain("Text Requests");
    expect(page).not.toMatch(/\bTeam\b/);
    expect(page).not.toMatch(/\bPraise\b|\bCampaigns\b/);
  });

  it("does not claim the customer page collects anything but a star", () => {
    expect(page.toLowerCase()).toContain("no field on it for anything but the star");
    expect(page).not.toMatch(/private note|written feedback/i);
  });
});
