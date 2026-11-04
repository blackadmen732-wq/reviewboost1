import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ownerGoogleLinkFlagsForAll } from "@/lib/server/owner-data";

/**
 * Home's "Google link is missing" covers every place. It used to read only the
 * first location, so a second place with no link — whose Tags send nobody to
 * Google — never showed up as something that needed the owner.
 */
describe("the Google link across every place", () => {
  const good = "https://g.page/r/abcdef/review";

  it("is set only when every place has a valid link", () => {
    expect(ownerGoogleLinkFlagsForAll([good, good])).toEqual({
      hasGoogleLink: true,
      googleLinkInvalid: false,
      googleLinkNeedsUpgrade: false,
    });
    expect(ownerGoogleLinkFlagsForAll([good, null])).toEqual({
      hasGoogleLink: false,
      googleLinkInvalid: false,
      googleLinkNeedsUpgrade: false,
    });
  });

  it("reads as wrong when any place has a wrong link", () => {
    expect(ownerGoogleLinkFlagsForAll([good, "https://evil.example/r"])).toEqual({
      hasGoogleLink: false,
      googleLinkInvalid: true,
      googleLinkNeedsUpgrade: false,
    });
  });

  it("reads as missing with no places at all", () => {
    expect(ownerGoogleLinkFlagsForAll([])).toEqual({
      hasGoogleLink: false,
      googleLinkInvalid: false,
      googleLinkNeedsUpgrade: false,
    });
  });

  it("counts a legacy listing or short link as set — its Tags work — and flags the upgrade", () => {
    const legacy = "https://www.google.com/maps/place/Corner+Cafe";
    expect(ownerGoogleLinkFlagsForAll([good, legacy])).toEqual({
      hasGoogleLink: true,
      googleLinkInvalid: false,
      googleLinkNeedsUpgrade: true,
    });
    expect(ownerGoogleLinkFlagsForAll([good, good]).googleLinkNeedsUpgrade).toBe(false);
  });
});
