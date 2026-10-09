/**
 * Time as the business experiences it.
 *
 * Pure and free of `server-only` on purpose: these are the boundaries "today"
 * and "this month" are measured against, they are the easiest thing in the
 * product to get subtly wrong, and a function that cannot be imported by a test
 * runner is a function nobody checks.
 */

/** The business's own local hour — for greetings, not for query boundaries. */
export function localHour(timezone: string, now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    }).format(now),
  );
}

/**
 * Midnight where the business is, as a real instant.
 *
 * "Today" for a restaurant is *their* today. Using the server's midnight means a
 * London owner on a US-hosted server watches "ratings today" reset in the middle
 * of their afternoon — which looks exactly like data loss.
 *
 * The approach: read the zone's current calendar date, treat that wall-clock
 * reading as if it were UTC, then measure how far that fiction is from the truth
 * and shift by it. Formatting the same instant in both zones and subtracting
 * recovers the offset *at that moment*, so half-hour zones (Kolkata),
 * three-quarter-hour zones (Chatham) and daylight-saving transitions all fall
 * out of the arithmetic rather than needing cases.
 */
export function startOfLocalDay(timezone: string, now: Date = new Date()): Date {
  const { year, month, day } = localCalendarDate(timezone, now);
  return localMidnight(timezone, year, month, day);
}

/**
 * Midnight six local days back — the start of “this week” as owners say it.
 *
 * Calendar arithmetic, then that date's own midnight. Subtracting 6 × 24h of
 * milliseconds from today's midnight is only the same thing in a zone that
 * never changes offset: across a spring-forward the week began an hour later
 * than the subtraction claims, so the boundary landed at 23:00 on the wrong
 * calendar day and a whole evening of ratings moved between "this week" and
 * "last week". Days are a calendar concept; milliseconds are not.
 */
export function startOfLocalWeek(timezone: string, now: Date = new Date()): Date {
  return localDay(timezone, -6, now).start;
}

/** A calendar date in the business's zone, written YYYY-MM-DD. */
export type LocalDate = string;

/**
 * The business's calendar day `offsetDays` from today — negative is the past —
 * and the instant it begins.
 *
 * Every period boundary in the product goes through here: calendar arithmetic
 * on the date first, then that date's own midnight. Across a daylight-saving
 * change the days either side are 23 or 25 hours long, and only this order of
 * operations gets that right.
 */
export function localDay(
  timezone: string,
  offsetDays: number,
  now: Date = new Date(),
): { date: LocalDate; start: Date } {
  const { year, month, day } = localCalendarDate(timezone, now);
  // Date.UTC normalises the rollover, so any offset crosses months and years.
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays));
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth() + 1;
  const d = shifted.getUTCDate();
  return { date: formatLocalDate(y, m, d), start: localMidnight(timezone, y, m, d) };
}

/**
 * The instant a given local calendar date begins, or null for anything that is
 * not a real YYYY-MM-DD date (a date read from a URL is untrusted input).
 */
export function startOfLocalDate(timezone: string, date: string): Date | null {
  const parts = parseLocalDate(date);
  if (!parts) return null;
  return localMidnight(timezone, parts.year, parts.month, parts.day);
}

/** A calendar date `days` later (or earlier), on the calendar, not the clock. */
export function addLocalDays(date: LocalDate, days: number): LocalDate {
  const parts = parseLocalDate(date);
  if (!parts) throw new Error(`Not a calendar date: ${date}`);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return formatLocalDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** Whole calendar days from one date to another (positive when `to` is later). */
export function localDaysBetween(from: LocalDate, to: LocalDate): number {
  const a = parseLocalDate(from);
  const b = parseLocalDate(to);
  if (!a || !b) throw new Error(`Not a calendar date: ${a ? to : from}`);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
}

function parseLocalDate(date: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Reject dates the calendar does not have, such as 2026-02-30.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function formatLocalDate(year: number, month: number, day: number): LocalDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The calendar date showing on a wall clock in that zone, right now. */
function localCalendarDate(
  timezone: string,
  now: Date,
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "01";
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")) };
}

/**
 * The instant at which a given local calendar date begins.
 *
 * Resolved twice on purpose. The first pass has to guess the offset from the
 * wall-clock numbers read as UTC, which is the wrong instant whenever the zone
 * changed offset between the two; the second pass asks again at the instant the
 * first pass produced. On a DST weekend that is the difference between midnight
 * and 23:00 the day before.
 */
function localMidnight(timezone: string, year: number, month: number, day: number): Date {
  const wallClockAsUtc = Date.UTC(year, month - 1, day);
  const firstPass = new Date(wallClockAsUtc + offsetMs(timezone, new Date(wallClockAsUtc)));
  return new Date(wallClockAsUtc + offsetMs(timezone, firstPass));
}

/** Start of the current month in the business's zone. */
export function startOfLocalMonth(timezone: string, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "01";
  return localMidnight(timezone, Number(get("year")), Number(get("month")), 1);
}

/**
 * How far the zone is from UTC at a given instant, in milliseconds.
 *
 * Positive west of Greenwich. Derived by formatting one instant in both zones
 * rather than from a table, so it stays correct across daylight-saving changes
 * and political offset changes without anything to maintain.
 */
function offsetMs(timezone: string, at: Date): number {
  const inZone = new Date(at.toLocaleString("en-US", { timeZone: timezone }));
  const inUtc = new Date(at.toLocaleString("en-US", { timeZone: "UTC" }));
  return inUtc.getTime() - inZone.getTime();
}
