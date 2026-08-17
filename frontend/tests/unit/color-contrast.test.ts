import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Contrast is a build failure, not a review comment.
 *
 * This exists because the brand colour was changed once and a real regression
 * came with it: `text-brand` on `bg-brand-soft` measured 2.75:1 — below even the
 * 3:1 floor for icons — and it was sitting in shared components nobody thought
 * to re-check. Nothing in the pipeline noticed. A human reading a diff of hex
 * values cannot notice either, because contrast is not something eyes compute.
 *
 * The pairs below are read from the real stylesheet, so a token edit that
 * breaks one fails here rather than shipping.
 */

const CSS = readFileSync(join(process.cwd(), "styles/globals.css"), "utf8");

/** Read a custom property out of a specific theme block. */
function token(name: string, block: "light" | "dark"): string {
  // `:root` carries light; the dark values live under the media query and the
  // explicit `[data-theme="dark"]` selector. Taking the first match for light
  // and the last for dark is enough because the file declares them in order.
  const pattern = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`, "g");
  const found = [...CSS.matchAll(pattern)].map((match) => match[1] as string);

  if (found.length === 0) throw new Error(`token --${name} not found`);
  return block === "light" ? (found[0] as string) : (found[found.length - 1] as string);
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((character) => character + character)
          .join("")
      : clean;

  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG 2.2 AA: 4.5:1 normal text, 3:1 large text and meaningful graphics. */
const AA_TEXT = 4.5;
const AA_GRAPHIC = 3;

describe.each(["light", "dark"] as const)("%s theme", (theme) => {
  const brand = () => token("rb-brand", theme);
  const brandSoft = () => token("rb-brand-soft", theme);
  const brandText = () => token("rb-brand-text", theme);
  const onBrand = () => token("rb-on-brand", theme);
  const canvas = () => token("rb-canvas", theme);
  const surface = () => token("rb-surface", theme);
  const ink = () => token("rb-ink", theme);
  const muted = () => token("rb-muted", theme);

  it("primary button label is readable on brand green", () => {
    // The whole reason `--rb-on-brand` exists. White here is 3.08:1 in light
    // mode, which is large-text only, and every primary button is normal size.
    expect(contrast(onBrand(), brand())).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("never uses white as the primary button label", () => {
    expect(contrast("#FFFFFF", brand())).toBeLessThan(AA_TEXT);
    expect(onBrand().toLowerCase()).not.toBe("#ffffff");
  });

  it("brand text token is readable on every surface it is used on", () => {
    for (const background of [canvas(), surface(), brandSoft()]) {
      expect(contrast(brandText(), background)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("brand green as a foreground is still not good enough for text", () => {
    // Documents *why* `--rb-brand-text` exists, so a future edit that "tidies
    // up" by collapsing the two tokens fails here with the reason attached.
    expect(contrast(brand(), brandSoft())).toBeLessThan(AA_TEXT);
  });

  it("body and muted text are readable", () => {
    expect(contrast(ink(), canvas())).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(ink(), surface())).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(muted(), canvas())).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(muted(), surface())).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("status colours are readable", () => {
    expect(contrast(token("rb-danger", theme), surface())).toBeGreaterThanOrEqual(AA_TEXT);
    // Stars are graphics, not text, so 3:1 is the right bar for them.
    expect(contrast(token("rb-star", theme), surface())).toBeGreaterThanOrEqual(AA_GRAPHIC);
  });
});

describe("brand migration", () => {
  it("has no trace of the old brand green", () => {
    expect(CSS.toLowerCase()).not.toContain("06c167");
    expect(CSS.toLowerCase()).not.toContain("059a52");
  });

  it("uses the agreed brand green", () => {
    expect(token("rb-brand", "light").toLowerCase()).toBe("#00a86b");
  });

  it("defines every brand token in both themes", () => {
    for (const name of ["rb-brand", "rb-brand-hover", "rb-brand-active", "rb-brand-soft", "rb-brand-text", "rb-on-brand"]) {
      expect(() => token(name, "light")).not.toThrow();
      expect(() => token(name, "dark")).not.toThrow();
    }
  });
});
