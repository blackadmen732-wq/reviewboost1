import "server-only";

/**
 * Server-side Google review destination validation.
 *
 * This URL is handed to a customer's browser, so an unvalidated one turns the
 * business's own printed QR code into a phishing lure — a sticker over a code,
 * or a compromised dashboard field, and every scanner goes wherever the
 * attacker chose.
 *
 * The allowlist matches `lib/security/destination.ts` on the client exactly,
 * and that is deliberate. If the server were the looser of the two, it would
 * serve a URL the client then rejects, and the customer would see a dead flow
 * for a reason no log explains. A test asserts the two agree.
 *
 * @deprecated Import from `lib/server/destination.ts` for new code.
 */

export { isValidGoogleReviewUrl } from "@/lib/server/destination";

/**
 * The URL a printed code or an NFC tag resolves to.
 *
 * Built against the configured frontend origin and nothing from the request, so
 * it cannot become an open redirect. The token is encoded, keeping it a single
 * path segment whatever it contains.
 */
export function standUrl(frontendOrigin: string, token: string): string {
  return `${frontendOrigin}/q/${encodeURIComponent(token)}`;
}
