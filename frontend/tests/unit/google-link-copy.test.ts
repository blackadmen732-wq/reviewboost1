import { describe, expect, it, vi } from "vitest";

import {
  GOOGLE_LINK_EMPTY,
  GOOGLE_LINK_INVALID,
  canOpenGoogleReviewUrl,
  googleLinkDisplay,
  googleLinkRefusal,
  googleLinkState,
  openGoogleReviewUrl,
} from "@/features/dashboard/google-link-copy";

const valid = "https://g.page/corner-cafe";
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
