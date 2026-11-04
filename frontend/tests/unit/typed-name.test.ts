import { describe, expect, it } from "vitest";

import { sameTypedName } from "@/lib/utils/typed-name";

describe("sameTypedName", () => {
  it("matches an iPhone's curly apostrophe to a straight one, and back", () => {
    expect(sameTypedName("Tony’s Barber & Shave", "Tony's Barber & Shave")).toBe(true);
    expect(sameTypedName("tony's barber & shave", "Tony’s Barber & Shave")).toBe(true);
  });

  it("ignores case and extra spaces, never a different name", () => {
    expect(sameTypedName("  mario's   pizza ", "Mario's Pizza")).toBe(true);
    expect(sameTypedName("Mario's Pizz", "Mario's Pizza")).toBe(false);
    expect(sameTypedName("", "")).toBe(false);
  });
});
