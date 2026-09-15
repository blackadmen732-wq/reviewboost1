import "server-only";

/**
 * Provider-aware review destination validation.
 *
 * ReviewBoost owns the door (/q/{token}). The door opens to a room — the
 * destination the owner chose. Google is the first room. The allowlist pattern
 * ensures a compromised dashboard cannot turn a printed code into a phishing lure.
 *
 * Adding a new provider later is an allowlist change plus an owner paste, not a
 * new product.
 */

export const DESTINATION_PROVIDERS = ["google"] as const;
export type DestinationProvider = (typeof DESTINATION_PROVIDERS)[number];

export interface ReviewDestination {
  provider: DestinationProvider;
  url: string;
}

const GOOGLE_SHORT_LINK_HOSTS = new Set(["g.page", "maps.app.goo.gl"]);

function isValidGoogleUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (GOOGLE_SHORT_LINK_HOSTS.has(host)) return true;
  if (host === "search.google.com") {
    return url.pathname === "/local/writereview" && Boolean(url.searchParams.get("placeid"));
  }
  if (host === "www.google.com" || host === "maps.google.com") {
    return url.pathname.startsWith("/maps/");
  }
  return false;
}

/**
 * Validate a destination URL for a given provider.
 *
 * Returns false for unknown providers — refusing to serve beats silently
 * redirecting to an unvalidated host.
 */
export function isValidDestinationUrl(provider: string, value: string): boolean {
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

  if (provider === "google") return isValidGoogleUrl(url);

  return false; // Unknown provider — fail closed.
}

/**
 * Build a ReviewDestination from a legacy google_review_url column value.
 *
 * Returns null when the URL is absent, empty, or does not pass the allowlist
 * check — a stand without a valid destination cannot open the door.
 */
export function destinationFromGoogleUrl(
  googleReviewUrl: string | null | undefined,
): ReviewDestination | null {
  if (!googleReviewUrl || googleReviewUrl === "") return null;
  if (!isValidDestinationUrl("google", googleReviewUrl)) return null;
  return { provider: "google", url: googleReviewUrl };
}

/**
 * Backward-compatibility alias. Google is the only provider today.
 */
export function isValidGoogleReviewUrl(value: string): boolean {
  return isValidDestinationUrl("google", value);
}
