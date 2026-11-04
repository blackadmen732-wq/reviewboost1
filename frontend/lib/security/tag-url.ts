/**
 * What a physical Tag may carry.
 *
 * A printed QR code or an NFC chip holds one thing: the stable ReviewBoost URL
 * `{ReviewBoost origin}/q/{public token}`. Everything behind it — the business,
 * the location, the Customer Page, the review destination — is resolved by the
 * server when a customer opens it. That is what lets an owner change their
 * Google link, their page, or where a Tag belongs without reprinting a sticker
 * or reprogramming a chip.
 *
 * So a payload that is anything else is refused before it is encoded or
 * written: a Google link, a query string, a fragment, another path, another
 * host. A Tag that pointed at Google directly would keep pointing there after
 * the owner changed their link, and would skip the rating entirely.
 *
 * The token is an opaque, high-entropy public identifier. It is not a secret:
 * anyone who scans a Tag can read it. It only chooses which Tag is being opened.
 */

/** 8–128 URL-safe characters: the same shape the public API accepts. */
const TAG_PATH = /^\/q\/[A-Za-z0-9_-]{8,128}$/;

/** Hosts a Tag must never name: every review destination provider's. */
const DESTINATION_HOST = /(^|\.)(google\.[a-z.]+|g\.page|goo\.gl|yelp\.com|facebook\.com|tripadvisor\.[a-z.]+)$/i;

export function isReviewBoostTagUrl(value: string, expectedOrigin?: string): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return false;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return false;
  if (url.username || url.password) return false;
  // Nothing but the path: a query or fragment is data a Tag has no business
  // carrying, and the first place a smuggled destination would go.
  if (url.search || url.hash || value.includes("?") || value.includes("#")) return false;
  if (!TAG_PATH.test(url.pathname)) return false;
  if (DESTINATION_HOST.test(url.hostname.replace(/\.$/, ""))) return false;
  if (expectedOrigin !== undefined && url.origin !== expectedOrigin) return false;

  return true;
}
