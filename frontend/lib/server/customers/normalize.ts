import "server-only";

import { KEY_VERSION, encrypt, keyedDigest } from "@/lib/server/crypto";
import { tokenDigestKey } from "@/lib/server/env";
import { PhoneNormalizationError, normalizePhone } from "@/lib/server/sms/phone";

/**
 * Customer PII normalization + hashing.
 *
 * Phone identity reuses the Text Requests convention exactly: normalise to
 * E.164, hash with the same keyed digest (`sms_phone` domain) that
 * `sms_consent_state.phone_hash` / `sms_phone_optout.phone_hash` already key
 * on. That is deliberate — a customer's canonical phone identity IS the same
 * identity Text Requests already gates consent by, so Track 3 hands directly
 * to the existing consent/suppression stack rather than introducing a parallel
 * one.
 *
 * Email identity is normalized (trim, lowercase local + host) and hashed with
 * a distinct domain so it can never collide with a phone hash.
 */

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

export class EmailNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailNormalizationError";
  }
}

export interface NormalizedEmail {
  address: string;
  domain: string;
}

/**
 * Normalise an email to lowercased canonical form; reject anything that isn't
 * shaped like an address. A malformed input becomes an invalid row, never a
 * silently-mangled one.
 */
export function normalizeEmail(input: string): NormalizedEmail {
  if (typeof input !== "string") throw new EmailNormalizationError("Email is required.");
  const trimmed = input.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmed)) throw new EmailNormalizationError("Email is not a valid address.");
  const atIndex = trimmed.lastIndexOf("@");
  const domain = trimmed.slice(atIndex + 1);
  return { address: trimmed, domain };
}

/** The same keyed digest Text Requests uses, so canonical phone identities collapse. */
export function customerPhoneHash(e164: string): string {
  return keyedDigest(e164, "sms_phone", tokenDigestKey());
}

/** Domain-separated from phones so a hash can never be a phone AND an email. */
export function customerEmailHash(canonical: string): string {
  return keyedDigest(canonical, "customer_email", tokenDigestKey());
}

/**
 * Everything the DB needs to store one customer's phone identity. Never
 * carries the raw number.
 */
export interface StoredCustomerPhone {
  phoneHash: string;
  phoneEncrypted: string | null;
  phoneKeyVersion: number;
  phoneLastFour: string;
}

export function toStoredCustomerPhone(rawPhone: string, defaultCountryCallingCode?: string): StoredCustomerPhone {
  const normalized = normalizePhone(rawPhone, defaultCountryCallingCode
    ? { defaultCountryCallingCode }
    : undefined);
  return {
    phoneHash: customerPhoneHash(normalized.e164),
    phoneEncrypted: encrypt(normalized.e164),
    phoneKeyVersion: KEY_VERSION,
    phoneLastFour: normalized.lastFour,
  };
}

export interface StoredCustomerEmail {
  emailHash: string;
  emailEncrypted: string | null;
  emailKeyVersion: number;
  emailDomain: string;
}

export function toStoredCustomerEmail(rawEmail: string): StoredCustomerEmail {
  const normalized = normalizeEmail(rawEmail);
  return {
    emailHash: customerEmailHash(normalized.address),
    emailEncrypted: encrypt(normalized.address),
    emailKeyVersion: KEY_VERSION,
    emailDomain: normalized.domain,
  };
}

/** Re-export for callers that catch normalization errors from either kind. */
export { PhoneNormalizationError };
