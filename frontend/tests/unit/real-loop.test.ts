import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  GOOGLE_LINK_BLAST,
  GOOGLE_LINK_EMPTY,
  GOOGLE_LINK_INVALID,
  GOOGLE_LINK_LATER,
} from "@/features/dashboard/google-link-copy";
import { tagProgramPhaseLabel } from "@/features/dashboard/home-model";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("real loop language", () => {
  it("states the Google blast radius in one sentence", () => {
    expect(GOOGLE_LINK_BLAST.toLowerCase()).toContain("every tag");
    expect(GOOGLE_LINK_BLAST.toLowerCase()).toContain("wrong");
    expect(GOOGLE_LINK_EMPTY.toLowerCase()).toContain("not set");
    expect(GOOGLE_LINK_INVALID.toLowerCase()).toContain("not a google review link");
    expect(GOOGLE_LINK_LATER.toLowerCase()).toContain("settings");
  });

  it("Settings and onboarding offer Test and the blast helper", () => {
    const settings = code("app/(owner)/settings/page.tsx");
    const care = code("features/dashboard/google-link-care.tsx");
    const onboarding = code("features/onboarding/onboarding-flow.tsx");

    expect(settings).toContain("GoogleLinkCare");
    expect(care).toMatch(/>\s*Test\s*</);
    expect(care).toMatch(/>\s*Open\s*</);
    expect(care).toMatch(/>\s*Save\s*</);
    expect(care).toContain("GOOGLE_LINK_BLAST");
    expect(onboarding).toContain("TestGoogleLinkButton");
    expect(onboarding).toContain("GOOGLE_LINK_BLAST");
    expect(onboarding).toContain("GOOGLE_LINK_LATER");
    expect(onboarding).toContain("data-google-unset");
    // The plan gate is what makes a Tag actually serve customers. It must
    // survive any future edit to this step.
    expect(onboarding).toContain("Choose a plan to switch it on");
    expect(care).toContain("data-google-link-state");
    expect(care).toContain("googleLinkRefusal");
  });

  it("keeps NDEF and provision chrome out of Tag UI copy", () => {
    const card = code("features/dashboard/stand-card.tsx");
    const create = code("features/dashboard/add-stand-button.tsx");
    const onboarding = code("features/onboarding/onboarding-flow.tsx");
    const writerUi = code("features/dashboard/web-nfc-writer.tsx");

    expect(card).not.toMatch(/\bNDEF\b/);
    expect(card).not.toMatch(/URL\s*\/\s*URI/);
    expect(card).not.toMatch(/NTAG\d/);
    expect(card).not.toMatch(/provisioning|Status recorded|Retry saving/i);
    expect(card).toContain("Program a tag");
    expect(card).toContain("Print your code");
    expect(card).toContain("tagProgramPhaseLabel");
    expect(create).toContain("Create a Tag");
    expect(create).not.toMatch(/Stand created|create stand/);
    expect(onboarding).toContain("Print this code");
    expect(onboarding).not.toMatch(/\bNDEF\b/);
    expect(onboarding).not.toMatch(/NTAG\d/);
    expect(writerUi).not.toMatch(/NTAG\d/);
    expect(writerUi).toContain("Program this tag");
  });

  it("Program Tag status is a human sequence", () => {
    expect(tagProgramPhaseLabel("not-programmed")).toBe("Not programmed");
    expect(tagProgramPhaseLabel("programmed")).toBe("Programmed");
    expect(tagProgramPhaseLabel("needs-reprogramming")).toBe("Needs reprogramming");
  });

  it("does not invent a new Google or NFC API", () => {
    const care = code("features/dashboard/google-link-care.tsx");
    const writer = source("features/dashboard/web-nfc-writer.tsx");

    expect(care).toContain("/api/v1/settings");
    expect(writer).toContain("/api/v1/review-stands/${standId}/nfc-provision");
    expect(care).not.toMatch(/\/api\/v1\/google/);

    const counts = source("lib/server/owner-data.ts");
    expect(counts).toContain("ownerGoogleLinkFlags");
    expect(counts).toContain("isValidGoogleReviewUrl");
    expect(counts).not.toMatch(/hasGoogleLink:\s*Boolean\(location/);
  });
});
