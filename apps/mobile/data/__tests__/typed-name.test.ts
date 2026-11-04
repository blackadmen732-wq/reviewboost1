import { describe, expect, it } from "vitest";

import { sameTypedName } from "../../lib/typed-name";

describe("sameTypedName (deleting a business by typing its name)", () => {
  it("matches the iPhone's curly apostrophe against a straight one, both ways", () => {
    expect(sameTypedName("Rosa’s Hair Studio", "Rosa's Hair Studio")).toBe(true);
    expect(sameTypedName("Rosa's Hair Studio", "Rosa’s Hair Studio")).toBe(true);
    expect(sameTypedName("“Cuts” & Co", '"Cuts" & Co')).toBe(true);
  });

  it("ignores case, outer spaces and runs of spaces", () => {
    expect(sameTypedName("  rosa's   HAIR studio ", "Rosa's Hair Studio")).toBe(true);
  });

  it("still needs the name itself", () => {
    expect(sameTypedName("Rosas Hair Studio", "Rosa's Hair Studio")).toBe(false);
    expect(sameTypedName("Rosa's Hair", "Rosa's Hair Studio")).toBe(false);
  });

  it("never matches an empty name", () => {
    expect(sameTypedName("", "")).toBe(false);
    expect(sameTypedName("   ", " ")).toBe(false);
  });
});
