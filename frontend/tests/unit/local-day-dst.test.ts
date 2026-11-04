import { describe, expect, it } from "vitest";

import {
  startOfLocalDay,
  startOfLocalMonth,
  startOfLocalWeek,
} from "@/lib/utils/local-day";

/**
 * Week boundaries across a daylight-saving change.
 *
 * `startOfLocalWeek` used to subtract 6 × 86_400_000 ms from today's local
 * midnight. In a zone that changed offset inside that span the result was an
 * hour off and landed on the wrong calendar day — so an evening of ratings
 * moved between "this week" and "last week" twice a year, which reads to an
 * owner as ratings appearing or vanishing.
 */

/** What a wall clock in that zone reads at a given instant. */
function wallClock(timezone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
}

describe("local day and week boundaries", () => {
  const NY = "America/New_York";

  it("starts the week at local midnight, six calendar days back", () => {
    // Wednesday 2026-03-11, 15:00 in New York. The week back crosses the
    // 2026-03-08 spring-forward.
    const now = new Date("2026-03-11T19:00:00Z");
    const start = startOfLocalWeek(NY, now);

    expect(wallClock(NY, start)).toBe("2026-03-05, 00:00");
  });

  it("starts the week at local midnight across a fall-back too", () => {
    // Wednesday 2026-11-04 in New York; the span crosses the 2026-11-01
    // fall-back, which the fixed-millisecond version overshot the other way.
    const now = new Date("2026-11-04T18:00:00Z");
    const start = startOfLocalWeek(NY, now);

    expect(wallClock(NY, start)).toBe("2026-10-29, 00:00");
  });

  it("is exactly midnight, not 23:00 the day before", () => {
    // The specific symptom of subtracting a fixed 24h across spring-forward.
    for (const iso of ["2026-03-11T19:00:00Z", "2026-03-09T19:00:00Z", "2026-11-04T18:00:00Z"]) {
      const start = startOfLocalWeek(NY, new Date(iso));
      expect(wallClock(NY, start).endsWith("00:00")).toBe(true);
    }
  });

  it("crosses month and year boundaries on the calendar", () => {
    // 2026-01-03 local → six days back is 2025-12-28.
    const start = startOfLocalWeek(NY, new Date("2026-01-03T17:00:00Z"));
    expect(wallClock(NY, start)).toBe("2025-12-28, 00:00");
  });

  it("puts the week start before now and within seven local days", () => {
    const now = new Date("2026-03-11T19:00:00Z");
    const start = startOfLocalWeek(NY, now);
    const dayStart = startOfLocalDay(NY, now);

    expect(start.getTime()).toBeLessThan(dayStart.getTime());
    // Six calendar days can be 143, 144 or 145 hours depending on DST.
    const hours = (dayStart.getTime() - start.getTime()) / 3_600_000;
    expect(hours).toBeGreaterThanOrEqual(143);
    expect(hours).toBeLessThanOrEqual(145);
  });

  it("holds in half-hour and three-quarter-hour zones", () => {
    const now = new Date("2026-04-08T12:00:00Z");

    for (const zone of ["Asia/Kolkata", "Pacific/Chatham", "Australia/Adelaide"]) {
      const start = startOfLocalWeek(zone, now);
      expect(wallClock(zone, start).endsWith("00:00")).toBe(true);

      // Derived from the zone's own calendar date rather than assumed: east of
      // UTC these zones are already on the following day at this instant.
      const [today] = wallClock(zone, now).split(",");
      const [year, month, day] = (today ?? "").split("-").map(Number);
      const expected = new Date(Date.UTC(year!, month! - 1, day! - 6))
        .toISOString()
        .slice(0, 10);
      expect(wallClock(zone, start).startsWith(expected)).toBe(true);
    }
  });

  it("starts the day and the month at local midnight", () => {
    // Spring-forward morning itself: midnight still exists, 02:00 does not.
    expect(wallClock(NY, startOfLocalDay(NY, new Date("2026-03-08T15:00:00Z")))).toBe(
      "2026-03-08, 00:00",
    );
    expect(wallClock(NY, startOfLocalMonth(NY, new Date("2026-03-11T19:00:00Z")))).toBe(
      "2026-03-01, 00:00",
    );
  });
});
