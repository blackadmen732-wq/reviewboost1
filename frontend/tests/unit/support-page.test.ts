import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FAQ } from "@/features/public/faq";

/**
 * Support and the FAQ answer the same questions, and they had drifted apart.
 *
 * Support said cancelling left "your account and data" running. The FAQ said
 * the Tags stop once the paid period ends. The FAQ was right —
 * `resolve_public_stand` requires `app.entitlement_allows_service`, which is
 * false once the status is cancelled — so a paying customer reading Support
 * would have been told the opposite of what happens, on the page they open when
 * something has already gone wrong.
 *
 * These tests keep the two agreeing and keep Support free of the promises this
 * product has not made.
 */

const ROOT = process.cwd();

/**
 * The page as a reader meets it: comments stripped, whitespace collapsed.
 *
 * Comments explaining what was removed necessarily quote it, and JSX wraps
 * prose across lines — so "stops the\n next charge" is the same sentence to a
 * person and a different string to a regex.
 */
const page = readFileSync(join(ROOT, "app/support/page.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\s+/g, " ");

describe("Support agrees with the FAQ", () => {
  it("describes cancellation the same way", () => {
    const faqAnswer = FAQ.find((entry) => /if i cancel/i.test(entry.question))!.answer;

    for (const claim of ["stops the next charge", "until the period"]) {
      expect(faqAnswer.toLowerCase(), `FAQ lost: ${claim}`).toContain(claim);
      expect(page.toLowerCase(), `Support lost: ${claim}`).toContain(claim);
    }
    // The contradiction that existed: Support must not say everything keeps
    // running after the paid period.
    expect(page).not.toMatch(/remain until you choose to delete/i);
  });

  it("does not contradict the FAQ on texts rolling over", () => {
    expect(page.toLowerCase()).toContain("does not carry into the next month");
  });
});

describe("Support promises nothing operations has not agreed", () => {
  it("states no response time and no reading guarantee", () => {
    expect(page).not.toMatch(/within one business day|read every message|reply within/i);
  });

  it("promises no deletion window", () => {
    expect(page).not.toMatch(/within \d+ days/i);
  });
});

describe("Support is accurate about the product", () => {
  it("names every platform that can program a Tag, not just iOS", () => {
    // Web NFC is Chrome-on-Android; the native app covers iPhone and Android.
    // The old copy said "the iOS app" and pinned iPhone 7 / iOS 14.
    expect(page).toContain("Chrome on Android");
    expect(page).toMatch(/ReviewBoost app on iPhone or Android/);
    expect(page).not.toMatch(/iPhone 7|iOS 14|NTAG21[35]/);
  });

  it("does not send owners to a third-party app to program a Tag", () => {
    expect(page).not.toMatch(/NFC Tools/i);
  });

  it("uses Tag, not Stand", () => {
    expect(page).not.toMatch(/\bstand(s)?\b/i);
  });

  it("is on the canonical domain", () => {
    expect(page).not.toMatch(/reviewboost\.app/);
    expect(page).toContain("reviewboost.fit");
  });
});
