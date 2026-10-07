import { describe, expect, it } from "vitest";

import { handoffOrigins } from "@/features/customer-flow/handoff-origins";

describe("handoff origins", () => {
  it("warms the review link's own host, Google sign-in and Google, once each", () => {
    expect(
      handoffOrigins("https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4"),
    ).toEqual(["https://search.google.com", "https://accounts.google.com", "https://www.google.com"]);
    expect(handoffOrigins("https://www.google.com/maps/place/x")).toEqual([
      "https://www.google.com",
      "https://accounts.google.com",
    ]);
  });

  it("carries nothing but the origin: no path, no place id", () => {
    for (const origin of handoffOrigins("https://g.page/r/CYdA1nUAexample/review")) {
      expect(origin).not.toMatch(/review|CYdA/);
    }
  });

  it("gives nothing for a value that is not a URL", () => {
    expect(handoffOrigins("not a url")).toEqual([]);
  });
});
