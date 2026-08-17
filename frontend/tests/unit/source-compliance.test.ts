import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("review-integrity source boundaries", () => {
  it("makes the Google opportunity structurally rating-blind", () => {
    const googleSource = source(
      "features/customer-flow/screens/google-opportunity.tsx",
    );
    expect(googleSource).not.toMatch(/rating|reviewThreshold/i);
  });

  it("keeps Team Praise free of prohibited customer concepts", () => {
    const praiseSource = source(
      "features/customer-flow/screens/team-praise-screen.tsx",
    );
    expect(praiseSource).not.toMatch(/rating|google|bonus|payroll|reward|ranking/i);
  });

  it("never references the legacy gating DTO or endpoints", () => {
    const apiSource = source("lib/api/production-customer-flow-api.ts");
    expect(apiSource).not.toContain("reviewThreshold");
    expect(apiSource).not.toMatch(/\/q\/\{publicId\}|\/rating[\"']/);
    expect(apiSource).toContain("/api/v1/public/q/{token}/responses");
  });
});
