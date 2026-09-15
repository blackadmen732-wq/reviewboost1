import { describe, expect, it } from "vitest";

import { isValidatedGoogleReviewUrl, isValidDestinationUrl } from "@/lib/security/destination";

/**
 * Destination validation tests.
 *
 * Tests run against the client-side module (lib/security/destination.ts).
 * A separate source-compliance test asserts the server module
 * (lib/server/destination.ts) contains the same allowlist logic.
 */

describe("isValidDestinationUrl — Google provider", () => {
  it.each([
    "https://search.google.com/local/writereview?placeid=abc123",
    "https://g.page/r/example/review",
    "https://maps.app.goo.gl/abc123",
    "https://www.google.com/maps/place/example",
    "https://maps.google.com/maps/place/example",
  ])("allows a recognised Google HTTPS destination: %s", (url) => {
    expect(isValidDestinationUrl("google", url)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "http://search.google.com/local/writereview?placeid=abc123",
    "https://google.com.evil.example/maps/place/example",
    "https://search.google.com/local/writereview",
    "https://example.com/google-review",
    "",
    "not-a-url",
  ])("rejects an untrusted or malformed destination: %s", (url) => {
    expect(isValidDestinationUrl("google", url)).toBe(false);
  });

  it("rejects a URL with credentials in the authority", () => {
    expect(
      isValidDestinationUrl("google", "https://user:pass@www.google.com/maps/place/foo"),
    ).toBe(false);
  });

  it("rejects a URL longer than 2048 characters", () => {
    const url = `https://g.page/${"a".repeat(2048)}`;
    expect(isValidDestinationUrl("google", url)).toBe(false);
  });
});

describe("isValidDestinationUrl — unknown provider", () => {
  it("fails closed for an unknown provider even with a valid-looking URL", () => {
    expect(isValidDestinationUrl("apple", "https://apps.apple.com/review")).toBe(false);
    expect(isValidDestinationUrl("yelp", "https://yelp.com/biz/example")).toBe(false);
    expect(isValidDestinationUrl("", "https://www.google.com/maps/place/foo")).toBe(false);
  });
});

describe("isValidatedGoogleReviewUrl backward-compat alias", () => {
  it("accepts the same URLs as isValidDestinationUrl('google', ...)", () => {
    const urls = [
      "https://search.google.com/local/writereview?placeid=abc123",
      "https://g.page/r/example/review",
      "https://maps.app.goo.gl/abc123",
      "https://www.google.com/maps/place/example",
    ];
    for (const url of urls) {
      expect(isValidatedGoogleReviewUrl(url)).toBe(isValidDestinationUrl("google", url));
    }
  });
});
