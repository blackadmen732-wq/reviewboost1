import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("review-integrity source boundaries", () => {
  it("makes the destination handoff structurally rating-blind", () => {
    const handoffSource = source(
      "features/customer-flow/screens/handoff-screen.tsx",
    );
    expect(handoffSource.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(
      /rating|reviewThreshold/i,
    );
  });

  it("keeps the customer path free of a screen between the star and the destination", () => {
    const flowSource = source("features/customer-flow/customer-flow.tsx");
    const screens = source("features/customer-flow/customer-flow-state.ts");
    expect(screens).toMatch(/export type CustomerScreen = "rating" \| "handoff";/);
    expect(flowSource).not.toMatch(/GoogleOpportunity|FinishedScreen|onContinue/);
  });

  it("never references the legacy gating DTO or endpoints", () => {
    const apiSource = source("lib/api/production-customer-flow-api.ts");
    expect(apiSource).not.toContain("reviewThreshold");
    expect(apiSource).not.toMatch(/\/q\/\{publicId\}|\/rating[\"']/);
    expect(apiSource).toContain("/api/v1/public/q/{token}/responses");
  });
});
