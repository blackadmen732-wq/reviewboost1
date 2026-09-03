import "server-only";

import { KEY_VERSION, encrypt, keyedDigest } from "@/lib/server/crypto";
import { tokenDigestKey } from "@/lib/server/env";

/**
 * Phone identity for Text Requests.
 *
 * A number is normalised to E.164 and then stored the way tokens are: a keyed
 * digest for matching (so suppression and consent lookups never need the number
 * in clear), an AES-256-GCM ciphertext for the rare read-back, and a last-four
 * fragment for recognition. The raw number never reaches the database.
 *
 * Normalisation is deliberately strict and dependency-free. A permissive
 * parser that "fixes" a malformed number is how one customer's Text Request
 * reaches a stranger; an unparseable number is rejected, not guessed.
 */

const E164_RE = /^\+[1-9]\d{7,14}$/;

export interface NormalizedPhone {
  e164: string;
  lastFour: string;
}

export class PhoneNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhoneNormalizationError";
  }
}

/**
 * Normalise to E.164, or throw.
 *
 * Accepts input already in E.164, an international `00`-prefixed form, or — only
 * when a default country calling code is supplied — a national number of plain
 * digits. Visual separators (spaces, hyphens, parentheses, dots) are stripped
 * first. Anything else is rejected rather than coerced.
 */
export function normalizePhone(
  input: string,
  options?: { defaultCountryCallingCode?: string },
): NormalizedPhone {
  if (typeof input !== "string") throw new PhoneNormalizationError("Phone number is required.");

  // Strip common visual separators only. Letters and other punctuation are left
  // in so they fail validation rather than being silently deleted.
  const cleaned = input.trim().replace(/[\s()\-.]/g, "");

  let candidate: string;
  if (cleaned.startsWith("+")) {
    candidate = cleaned;
  } else if (cleaned.startsWith("00")) {
    // International access code form: 00<cc><number> → +<cc><number>.
    candidate = `+${cleaned.slice(2)}`;
  } else if (/^\d+$/.test(cleaned) && options?.defaultCountryCallingCode) {
    const cc = options.defaultCountryCallingCode.replace(/^\+/, "");
    if (!/^\d{1,3}$/.test(cc)) {
      throw new PhoneNormalizationError("Invalid default country calling code.");
    }
    // A national number should not itself carry a country/trunk zero prefix in
    // this simple path; strip a single leading trunk 0 if present.
    const national = cleaned.replace(/^0/, "");
    candidate = `+${cc}${national}`;
  } else {
    throw new PhoneNormalizationError(
      "Phone number must be in international format, e.g. +15551234567.",
    );
  }

  if (!E164_RE.test(candidate)) {
    throw new PhoneNormalizationError("Phone number is not a valid E.164 number.");
  }

  return { e164: candidate, lastFour: candidate.slice(-4) };
}

/** Keyed digest of an E.164 number, domain-separated. The stored matching key. */
export function phoneHash(e164: string): string {
  return keyedDigest(e164, "sms_phone", tokenDigestKey());
}

/** Everything the database needs to store one recipient identity. */
export interface StoredPhone {
  phoneHash: string;
  phoneEncrypted: string | null;
  phoneKeyVersion: number;
  lastFour: string;
}

export function toStoredPhone(normalized: NormalizedPhone): StoredPhone {
  return {
    phoneHash: phoneHash(normalized.e164),
    phoneEncrypted: encrypt(normalized.e164),
    phoneKeyVersion: KEY_VERSION,
    lastFour: normalized.lastFour,
  };
}
