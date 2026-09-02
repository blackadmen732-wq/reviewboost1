import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const load = () => import("@/lib/server/sms/keywords");

describe("STOP/START/HELP classification", () => {
  it("recognises STOP forms regardless of case and surrounding text", async () => {
    const { classifyKeyword } = await load();
    for (const s of ["STOP", "stop", "  Stop  ", "STOP please", "Stop!", "unsubscribe", "CANCEL", "quit", "end"]) {
      expect(classifyKeyword(s)).toBe("stop");
    }
  });

  it("recognises the OPT OUT two-word and hyphenated forms", async () => {
    const { classifyKeyword } = await load();
    expect(classifyKeyword("opt out")).toBe("stop");
    expect(classifyKeyword("OPT-OUT")).toBe("stop");
    expect(classifyKeyword("optout")).toBe("stop");
  });

  it("recognises START forms", async () => {
    const { classifyKeyword } = await load();
    for (const s of ["START", "start", "YES", "unstop", "subscribe", "opt in", "OPT-IN", "optin"]) {
      expect(classifyKeyword(s)).toBe("start");
    }
  });

  it("recognises HELP forms", async () => {
    const { classifyKeyword } = await load();
    expect(classifyKeyword("HELP")).toBe("help");
    expect(classifyKeyword("info")).toBe("help");
  });

  it("does not fuzzy-match: a keyword must be the first word", async () => {
    const { classifyKeyword } = await load();
    expect(classifyKeyword("please stop texting me")).toBe("none"); // stop is not first
    expect(classifyKeyword("stopwatch")).toBe("none"); // not the whole first word
    expect(classifyKeyword("i want to help")).toBe("none");
    expect(classifyKeyword("restart")).toBe("none");
  });

  it("treats empty and null input as no keyword", async () => {
    const { classifyKeyword } = await load();
    expect(classifyKeyword("")).toBe("none");
    expect(classifyKeyword(null)).toBe("none");
    expect(classifyKeyword(undefined)).toBe("none");
    expect(classifyKeyword("   ")).toBe("none");
  });
});
