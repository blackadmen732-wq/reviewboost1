import { readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * One card, not fourteen.
 *
 * `components/ui/card.tsx` existed and nothing imported it — generated
 * boilerplate on a padding rhythm this product does not use. So twenty-one
 * places wrote the recipe out by hand instead, in fourteen spellings: p-3,
 * p-4, p-5, p-6, `p-4 sm:p-5`, `p-5 sm:p-6`, some raised and some not.
 *
 * That is the real reason no two screens looked like the same product. Not
 * taste — six paddings for one idea, and nothing to notice.
 *
 * A raised surface now comes from `<Card>`. The exceptions below are the
 * elements that only share a corner radius with it: banners, selectable
 * tiles and rows, and the dialog. They are listed by name so that adding to
 * the list is a deliberate act with a reason, rather than the default.
 */

const SURFACE = /rounded-\[var\(--radius-card\)\][^"'`]*\bbg-surface\b/;

/**
 * Not cards: a raised surface is `bg-surface` plus the radius, and these
 * carry a chosen or branded background instead. The dialog, the stat tile
 * and the status banner never appear here at all — they borrow the radius
 * and nothing else, so the rule above does not reach them.
 */
const NOT_A_CARD = [
  "components/ui/card.tsx", // the definition itself
  "features/dashboard/praise-matcher.tsx", // selectable rows that carry a chosen state
  "features/dashboard/billing-panel.tsx", // the plan cards, whose border IS the selection
  "components/ui/setting-list.tsx", // SettingRow, a row inside a Card rather than a card
];

function sources(): { file: string; text: string }[] {
  const files = globSync("{app,features,components}/**/*.tsx", { cwd: process.cwd() });
  return files.map((file) => ({ file, text: readFileSync(join(process.cwd(), file), "utf8") }));
}

describe("a raised surface comes from one place", () => {
  it("has no hand-rolled card outside the listed exceptions", () => {
    const strays = sources()
      .filter(({ file }) => !NOT_A_CARD.includes(file))
      .flatMap(({ file, text }) =>
        text
          .split("\n")
          .map((line, index) => ({ line, number: index + 1 }))
          .filter(({ line }) => SURFACE.test(line))
          .map(({ number }) => `${file}:${number}`),
      );

    expect(strays).toEqual([]);
  });

  it("keeps the exception list honest", () => {
    // An exception that no longer contains a card should come off the list,
    // or the list becomes a place things go to be forgotten.
    const all = new Map(sources().map(({ file, text }) => [file, text]));
    const stale = NOT_A_CARD.filter(
      (file) => file !== "components/ui/card.tsx" && !SURFACE.test(all.get(file) ?? ""),
    );
    expect(stale).toEqual([]);
  });

  it("is actually used", () => {
    const importers = sources().filter(({ text }) => text.includes('from "@/components/ui/card"'));
    expect(importers.length).toBeGreaterThan(10);
  });
});
