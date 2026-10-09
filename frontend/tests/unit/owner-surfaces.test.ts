import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/** Source with comments removed: a comment may name a number the code must not. */
function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function ownerPages(): string[] {
  return readdirSync(join(process.cwd(), "app/(owner)"), {
    recursive: true,
    encoding: "utf8",
  }).filter((entry) => entry.endsWith("page.tsx"));
}

describe("the owner surfaces show real state", () => {
  it("never writes a plan, a status, or a trial length into a billing screen", () => {
    const panel = code("features/dashboard/billing-panel.tsx");

    // A page that fills in "Starter" or "trialing" when the data is missing is
    // a page that tells a business it is subscribed when it is not.
    expect(panel).not.toMatch(/status\s*[=:]\s*["']trialing["']/);
    expect(panel).not.toMatch(/planId\s*[=:]\s*["']starter["']/);
    expect(panel).not.toMatch(/\|\|\s*["']starter["']/);
    expect(panel).not.toMatch(/\?\?\s*["']trialing["']/);
    expect(panel).not.toMatch(/7 days remaining/);
  });

  it("renders no plan at all rather than a default one when the backend has none", () => {
    const panel = code("features/dashboard/billing-panel.tsx");

    // `describe` must have an explicit branch for "no entitlement", and it must
    // not fall through to a plan.
    expect(panel).toMatch(/could not read your plan/);
    expect(panel).toMatch(/billing\.status === null/);
  });

  it("asks a business with no subscription to choose a plan, not to panic", () => {
    const panel = code("features/dashboard/billing-panel.tsx");

    // A brand-new business is suspended: it has been through no checkout, so
    // its Tags serve nobody. Telling it "your account is suspended" would read
    // as a punishment for signing up, and it would not say what to do next.
    expect(panel).toMatch(/Choose a plan to open your Tags/);
    // And it must be offered the checkout, not just the sentence.
    expect(panel).toMatch(/billing\.status === "trialing" && billing\.planId === null/);
  });

  it("never claims a card is on file for a trial that never had one", () => {
    const panel = code("features/dashboard/billing-panel.tsx");

    // Businesses that predate billing were given a finite trial by a
    // migration. They have no card. The copy that says otherwise must be
    // behind a branch that knows there is a plan.
    const cardOnFile = panel.indexOf("Your card is on file");
    const planCheck = panel.indexOf("billing.planId === null");
    expect(cardOnFile).toBeGreaterThan(-1);
    expect(planCheck).toBeGreaterThan(-1);
    expect(planCheck).toBeLessThan(cardOnFile);
  });

  it("keeps the Text Requests balance out of the component's hands", () => {
    const composer = code("features/dashboard/text-request-composer.tsx");

    // 150 is Starter's included allowance. A page that knows it is a page that
    // will show it to a business on Growth, or to one that has already spent it.
    expect(composer).not.toMatch(/\b150\b/);
    expect(composer).not.toMatch(/\b500\b/);
    expect(composer).not.toMatch(/\b1500\b/);
    // Balances arrive as props, from the ledger.
    expect(composer).toMatch(/balance\.monthly/);
    expect(composer).toMatch(/balance\.purchased/);
  });

  it("counts segments on the server, never in the browser", () => {
    const composer = code("features/dashboard/text-request-composer.tsx");

    // `length / 160` is wrong for any message with an emoji, a curly quote, or
    // an accented name — and the number it produces is what a business is
    // billed against.
    expect(composer).not.toMatch(/length\s*\/\s*160/);
    expect(composer).not.toMatch(/Math\.ceil\([^)]*length/);
    expect(composer).toMatch(/text-requests\/preview/);
  });

  it("calls the product Text Requests, and never campaigns", () => {
    for (const file of [
      "features/dashboard/text-request-composer.tsx",
      "features/dashboard/nav-items.ts",
      "app/(owner)/text-requests/page.tsx",
    ]) {
      // Comments stripped: this file's own comment says why the word is
      // banned, and a rule that trips on its own rationale is noise.
      expect(code(file), file).not.toMatch(/campaign/i);
    }
  });

  it("names the physical thing Tags in the navigation", () => {
    const nav = source("features/dashboard/nav-items.ts");
    expect(nav).toMatch(/label: "Tags"/);
    expect(nav).toMatch(/label: "Text Requests"/);
  });

  it("gives Home and Feedback one definition of unread", () => {
    const layer = code("lib/server/owner-data.ts");

    // Home counts unread and Feedback filters by it. Two definitions is how a
    // badge says 3 and the list shows 5, and the owner stops believing either.
    const predicates = layer.match(/\.is\("read_at", null\)/g) ?? [];
    expect(predicates.length).toBeGreaterThanOrEqual(2);
    // Nothing may reach for a second notion of "seen".
    expect(layer).not.toMatch(/viewed_at|seen_at|opened_by_owner/);
  });

  it("measures the day where the business is, not where the server is", () => {
    const layer = code("lib/server/owner-data.ts");

    // A London owner on a US-hosted server watching "today" reset mid-afternoon
    // looks exactly like data loss.
    expect(layer).toMatch(/startOfLocalDay\(timezone\)/);
    expect(layer).not.toMatch(/setHours\(0, ?0, ?0, ?0\)/);
    expect(layer).not.toMatch(/toISOString\(\)\.slice\(0, ?10\)/);
  });

  it("reads every owner surface through the shared data layer", () => {
    // `owner-data.test.ts` already guards the table names. This adds the two
    // screens built here, where a direct query would also bypass the
    // entitlement and balance reads they exist to render.
    for (const page of ["text-requests/page.tsx", "settings/billing/page.tsx"]) {
      const body = code(join("app/(owner)", page));
      expect(ownerPages(), `${page} should exist`).toContain(page);
      expect(body, page).not.toMatch(/createClient|\.from\(|\.rpc\(/);
    }
  });
});

/**
 * The unread badge and the unread list have to mean the same thing.
 *
 * The count queried `read_at is null` with no resolved filter while both Home
 * and Feedback listed unread *and* unresolved, so a rating a teammate had
 * already resolved still read as "1 message needs you" above an empty list.
 */
describe("unread means the same thing everywhere", () => {
  it("counts unread and unresolved, as the lists do", () => {
    const data = code("lib/server/owner-data.ts");
    // Scoped to getOwnerCounts: `listReviews` also matches on read_at, and it
    // applies the unresolved predicate through its own `openOnly` option.
    const counts = data.slice(data.indexOf("export const getOwnerCounts"));
    const unreadIndex = counts.indexOf('.is("read_at", null)');
    expect(unreadIndex).toBeGreaterThan(-1);

    const unreadQuery = counts.slice(unreadIndex, unreadIndex + 120);
    expect(unreadQuery).toContain('.is("resolved_at", null)');
  });

  it("lists Home's unread rows without a note filter", () => {
    // A silent 1-star is exactly the unread an owner most needs to see, and it
    // has no note — filtering by one hid it from the list while still counting
    // it in the badge.
    const home = code("app/(owner)/home/page.tsx");
    expect(home).toContain("unreadOnly: true");
    expect(home).not.toContain("withNotesOnly");
  });

  it("lists Feedback without a note filter either", () => {
    const feedback = code("app/(owner)/feedback/page.tsx");
    expect(feedback).not.toContain("withNotesOnly");
  });
});
