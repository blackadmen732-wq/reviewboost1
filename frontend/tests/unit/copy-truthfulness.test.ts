import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Copy that was true when it was written and is false now.
 *
 * Every one of these shipped as an accurate sentence and rotted in place:
 * "Billing is not live yet" outlived Stripe; the Integrity and How-it-works
 * pages still described customers leaving words, which V1 stopped collecting;
 * Settings promised deletion "within 30 days" and Support "within one business
 * day", neither of which anyone had committed to operationally; and half the
 * contact addresses pointed at reviewboost.app after reviewboost.fit became
 * canonical.
 *
 * A stale sentence on a marketing page is worse than a missing one: a visitor
 * who catches it stops believing the rest of the page.
 */

const ROOT = process.cwd();

/** Every page and copy module a visitor or owner can actually read. */
function userFacingSources(): string[] {
  const files: string[] = [];
  for (const dir of ["app", "features"]) {
    const base = join(ROOT, dir);
    for (const entry of readdirSync(base, { recursive: true, encoding: "utf8" })) {
      if (!/\.(tsx|ts)$/.test(entry)) continue;
      if (entry.includes("node_modules")) continue;
      files.push(join(base, entry));
    }
  }
  return files;
}

/**
 * Source with comments removed.
 *
 * These checks are about what a person reads on screen. A comment explaining
 * why a sentence was removed necessarily quotes it, and matching that would
 * make the fix look like the bug.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function offenders(pattern: RegExp): string[] {
  return userFacingSources()
    .filter((file) => pattern.test(code(readFileSync(file, "utf8"))))
    .map((file) => file.replace(`${ROOT}/`, ""));
}

describe("the product does not describe itself inaccurately", () => {
  it("does not say billing is switched off, because it is not", () => {
    expect(offenders(/billing is not live/i)).toEqual([]);
  });

  it("does not promise a support response time nobody has committed to", () => {
    expect(offenders(/within one business day|reply within/i)).toEqual([]);
  });

  it("does not promise a deletion window nobody has committed to", () => {
    // Scoped to product copy. The Privacy Policy states retention periods
    // because a privacy policy is supposed to, and changing a legal retention
    // commitment is a decision about what the business actually does — not a
    // copy edit. Those numbers need an owner to confirm them, not a test.
    const productCopy = offenders(/within \d+ days/i).filter(
      (file) => !file.includes("privacy"),
    );
    expect(productCopy).toEqual([]);
  });

  it("does not claim customers leave written feedback", () => {
    // V1 takes a star and nothing else: no note field, no praise.
    //
    // The first version of this matched two exact phrases, and missed the
    // Integrity page saying "letting you read what they wrote" and "words you
    // can act on" — the same false claim in different words, on the page whose
    // whole argument is that the product is honest. Matching the concept
    // instead.
    expect(
      offenders(
        /words they left|private notes are extra|read what they wrote|words you can act on|what they wrote/i,
      ),
    ).toEqual([]);
  });

  /**
   * A customer note is not a V1 feature, and every attempt to guard that with a
   * single regex over the noun has been wrong in one direction or the other.
   *
   * Matching exact phrases missed the Integrity page saying "read what they
   * wrote". A bare /\bnotes?\b/ went too far the other way: a business CAN
   * write a note on a rating — ActionThread posts to
   * /customer-responses/{id}/notes and it renders on the feedback detail page —
   * so the blanket rule flagged accurate sentences and flagged `note:
   * item.note` for being an identifier. Narrowing to "customer note" then
   * flagged the Privacy page for correctly describing historical rows, and the
   * Security page for the very sentence that corrects the claim.
   *
   * The noun is not the thing that is false. `customer_responses.note_encrypted`
   * exists, earlier versions filled it, and the owner read path still decrypts
   * it; what changed is that `submitCustomerResponse` now passes
   * `p_note_encrypted: null`, so nothing new is ever collected. So the rule is
   * about tense, not vocabulary: mention a customer note and you must say in the
   * same breath that it is gone.
   *
   * This is the shape that catches the original offender — "Customer notes and
   * the reprintable copy of Tag codes are encrypted" — which named the field
   * with nothing to say it no longer fills.
   */
  it("never mentions a customer note without saying it is not collected", () => {
    const MENTION = /customer'?s?\s+notes?\b|notes?\s+(?:from|left by)\s+(?:a\s+)?customer/i;
    // "never sent to a client" is not a disclaimer about the note, so a bare
    // "never" must not count as one.
    const RETIRED =
      /historical|earlier version|legacy|previous version|no longer|does not collect|never collected|no customer note|write nothing|writes nothing/i;

    const offenders: string[] = [];
    for (const file of userFacingSources()) {
      const prose = code(readFileSync(file, "utf8")).replace(/\s+/g, " ");
      for (const sentence of prose.split(/(?<=[.!?])\s+/)) {
        if (MENTION.test(sentence) && !RETIRED.test(sentence)) {
          offenders.push(`${file.replace(`${ROOT}/`, "")}: ${sentence.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("one canonical domain", () => {
  /**
   * `docs/backend/ENVIRONMENT.md` and `.env.example` both name reviewboost.fit
   * as production. reviewboost.app is the retired alternative, and a contact
   * address on a domain the business does not serve is a dead mailbox.
   */
  it("uses reviewboost.fit everywhere a domain is written", () => {
    expect(offenders(/reviewboost\.app/)).toEqual([]);
  });
});

describe("the owner UI hides machinery the owner cannot act on", () => {
  it("never shows an SMS encoding to a business owner", () => {
    const composer = code(
      readFileSync(join(ROOT, "features/dashboard/text-request-composer.tsx"), "utf8"),
    );
    // The server still computes exact segments, including the GSM-7/UCS-2 split.
    // The owner sees a message count.
    expect(composer).not.toMatch(/\{preview\.encoding/);
    expect(composer).not.toMatch(/\{preview\.unitCount/);
    expect(composer).toMatch(/Uses \{preview\.segments\}/);
  });

  it("offers the Customer Page one action, not a draft model", () => {
    const editor = code(
      readFileSync(join(ROOT, "features/customer-page/customer-page-editor.tsx"), "utf8"),
    );
    expect(editor).not.toMatch(/Save draft|Go live|Update live page/);
    // publish() still saves first and refuses to publish if that save fails.
    expect(editor).toMatch(/Publish/);
  });
});
