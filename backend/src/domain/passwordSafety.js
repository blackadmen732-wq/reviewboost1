import { createHash } from 'node:crypto';

/**
 * Password safety checks.
 *
 * Length and character-class rules are close to worthless on their own —
 * `Password1!` satisfies most of them and appears in every breach corpus. What
 * actually predicts compromise is whether the password has already leaked, and
 * whether it contains something an attacker targeting this specific user
 * already knows.
 *
 * Breach checking uses the Have I Been Pwned range API with k-anonymity: only
 * the first five characters of the SHA-1 hash leave this process. HIBP returns
 * every suffix sharing that prefix — several hundred — and the comparison
 * happens locally, so neither the password nor its full hash is ever disclosed.
 */

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range';
const REQUEST_TIMEOUT_MS = 3000;
const PREFIX_LENGTH = 5;

/** Not worth a network round trip. */
const OBVIOUS_PASSWORDS = new Set([
  'password',
  'password1',
  'password12',
  'password123',
  'passw0rd123',
  '123456789012',
  '1234567890',
  'qwertyuiop',
  'qwerty123456',
  'letmein12345',
  'welcome12345',
  'admin1234567',
  'changeme1234',
  'reviewboost',
  'reviewboost1',
  'iloveyou1234',
]);

export class PasswordCheckResult {
  constructor({ safe, reason = null, breachCount = 0, checked = true }) {
    this.safe = safe;
    this.reason = reason;
    this.breachCount = breachCount;
    /** False when the breach corpus could not be reached, so callers can decide policy. */
    this.checked = checked;
  }
}

/**
 * Checks that need no network call.
 *
 * The context check matters more than it looks: an attacker targeting one
 * business already knows the owner's email and company name, so those are the
 * first things they try.
 */
function findLocalWeakness(password, context = {}) {
  const lowered = password.toLowerCase();

  if (OBVIOUS_PASSWORDS.has(lowered)) {
    return 'That is one of the most commonly used passwords. Choose something else.';
  }

  if (/^(.)\1+$/.test(password)) {
    return 'Password cannot be a single repeated character.';
  }

  if (/^(0123456789|1234567890|abcdefghij|qwertyuiop)/.test(lowered)) {
    return 'Password cannot be a keyboard or alphabet sequence.';
  }

  // Only the leading token of an email is worth checking — everyone's password
  // could contain "com" or "gmail" innocently.
  for (const [label, raw] of Object.entries(context)) {
    const value = String(raw ?? '')
      .toLowerCase()
      .split(/[@\s.]/)[0]
      .replace(/[^a-z0-9]/g, '');

    if (value.length >= 4 && lowered.includes(value)) {
      return `Password must not contain your ${label}.`;
    }
  }

  return null;
}

/**
 * @param {string} password
 * @param {{email?: string, businessName?: string}} context
 * @param {{fetchImpl?: typeof fetch}} options  injectable for testing
 * @returns {Promise<PasswordCheckResult>}
 */
export async function checkPasswordSafety(password, context = {}, { fetchImpl = fetch } = {}) {
  const value = String(password ?? '');

  const localWeakness = findLocalWeakness(value, context);
  if (localWeakness) {
    return new PasswordCheckResult({ safe: false, reason: localWeakness });
  }

  const sha1 = createHash('sha1').update(value, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, PREFIX_LENGTH);
  const suffix = sha1.slice(PREFIX_LENGTH);

  let body;
  try {
    const response = await fetchImpl(`${HIBP_RANGE_URL}/${prefix}`, {
      headers: {
        // Pads the response so its size cannot hint at how many hashes matched.
        'Add-Padding': 'true',
        'User-Agent': 'ReviewBoost-PasswordCheck',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) throw new Error(`HIBP responded ${response.status}`);
    body = await response.text();
  } catch {
    // Availability decision: an outage at a third party must not block signups
    // or password resets. The local checks above still applied, and `checked`
    // records that this one did not — so a sustained outage is visible in logs
    // rather than silently weakening the policy.
    return new PasswordCheckResult({ safe: true, checked: false });
  }

  for (const line of body.split('\n')) {
    const [candidate, count] = line.trim().split(':');
    if (candidate === suffix) {
      const breachCount = Number(count) || 1;
      return new PasswordCheckResult({
        safe: false,
        breachCount,
        reason:
          `This password has appeared in ${breachCount.toLocaleString()} known data breaches ` +
          'and is actively used in attacks. Choose a different one.',
      });
    }
  }

  return new PasswordCheckResult({ safe: true });
}
