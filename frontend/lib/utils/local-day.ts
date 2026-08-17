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
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "01";
  const wallClockAsUtc = new Date(
    Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day"))),
  );

  return new Date(wallClockAsUtc.getTime() + offsetMs(timezone, wallClockAsUtc));
}

/** Start of the current month in the business's zone. */
export function startOfLocalMonth(timezone: string, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "01";
  const wallClockAsUtc = new Date(Date.UTC(Number(get("year")), Number(get("month")) - 1, 1));

  return new Date(wallClockAsUtc.getTime() + offsetMs(timezone, wallClockAsUtc));
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
