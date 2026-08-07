/**
 * Pure rules for the anonymous customer flow.
 *
 * No I/O, so every rule here is unit-testable without a database — which
 * matters most for the one rule that must never be wrong: that the response a
 * customer gets does not depend on the rating they chose.
 */

/**
 * Locales the customer page is translated into.
 *
 * Served from the API rather than hardcoded in the client so that adding a
 * language is a backend deploy, not a coordinated release. Ordered, and the
 * default must be a member.
 */
export const SUPPORTED_LOCALES = Object.freeze(['en', 'es', 'ht']);
export const DEFAULT_LOCALE = 'en';

/** Text limits, matching the published contract. */
export const MAX_NOTE_LENGTH = 2000;
export const MAX_FIRST_NAME_LENGTH = 80;

/**
 * Byte ceilings on top of the character limits.
 *
 * `maxLength` in the contract counts UTF-16 code units, so 2,000 characters of
 * emoji or Devanagari is several times 2,000 bytes. The database and the
 * encryption layer care about bytes, so both limits are enforced.
 */
export const MAX_NOTE_BYTES = 8000;
export const MAX_FIRST_NAME_BYTES = 320;

/**
 * Tab, newline, carriage return.
 *
 * These survive normalisation because a customer writing a multi-line note
 * means it. Every other C0 control character, and DEL, is stripped: it carries
 * no meaning in a name or a note and is a display-spoofing vector.
 */
const MEANINGFUL_WHITESPACE = new Set([9, 10, 13]);

export function byteLength(value) {
  return Buffer.byteLength(String(value ?? ''), 'utf8');
}

export function isSupportedLocale(value) {
  return SUPPORTED_LOCALES.includes(value);
}

/**
 * Canonical form of a request body, for the idempotency request fingerprint.
 *
 * Keys are sorted recursively so that `{a,b}` and `{b,a}` — which a retrying
 * client may well produce, since JSON object key order is not guaranteed across
 * serialisers — fingerprint identically rather than being reported as a
 * conflict. Arrays keep their order, because their order is meaningful.
 *
 * `undefined` members are dropped, so an omitted optional field and an
 * explicitly-undefined one are the same request.
 */
export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);

  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) continue;
    result[key] = canonicalize(value[key]);
  }
  return result;
}

/**
 * Normalise customer-entered text.
 *
 * Unicode NFC only: the customer's own words are stored as written. Nothing
 * here transliterates a name, strips an accent, or rewrites text — a colleague
 * called "José" must reach the owner as "José", and a praise note is evidence,
 * not copy to be edited.
 */
export function normalizeCustomerText(value) {
  const normalized = String(value ?? '').normalize('NFC');

  let stripped = '';
  for (const character of normalized) {
    const code = character.codePointAt(0);
    if (code < 32 && !MEANINGFUL_WHITESPACE.has(code)) continue;
    if (code === 127) continue;
    stripped += character;
  }

  return stripped.trim();
}
