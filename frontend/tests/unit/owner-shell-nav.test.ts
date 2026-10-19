import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DESKTOP_NAV,
  MOBILE_NAV,
  TEXT_REQUESTS,
  mobileLabelOf,
} from "@/features/dashboard/nav-items";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("OwnerShell IA", () => {
  it("desktop is Home / Feedback / Text Requests / Set up / Settings", () => {
    expect(DESKTOP_NAV.map((item) => item.label)).toEqual([
      "Home",
      "Feedback",
      "Text Requests",
      "Set up",
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
    // The phone bar's own labels, locked separately from the desktop ones:
    // "Text Requests" wrapped to two lines at 320px, so the bar says "Texts".
    expect(MOBILE_NAV.map(mobileLabelOf)).toEqual(["Home", "Feedback", "Texts", "Set up"]);
    expect(MOBILE_NAV.map((item) => item.href)).toEqual([
      "/home",
      "/feedback",
      "/text-requests",
      "/stands",
    ]);
    expect(MOBILE_NAV).toHaveLength(4);
  });

  it("shortens only the phone bar's label, not the feature", () => {
    // Same destination, same route; the sidebar and page keep the full name.
    expect(TEXT_REQUESTS.label).toBe("Text Requests");
    expect(TEXT_REQUESTS.href).toBe("/text-requests");
    expect(DESKTOP_NAV.map(mobileLabelOf)).not.toEqual(DESKTOP_NAV.map((item) => item.label));
    expect(source("app/(owner)/text-requests/page.tsx")).toContain('title: "Text Requests"');
    expect(source("features/dashboard/desktop-sidebar.tsx")).toContain("item.label");
    expect(source("features/dashboard/bottom-nav.tsx")).toContain("mobileLabelOf(item)");
  });

  it("does not resurrect Customers or Praise in main nav", () => {
    const labels = [
      ...DESKTOP_NAV.map((item) => item.label),
      ...MOBILE_NAV.map(mobileLabelOf),
    ];
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
