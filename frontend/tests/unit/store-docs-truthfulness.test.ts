import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The documents that leave the building.
 *
 * `copy-truthfulness.test.ts` guards what a visitor reads on the site. It
 * walks `app/` and `features/`, which is the right scope for a page — and
 * exactly the wrong scope for the App Store listing, which is copy that ships
 * to Apple and to every person who reads the product page.
 *
 * Nothing was watching it, and it showed. The submission package carried
 * `https://reviewboost.app/privacy` in the privacy-policy field — a domain the
 * business does not serve, so the URL App Review checks would have 404'd — and
 * advertised "written feedback from customers", which V1 does not collect. Both
 * are the same failures the site was already guarded against. The guard just
 * stopped at the directory boundary.
 *
 * `fit.reviewboost.app` is the bundle identifier and is correct. The lookbehind
 * below is what tells a reverse-DNS identifier apart from a URL.
 */

const REPO = join(process.cwd(), "..");

const STORE_DOCS = [
  "docs/app-store/SUBMISSION.md",
  "docs/google-play/SUBMISSION.md",
  "docs/mobile/MOBILE_RELEASE.md",
];

function doc(path: string): string {
  return readFileSync(join(REPO, path), "utf8");
}

/**
 * The same document with its line wrapping collapsed.
 *
 * A sentence in a hard-wrapped Markdown file is one thing to a reader and a
 * different string to a regex: "contains no\nPlay Billing integration" does
 * not match /contains no Play Billing/. Every prose assertion below reads this
 * instead, so a reflow cannot silently turn a guard off.
 */
function prose(path: string): string {
  return doc(path).replace(/\s+/g, " ");
}

describe("the store documents point at a domain that exists", () => {
  it("names reviewboost.fit, never the retired reviewboost.app", () => {
    for (const path of STORE_DOCS) {
      const offenders = [...doc(path).matchAll(/(?<!\.)\breviewboost\.app\b/g)];
      expect(offenders.map((m) => m[0]), `${path} still uses the retired domain`).toEqual([]);
    }
  });

  it("still allows the bundle identifier, which is not a URL", () => {
    // Guards the guard: a blanket match on "reviewboost.app" would flag
    // `fit.reviewboost.app` eight times in MOBILE_RELEASE.md and somebody
    // would "fix" the bundle id to make it pass.
    expect(doc("docs/mobile/MOBILE_RELEASE.md")).toContain("fit.reviewboost.app");
  });
});

describe("the two store listings agree with each other", () => {
  const apple = prose("docs/app-store/SUBMISSION.md");
  const play = prose("docs/google-play/SUBMISSION.md");

  it("quote the same prices, because there is one price list", () => {
    for (const price of ["$49", "$79", "$129"]) {
      expect(apple, `the App Store listing omits ${price}`).toContain(price);
      expect(play, `the Play listing omits ${price}`).toContain(price);
    }
  });

  it("both declare no analytics, in the form each store asks for", () => {
    // Play's Data safety form and Apple's nutrition labels ask the same
    // question. Two different answers means at least one is a false
    // declaration, and it is the sort of inconsistency a reviewer notices
    // because the two listings sit side by side.
    expect(apple).toMatch(/no analytics SDK/i);
    expect(play).toMatch(/no analytics or crash SDK/i);
  });

  it("both point at the same deletion URL", () => {
    for (const [store, text] of [["App Store", apple], ["Play", play]] as const) {
      expect(text, `${store} omits the deletion URL`).toContain(
        "reviewboost.fit/delete-account",
      );
    }
  });

  it("both state that the app sells nothing", () => {
    // The moment either app grows a purchase button or a link to one, the
    // store answer changes — Apple 3.1.3(b), Play Payments policy. These
    // sentences are the record of the posture being deliberate.
    expect(apple).toMatch(/no purchase mechanism and no link to one/i);
    expect(play).toMatch(/no Play Billing integration, no purchase flow/i);
  });
});

describe("the App Store listing describes this product", () => {
  const submission = prose("docs/app-store/SUBMISSION.md");

  it("does not advertise written feedback from customers", () => {
    // One tap is the whole customer interaction. There is no message box, so
    // there is nothing for a customer to write.
    expect(submission).not.toMatch(
      /written feedback|feedback from customers|customers? (can )?(leave|write) (a )?(note|message|comment)/i,
    );
  });

  it("documents where account deletion lives, which App Review checks", () => {
    // Guideline 5.1.1(v). A submission package without it is one rejection
    // round wasted on a question with a written answer.
    expect(submission).toContain("5.1.1(v)");
    expect(submission).toContain("/delete-account");
    expect(submission.toLowerCase()).toContain("account tab");
  });

  it("declares no analytics, because there is no analytics SDK", () => {
    // A privacy label is a legal declaration. Over-declaring is not the safe
    // side of the line — it is a false statement App Review can check against
    // the binary.
    expect(submission).not.toMatch(/\|\s*Product interaction\s*\|\s*Yes/i);

    // The User ID row is the one that has to be read rather than pattern
    // matched. Its Use cell mentions analytics in order to rule it out, and a
    // regex for "User ID ... analytics" flagged exactly the sentence that
    // fixed the problem — the same way the customer-notes guard once flagged
    // "there is no customer note to encrypt".
    const userIdRow = /\|\s*User ID\s*\|([^|]*)\|([^|]*)\|/.exec(
      doc("docs/app-store/SUBMISSION.md"),
    );
    expect(userIdRow, "the User ID privacy row is missing").not.toBeNull();
    expect(userIdRow![2]).toMatch(/not used for analytics/i);
  });

  it("names the NFC labels the app actually shows", () => {
    // A reviewer following instructions that name a button which is not there
    // files a rejection, not a bug report.
    expect(submission).toContain("Program NFC");
    expect(submission).not.toMatch(/Programme NFC/);
  });
});
