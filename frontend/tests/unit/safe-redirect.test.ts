import { describe, expect, it } from "vitest";

import { safeInternalPath } from "@/lib/security/safe-redirect";

const ORIGIN = "https://app.reviewboost.com";

describe("safe redirect validation", () => {
  it("allows a normal internal path", () => {
    expect(safeInternalPath("/home", ORIGIN)).toBe("/home");
  });

  it("allows a path with query string", () => {
    expect(safeInternalPath("/settings?tab=team", ORIGIN)).toBe("/settings?tab=team");
  });

  it("allows a path with hash", () => {
    expect(safeInternalPath("/home#top", ORIGIN)).toBe("/home#top");
  });

  it("rejects protocol-relative //evil.example", () => {
    expect(safeInternalPath("//evil.example", ORIGIN)).toBe("/home");
  });

  it("rejects backslash /\\evil.example", () => {
    expect(safeInternalPath("/\\evil.example", ORIGIN)).toBe("/home");
  });

  it("rejects encoded backslash /%5Cevil.example", () => {
    expect(safeInternalPath("/%5Cevil.example", ORIGIN)).toBe("/home");
  });

  it("rejects encoded backslash /%5cevil.example (lowercase)", () => {
    expect(safeInternalPath("/%5cevil.example", ORIGIN)).toBe("/home");
  });

  it("rejects absolute external URL", () => {
    expect(safeInternalPath("https://evil.example/login", ORIGIN)).toBe("/home");
  });

  it("rejects null byte control characters", () => {
    expect(safeInternalPath("/home\x00evil", ORIGIN)).toBe("/home");
  });

  it("rejects other control characters", () => {
    expect(safeInternalPath("/home\x0Devil", ORIGIN)).toBe("/home");
  });

  it("rejects empty string", () => {
    expect(safeInternalPath("", ORIGIN)).toBe("/home");
  });

  it("rejects null", () => {
    expect(safeInternalPath(null, ORIGIN)).toBe("/home");
  });

  it("rejects undefined", () => {
    expect(safeInternalPath(undefined, ORIGIN)).toBe("/home");
  });

  it("rejects relative path without leading slash", () => {
    expect(safeInternalPath("home", ORIGIN)).toBe("/home");
  });

  it("rejects malformed percent encoding", () => {
    expect(safeInternalPath("/%ZZbad", ORIGIN)).toBe("/home");
  });

  it("uses custom fallback when provided", () => {
    expect(safeInternalPath(null, ORIGIN, "/dashboard")).toBe("/dashboard");
  });

  it("rejects URL with userinfo that could redirect", () => {
    expect(safeInternalPath("/@evil.example", ORIGIN)).toBe("/@evil.example");
  });

  it("handles deep nested paths", () => {
    expect(safeInternalPath("/feedback/abc-123/notes", ORIGIN)).toBe("/feedback/abc-123/notes");
  });
});
