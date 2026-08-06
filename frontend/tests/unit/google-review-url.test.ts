import { describe, expect, it } from "vitest";

import { isValidatedGoogleReviewUrl } from "@/lib/security/google-review-url";

describe("Google review URL validation", () => {
  it.each([
    "https://search.google.com/local/writereview?placeid=abc123",
    "https://g.page/r/example/review",
    "https://maps.app.goo.gl/abc123",
    "https://www.google.com/maps/place/example",
  ])("allows a recognized HTTPS Google destination: %s", (url) => {
    expect(isValidatedGoogleReviewUrl(url)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "http://search.google.com/local/writereview?placeid=abc123",
    "https://google.com.evil.example/maps/place/example",
    "https://search.google.com/local/writereview",
    "https://example.com/google-review",
  ])("rejects an untrusted destination: %s", (url) => {
    expect(isValidatedGoogleReviewUrl(url)).toBe(false);
  });
});

