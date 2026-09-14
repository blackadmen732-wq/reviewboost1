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
 * The approach: read the zone's current calendar date, then solve for the
 * instant whose local wall clock is midnight on that date. Offsets are measured
 * by formatting one instant in both zones and subtracting, so half-hour zones
 * (Kolkata), three-quarter-hour zones (Chatham), and political offset changes
 * all fall out of the arithmetic rather than needing cases.
 */
export function startOfLocalDay(timezone: string, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "01";
  return localMidnight(timezone, Number(get("year")), Number(get("month")), Number(get("day")));
}

/**
 * The instant at which the local wall clock reads midnight on a given date.
 *
 * WHY THIS ITERATES
 * -----------------
 * Treating the wall clock as UTC and shifting once by the offset *at that
 * fictional instant* is wrong on the two days a year it matters most. For
 * Auckland, midnight-as-UTC is 13:00 local on the target day -- past the
 * spring-forward transition -- so the offset comes back as +13 when the offset
 * in force at local midnight is +12. The single-shift version returned 23:00 on
 * the *previous* day, which means "ratings today" silently began an hour early
 * and counted an hour of yesterday's.
 *
 * Re-measuring the offset at the candidate instant fixes it: the second
 * measurement is taken on the correct side of the transition. The loop runs to
 * a fixed point rather than a set number of times, and stops either way, so a
 * zone with an unusual transition cannot make it spin.
 */
function localMidnight(timezone: string, year: number, month: number, day: number): Date {
  const wallClockAsUtc = Date.UTC(year, month - 1, day);

  let instant = wallClockAsUtc + offsetMs(timezone, new Date(wallClockAsUtc));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const corrected = wallClockAsUtc + offsetMs(timezone, new Date(instant));
    if (corrected === instant) break;
    instant = corrected;
  }

  return new Date(instant);
}

/** Start of the current month in the business's zone. */
export function startOfLocalMonth(timezone: string, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "01";
  // Same correction as startOfLocalDay: a month can begin on a transition day.
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
