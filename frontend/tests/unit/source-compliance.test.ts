import { readFileSync, readdirSync } from "node:fs";
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

  it("offers the customer no screen beyond rating and Google", () => {
    const screens = readdirSync(join(process.cwd(), "features/customer-flow/screens"));

    // V1 collects a rating and nothing else. A new screen here is how a note
    // box or a praise form comes back, so the set is asserted exactly rather
    // than checked for the absence of a particular file.
    expect(screens.sort()).toEqual([
      "finished-screen.tsx",
      "google-opportunity.tsx",
      "rating-screen.tsx",
    ]);
  });

  it("keeps the rating screen free of a text input", () => {
    const ratingSource = source("features/customer-flow/screens/rating-screen.tsx");
    expect(ratingSource).not.toMatch(/Textarea|<input|onNoteChange/);
  });

  it("never references the legacy gating DTO or endpoints", () => {
    const apiSource = source("lib/api/production-customer-flow-api.ts");
    expect(apiSource).not.toContain("reviewThreshold");
    expect(apiSource).not.toMatch(/\/q\/\{publicId\}|\/rating[\"']/);
    expect(apiSource).toContain("/api/v1/public/q/{token}/responses");
  });
});
