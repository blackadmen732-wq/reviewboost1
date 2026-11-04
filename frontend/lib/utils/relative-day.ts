import { localDateOf, localDaysBetween } from "@/lib/utils/local-day";

/**
 * Dates the way a person says them.
 *
 * "Today" and "Yesterday" beat a date nobody has to decode. Past a week that
 * flips: "23 days ago" is harder to place than "Jul 12", because at that
 * distance people think in dates, not in counts.
 *
 * Days on the business's calendar, not 24-hour periods. Counting hours made
 * a rating left at 6 PM and read at 9 the next morning "Today at 6:00 PM",
 * which is every evening's ratings at the hour an owner reads them. The zone
 * and the locale are fixed (the business's zone, en-US like the rest of the
 * product), so the server's HTML and the hydrated page say the same thing.
 */
export function relativeDay(iso: string, timeZone: string, now: number = Date.now()): string {
  const then = new Date(iso);
  // As before: a date that isn't one reads "Invalid Date" rather than taking
  // the page down (Intl throws on it).
  if (Number.isNaN(then.getTime())) return String(then);

  const zone = knownZone(timeZone);
  const days = localDaysBetween(localDateOf(zone, then), localDateOf(zone, new Date(now)));

  // Clock skew can put a timestamp a moment in the future: that is today.
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;

  return then.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: zone });
}

/**
 * A list row's when: "Today at 2:30 PM" and "Yesterday at 6:05 PM" (as a
 * rating's own page and the app say it), where the
 * hour tells two ratings of the same day apart; just the day further back,
 * where it no longer does.
 */
export function relativeDayTime(iso: string, timeZone: string, now: number = Date.now()): string {
  const day = relativeDay(iso, timeZone, now);
  if (day !== "Today" && day !== "Yesterday") return day;
  const clock = new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: knownZone(timeZone),
  });
  return `${day} at ${clock}`;
}

const KNOWN_ZONES = new Map<string, string>();

/**
 * The business's zone if this runtime has it, otherwise the device's own.
 *
 * These labels also render in the browser, inside client components. Node
 * knows every zone sign-up accepts, but a browser with older time-zone data
 * may not, and Intl throws on a zone it doesn't know: the page failed, and so
 * did its Try again. The owner's own device is the nearest stand-in, since an
 * owner is usually where the business is.
 */
function knownZone(timeZone: string): string {
  let zone = KNOWN_ZONES.get(timeZone);
  if (zone === undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone });
      zone = timeZone;
    } catch {
      zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
    KNOWN_ZONES.set(timeZone, zone);
  }
  return zone;
}
