import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("review-integrity source boundaries", () => {
  it("never references the legacy gating DTO or endpoints", () => {
    const apiSource = source("lib/api/production-customer-flow-api.ts");
    expect(apiSource).not.toContain("reviewThreshold");
    expect(apiSource).not.toMatch(/\/q\/\{publicId\}|\/rating[\"']/);
    expect(apiSource).toContain("/api/v1/public/q/{token}/responses");
  });

  it("sends every rating to the same Google destination", () => {
    const flowSource = source("features/customer-flow/customer-flow.tsx");
    expect(flowSource).not.toMatch(/reviewThreshold|ratingGate/i);
    expect(flowSource).toContain("window.location.assign");
  });
});
