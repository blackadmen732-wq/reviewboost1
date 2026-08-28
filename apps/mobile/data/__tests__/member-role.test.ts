import { describe, it, expect } from "vitest";
import { MEMBER_ROLES, parseMemberRole, type MemberRole } from "../types";

describe("parseMemberRole", () => {
  it.each(MEMBER_ROLES)("accepts canonical role %s", (role) => {
    expect(parseMemberRole(role)).toBe(role);
  });

  it("returns the correct type for each role", () => {
    const result: MemberRole = parseMemberRole("viewer");
    expect(result).toBe("viewer");
  });

  it("rejects the old mobile-only role 'manager'", () => {
    expect(() => parseMemberRole("manager")).toThrow(RangeError);
  });

  it("rejects the old mobile-only role 'staff'", () => {
    expect(() => parseMemberRole("staff")).toThrow(RangeError);
  });

  it("rejects an empty string", () => {
    expect(() => parseMemberRole("")).toThrow(RangeError);
  });

  it("rejects null", () => {
    expect(() => parseMemberRole(null)).toThrow(RangeError);
  });

  it("rejects undefined", () => {
    expect(() => parseMemberRole(undefined)).toThrow(RangeError);
  });

  it("rejects a number", () => {
    expect(() => parseMemberRole(0)).toThrow(RangeError);
  });

  it("includes the unexpected value in the error message", () => {
    expect(() => parseMemberRole("superadmin")).toThrow(/superadmin/);
  });
});

describe("MEMBER_ROLES", () => {
  it("contains exactly the four database roles", () => {
    expect([...MEMBER_ROLES]).toEqual(["owner", "admin", "member", "viewer"]);
  });
});
