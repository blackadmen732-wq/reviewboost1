import { describe, expect, it, vi } from "vitest";

import {
  canOpenGoogleReviewUrl,
  googleLinkDisplay,
  googleLinkRefusal,
  googleLinkState,
  GOOGLE_LINK_EMPTY,
  GOOGLE_LINK_INVALID,
  openGoogleReviewUrl,
} from "@/features/dashboard/google-link-copy";

describe("googleLinkState", () => {
  it("returns missing for null", () => {
    expect(googleLinkState(null)).toBe("missing");
  });

  it("returns missing for undefined", () => {
    expect(googleLinkState(undefined)).toBe("missing");
  });

  it("returns missing for empty string", () => {
    expect(googleLinkState("")).toBe("missing");
  });

  it("returns missing for whitespace", () => {
    expect(googleLinkState("   ")).toBe("missing");
  });

  it("returns valid for a g.page link", () => {
    expect(googleLinkState("https://g.page/r/abc123")).toBe("valid");
  });

  it("returns valid for maps.app.goo.gl", () => {
    expect(googleLinkState("https://maps.app.goo.gl/abc")).toBe("valid");
  });

  it("returns valid for search.google.com/local/writereview with placeid", () => {
    expect(
      googleLinkState("https://search.google.com/local/writereview?placeid=ChIJ123"),
    ).toBe("valid");
  });

  it("returns invalid for a random URL", () => {
    expect(googleLinkState("https://example.com")).toBe("invalid");
  });

  it("returns invalid for a non-URL string", () => {
    expect(googleLinkState("not a url")).toBe("invalid");
  });
});

describe("googleLinkDisplay", () => {
  it("returns the value when present", () => {
    expect(googleLinkDisplay("https://g.page/r/abc")).toBe("https://g.page/r/abc");
  });

  it("returns empty message for null", () => {
    expect(googleLinkDisplay(null)).toBe(GOOGLE_LINK_EMPTY);
  });

  it("returns empty message for empty string", () => {
    expect(googleLinkDisplay("")).toBe(GOOGLE_LINK_EMPTY);
  });
});

describe("googleLinkRefusal", () => {
  it("returns empty message for missing", () => {
    expect(googleLinkRefusal("missing")).toBe(GOOGLE_LINK_EMPTY);
  });

  it("returns invalid message for invalid", () => {
    expect(googleLinkRefusal("invalid")).toBe(GOOGLE_LINK_INVALID);
  });

  it("returns null for valid", () => {
    expect(googleLinkRefusal("valid")).toBeNull();
  });
});

describe("canOpenGoogleReviewUrl", () => {
  it("returns true for a valid google link", () => {
    expect(canOpenGoogleReviewUrl("https://g.page/r/abc")).toBe(true);
  });

  it("returns false for a random URL", () => {
    expect(canOpenGoogleReviewUrl("https://example.com")).toBe(false);
  });
});

describe("openGoogleReviewUrl", () => {
  it("opens a new window for valid URLs", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);

    const state = openGoogleReviewUrl("https://g.page/r/abc123");
    expect(state).toBe("valid");
    expect(open).toHaveBeenCalledWith(
      "https://g.page/r/abc123",
      "_blank",
      "noopener,noreferrer",
    );

    vi.unstubAllGlobals();
  });

  it("does not open a window for invalid URLs", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);

    const state = openGoogleReviewUrl("https://example.com");
    expect(state).toBe("invalid");
    expect(open).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("does not open a window for missing URLs", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);

    const state = openGoogleReviewUrl("");
    expect(state).toBe("missing");
    expect(open).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
