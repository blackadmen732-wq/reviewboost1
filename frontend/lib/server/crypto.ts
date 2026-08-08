import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { encryptionKey } from "@/lib/server/env";

/**
 * Encryption and token primitives for the public customer flow.
 *
 * Two distinct jobs, deliberately not conflated:
 *
 *   **Encryption** protects content that must be readable again — a customer's
 *   private note, a colleague's name. AES-256-GCM, so a tampered ciphertext
 *   fails loudly rather than decrypting to plausible garbage.
 *
 *   **Keyed digests** protect values that only ever need to be *matched* — the
 *   stand, session, and response tokens, and the rate-limit client key. A plain
 *   SHA-256 would be reversible here by exhaustive search, because the input
 *   space is small enough to enumerate; an HMAC is not, unless the key leaks
 *   too.
 */

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12; // 96 bits — the size GCM is specified and optimised for.

export const KEY_VERSION = 1;

/**
 * Stand, session, and response tokens.
 *
 * 32 bytes is 256 bits of entropy, well past the 192-bit floor, and base64url
 * keeps it URL-safe so it can sit in a path segment and be encoded into a QR
 * code without escaping.
 *
 * A token is the *only* thing authorising a write into a business's data, so
 * guessability is the whole security argument. Sequential or short ids would
 * let anyone enumerate stands and fill a business's feedback with fabrications.
 */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Non-secret leading fragment, so an owner can recognise a stand in a list. */
export function tokenPrefix(token: string): string {
  return token.slice(0, 8);
}

/**
 * Domain-separated keyed digest.
 *
 * The domain stops a session token and a response token with identical bytes
 * from producing the same stored digest, which would let one be presented where
 * the other is expected.
 */
export function keyedDigest(value: string, domain: string): string {
  return createHmac("sha256", encryptionKey()).update(`${domain}:${value}`).digest("hex");
}

export const digestStandToken = (token: string) => keyedDigest(token, "stand_token");
export const digestSessionToken = (token: string) => keyedDigest(token, "session_token");
export const digestResponseToken = (token: string) => keyedDigest(token, "response_token");
export const digestIdempotencyKey = (key: string) => keyedDigest(key, "idempotency_key");
export const digestRequestBody = (canonical: string) => keyedDigest(canonical, "idempotency_request");

/**
 * Coarse, rotating client fingerprint for abuse controls.
 *
 * Keyed so it cannot be reversed, and salted with the UTC date so it rotates
 * daily and cannot follow a device across weeks.
 *
 * **This is not customer identity and must never be used as such.** Every
 * customer in one restaurant shares a network address; treating this as a
 * person would merge them all into one.
 */
export function clientFingerprint(address: string | null, userAgent: string | null): string {
  const day = new Date().toISOString().slice(0, 10);
  return keyedDigest(`${day}|${address ?? "unknown"}|${(userAgent ?? "").slice(0, 400)}`, "client");
}

/** `v1:<iv>:<tag>:<ciphertext>`, each part base64. Null in, null out. */
export function encrypt(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === "") return null;

  // A fresh random IV per message. Reusing one under the same key is a
  // catastrophic failure for GCM — it leaks the authentication key itself.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return [
    VERSION,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decrypt(payload: string | null | undefined): string | null {
  if (payload === null || payload === undefined || payload === "") return null;

  const parts = payload.split(":");
  if (parts.length !== 4) throw new Error("Encrypted value is malformed.");

  const [version, iv, tag, ciphertext] = parts;
  if (version !== VERSION) throw new Error("Unsupported ciphertext version.");
  if (!iv || !tag || ciphertext === undefined) throw new Error("Encrypted value is malformed.");

  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(iv, "base64"));
  // Throws from final() if the ciphertext or tag was altered, or the key is
  // wrong — which is exactly the property authenticated encryption buys.
  decipher.setAuthTag(Buffer.from(tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Decrypt without throwing, for paths where one bad row must not fail the request. */
export function tryDecrypt(payload: string | null | undefined): string | null {
  try {
    return decrypt(payload);
  } catch {
    return null;
  }
}

/**
 * Constant-time comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, and returning early on length
 * would itself leak information, so unequal inputs are compared as fixed-size
 * digests instead and the timing stays flat.
 */
export function secureCompare(left: string, right: string): boolean {
  const a = createHmac("sha256", "compare").update(left).digest();
  const b = createHmac("sha256", "compare").update(right).digest();
  return timingSafeEqual(a, b);
}
