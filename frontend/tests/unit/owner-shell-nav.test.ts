import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DESKTOP_NAV, MOBILE_NAV } from "@/features/dashboard/nav-items";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("OwnerShell IA", () => {
  it("desktop is Home / Feedback / Text Requests / Tags / Settings", () => {
    expect(DESKTOP_NAV.map((item) => item.label)).toEqual([
      "Home",
      "Feedback",
      "Text Requests",
      "Tags",
      "Settings",
    ]);
    expect(DESKTOP_NAV.map((item) => item.href)).toEqual([
      "/home",
      "/feedback",
      "/text-requests",
      "/stands",
      "/settings",
    ]);
  });

  it("mobile is four tabs, Settings reached by profile", () => {
    expect(MOBILE_NAV.map((item) => item.label)).toEqual([
      "Home",
      "Feedback",
      "Text Requests",
      "Tags",
    ]);
    expect(MOBILE_NAV).toHaveLength(4);
  });

  it("does not resurrect Customers or Praise in main nav", () => {
    const labels = [...DESKTOP_NAV, ...MOBILE_NAV].map((item) => item.label);
    expect(labels).not.toContain("Customers");
    expect(labels).not.toContain("Praise");
    expect(labels).not.toContain("Reviews");
    // "Team" was /praise wearing a different label.
    expect(labels).not.toContain("Team");
    expect([...DESKTOP_NAV, ...MOBILE_NAV].map((item) => item.href)).not.toContain("/praise");
  });

  it("keeps Home on existing owner-data reads", () => {
    const page = source("app/(owner)/home/page.tsx");
    expect(page).toMatch(/getOwnerCounts/);
    expect(page).toMatch(/listStands/);
    expect(page).toMatch(/listReviews/);
    expect(page).not.toMatch(/from\(["']customer_responses["']\)/);
  });
});
