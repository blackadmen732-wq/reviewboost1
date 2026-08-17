const exactShortLinkHosts = new Set(["g.page", "maps.app.goo.gl"]);

export function isValidatedGoogleReviewUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;

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
