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
});

export const hashPhone = (value) => pii.lookupHash(value, HASH_DOMAIN.PHONE);
export const hashIp = (value) => pii.lookupHash(value ?? 'unknown', HASH_DOMAIN.IP);
export const hashEmail = (value) => pii.lookupHash(String(value ?? '').toLowerCase(), HASH_DOMAIN.EMAIL);
