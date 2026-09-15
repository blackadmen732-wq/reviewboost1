/**
 * Provider-aware review destination validation, client side.
 *
 * Mirrors lib/server/destination.ts exactly. A test asserts they agree so a
 * server-valid URL is never rejected by the client and vice versa.
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
 * Returns false for unknown providers — refusing to navigate beats silently
 * sending a customer to an unvalidated host.
 */
export function isValidDestinationUrl(provider: string, value: string): boolean {
  try {
    if (value.length === 0 || value.length > 2048) return false;
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    if (provider === "google") return isValidGoogleUrl(url);
    return false;
  } catch {
    return false;
  }
}

/**
 * Backward-compatibility alias. Google is the only provider today.
 */
export function isValidatedGoogleReviewUrl(value: string): boolean {
  return isValidDestinationUrl("google", value);
}

class CustomerApiErrorForInvalidDestination extends Error {
  readonly code = "invalid_destination_url";
  readonly provider: string;

  constructor(provider: string) {
    super(`The API returned an unvalidated destination URL for provider: ${provider}`);
    this.name = "CustomerApiErrorForInvalidDestination";
    this.provider = provider;
  }
}

/**
 * Assert that a destination URL from the server is still valid before
 * navigating the customer there.
 */
export function requireValidatedDestinationUrl(provider: string, value: string): string {
  if (!isValidDestinationUrl(provider, value)) {
    throw new CustomerApiErrorForInvalidDestination(provider);
  }
  return value;
}
