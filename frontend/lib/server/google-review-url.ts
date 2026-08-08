import "server-only";

/**
 * Server-side Google review destination validation.
 *
 * This URL is handed to a customer's browser, so an unvalidated one turns the
 * business's own printed QR code into a phishing lure — a sticker over a code,
 * or a compromised dashboard field, and every scanner goes wherever the
 * attacker chose.
 *
 * The allowlist matches `lib/security/google-review-url.ts` on the client
 * exactly, and that is deliberate. If the server were the looser of the two, it
 * would serve a URL the client then rejects, and the customer would see a dead
 * flow for a reason no log explains. A test asserts the two agree.
 */

const SHORT_LINK_HOSTS = new Set(["g.page", "maps.app.goo.gl"]);

export function isValidGoogleReviewUrl(value: string): boolean {
  if (value.length === 0 || value.length > 2048) return false;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  // Credentials in the authority are a phishing primitive:
  // https://www.google.com@evil.example is not Google, and a hostname check
  // alone would not catch it.
  if (url.protocol !== "https:" || url.username || url.password) return false;

  const host = url.hostname.toLowerCase().replace(/\.$/, "");

  if (SHORT_LINK_HOSTS.has(host)) return true;

  if (host === "search.google.com") {
    return url.pathname === "/local/writereview" && Boolean(url.searchParams.get("placeid"));
  }

  if (host === "www.google.com" || host === "maps.google.com") {
    return url.pathname.startsWith("/maps/");
  }

  return false;
}

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
