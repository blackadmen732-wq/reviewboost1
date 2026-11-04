const exactShortLinkHosts = new Set(["g.page", "maps.app.goo.gl"]);

export function isValidatedGoogleReviewUrl(value: string): boolean {
  try {
    const url = new URL(value);
    // Port refused for the same reason the server and the database refuse one:
    // three validators that disagree mean the loosest is the real policy.
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;

    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (exactShortLinkHosts.has(host)) return true;

    if (host === "search.google.com") {
      return url.pathname === "/local/writereview" && Boolean(url.searchParams.get("placeid"));
    }

    if (host === "www.google.com" || host === "maps.google.com") {
      return url.pathname.startsWith("/maps/");
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * A Google link that opens the review-writing box for one place — the only
 * kind ReviewBoost accepts when a destination is set or changed:
 *
 *   https://search.google.com/local/writereview?placeid=<place id>
 *   https://g.page/r/<profile id>/review
 *
 * A Maps listing (www.google.com/maps/…) opens the place page, where writing a
 * review is several taps further, and an opaque short link (maps.app.goo.gl,
 * g.page/<name>) can lead anywhere its owner re-points it. Both still resolve
 * for destinations saved before this rule, so no Tag in the field goes dark;
 * neither can be saved again. Mirrors public._is_google_review_writing_url.
 */
export function isGoogleReviewWritingUrl(value: string): boolean {
  if (!isValidatedGoogleReviewUrl(value)) return false;
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");

  if (host === "search.google.com") {
    return url.pathname === "/local/writereview" && /^[A-Za-z0-9_-]+$/.test(url.searchParams.get("placeid") ?? "");
  }
  if (host === "g.page") {
    return /^\/r\/[A-Za-z0-9_-]+\/review\/?$/.test(url.pathname);
  }
  return false;
}

export function requireValidatedGoogleReviewUrl(value: string): string {
  if (!isValidatedGoogleReviewUrl(value)) {
    throw new CustomerApiErrorForInvalidGoogleUrl();
  }
  return value;
}

class CustomerApiErrorForInvalidGoogleUrl extends Error {
  readonly code = "invalid_google_review_url";

  constructor() {
    super("The API returned an unvalidated Google review URL.");
    this.name = "CustomerApiErrorForInvalidGoogleUrl";
  }
}
