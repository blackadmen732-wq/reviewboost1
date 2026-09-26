import { describe, expect, it, vi } from "vitest";

import {
  GOOGLE_LINK_EMPTY,
  GOOGLE_LINK_INVALID,
  GOOGLE_LINK_LEGACY,
  canOpenGoogleReviewUrl,
  googleLinkDisplay,
  googleLinkRefusal,
  googleLinkState,
  googleLinkWorks,
  openGoogleReviewUrl,
} from "@/features/dashboard/google-link-copy";

const valid = "https://g.page/r/CornerCafe/review";
/** Saved before review links were required: still works, needs an upgrade. */
const legacy = "https://g.page/corner-cafe";
const invalid = "https://evil.example/reviews";

describe("googleLinkState", () => {
  it("names missing, invalid, and valid", () => {
    expect(googleLinkState(null)).toBe("missing");
    expect(googleLinkState("")).toBe("missing");
    expect(googleLinkState("   ")).toBe("missing");
    expect(googleLinkState(invalid)).toBe("invalid");
    expect(googleLinkState("https://example.com")).toBe("invalid");
    expect(googleLinkState(valid)).toBe("valid");
  });

  it("names a working listing or short link as legacy — open, not broken", () => {
    for (const url of [
      legacy,
      "https://maps.app.goo.gl/abc123",
      "https://www.google.com/maps/place/Corner+Cafe",
    ]) {
      expect(googleLinkState(url), url).toBe("legacy");
      expect(googleLinkWorks(googleLinkState(url)), url).toBe(true);
      expect(canOpenGoogleReviewUrl(url), url).toBe(true);
    }
    expect(googleLinkRefusal("legacy")).toBeNull();
    expect(googleLinkWorks("invalid")).toBe(false);
    expect(googleLinkWorks("missing")).toBe(false);
  });

  it("says the legacy link still works and that Tags do not change", () => {
    expect(GOOGLE_LINK_LEGACY).toMatch(/still works/);
    expect(GOOGLE_LINK_LEGACY).toMatch(/review box/);
    expect(GOOGLE_LINK_LEGACY).toMatch(/printed codes and NFC Tags stay the same/);
  });

  it("will not treat a present-but-wrong address as openable", () => {
    expect(canOpenGoogleReviewUrl(invalid)).toBe(false);
    expect(canOpenGoogleReviewUrl("https://not-google.com")).toBe(false);
    expect(canOpenGoogleReviewUrl(valid)).toBe(true);
    expect(googleLinkDisplay(null)).toBe(GOOGLE_LINK_EMPTY);
    expect(googleLinkDisplay(invalid)).toBe(invalid);
    expect(googleLinkRefusal("missing")).toBe(GOOGLE_LINK_EMPTY);
    expect(googleLinkRefusal("invalid")).toBe(GOOGLE_LINK_INVALID);
    expect(googleLinkRefusal("valid")).toBeNull();
  });

  it("never opens an invalid or missing link", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);

    expect(openGoogleReviewUrl("")).toBe("missing");
    expect(openGoogleReviewUrl(invalid)).toBe("invalid");
    expect(open).not.toHaveBeenCalled();

    expect(openGoogleReviewUrl(valid)).toBe("valid");
    expect(open).toHaveBeenCalledWith(valid, "_blank", "noopener,noreferrer");

    vi.unstubAllGlobals();
  });
});
