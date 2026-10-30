import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The product calls it a Tag. The code calls it a stand.
 *
 * Both are deliberate. `review_stands`, `/stands`, `standUrl` and `stand_id`
 * are load-bearing names attached to live tokens and a printed URL, and
 * renaming them is a migration with no user-visible benefit. But an owner or a
 * customer must never see the word, and "never" was being kept true by
 * somebody remembering.
 *
 * It had already stopped being true. The mobile Live Feed labelled a scan
 * "Stand tap", which is the one place the word survived into a screen — found
 * only because the README asserted the opposite and the claim was checked
 * before it shipped.
 *
 * So this looks for the word in the places a person reads: rendered text,
 * button labels, accessibility labels, titles and placeholders. Identifiers
 * are not user-visible and are explicitly allowed.
 */

const ROOTS = [
  join(process.cwd(), "app"),
  join(process.cwd(), "features"),
  join(process.cwd(), "..", "apps", "mobile", "app"),
];

function sources(): string[] {
  const files: string[] = [];
  for (const base of ROOTS) {
    for (const entry of readdirSync(base, { recursive: true, encoding: "utf8" })) {
      if (!entry.endsWith(".tsx")) continue;
      files.push(join(base, entry));
    }
  }
  return files;
}

/**
 * The word, as a reader would meet it.
 *
 * `>Stand tap<` is text on a screen. `standUrl`, `stand.label`, `/stands` and
 * `add-stand-label` are names, and a rule that flagged those would be turned
 * off within a week. The boundary is the character before and after: a name
 * carries a letter, digit, underscore, hyphen, dot or slash against it.
 */
const VISIBLE_STAND =
  /(?:^|[^A-Za-z0-9_\-./])[Ss]tands?(?![A-Za-z0-9_\-./])/;

/** Text between JSX tags, and the attributes a screen reader or a user reads. */
function readableFragments(source: string): string[] {
  const fragments: string[] = [];

  for (const [, text] of source.matchAll(/>([^<>{}]+)</g)) {
    if (text && text.trim()) fragments.push(text);
  }

  const readableAttrs =
    /\b(?:title|label|placeholder|accessibilityLabel|accessibilityHint|aria-label|alt)\s*=\s*(?:"([^"]*)"|\{"([^"]*)"\}|'([^']*)')/g;
  for (const match of source.matchAll(readableAttrs)) {
    const value = match[1] ?? match[2] ?? match[3];
    if (value?.trim()) fragments.push(value);
  }

  // Ternaries and string literals that land in a <Text> without their own
  // tags — "Stand tap" arrived exactly this way.
  for (const [, literal] of source.matchAll(/\?\s*"([^"]+)"\s*:\s*"([^"]+)"/g)) {
    if (literal) fragments.push(literal);
  }
  for (const match of source.matchAll(/\?\s*"[^"]+"\s*:\s*"([^"]+)"/g)) {
    if (match[1]) fragments.push(match[1]);
  }

  return fragments;
}

describe("nothing a person reads says Stand", () => {
  it("finds files to check, in both apps", () => {
    // Otherwise a moved directory makes this pass by finding nothing.
    const files = sources();
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((f) => f.includes("apps/mobile"))).toBe(true);
  });

  it("uses Tag in every rendered string", () => {
    const offenders: string[] = [];

    for (const file of sources()) {
      const source = readFileSync(file, "utf8");
      for (const fragment of readableFragments(source)) {
        if (VISIBLE_STAND.test(fragment)) {
          offenders.push(`${file.split("/").slice(-2).join("/")}: ${fragment.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("leaves the identifiers alone, which is the point", () => {
    // Guards the guard. If this ever fails, the rule above has been widened
    // into a rename of the database and the printed URL, which is not what it
    // is for.
    expect(VISIBLE_STAND.test("standUrl")).toBe(false);
    expect(VISIBLE_STAND.test("stand.label")).toBe(false);
    expect(VISIBLE_STAND.test("/stands/abc")).toBe(false);
    expect(VISIBLE_STAND.test("add-stand-label")).toBe(false);
    expect(VISIBLE_STAND.test("review_stands")).toBe(false);
    expect(VISIBLE_STAND.test("understand the flow")).toBe(false);

    // And still catches the real thing.
    expect(VISIBLE_STAND.test("Stand tap")).toBe(true);
    expect(VISIBLE_STAND.test("Open Stand Page")).toBe(true);
    expect(VISIBLE_STAND.test("your stand is ready")).toBe(true);
  });
});
