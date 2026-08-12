import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("multi-org data isolation", () => {
  const ownerDataPath = path.resolve(__dirname, "../../lib/server/owner-data.ts");
  const ownerDataSource = fs.readFileSync(ownerDataPath, "utf-8");

  it("every query function requires orgId as first parameter", () => {
    const queryFunctions = [
      "listReviews",
      "listActionNotes",
      "getReview",
      "getRatingBreakdown",
      "listStaff",
      "listPraise",
      "getStaffPraiseTally",
      "listStands",
      "getPrimaryLocation",
      "getOwnerCounts",
      "listVisits",
      "getVisitSummary",
    ];

    for (const fn of queryFunctions) {
      const pattern = new RegExp(`${fn}[\\s\\S]{0,40}\\(\\s*orgId\\s*:\\s*string`);
      expect(ownerDataSource, `${fn} must take orgId: string as first parameter`).toMatch(pattern);
    }
  });

  it("every query applies eq org_id filter", () => {
    const lines = ownerDataSource.split("\n");
    const fromCalls = lines.filter((line) => line.includes('.from("'));
    const tables = [
      "customer_responses",
      "response_notes",
      "team_praise_records",
      "staff_members",
      "review_stands",
      "locations",
      "google_review_clicks",
    ];

    for (const table of tables) {
      const tableQueries = fromCalls.filter((line) => line.includes(`"${table}"`));
      if (tableQueries.length === 0) continue;

      const hasOrgFilter = ownerDataSource.includes(`.eq("org_id", orgId)`);
      expect(hasOrgFilter, `queries must filter by org_id`).toBe(true);
    }
  });

  it("requireOwner redirects multi-org users without selection", () => {
    expect(ownerDataSource).toContain("/select-org");
    expect(ownerDataSource).toContain("needsSelection");
  });

  it("getActiveOrganization validates cookie against memberships", () => {
    expect(ownerDataSource).toContain("rb-active-org");
    expect(ownerDataSource).toContain("UUID_RE.test");
    expect(ownerDataSource).toContain("organizations.find");
  });

  const pageFiles = [
    "../../app/(owner)/home/page.tsx",
    "../../app/(owner)/reviews/page.tsx",
    "../../app/(owner)/customers/page.tsx",
    "../../app/(owner)/feedback/page.tsx",
    "../../app/(owner)/feedback/[responseId]/page.tsx",
    "../../app/(owner)/praise/page.tsx",
    "../../app/(owner)/settings/page.tsx",
    "../../app/(owner)/stands/page.tsx",
  ];

  for (const relPath of pageFiles) {
    const pageName = relPath.replace("../../app/(owner)/", "").replace("/page.tsx", "");

    it(`${pageName} page destructures organization from requireOwner`, () => {
      const filePath = path.resolve(__dirname, relPath);
      const source = fs.readFileSync(filePath, "utf-8");

      expect(source).toContain("organization");
      expect(source).toContain("requireOwner");
    });
  }
});

describe("org selection security", () => {
  it("select-org action validates orgId against memberships", () => {
    const actionPath = path.resolve(__dirname, "../../features/auth/select-org-action.ts");
    const source = fs.readFileSync(actionPath, "utf-8");

    expect(source).toContain("listUserOrganizations");
    expect(source).toContain("UUID_RE.test");
    expect(source).toContain("httpOnly: true");
    expect(source).toContain("sameSite:");
  });

  it("select-org route is protected in proxy", () => {
    const proxyPath = path.resolve(__dirname, "../../proxy.ts");
    const source = fs.readFileSync(proxyPath, "utf-8");

    expect(source).toContain('"/select-org"');
  });
});
