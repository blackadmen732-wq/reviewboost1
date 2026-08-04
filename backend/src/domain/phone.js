/**
 * Phone number normalisation.
 *
 * Everything downstream — Twilio, duplicate protection, suppression lists —
 * assumes E.164 (`+15555550123`). A number that cannot be normalised with
 * confidence is *rejected* rather than guessed at: a wrong guess means texting
 * a stranger, which costs money and is a compliance incident.
 *
 * This is deliberately not a full libphonenumber. It handles NANP precisely,
 * accepts explicit international input, and refuses anything ambiguous.
 */

const MIN_E164_DIGITS = 8;
const MAX_E164_DIGITS = 15;
const NANP_COUNTRY_CODE = '1';

/**
 * A NANP number is valid only if the area code and exchange code both start
 * with 2-9. This rejects the placeholder ranges people paste in during testing
 * (555-0100 style) reaching real handsets by accident.
 */
const NANP_PATTERN = /^[2-9]\d{2}[2-9]\d{6}$/;

/**
 * @param {string} input
 * @param {string} defaultCountryCode digits only, e.g. '1'
 * @returns {string} E.164, or '' when the input cannot be normalised safely
 */
export function normalizePhone(input, defaultCountryCode = NANP_COUNTRY_CODE) {
  const raw = String(input ?? '').trim();
  if (!raw) return '';

  // Strip formatting but remember whether the caller was explicit about the
  // international prefix — that changes how we interpret the digits.
  const wasExplicitlyInternational = raw.startsWith('+') || raw.startsWith('00');
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  if (wasExplicitlyInternational) {
    // '00' is the ITU international access prefix; drop it if present.
    const normalized = raw.startsWith('00') ? digits.replace(/^00/, '') : digits;
    return isPlausibleE164(normalized) ? `+${normalized}` : '';
  }

  if (defaultCountryCode === NANP_COUNTRY_CODE) {
    if (digits.length === 10) {
      return NANP_PATTERN.test(digits) ? `+1${digits}` : '';
    }
    if (digits.length === 11 && digits.startsWith('1')) {
      const national = digits.slice(1);
      return NANP_PATTERN.test(national) ? `+1${national}` : '';
    }
    // Anything else in a NANP context is ambiguous — refuse it.
    return '';
  }

  const withCountry = digits.startsWith(defaultCountryCode)
    ? digits
    : `${defaultCountryCode}${digits}`;

  return isPlausibleE164(withCountry) ? `+${withCountry}` : '';
}

function isPlausibleE164(digits) {
  return (
    digits.length >= MIN_E164_DIGITS &&
    digits.length <= MAX_E164_DIGITS &&
    // E.164 country codes never begin with zero.
    !digits.startsWith('0')
  );
}

/**
 * Stable key for duplicate protection and suppression.
 *
 * NANP numbers reduce to their ten significant digits, so `+15555550123`,
 * `1-555-555-0123`, and `(555) 555-0123` all collapse to one key. Without this,
 * the same person could be texted three times from one upload.
 */
export function phoneDedupeKey(input) {
  const e164 = normalizePhone(input);
  if (!e164) return '';

  const digits = e164.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith(NANP_COUNTRY_CODE) ? digits.slice(1) : digits;
}

export function isValidPhone(input) {
  return normalizePhone(input) !== '';
}

/** Last four digits, for dashboards that must never show a full number. */
export function maskPhone(input) {
  const digits = String(input ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : '';
}

/**
 * Normalise a batch, reporting rejections rather than silently dropping them.
 *
 * Silent drops are how a user uploads 500 contacts, sees "sent", and never
 * learns that 40 of them had a typo.
 *
 * @returns {{valid: Array<{input: string, e164: string, dedupeKey: string, index: number}>,
 *            invalid: Array<{input: string, index: number, reason: string}>}}
 */
export function normalizeBatch(inputs, defaultCountryCode = NANP_COUNTRY_CODE) {
  const valid = [];
  const invalid = [];
  const seen = new Map();

  inputs.forEach((input, index) => {
    const e164 = normalizePhone(input, defaultCountryCode);

    if (!e164) {
      invalid.push({ input: String(input ?? ''), index, reason: 'invalid_phone' });
      return;
    }

    const dedupeKey = phoneDedupeKey(e164);
    if (seen.has(dedupeKey)) {
      invalid.push({
        input: String(input ?? ''),
        index,
        reason: 'duplicate_in_batch',
        duplicateOfIndex: seen.get(dedupeKey),
      });
      return;
    }

    seen.set(dedupeKey, index);
    valid.push({ input: String(input ?? ''), e164, dedupeKey, index });
  });

  return { valid, invalid };
}
