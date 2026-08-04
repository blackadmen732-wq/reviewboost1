import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * PII protection primitives.
 *
 * Customer phone numbers, names, and free-text feedback are encrypted at rest
 * with AES-256-GCM — authenticated encryption, so a tampered ciphertext fails
 * loudly rather than decrypting to garbage.
 *
 * Equality lookups (duplicate protection, suppression) use a *keyed* HMAC
 * rather than a plain digest. This matters more than it looks: there are only
 * ~10^10 possible NANP phone numbers and 2^32 IPv4 addresses, so an unsalted
 * SHA-256 of either is reversible by exhaustive search in seconds on commodity
 * hardware. A keyed HMAC is not, unless the key also leaks.
 */

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12; // 96 bits — the size GCM is specified and optimised for.
const KEY_BYTES = 32;

export class CryptoError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CryptoError';
  }
}

export class PiiProtector {
  #key;

  /** @param {string} base64Key base64-encoded 32 bytes */
  constructor(base64Key) {
    const key = Buffer.from(String(base64Key ?? ''), 'base64');

    if (key.length !== KEY_BYTES) {
      throw new CryptoError(
        `PII encryption key must be base64-encoded ${KEY_BYTES} bytes. ` +
          `Generate one with: openssl rand -base64 ${KEY_BYTES}`,
      );
    }

    this.#key = key;
  }

  /**
   * @returns {string|null} `v1:<iv>:<tag>:<ciphertext>`, each part base64.
   *   Null for empty input, so callers can store NULL rather than the
   *   ciphertext of an empty string.
   */
  encrypt(plaintext) {
    if (plaintext === null || plaintext === undefined || plaintext === '') return null;

    // A fresh random IV per message. Reusing one under the same key is a
    // catastrophic failure for GCM — it leaks the authentication key.
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.#key, iv);
    const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);

    return [
      VERSION,
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(payload) {
    if (payload === null || payload === undefined || payload === '') return null;

    const parts = String(payload).split(':');
    if (parts.length !== 4) {
      throw new CryptoError('Encrypted value is malformed.');
    }

    const [version, iv, tag, ciphertext] = parts;
    if (version !== VERSION) {
      throw new CryptoError(`Unsupported ciphertext version "${version}".`);
    }

    try {
      const decipher = createDecipheriv(ALGORITHM, this.#key, Buffer.from(iv, 'base64'));
      // Throws from final() if the ciphertext or tag was altered, or if the
      // key is wrong — which is the property we want.
      decipher.setAuthTag(Buffer.from(tag, 'base64'));

      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch (error) {
      throw new CryptoError(`Could not decrypt value: ${error.message}`);
    }
  }

  /**
   * Deterministic, keyed lookup value.
   *
   * The same input always produces the same digest, so it can be indexed and
   * compared — but it cannot be reversed without the key.
   *
   * `domain` separates namespaces: the hash of a phone number must not equal
   * the hash of an IP address that happens to share the same string form.
   */
  lookupHash(value, domain = 'default') {
    return createHmac('sha256', this.#key)
      .update(`${domain}:${String(value ?? '')}`)
      .digest('hex');
  }

  /** Decrypt without throwing, for list endpoints where one bad row must not fail the page. */
  tryDecrypt(payload, fallback = null) {
    try {
      return this.decrypt(payload);
    } catch {
      return fallback;
    }
  }
}

/**
 * Constant-time string comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, and returning early on length
 * would itself leak information — so unequal lengths are compared against a
 * fixed-size digest instead, keeping the timing flat.
 */
export function secureCompare(left, right) {
  const a = createHmac('sha256', 'compare').update(String(left ?? '')).digest();
  const b = createHmac('sha256', 'compare').update(String(right ?? '')).digest();
  return timingSafeEqual(a, b);
}

/** URL-safe random token. 32 bytes is 256 bits of entropy. */
export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Hash a token for storage.
 *
 * Session and reset tokens are stored only as HMACs, so a database disclosure
 * does not hand an attacker usable sessions. A single fast HMAC is appropriate
 * here — unlike a password, the input is 256 bits of server-generated entropy,
 * so there is nothing to brute force.
 */
export function hashToken(token, key, domain = 'refresh') {
  return createHmac('sha256', key).update(`${domain}:${token}`).digest('hex');
}
