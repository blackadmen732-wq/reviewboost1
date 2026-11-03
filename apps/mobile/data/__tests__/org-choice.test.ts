import { describe, expect, it } from "vitest";
import { chooseActiveOrg } from "../org-choice";
import type { Organization } from "../types";

const pizza: Organization = { orgId: "org-pizza", name: "Mario's Pizza", timezone: "America/New_York", role: "owner" };
const cafe: Organization = { orgId: "org-cafe", name: "Corner Cafe", timezone: "America/New_York", role: "admin" };

describe("which business the app opens on", () => {
  it("opens the only business without asking", () => {
    expect(chooseActiveOrg(null, [pizza], null)).toBe(pizza);
  });

  it("asks when there are several and nothing was chosen before", () => {
    expect(chooseActiveOrg(null, [pizza, cafe], null)).toBeNull();
  });

  it("reopens the business chosen last time", () => {
    expect(chooseActiveOrg(null, [pizza, cafe], "org-cafe")).toBe(cafe);
  });

  it("never opens a business the person no longer belongs to", () => {
    expect(chooseActiveOrg(null, [pizza, cafe], "org-gone")).toBeNull();
    expect(chooseActiveOrg({ ...cafe }, [pizza], null)).toBe(pizza);
    expect(chooseActiveOrg(null, [], "org-pizza")).toBeNull();
  });

  it("keeps the open business, with its latest name and role", () => {
    const renamed = { ...pizza, name: "Mario's", role: "admin" as const };
    expect(chooseActiveOrg(pizza, [renamed, cafe], "org-cafe")).toBe(renamed);
  });
});
