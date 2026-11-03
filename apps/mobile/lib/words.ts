/**
 * The website's words for days, times and Tag states, so a rating or a Tag
 * reads the same on the iPhone as on the website. Each function names the
 * file it mirrors; `words.test.ts` pins the outputs.
 *
 * Dates are always en-US: the product's copy is English, and a phone set to
 * another region must not turn "Oct 22" into "22/10".
 */

const DAY = 86_400_000;

/**
 * Formats in the business's zone, or in UTC for a zone this phone's Intl
 * does not know, as `clock` does, so a day label and its time never
 * disagree about the zone.
 */
function inZone(at: Date, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  try {
    return at.toLocaleDateString("en-US", { ...options, timeZone });
  } catch {
    return at.toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
  }
}

/** The business's calendar day an instant falls on, as a whole day number. */
function calendarDay(at: Date, timeZone: string): number {
  // en-US numeric dates read month/day/year ("11/3/2026"); the separators
  // are not relied on, only the order.
  const parts = /(\d+)\D+(\d+)\D+(\d+)/.exec(
    inZone(at, timeZone, { year: "numeric", month: "numeric", day: "numeric" }),
  );
  if (!parts) return Math.floor(at.getTime() / DAY);
  return Date.UTC(Number(parts[3]), Number(parts[1]) - 1, Number(parts[2])) / DAY;
}

/**
 * frontend/lib/utils/relative-day.ts: days on the business's calendar, not
 * 24-hour periods, so last night's rating is "Yesterday" in the morning.
 */
export function relativeDay(iso: string, timeZone: string, now: number = Date.now()): string {
  const then = new Date(iso);
  const days = calendarDay(new Date(now), timeZone) - calendarDay(then, timeZone);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return inZone(then, timeZone, { day: "numeric", month: "short" });
}

/** "7:30 AM" in the business's own time zone, like the rating page. */
export function clock(iso: string, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  try {
    return new Date(iso).toLocaleTimeString("en-US", { ...options, timeZone });
  } catch {
    return new Date(iso).toLocaleTimeString("en-US", { ...options, timeZone: "UTC" });
  }
}

export interface TagTimes {
  nfcProvisionedAt: string | null;
  tokenRotatedAt: string | null;
}

/** frontend/lib/owner/tag-readiness.ts — a new code makes old chips and printouts stale. */
export function tagNeedsRewrite(input: TagTimes): boolean {
  if (input.tokenRotatedAt === null) return false;
  return input.nfcProvisionedAt === null || new Date(input.tokenRotatedAt) > new Date(input.nfcProvisionedAt);
}

export type TagReadiness = "ready" | "needs-nfc" | "needs-qr" | "both";

export function tagReadiness(input: TagTimes): TagReadiness {
  const needsNfc = input.nfcProvisionedAt === null || tagNeedsRewrite(input);
  const needsQr = tagNeedsRewrite(input);
  if (needsNfc && needsQr) return "both";
  if (needsNfc) return "needs-nfc";
  if (needsQr) return "needs-qr";
  return "ready";
}

/** frontend/lib/owner/tag-readiness.ts tagReadinessLabel: the Tag's state in an owner's words. */
export function tagReadinessLabel(status: TagReadiness): string {
  if (status === "ready") return "Ready";
  if (status === "needs-qr") return "Reprint the code";
  if (status === "needs-nfc") return "Tap not set up";
  return "Code changed: reprint and set up tap";
}

/** The two things an owner checks on a Tag, as the website's Tags list says them. */
export function tagChecks(input: TagTimes): { qr: { ok: boolean; label: string }; nfc: { ok: boolean; label: string } } {
  const status = tagReadiness(input);
  const qrOk = status === "ready" || status === "needs-nfc";
  const nfcOk = status === "ready" || status === "needs-qr";
  return {
    qr: { ok: qrOk, label: qrOk ? "QR ready" : "Reprint QR" },
    nfc: { ok: nfcOk, label: nfcOk ? "Tap ready" : tagNeedsRewrite(input) ? "Set up tap again" : "Set up tap" },
  };
}

/** frontend/lib/owner/tag-readiness.ts lastUsedLabel */
export function lastUsedLabel(iso: string | null, timeZone: string, now: number = Date.now()): string {
  if (!iso) return "Not used yet";
  const day = relativeDay(iso, timeZone, now);
  if (day === "Today") return "Used today";
  if (day === "Yesterday") return "Used yesterday";
  return `Used ${day}`;
}

/** frontend/features/dashboard/text-request-composer.tsx STATUS */
const TEXT_STATUS: Record<string, { label: string; tone: "ok" | "wait" | "bad" | "off" }> = {
  scheduled: { label: "Scheduled", tone: "wait" },
  queued: { label: "Queued", tone: "wait" },
  sending: { label: "Sending", tone: "wait" },
  submitted: { label: "Sent", tone: "wait" },
  provider_unknown: { label: "Delivery unknown", tone: "wait" },
  delivered: { label: "Delivered", tone: "ok" },
  failed: { label: "Not delivered", tone: "bad" },
  suppressed: { label: "Not sent · opted out or blocked", tone: "off" },
  cancelled: { label: "Cancelled", tone: "off" },
};

export function textStatus(status: string): { label: string; tone: "ok" | "wait" | "bad" | "off" } {
  return TEXT_STATUS[status] ?? { label: status, tone: "off" };
}

/** "1 rating" / "12 ratings". */
export function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}
