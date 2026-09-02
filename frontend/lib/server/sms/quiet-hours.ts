import "server-only";

/**
 * Quiet-hours scheduling.
 *
 * A review-request text must not arrive at 3 a.m. local time. "Local" is the
 * recipient's IANA zone, and the only correct way to reason about a wall-clock
 * hour in a zone is to ask the zone — never to add a fixed UTC offset, because
 * an offset is wrong for half the year wherever daylight saving applies.
 *
 * The permitted window is configurable, expressed as local hours [start, end),
 * so there is one place to change it rather than a magic 9 and 20 scattered
 * through the code.
 */

export interface QuietHoursWindow {
  /** First permitted local hour, inclusive (0-23). */
  startHour: number;
  /** First disallowed local hour, exclusive (1-24). */
  endHour: number;
}

export const DEFAULT_QUIET_HOURS: QuietHoursWindow = { startHour: 9, endHour: 20 };

export function assertValidWindow(w: QuietHoursWindow): void {
  if (!Number.isInteger(w.startHour) || !Number.isInteger(w.endHour)) {
    throw new Error("Quiet-hours window bounds must be integers.");
  }
  if (w.startHour < 0 || w.startHour > 23 || w.endHour < 1 || w.endHour > 24) {
    throw new Error("Quiet-hours window bounds are out of range.");
  }
  if (w.startHour >= w.endHour) {
    throw new Error("Quiet-hours window must have startHour < endHour.");
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall-clock parts of an instant, as seen in a given IANA zone. */
function partsInZone(instant: Date, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== "literal") map[part.type] = Number(part.value);
  }
  return {
    year: map.year!,
    month: map.month!,
    day: map.day!,
    hour: map.hour!,
    minute: map.minute!,
    second: map.second!,
  };
}

/** The zone's offset from UTC, in minutes, at a given instant (DST-aware). */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const p = partsInZone(instant, timeZone);
  // Interpret the zone's wall-clock reading as if it were UTC, then diff.
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/**
 * The UTC instant of a local wall-clock time in a zone.
 *
 * Compute the two candidate instants — one under the offset on each side of a
 * possible transition — and pick the candidate whose zone wall-clock actually
 * equals the requested time. In the ordinary case both agree; in an autumn fold
 * the earliest valid instant is chosen. In a spring-forward gap the requested
 * wall time does not exist, so neither candidate matches and we advance to the
 * first valid instant *after* the gap (the later candidate) — never earlier,
 * which for a send time is the safe direction (it would otherwise land back
 * inside quiet hours).
 */
function zonedWallClockToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
): Date {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  const off1 = zoneOffsetMinutes(new Date(naive), timeZone);
  const c1 = naive - off1 * 60000;
  const off2 = zoneOffsetMinutes(new Date(c1), timeZone);
  if (off2 === off1) return new Date(c1);

  const c2 = naive - off2 * 60000;
  for (const c of [c1, c2]) {
    const p = partsInZone(new Date(c), timeZone);
    if (
      p.year === parts.year &&
      p.month === parts.month &&
      p.day === parts.day &&
      p.hour === parts.hour &&
      p.minute === parts.minute
    ) {
      return new Date(c);
    }
  }
  // Spring-forward gap: advance past it rather than resolving backward.
  return new Date(Math.max(c1, c2));
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Whether sending is permitted right now in the recipient's zone. */
export function isWithinSendWindow(
  now: Date,
  timeZone: string,
  window: QuietHoursWindow = DEFAULT_QUIET_HOURS,
): boolean {
  assertValidWindow(window);
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const hour = partsInZone(now, zone).hour;
  return hour >= window.startHour && hour < window.endHour;
}

/**
 * The next instant at which a send is permitted.
 *
 * If the current time is already inside the window, that is now. Otherwise it is
 * the next occurrence of `startHour:00` local time — today if we are before the
 * window opens, tomorrow if we are past it — converted back to a UTC instant
 * through the recipient's actual offset at that moment.
 */
export function nextAllowedSendTime(
  now: Date,
  timeZone: string,
  window: QuietHoursWindow = DEFAULT_QUIET_HOURS,
): Date {
  assertValidWindow(window);
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";

  if (isWithinSendWindow(now, zone, window)) return now;

  const local = partsInZone(now, zone);
  // Before the window opens today → open today; otherwise → open tomorrow.
  const beforeToday = local.hour < window.startHour;

  let target = {
    year: local.year,
    month: local.month,
    day: local.day,
    hour: window.startHour,
    minute: 0,
  };

  if (!beforeToday) {
    // Advance one calendar day using a UTC date as a safe calendar, then read
    // the local Y/M/D of that next day so month/year rollovers are correct.
    const nextDayInstant = new Date(Date.UTC(local.year, local.month - 1, local.day + 1, 12, 0, 0));
    const nextLocal = partsInZone(nextDayInstant, zone);
    target = {
      year: nextLocal.year,
      month: nextLocal.month,
      day: nextLocal.day,
      hour: window.startHour,
      minute: 0,
    };
  }

  return zonedWallClockToUtc(target, zone);
}
