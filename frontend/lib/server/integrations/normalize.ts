import "server-only";

import { keyedDigest } from "@/lib/server/crypto";
import { tokenDigestKey } from "@/lib/server/env";
import { normalizePhone, toStoredPhone, type StoredPhone } from "@/lib/server/sms/phone";

/**
 * Shared field rules for anything a provider hands us (docs/connections/05).
 *
 * The provider is not trusted to have clean data: names are trimmed and
 * capped, phones go through the same strict E.164 normaliser Text Requests
 * uses, and anything that does not parse becomes an issue the owner can see,
 * never a guessed number.
 */

export const MAX_NAME_LENGTH = 120;

export function cleanName(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join("");
}

/**
 * Keyed digest of a name, so two sources' names can be compared without
 * decrypting either. Case and spacing do not make two names different.
 */
export function nameDigest(name: string): string {
  return keyedDigest(name.toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim(), "customer_name", tokenDigestKey());
}

function defaultCountryCallingCode(): string | undefined {
  const raw = process.env.SMS_DEFAULT_COUNTRY_CALLING_CODE;
  return raw && /^\d{1,3}$/.test(raw) ? raw : undefined;
}

export type PhoneResult =
  | { kind: "ok"; stored: StoredPhone }
  | { kind: "missing" }
  | { kind: "invalid" };

export function normalizeProviderPhone(raw: string | null | undefined): PhoneResult {
  if (typeof raw !== "string" || raw.trim() === "") return { kind: "missing" };
  try {
    const cc = defaultCountryCallingCode();
    const normalized = normalizePhone(raw, cc ? { defaultCountryCallingCode: cc } : undefined);
    return { kind: "ok", stored: toStoredPhone(normalized) };
  } catch {
    return { kind: "invalid" };
  }
}

/**
 * The most an issue list ever shows about a person: first name, an initial,
 * and the last digits of the number. "Ana R. · •••• 0101".
 */
export function displayHint(name: string | null, phone: string | null | undefined): string | null {
  const parts: string[] = [];
  const cleaned = cleanName(name);
  if (cleaned) {
    const [first, ...rest] = cleaned.split(" ");
    const last = rest.at(-1);
    parts.push(last ? `${first} ${Array.from(last)[0]}.` : (first ?? ""));
  }
  const digits = typeof phone === "string" ? phone.replace(/\D/g, "") : "";
  if (digits.length >= 2) parts.push(`•••• ${digits.slice(-Math.min(4, digits.length - 1))}`);
  return parts.length ? parts.join(" · ").slice(0, 80) : null;
}
