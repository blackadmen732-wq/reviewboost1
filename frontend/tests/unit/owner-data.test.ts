import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { startOfLocalDay, startOfLocalMonth } from "@/lib/utils/local-day";
import { relativeDay } from "@/lib/utils/relative-day";

/**
 * The owner data layer, and the rules the owner screens have to keep.
 *
 * `owner-data.ts` imports "server-only" and reaches Supabase, so the pure
 * helpers are tested directly and the rest is asserted against source. Source
 * assertions are weaker than behavioural ones and are used here deliberately:
 * the properties being protected are *absences* — a query that must never be
 * written, a metric that must never be computed — and an absence cannot be
 * observed by calling anything.
 *
 * This is the same class of test that would have caught the grant outage, where
 * every mock happily returned rows a real role could not read.
 */

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/**
 * Source with comments removed.
 *
 * The rules below are enforced by asserting that certain words never appear in
 * the code — and the code is heavily commented with prose *explaining those very
 * rules*, which trips every one of those assertions. Stripping comments first
 * means the tests check what the program does, not what it says about itself.
 */
function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("startOfLocalDay", () => {
  it("returns an instant that is midnight in the target zone", () => {
    for (const timezone of [
      "UTC",
      "Europe/London",
      "America/New_York",
      "Asia/Tokyo",
      "Australia/Sydney",
      "Asia/Kolkata", // half-hour offset
      "Pacific/Chatham", // 45-minute offset
    ]) {
      const start = startOfLocalDay(timezone);

      const wallClock = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(start);

      expect(wallClock, `${timezone} should start at midnight`).toBe("00:00");
    }
  });

  it("never returns a moment in the future", () => {
    // Kiritimati is UTC+14: the zone most likely to expose a sign error.
    for (const timezone of ["UTC", "Pacific/Kiritimati", "Pacific/Niue"]) {
      expect(startOfLocalDay(timezone).getTime(), timezone).toBeLessThanOrEqual(Date.now());
    }
  });

  it("lands on the same calendar day the business is currently in", () => {
    for (const timezone of ["UTC", "America/Los_Angeles", "Asia/Tokyo", "Pacific/Kiritimati"]) {
      const format = (date: Date) =>
        new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date);

      expect(format(startOfLocalDay(timezone)), timezone).toBe(format(new Date()));
    }
  });

  it("holds across a daylight-saving transition", () => {
    // The morning New York springs forward. A fixed-offset implementation is an
    // hour out here and "today" silently starts at 01:00.
    const duringDst = new Date("2026-03-08T15:00:00Z");
    const start = startOfLocalDay("America/New_York", duringDst);

    expect(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(start),
    ).toBe("00:00");
  });
});

describe("startOfLocalMonth", () => {
  it("is midnight on the first of the month in the target zone", () => {
    for (const timezone of ["UTC", "Asia/Kolkata", "America/New_York"]) {
      const start = startOfLocalMonth(timezone);

      const formatted = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(start);

      expect(formatted, timezone).toMatch(/-01,? 00:00$/);
    }
  });

  it("is never after the start of today", () => {
    for (const timezone of ["UTC", "Asia/Tokyo", "America/Los_Angeles"]) {
      expect(startOfLocalMonth(timezone).getTime(), timezone).toBeLessThanOrEqual(
        startOfLocalDay(timezone).getTime(),
      );
    }
  });
});

describe("relativeDay", () => {
  const now = new Date("2026-08-10T12:00:00Z").getTime();

  it("says today, yesterday, then counts, then dates", () => {
    expect(relativeDay("2026-08-10T09:00:00Z", now)).toBe("Today");
    expect(relativeDay("2026-08-09T09:00:00Z", now)).toBe("Yesterday");
    expect(relativeDay("2026-08-07T09:00:00Z", now)).toBe("3 days ago");
    // Past a week people think in dates, not counts.
    expect(relativeDay("2026-07-12T09:00:00Z", now)).toMatch(/Jul/);
  });

  it("treats a future timestamp as today rather than a negative count", () => {
    // Clock skew between a phone and the server must not produce "-1 days ago".
    expect(relativeDay("2026-08-11T09:00:00Z", now)).toBe("Today");
  });
});

/**
 * Colours that carry a good/bad judgement.
 *
 * Matched as real design tokens rather than as bare words — `motion-reduce`
 * contains "red", and a test that fails on it teaches people to delete the test.
 */
const VALENCE_COLOUR =
  /--rb-(?:danger|success|brand)\b|\b(?:bg|text|fill|border|stroke)-(?:red|green|emerald|rose|lime)-/;

describe("review integrity in the owner interface", () => {
  const ownerPages = readdirSync(join(process.cwd(), "app/(owner)"), {
    recursive: true,
    encoding: "utf8",
  }).filter((entry) => entry.endsWith(".tsx"));

  it("has owner screens to check", () => {
    expect(ownerPages.length).toBeGreaterThan(5);
  });

  it("never introduces a rating threshold anywhere an owner can see", () => {
    for (const page of ownerPages) {
      const text = code(join("app/(owner)", page));
      expect(text, page).not.toMatch(/review_?threshold/i);
      expect(text, page).not.toMatch(/reviews?\s+prevented/i);
      expect(text, page).not.toMatch(/intercept(ed|ion)?\s*rate/i);
    }
  });

  it("keeps the same rule out of the data layer", () => {
    const layer = code("lib/server/owner-data.ts");
    expect(layer).not.toMatch(/review_?threshold/i);
    expect(layer).not.toMatch(/intercept/i);
  });

  it("never joins praise to a rating", () => {
    const layer = code("lib/server/owner-data.ts");

    // `team_praise_records` has no rating column, and listPraise must not reach
    // `customer_responses` to find one. The whole point of the feature is that
    // an owner reacts to what was written, not to a number that may have been
    // about the parking.
    const listPraise = layer.slice(
      layer.indexOf("export async function listPraise"),
      layer.indexOf("export async function getPraiseLeaderboard"),
    );

    expect(listPraise.length).toBeGreaterThan(0);
    expect(listPraise).not.toMatch(/rating/i);
    expect(listPraise).not.toMatch(/customer_responses/);
  });

  it("renders every star value through one component with no branch on value", () => {
    const stars = code("components/ui/stars.tsx");

    // A single gold, applied by position only. A green 5 or a red 1 would turn
    // the interface into a scoreboard and teach an owner to read low ratings as
    // something to suppress rather than something to learn from.
    expect(stars).not.toMatch(VALENCE_COLOUR);

    // Exactly one colour decision in the file: filled or not.
    expect(stars).not.toMatch(/rating\s*[<>]=?\s*[1-5]/);
    expect(stars).toMatch(/position <= rating/);
  });

  it("scales the breakdown without colouring low ratings differently", () => {
    const breakdown = code("features/dashboard/rating-breakdown.tsx");

    expect(breakdown).not.toMatch(VALENCE_COLOUR);
    // Every bar reads the same token; none is chosen from the rating.
    expect(breakdown).not.toMatch(/rating\s*[<>]=?\s*[1-5]/);
  });

  it("never breaks the Google click-through down by rating", () => {
    const layer = code("lib/server/owner-data.ts");

    const summary = layer.slice(layer.indexOf("export async function getVisitSummary"));

    // Split by star, "went to Google" becomes an intercept rate — precisely the
    // metric this product refuses to produce.
    expect(summary).not.toMatch(/\.eq\(\s*["']rating["']/);
  });
});

describe("owner data layer discipline", () => {
  it("is server-only", () => {
    expect(source("lib/server/owner-data.ts")).toMatch(/^import "server-only";/m);
  });

  it("never reaches for the service-role key", () => {
    const layer = code("lib/server/owner-data.ts");

    // Every read here must run through the caller's own RLS-scoped client. A
    // service-role client would return every tenant's rows and no test using
    // mocks would notice.
    expect(layer).not.toMatch(/service_?role/i);
    expect(layer).not.toMatch(/supabaseAdmin|createAdminClient/);
    expect(layer).toMatch(/supabaseServer/);
  });

  it("leaves owner pages with no hand-rolled Supabase queries", () => {
    const pages = readdirSync(join(process.cwd(), "app/(owner)"), {
      recursive: true,
      encoding: "utf8",
    }).filter((entry) => entry.endsWith("page.tsx"));

    for (const page of pages) {
      const text = code(join("app/(owner)", page));

      // Onboarding and login legitimately talk to Supabase auth directly; they
      // are not reading owner data.
      if (page.includes("onboarding") || page.includes("login")) continue;

      expect(text, `${page} should read through the shared data layer`).not.toMatch(
        /\.from\(["'](customer_responses|team_praise_records|review_stands|locations|organization_members)["']\)/,
      );
    }
  });
});
