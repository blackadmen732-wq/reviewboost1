import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The customer fast path is a product promise, not a preference: one star tap,
 * a saved private rating, the same Google opportunity for 1★ as for 5★. Those
 * are properties of the source, so they are tested against the source. A render
 * test only proves the screen you thought to render; this proves nobody quietly
 * added a branch, a second question, or a threshold anywhere in the section.
 */

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function customerSection(): Array<{ path: string; text: string }> {
  const roots = ["features/customer-page", "lib/customer-page"];
  const files: Array<{ path: string; text: string }> = [];

  for (const root of roots) {
    for (const entry of readdirSync(join(process.cwd(), root), {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      files.push({ path, text: readFileSync(path, "utf8") });
    }
  }

  expect(files.length).toBeGreaterThan(8);
  return files;
}

/** Comments describe the rules; only shipped code has to obey them. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("customer fast path source boundaries", () => {
  it("never branches on the rating value", () => {
    // `star-rating` is the one place the number is allowed to decide anything,
    // and what it decides is how many stars are gold.
    const flowFiles = customerSection().filter(
      (file) => !file.path.endsWith("star-rating.tsx"),
    );

    for (const file of flowFiles) {
      expect.soft(code(file.text), file.path).not.toMatch(
        /rating\s*(?:>=|<=|>|<)|(?:>=|<=|>|<)\s*rating|reviewThreshold/,
      );
    }
  });

  it("gives every rating the same Google handoff", () => {
    const client = code(source("features/customer-page/customer-page-client.tsx"));

    // One destination, read straight off the context, never chosen.
    const destinations = client.match(/location\.assign\([^)]*\)/g) ?? [];
    expect(destinations).toHaveLength(1);
    expect(destinations[0]).toContain("googleReviewUrl");
  });

  it("keeps the forbidden steps out of the customer section", () => {
    // PART 2 of the spec, enumerated: anything here is a step between the tap
    // and Google, and the tap is meant to be the whole decision.
    const forbidden: Array<[string, RegExp]> = [
      ["free-text note field", /<textarea|noteLabel|privateNote/i],
      ["second question or continue step", /continueButton|onContinue|nextStep/i],
      ["team praise step", /teamPraise|praiseScreen/i],
      ["thank-you screen before Google", /thankYou|finishedScreen/i],
      ["account or contact capture", /\btype="(?:email|tel|password)"|signIn|createAccount/i],
      ["progress indicator", /progressBar|stepIndicator|currentStep/i],
    ];

    for (const file of customerSection()) {
      for (const [what, pattern] of forbidden) {
        expect.soft(code(file.text), `${file.path} — ${what}`).not.toMatch(pattern);
      }
    }
  });

  it("never references the legacy gating DTO or endpoints", () => {
    const apiSource = source("lib/api/production-customer-flow-api.ts");
    expect(apiSource).not.toContain("reviewThreshold");
    expect(apiSource).not.toMatch(/\/q\/\{publicId\}|\/rating["']/);
    expect(apiSource).toContain("/api/v1/public/q/{token}/responses");
  });
});
