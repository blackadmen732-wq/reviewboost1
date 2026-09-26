import {
  addLocalDays,
  localDay,
  localDaysBetween,
  startOfLocalDate,
  type LocalDate,
} from "@/lib/utils/local-day";

/**
 * Feedback → Insights: what the ratings a business received add up to.
 *
 * Pure on purpose. Every rule that decides what an owner is told — which days
 * a period covers, when two periods may be compared, when a change is called a
 * change — lives here, where a test can reach it without a database.
 *
 * WHAT THIS IS NOT
 * ----------------
 * No health score, no benchmark against other businesses, no themes, and
 * nothing about what happened after a customer left. ReviewBoost knows which
 * star each customer tapped and when; that is all this reports.
 */

export const INSIGHT_RANGES = [7, 30, 90] as const;
export type InsightRange = (typeof INSIGHT_RANGES)[number];
export const DEFAULT_RANGE: InsightRange = 30;

/**
 * A period needs this many ratings before it gets an average, a trend line, or
 * a comparison. Below it the screen shows the count and the spread only: an
 * average of three ratings moves a whole point when one person has a bad day.
 */
export const MIN_SAMPLE = 10;

/** A point on the trend line needs this many ratings; fewer is drawn as a gap. */
export const MIN_BUCKET = 3;

/**
 * How far apart two averages, as shown, must be before the screen says
 * "Improving" or "Declining". A display rule chosen so that the words never
 * outrun the numbers next to them — NOT a test of statistical significance,
 * and nothing on screen may claim one.
 */
export const MEANINGFUL_CHANGE = 0.2;

/** Trend buckets tile the period exactly: 7 × 1 day, 6 × 5 days, 9 × 10 days. */
const BUCKET_DAYS: Record<InsightRange, number> = { 7: 1, 30: 5, 90: 10 };

export function parseRange(value: string | undefined | null): InsightRange {
  const days = Number(value);
  return (INSIGHT_RANGES as readonly number[]).includes(days) ? (days as InsightRange) : DEFAULT_RANGE;
}

/** A span of whole local days. `end` is exclusive; `endDate` is the last day in it. */
export interface InsightWindow {
  startDate: LocalDate;
  endDate: LocalDate;
  start: string;
  end: string;
}

export interface InsightPeriods {
  range: InsightRange;
  bucketDays: number;
  /** The last `range` COMPLETED local days: it ends at the start of today. */
  current: InsightWindow;
  /** The `range` completed days immediately before that. */
  previous: InsightWindow;
  /** Today so far. Never part of an average, a trend or a comparison. */
  today: InsightWindow;
  /** `current`, split into equal trend buckets, oldest first. */
  buckets: InsightWindow[];
  /**
   * The boundaries handed to rpc_feedback_insights, as instants:
   * previous start, each bucket start, today's start, tomorrow's start.
   * Bucket 1 is the previous period, 2…n+1 the trend buckets, n+2 today.
   */
  bounds: string[];
}

function daySpan(timezone: string, fromOffset: number, toOffset: number, now: Date): InsightWindow {
  const from = localDay(timezone, fromOffset, now);
  const to = localDay(timezone, toOffset, now);
  return {
    startDate: from.date,
    endDate: addLocalDays(to.date, -1),
    start: from.start.toISOString(),
    end: to.start.toISOString(),
  };
}

/**
 * The periods for one view, in the business's own time zone.
 *
 * Why the current period stops at midnight this morning: a period that
 * included today would hold a few hours of today against full days in the
 * period it is compared with, and a quiet morning would read as a decline.
 * Today's ratings are counted separately and join the period tomorrow.
 */
export function insightPeriods(
  timezone: string,
  range: InsightRange,
  now: Date = new Date(),
): InsightPeriods {
  const bucketDays = BUCKET_DAYS[range];
  const bucketCount = range / bucketDays;

  const buckets: InsightWindow[] = [];
  for (let index = 0; index < bucketCount; index += 1) {
    const from = -range + index * bucketDays;
    buckets.push(daySpan(timezone, from, from + bucketDays, now));
  }

  const current = daySpan(timezone, -range, 0, now);
  const previous = daySpan(timezone, -2 * range, -range, now);
  const today = daySpan(timezone, 0, 1, now);

  return {
    range,
    bucketDays,
    current,
    previous,
    today,
    buckets,
    bounds: [previous.start, ...buckets.map((bucket) => bucket.start), today.start, today.end],
  };
}

export type StarValue = 1 | 2 | 3 | 4 | 5;
export type StarCounts = Record<StarValue, number>;

export interface PeriodStats {
  total: number;
  /** Null when there is nothing to average. The screen applies MIN_SAMPLE. */
  average: number | null;
  counts: StarCounts;
}

export interface TrendPoint {
  startDate: LocalDate;
  endDate: LocalDate;
  total: number;
  /** Null when the bucket has fewer than MIN_BUCKET ratings: drawn as a gap. */
  average: number | null;
}

export type Direction = "improving" | "steady" | "declining";

export interface Comparison {
  direction: Direction;
  /** Both rounded to one decimal, exactly as the screen shows them. */
  current: number;
  previous: number;
}

/**
 * none     — this business (or location) has never received a rating
 * quiet    — it has, but none in this period
 * starting — 1 to 9 in this period: count and spread only
 * full     — 10 or more: average, trend and, where allowed, a comparison
 */
export type InsightState = "none" | "quiet" | "starting" | "full";

export interface FeedbackInsights {
  periods: InsightPeriods;
  current: PeriodStats;
  previous: PeriodStats;
  todayTotal: number;
  trend: TrendPoint[];
  comparison: Comparison | null;
  state: InsightState;
}

export interface InsightRow {
  bucket: number;
  rating: number;
  responses: number;
}

function emptyCounts(): StarCounts {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

function isStar(value: number): value is StarValue {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

function stats(counts: StarCounts): PeriodStats {
  let total = 0;
  let weighted = 0;
  for (const star of [1, 2, 3, 4, 5] as const) {
    total += counts[star];
    weighted += counts[star] * star;
  }
  return { total, average: total > 0 ? weighted / total : null, counts };
}

/** One decimal, as shown. Integer tenths, so 4.25 and 4.35 round the same way everywhere. */
export function roundAverage(average: number): number {
  return Math.round(average * 10) / 10;
}

export function formatAverage(average: number): string {
  return roundAverage(average).toFixed(1);
}

/**
 * Compare two periods, or decline to.
 *
 * Both need MIN_SAMPLE ratings. The direction is decided on the averages as
 * they will be shown, so "Improving" can never appear beside 4.1 and 4.0.
 */
export function compareAverages(current: PeriodStats, previous: PeriodStats): Comparison | null {
  if (current.total < MIN_SAMPLE || previous.total < MIN_SAMPLE) return null;
  if (current.average === null || previous.average === null) return null;
  const now = roundAverage(current.average);
  const before = roundAverage(previous.average);
  const tenths = Math.round((now - before) * 10);
  const threshold = Math.round(MEANINGFUL_CHANGE * 10);
  const direction: Direction =
    tenths >= threshold ? "improving" : tenths <= -threshold ? "declining" : "steady";
  return { direction, current: now, previous: before };
}

/**
 * Turn the function's rows into what the screen needs.
 *
 * `hasEarlier` says whether any rating exists before the previous period; it
 * is only consulted when nothing turned up in the periods themselves, to tell
 * a quiet week from a business that has not had its first rating.
 */
export function summarizeInsights(
  periods: InsightPeriods,
  rows: readonly InsightRow[],
  hasEarlier: boolean,
): FeedbackInsights {
  const previousCounts = emptyCounts();
  const currentCounts = emptyCounts();
  const bucketCounts = periods.buckets.map(() => emptyCounts());
  const todayBucket = periods.buckets.length + 2;
  let todayTotal = 0;

  for (const row of rows) {
    const responses = Number(row.responses);
    if (!isStar(row.rating) || !Number.isFinite(responses) || responses <= 0) continue;
    if (row.bucket === 1) {
      previousCounts[row.rating] += responses;
    } else if (row.bucket === todayBucket) {
      todayTotal += responses;
    } else if (row.bucket >= 2 && row.bucket < todayBucket) {
      currentCounts[row.rating] += responses;
      const bucket = bucketCounts[row.bucket - 2];
      if (bucket) bucket[row.rating] += responses;
    }
  }

  const current = stats(currentCounts);
  const previous = stats(previousCounts);

  const trend: TrendPoint[] = periods.buckets.map((bucket, index) => {
    const bucketStats = stats(bucketCounts[index] ?? emptyCounts());
    return {
      startDate: bucket.startDate,
      endDate: bucket.endDate,
      total: bucketStats.total,
      average: bucketStats.total >= MIN_BUCKET ? bucketStats.average : null,
    };
  });

  const state: InsightState =
    current.total >= MIN_SAMPLE
      ? "full"
      : current.total > 0
        ? "starting"
        : previous.total > 0 || todayTotal > 0 || hasEarlier
          ? "quiet"
          : "none";

  return {
    periods,
    current,
    previous,
    todayTotal,
    trend,
    comparison: state === "full" ? compareAverages(current, previous) : null,
    state,
  };
}

/** Enough plotted points for a line to say anything: two or more. */
export function plottedPoints(trend: readonly TrendPoint[]): number {
  return trend.filter((point) => point.average !== null).length;
}

// ---------------------------------------------------------------- dates ----

const MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const MONTH_DAY_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function asUtcDate(date: LocalDate): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

/** "Sep 26", on the calendar date itself — no time zone can shift it a day. */
export function formatDay(date: LocalDate): string {
  return MONTH_DAY.format(asUtcDate(date));
}

/** "Aug 27 – Sep 25", or with years when the span crosses one. */
export function formatDateRange(startDate: LocalDate, endDate: LocalDate): string {
  if (startDate === endDate) return formatDay(startDate);
  const format = startDate.slice(0, 4) === endDate.slice(0, 4) ? MONTH_DAY : MONTH_DAY_YEAR;
  return `${format.format(asUtcDate(startDate))} – ${format.format(asUtcDate(endDate))}`;
}

// ----------------------------------------------------------- drilldown ----

/**
 * The ratings behind one row of the breakdown, in the Feedback inbox.
 * Everything, filtered by star value, location and the same local days.
 */
export function drilldownHref({
  rating,
  locationId,
  period,
}: {
  rating: StarValue;
  locationId: string | null;
  period: Pick<InsightWindow, "startDate" | "endDate">;
}): string {
  const params = new URLSearchParams({ show: "all", rating: String(rating) });
  if (locationId) params.set("location", locationId);
  params.set("from", period.startDate);
  params.set("to", period.endDate);
  return `/feedback?${params.toString()}`;
}

export interface FeedbackFilters {
  rating: StarValue | null;
  locationId: string | null;
  /** Inclusive local dates, only ever both or neither. */
  from: LocalDate | null;
  to: LocalDate | null;
}

/** The longest span a filter link may ask for, matching the database's own cap. */
const MAX_FILTER_DAYS = 400;

/**
 * Read the inbox filters from a URL, trusting none of it.
 *
 * A star value must be 1–5, a location must be one of this business's own
 * (anything else is dropped, never passed on), and dates must be real calendar
 * dates, in order, and no more than 400 days apart.
 */
export function parseFeedbackFilters(
  params: { rating?: string | undefined; location?: string | undefined; from?: string | undefined; to?: string | undefined },
  locationIds: readonly string[],
): FeedbackFilters {
  const ratingNumber = Number(params.rating);
  const rating = params.rating !== undefined && isStar(ratingNumber) ? ratingNumber : null;
  const locationId =
    params.location && locationIds.includes(params.location) ? params.location : null;

  let from: LocalDate | null = null;
  let to: LocalDate | null = null;
  if (params.from && params.to && startOfLocalDate("UTC", params.from) && startOfLocalDate("UTC", params.to)) {
    const span = localDaysBetween(params.from, params.to);
    if (span >= 0 && span <= MAX_FILTER_DAYS) {
      from = params.from;
      to = params.to;
    }
  }

  return { rating, locationId, from, to };
}

export function hasFeedbackFilters(filters: FeedbackFilters): boolean {
  return filters.rating !== null || filters.locationId !== null || filters.from !== null;
}

/** The instants a from/to pair of local dates covers, in the business's zone. */
export function filterInstants(
  timezone: string,
  filters: Pick<FeedbackFilters, "from" | "to">,
): { from: string; before: string } | null {
  if (!filters.from || !filters.to) return null;
  const start = startOfLocalDate(timezone, filters.from);
  const end = startOfLocalDate(timezone, addLocalDays(filters.to, 1));
  if (!start || !end) return null;
  return { from: start.toISOString(), before: end.toISOString() };
}

// ---------------------------------------------------------------- words ----

export const DIRECTION_LABEL: Record<Direction, string> = {
  improving: "Improving",
  steady: "About the same",
  declining: "Declining",
};

export function ratingsCount(count: number): string {
  return `${count} ${count === 1 ? "rating" : "ratings"}`;
}

/**
 * Home's one quiet line, or nothing.
 *
 * Only a full period earns it: "4.3 average · 84 ratings · Improving". The
 * direction appears only where a comparison was allowed. Home stays about what
 * needs doing; this is a pointer to Insights, not a second copy of it.
 */
export function insightsHomeLine(
  insights: Pick<FeedbackInsights, "state" | "current" | "comparison">,
): string | null {
  if (insights.state !== "full" || insights.current.average === null) return null;
  const parts = [`${formatAverage(insights.current.average)} average`, ratingsCount(insights.current.total)];
  if (insights.comparison) parts.push(DIRECTION_LABEL[insights.comparison.direction]);
  return parts.join(" · ");
}

/** What one trend point covers: "day", "5-day stretch". */
export function stretchName(bucketDays: number): string {
  return bucketDays === 1 ? "day" : `${bucketDays}-day stretch`;
}
