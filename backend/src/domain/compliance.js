/**
 * Messaging compliance (TCPA and carrier rules).
 *
 * These are not product preferences. Sending to someone who replied STOP is a
 * per-message statutory violation in the US ($500–$1,500 each), and sending
 * outside local quiet hours is a common cause of carrier filtering that damages
 * deliverability for every other message on the same number.
 *
 * Everything here fails closed: an unrecognised timezone, an unparseable
 * consent record, or an ambiguous keyword all resolve to "do not send".
 */

/** Keywords carriers require to be honoured as an opt-out. */
export const STOP_KEYWORDS = new Set([
  'STOP',
  'STOPALL',
  'UNSUBSCRIBE',
  'CANCEL',
  'END',
  'QUIT',
  'REVOKE',
  'OPTOUT',
  'OPT-OUT',
]);

export const START_KEYWORDS = new Set(['START', 'UNSTOP', 'YES', 'OPTIN', 'OPT-IN']);

export const HELP_KEYWORDS = new Set(['HELP', 'INFO']);

export const DEFAULT_OPT_OUT_NOTICE = 'Reply STOP to opt out.';

/**
 * Classify an inbound message.
 *
 * Punctuation and case are stripped because real replies are "Stop.", "STOP!",
 * and " stop " far more often than a bare uppercase token.
 *
 * @returns {'stop'|'start'|'help'|null}
 */
export function classifyInboundKeyword(body) {
  const keyword = String(body ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z-]/g, '');

  if (!keyword) return null;
  if (STOP_KEYWORDS.has(keyword)) return 'stop';
  if (START_KEYWORDS.has(keyword)) return 'start';
  if (HELP_KEYWORDS.has(keyword)) return 'help';
  return null;
}

/**
 * Guarantee an opt-out instruction is present.
 *
 * Appended rather than enforced, because refusing to send a message whose
 * author forgot the notice helps nobody — the requirement is that the recipient
 * sees it, not that the author typed it.
 */
export function ensureOptOutNotice(body, notice = DEFAULT_OPT_OUT_NOTICE) {
  const text = String(body ?? '').trim();
  if (!text) return notice;

  return hasOptOutInstruction(text) ? text : `${text} ${notice}`;
}

/**
 * Does this body already tell the recipient how to opt out?
 *
 * `\bstop\b` is not sufficient: a hyphen is a word boundary, so it matches
 * "one-stop shop" and "non-stop", and the message would then ship with no
 * opt-out instruction at all. The character classes below exclude hyphens and
 * apostrophes on both sides, so only a standalone STOP counts.
 */
export function hasOptOutInstruction(body) {
  return /(?:^|[^\w'-])stop(?:[^\w'-]|$)/i.test(String(body ?? ''));
}

/**
 * Is it currently legal to send to a recipient in `timezone`?
 *
 * Evaluated in the *recipient's* local time, not the server's — the entire
 * point is that a business in New York must not text a customer in Los Angeles
 * at 5am Pacific.
 *
 * Two distinct failure modes, handled differently on purpose:
 *
 *   Missing timezone (null, undefined, '')  UTC is assumed. Supplying a
 *     sensible default is the caller's job; failing closed here would block
 *     every send for a contact whose timezone was simply never collected.
 *
 *   Invalid timezone ('Not/AZone')  Fails closed. The value is wrong rather
 *     than absent, so guessing would mean texting someone at 3am.
 *
 * @param {Date} now
 * @param {string} timezone IANA zone, e.g. 'America/New_York'
 * @param {number} startHour inclusive, e.g. 8
 * @param {number} endHour   exclusive, e.g. 21
 */
export function isWithinSendingWindow(now, timezone, startHour, endHour) {
  const localHour = hourIn(timezone, now);
  if (localHour === null) return false;
  return localHour >= startHour && localHour < endHour;
}

function hourIn(timezone, when) {
  const zone = String(timezone ?? '').trim() || 'UTC';

  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: 'numeric',
      hour12: false,
    }).format(when);

    const hour = Number(formatted);
    if (!Number.isInteger(hour)) return null;
    // Some ICU builds render midnight as 24.
    return hour === 24 ? 0 : hour;
  } catch {
    // Intl throws RangeError on an unrecognised zone. Fail closed.
    return null;
  }
}

/**
 * Milliseconds until the next legal sending hour.
 *
 * Returns 0 when sending is permitted right now. Steps hour by hour rather than
 * computing an offset, so it stays correct across daylight-saving transitions.
 */
export function millisecondsUntilSendingWindow(now, timezone, startHour, endHour) {
  if (isWithinSendingWindow(now, timezone, startHour, endHour)) return 0;

  for (let hoursAhead = 1; hoursAhead <= 25; hoursAhead += 1) {
    const candidate = new Date(now.getTime() + hoursAhead * 3_600_000);
    if (isWithinSendingWindow(candidate, timezone, startHour, endHour)) {
      return hoursAhead * 3_600_000;
    }
  }

  // No window found in 25 hours means the zone is unknown or the window is
  // misconfigured. Defer an hour rather than block the campaign forever.
  return 3_600_000;
}

/**
 * Does this contact have consent we could defend?
 *
 * Requires both the flag and a timestamp: "we think they said yes" with no
 * record of when is not consent, and is exactly what a TCPA claim turns on.
 */
export function hasDefensibleConsent(contact) {
  if (!contact?.consent) return false;

  const at = contact.consent_at ?? contact.consentAt;
  if (!at) return false;

  const timestamp = new Date(at);
  if (Number.isNaN(timestamp.getTime())) return false;

  // A consent record dated in the future is corrupt, not valid.
  return timestamp.getTime() <= Date.now();
}

/**
 * Decide whether one recipient may be messaged right now.
 *
 * Collected in one place so the campaign builder, the worker, and any future
 * scheduler all apply an identical rule. Returns every failing reason rather
 * than the first, so a user can fix an upload in one pass.
 *
 * @returns {{allowed: boolean, reasons: string[], deferMs: number}}
 */
export function evaluateSendEligibility({
  contact,
  isSuppressed,
  recentlyMessaged,
  requireConsent = true,
  now = new Date(),
  timezone = 'UTC',
  quietHoursStart = 8,
  quietHoursEnd = 21,
}) {
  const reasons = [];

  if (isSuppressed) reasons.push('suppressed');
  if (recentlyMessaged) reasons.push('duplicate');
  if (requireConsent && !hasDefensibleConsent(contact)) reasons.push('no_consent');

  // Quiet hours defer rather than reject — the message is still legal, just
  // not yet.
  const deferMs = millisecondsUntilSendingWindow(
    now,
    contact?.timezone ?? timezone,
    quietHoursStart,
    quietHoursEnd,
  );

  return { allowed: reasons.length === 0, reasons, deferMs };
}
