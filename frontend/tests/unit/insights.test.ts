import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  compareAverages,
  drilldownHref,
  filterInstants,
  formatAverage,
  formatDateRange,
  insightPeriods,
  MIN_BUCKET,
  MIN_SAMPLE,
  parseFeedbackFilters,
  parseRange,
  plottedPoints,
  summarizeInsights,
  type InsightPeriods,
  type InsightRow,
  type PeriodStats,
} from "@/lib/owner/insights";
import { addLocalDays, localDay, localDaysBetween, startOfLocalDate } from "@/lib/utils/local-day";

/**
 * Insights V1: the rules that decide what an owner is told.
 *
 * Every number on the Insights screen comes through these functions, and the
 * ones that matter most are refusals: no comparison on a thin sample, no
 * "Improving" that the shown numbers do not support, and never a half-finished
 * today weighed against full days.
 */

const NY = "America/New_York";

function wallClock(timezone: string, iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function hours(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;
}

/** Rows as the database returns them, from per-bucket star lists. */
function rowsFor(periods: InsightPeriods, spec: { previous?: number[]; buckets?: number[][]; today?: number[] }): InsightRow[] {
  const rows: InsightRow[] = [];
  const add = (bucket: number, ratings: number[]) => {
    const tally = new Map<number, number>();
    for (const rating of ratings) tally.set(rating, (tally.get(rating) ?? 0) + 1);
    for (const [rating, responses] of tally) rows.push({ bucket, rating, responses });
  };
  add(1, spec.previous ?? []);
  (spec.buckets ?? []).forEach((ratings, index) => add(index + 2, ratings));
  add(periods.buckets.length + 2, spec.today ?? []);
  return rows;
}

/** n copies of a rating. */
function times(n: number, rating: number): number[] {
  return Array.from({ length: n }, () => rating);
}

// A Thursday afternoon in New York.
const NOW = new Date("2026-09-24T19:30:00Z");

describe("periods: completed local days, in the business's zone", () => {
  it.each([
    [7, 1, 7],
    [30, 5, 6],
    [90, 10, 9],
  ] as const)("%i days → %i-day buckets, %i points", (range, bucketDays, count) => {
    const periods = insightPeriods(NY, range, NOW);
    expect(periods.bucketDays).toBe(bucketDays);
    expect(periods.buckets).toHaveLength(count);
    // previous start, each bucket start, today's start, tomorrow's start
    expect(periods.bounds).toHaveLength(count + 3);
    expect(localDaysBetween(periods.current.startDate, periods.current.endDate) + 1).toBe(range);
    expect(localDaysBetween(periods.previous.startDate, periods.previous.endDate) + 1).toBe(range);
  });

  it("ends the current period at midnight this morning, so today never counts", () => {
    const periods = insightPeriods(NY, 30, NOW);
    expect(periods.current.endDate).toBe("2026-09-23"); // yesterday, local
    expect(periods.current.end).toBe(periods.today.start);
    expect(wallClock(NY, periods.today.start)).toBe("2026-09-24, 00:00");
    expect(new Date(periods.today.start).getTime()).toBeLessThanOrEqual(NOW.getTime());
    expect(new Date(periods.today.end).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("puts the previous period directly before the current one, the same length", () => {
    const periods = insightPeriods(NY, 30, NOW);
    expect(periods.previous.end).toBe(periods.current.start);
    expect(periods.previous.startDate).toBe("2026-07-26");
    expect(periods.previous.endDate).toBe("2026-08-24");
    expect(periods.current.startDate).toBe("2026-08-25");
  });

  it("tiles the current period with buckets, no gaps and no overlaps", () => {
    for (const range of [7, 30, 90] as const) {
      const periods = insightPeriods(NY, range, NOW);
      expect(periods.buckets[0]?.start).toBe(periods.current.start);
      expect(periods.buckets.at(-1)?.end).toBe(periods.current.end);
      for (let index = 1; index < periods.buckets.length; index += 1) {
        expect(periods.buckets[index]?.start).toBe(periods.buckets[index - 1]?.end);
      }
      const sorted = [...periods.bounds].sort();
      expect(periods.bounds).toEqual(sorted);
      expect(new Set(periods.bounds).size).toBe(periods.bounds.length);
    }
  });

  it("starts every boundary at local midnight across the spring-forward", () => {
    // 2026-03-08: New York skips 02:00–03:00. That day is 23 hours long.
    const periods = insightPeriods(NY, 7, new Date("2026-03-12T15:00:00Z"));
    for (const bound of periods.bounds) expect(wallClock(NY, bound).endsWith("00:00")).toBe(true);
    const short = periods.buckets.find((bucket) => bucket.startDate === "2026-03-08");
    expect(short).toBeDefined();
    expect(hours(short!.start, short!.end)).toBe(23);
  });

  it("starts every boundary at local midnight across the fall-back", () => {
    // 2026-11-01: New York repeats 01:00–02:00. That day is 25 hours long.
    const periods = insightPeriods(NY, 7, new Date("2026-11-04T17:00:00Z"));
    for (const bound of periods.bounds) expect(wallClock(NY, bound).endsWith("00:00")).toBe(true);
    const long = periods.buckets.find((bucket) => bucket.startDate === "2026-11-01");
    expect(hours(long!.start, long!.end)).toBe(25);
  });

  it("follows the business's calendar in half-hour zones and east of UTC", () => {
    for (const zone of ["Asia/Kolkata", "Pacific/Chatham", "Pacific/Kiritimati"]) {
      const periods = insightPeriods(zone, 30, NOW);
      for (const bound of periods.bounds) expect(wallClock(zone, bound).endsWith("00:00"), zone).toBe(true);
      const todayThere = wallClock(zone, NOW.toISOString()).slice(0, 10);
      expect(addLocalDays(periods.current.endDate, 1), zone).toBe(todayThere);
    }
  });

  it("reads the range from the URL, defaulting to 30 days", () => {
    expect(parseRange("7")).toBe(7);
    expect(parseRange("90")).toBe(90);
    expect(parseRange(undefined)).toBe(30);
    expect(parseRange("365")).toBe(30);
    expect(parseRange("7; drop table")).toBe(30);
  });
});

describe("the numbers", () => {
  const periods = insightPeriods(NY, 30, NOW);

  it("averages and counts every star value, the same way for each", () => {
    const insights = summarizeInsights(
      periods,
      rowsFor(periods, { buckets: [[5, 5, 5], [4, 4], [1], [], [3], [2, 5]] }),
      false,
    );
    expect(insights.current.counts).toEqual({ 1: 1, 2: 1, 3: 1, 4: 2, 5: 4 });
    expect(insights.current.total).toBe(9);
    expect(insights.current.average).toBeCloseTo((1 + 2 + 3 + 8 + 20) / 9, 10);
  });

  it("keeps today's ratings out of the period, its average and the comparison", () => {
    const base = { previous: times(10, 4), buckets: [times(4, 4), times(3, 4), times(3, 4)] };
    const without = summarizeInsights(periods, rowsFor(periods, base), false);
    const withBadMorning = summarizeInsights(periods, rowsFor(periods, { ...base, today: times(6, 1) }), false);

    expect(withBadMorning.todayTotal).toBe(6);
    expect(withBadMorning.current).toEqual(without.current);
    expect(withBadMorning.comparison).toEqual(without.comparison);
    expect(withBadMorning.comparison?.direction).toBe("steady");
  });

  it("formats averages to one decimal, rounding halves up", () => {
    expect(formatAverage(4.25)).toBe("4.3");
    expect(formatAverage(4.249)).toBe("4.2");
    expect(formatAverage(5)).toBe("5.0");
  });
});

describe("what is shown for how much data", () => {
  const periods = insightPeriods(NY, 30, NOW);

  it("says there is nothing yet only when there has never been a rating", () => {
    expect(summarizeInsights(periods, [], false).state).toBe("none");
  });

  it("calls a quiet period quiet, not new", () => {
    expect(summarizeInsights(periods, [], true).state).toBe("quiet");
    expect(summarizeInsights(periods, rowsFor(periods, { previous: [5] }), false).state).toBe("quiet");
    // A first rating this morning: the business is not "new", the period is empty.
    const firstToday = summarizeInsights(periods, rowsFor(periods, { today: [5, 4] }), false);
    expect(firstToday.state).toBe("quiet");
    expect(firstToday.todayTotal).toBe(2);
  });

  it("counts 1 to 9 ratings as starting: no comparison", () => {
    for (const n of [1, MIN_SAMPLE - 1]) {
      const insights = summarizeInsights(
        periods,
        rowsFor(periods, { previous: times(40, 4), buckets: [times(n, 5)] }),
        false,
      );
      expect(insights.state, `${n}`).toBe("starting");
      expect(insights.comparison, `${n}`).toBeNull();
    }
  });

  it("enables the full view at 10", () => {
    const insights = summarizeInsights(periods, rowsFor(periods, { buckets: [times(MIN_SAMPLE, 5)] }), false);
    expect(insights.state).toBe("full");
  });
});

describe("comparisons", () => {
  function stats(total: number, average: number): PeriodStats {
    return { total, average, counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: total } };
  }

  it("compares only when both periods have enough ratings", () => {
    expect(compareAverages(stats(9, 4.8), stats(50, 4.0))).toBeNull();
    expect(compareAverages(stats(50, 4.8), stats(9, 4.0))).toBeNull();
    expect(compareAverages(stats(10, 4.8), stats(10, 4.0))).not.toBeNull();
  });

  it("calls a change of 0.2 or more, as shown, a change", () => {
    expect(compareAverages(stats(20, 4.3), stats(20, 4.0))?.direction).toBe("improving");
    expect(compareAverages(stats(20, 4.2), stats(20, 4.0))?.direction).toBe("improving");
    expect(compareAverages(stats(20, 4.1), stats(20, 4.0))?.direction).toBe("steady");
    expect(compareAverages(stats(20, 3.9), stats(20, 4.0))?.direction).toBe("steady");
    expect(compareAverages(stats(20, 3.8), stats(20, 4.0))?.direction).toBe("declining");
  });

  it("decides on the rounded numbers the owner sees, never the raw ones", () => {
    // Raw difference 0.19 — but shown as 4.2 against 4.1: "about the same".
    expect(compareAverages(stats(20, 4.24), stats(20, 4.05))).toEqual({
      direction: "steady",
      current: 4.2,
      previous: 4.1,
    });
    // Raw difference 0.16 — shown as 4.3 against 4.1: a real 0.2 on screen.
    expect(compareAverages(stats(20, 4.25), stats(20, 4.09))?.direction).toBe("improving");
  });

  it("reports the previous average it compared against", () => {
    const periods = insightPeriods(NY, 7, NOW);
    const insights = summarizeInsights(
      periods,
      rowsFor(periods, {
        previous: [...times(8, 4), ...times(2, 3)],
        buckets: [times(5, 5), times(5, 4)],
      }),
      false,
    );
    expect(insights.comparison).toEqual({ direction: "improving", current: 4.5, previous: 3.8 });
  });
});

describe("the trend line", () => {
  const periods = insightPeriods(NY, 30, NOW);

  it("draws a gap, not a zero, where a stretch had too few ratings", () => {
    const insights = summarizeInsights(
      periods,
      rowsFor(periods, { buckets: [times(3, 4), times(2, 5), [], times(4, 5), times(MIN_BUCKET, 3), times(5, 4)] }),
      false,
    );
    expect(insights.trend.map((point) => point.average)).toEqual([4, null, null, 5, 3, 4]);
    expect(insights.trend.map((point) => point.total)).toEqual([3, 2, 0, 4, 3, 5]);
    expect(plottedPoints(insights.trend)).toBe(4);
  });

  it("labels each point with the local days it covers", () => {
    const insights = summarizeInsights(periods, [], false);
    expect(insights.trend[0]).toMatchObject({ startDate: "2026-08-25", endDate: "2026-08-29" });
    expect(insights.trend.at(-1)).toMatchObject({ startDate: "2026-09-19", endDate: "2026-09-23" });
  });

  it("describes periods as dates a person reads", () => {
    expect(formatDateRange("2026-08-25", "2026-09-23")).toBe("Aug 25 – Sep 23");
    expect(formatDateRange("2025-12-20", "2026-01-18")).toBe("Dec 20, 2025 – Jan 18, 2026");
    expect(formatDateRange("2026-09-23", "2026-09-23")).toBe("Sep 23");
  });
});

describe("drilling down into the inbox", () => {
  const LOCATIONS = ["loc-downtown", "loc-coral"];

  it("links a star row to Everything, filtered by star, place and the same days", () => {
    const href = drilldownHref({
      rating: 2,
      locationId: "loc-coral",
      period: { startDate: "2026-08-25", endDate: "2026-09-23" },
    });
    const url = new URL(href, "https://reviewboost.fit");
    expect(url.pathname).toBe("/feedback");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      show: "all",
      rating: "2",
      location: "loc-coral",
      from: "2026-08-25",
      to: "2026-09-23",
    });
    expect(parseFeedbackFilters(Object.fromEntries(url.searchParams), LOCATIONS)).toEqual({
      rating: 2,
      locationId: "loc-coral",
      from: "2026-08-25",
      to: "2026-09-23",
    });
  });

  it("leaves the location out for all locations", () => {
    const href = drilldownHref({ rating: 5, locationId: null, period: { startDate: "2026-09-17", endDate: "2026-09-23" } });
    expect(href).not.toContain("location=");
  });

  it("trusts nothing in the URL", () => {
    const none = { rating: null, locationId: null, from: null, to: null };
    // Another business's location id is dropped, never passed to a query.
    expect(parseFeedbackFilters({ location: "someone-elses" }, LOCATIONS)).toEqual(none);
    expect(parseFeedbackFilters({ rating: "0" }, LOCATIONS)).toEqual(none);
    expect(parseFeedbackFilters({ rating: "6" }, LOCATIONS)).toEqual(none);
    expect(parseFeedbackFilters({ rating: "4.5" }, LOCATIONS)).toEqual(none);
    expect(parseFeedbackFilters({ from: "2026-02-30", to: "2026-03-02" }, LOCATIONS)).toEqual(none);
    expect(parseFeedbackFilters({ from: "2026-09-23", to: "2026-08-25" }, LOCATIONS)).toEqual(none);
    expect(parseFeedbackFilters({ from: "2024-01-01", to: "2026-09-23" }, LOCATIONS)).toEqual(none);
    expect(parseFeedbackFilters({ from: "2026-09-01" }, LOCATIONS)).toEqual(none);
  });

  it("turns inclusive local dates into instants in the business's zone", () => {
    // Through Nov 1, the 25-hour day: the filter must end at midnight Nov 2 local.
    const span = filterInstants(NY, { from: "2026-10-26", to: "2026-11-01" });
    expect(span).not.toBeNull();
    expect(wallClock(NY, span!.from)).toBe("2026-10-26, 00:00");
    expect(wallClock(NY, span!.before)).toBe("2026-11-02, 00:00");
  });
});

describe("local calendar arithmetic", () => {
  it("moves across month and year ends on the calendar", () => {
    expect(addLocalDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addLocalDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(localDaysBetween("2025-12-25", "2026-01-04")).toBe(10);
    expect(localDay(NY, -30, NOW).date).toBe("2026-08-25");
  });

  it("refuses dates the calendar does not have", () => {
    expect(startOfLocalDate(NY, "2026-02-29")).toBeNull();
    expect(startOfLocalDate(NY, "2026-13-01")).toBeNull();
    expect(startOfLocalDate(NY, "yesterday")).toBeNull();
    expect(startOfLocalDate(NY, "2028-02-29")).not.toBeNull();
  });

  it("counts the previous week from the calendar, not 7 × 24 hours", () => {
    // The Friday after spring-forward: thirteen days back crosses the change.
    const now = new Date("2026-03-13T16:00:00Z");
    expect(wallClock(NY, localDay(NY, -13, now).start.toISOString())).toBe("2026-02-28, 00:00");

    const layer = readFileSync(join(process.cwd(), "lib/server/owner-data.ts"), "utf8");
    expect(layer).not.toMatch(/7 \* 86_400_000/);
    expect(layer).toMatch(/priorWeekStart = localDay\(timezone, -13\)\.start/);
  });
});
