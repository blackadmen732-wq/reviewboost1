import { config } from '../config/index.js';
import { PiiProtector } from '../domain/crypto.js';

/**
 * The single configured PiiProtector.
 *
 * Given its own module rather than hanging off a feature service, so that
 * importing encryption does not drag campaign or billing logic along with it —
 * and so there is exactly one place the key is read.
 */
export const pii = new PiiProtector(config.piiEncryptionKey);

/**
 * Domain separators for lookup hashes.
 *
 * Named constants rather than inline strings: a typo in a domain string would
 * silently produce a different hash, which surfaces as duplicate protection or
 * suppression quietly not matching anything.
 */
export const HASH_DOMAIN = Object.freeze({
  PHONE: 'phone',
  IP: 'ip',
  DEVICE: 'device',
  EMAIL: 'email',
  // The anonymous customer flow. Separate domains so a session token and a
  // response token with the same bytes do not produce the same stored hash.
  PUBLIC_SESSION: 'public_session',
  PUBLIC_RESPONSE: 'public_response',
  IDEMPOTENCY_KEY: 'idempotency_key',
  IDEMPOTENCY_REQUEST: 'idempotency_request',
  PUBLIC_CLIENT: 'public_client',
});

export const hashPhone = (value) => pii.lookupHash(value, HASH_DOMAIN.PHONE);
export const hashIp = (value) => pii.lookupHash(value ?? 'unknown', HASH_DOMAIN.IP);
export const hashEmail = (value) => pii.lookupHash(String(value ?? '').toLowerCase(), HASH_DOMAIN.EMAIL);

/**
 * Hashes for the anonymous customer flow.
 *
 * The session and response tokens are capability tokens: holding one is the
 * only thing that authorises writing into a business's data. They are stored
 * only as a keyed HMAC, so a database disclosure yields nothing usable.
 */
export const hashPublicSessionToken = (value) => pii.lookupHash(value, HASH_DOMAIN.PUBLIC_SESSION);
export const hashPublicResponseToken = (value) => pii.lookupHash(value, HASH_DOMAIN.PUBLIC_RESPONSE);
export const hashIdempotencyKey = (value) => pii.lookupHash(value, HASH_DOMAIN.IDEMPOTENCY_KEY);
export const hashIdempotencyRequest = (value) =>
  pii.lookupHash(value, HASH_DOMAIN.IDEMPOTENCY_REQUEST);

/**
 * Coarse, rotating client fingerprint for short-term abuse prevention.
 *
 * Keyed, so it cannot be reversed, and salted with the UTC date so it rotates
 * daily and cannot be used to follow a device across weeks.
 *
 * It is not customer identity and must never be used as such: every customer in
 * one restaurant shares a network address, so treating this as a person would
 * merge them all into one.
 */
export function publicClientFingerprint({ ip, userAgent } = {}) {
  const day = new Date().toISOString().slice(0, 10);
  const material = `${day}|${ip ?? 'unknown'}|${String(userAgent ?? '').slice(0, 400)}`;
  return pii.lookupHash(material, HASH_DOMAIN.PUBLIC_CLIENT);
}
