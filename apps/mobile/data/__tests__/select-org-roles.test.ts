import { describe, it, expect } from "vitest";
import { MEMBER_ROLES, parseMemberRole, type MemberRole } from "../types";
import type { Organization } from "../types";

function buildOrg(role: MemberRole, index: number): Organization {
  return {
    orgId: `org-${index}`,
    name: `Org ${role}`,
    timezone: "UTC",
    role,
  };
}

describe("select-org role contract", () => {
  it("all four canonical roles produce valid Organization objects", () => {
    const orgs = MEMBER_ROLES.map((r, i) => buildOrg(r, i));
    expect(orgs).toHaveLength(4);
    for (const org of orgs) {
      expect(org.role).toBeTruthy();
      expect(typeof org.role).toBe("string");
      expect(MEMBER_ROLES).toContain(org.role);
    }
  });

  it("role values are non-empty and suitable for display", () => {
    for (const role of MEMBER_ROLES) {
      expect(role.length).toBeGreaterThan(0);
      expect(role).not.toBe("undefined");
      expect(role).not.toBe("null");
    }
  });

  it("parseMemberRole→Organization pipeline works for all four roles", () => {
    const orgs = MEMBER_ROLES.map((raw, i) => {
      const role = parseMemberRole(raw);
      return buildOrg(role, i);
    });
    expect(orgs.map((o) => o.role)).toEqual(["owner", "admin", "member", "viewer"]);
  });

  it("old mobile-only roles cannot enter the organization list", () => {
    expect(() => parseMemberRole("manager")).toThrow(RangeError);
    expect(() => parseMemberRole("staff")).toThrow(RangeError);
  });

  it("no role value would display as undefined or empty in the UI", () => {
    const orgs = MEMBER_ROLES.map((r, i) => buildOrg(parseMemberRole(r), i));
    for (const org of orgs) {
      expect(org.role).toBeDefined();
      expect(org.role).not.toBe("");
    }
  });

  it("capitalize transform produces correct display labels", () => {
    const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const labels = MEMBER_ROLES.map(capitalize);
    expect(labels).toEqual(["Owner", "Admin", "Member", "Viewer"]);
  });
});
