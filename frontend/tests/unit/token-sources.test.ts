import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * One house, two doors.
 *
 * The website and the owner app are one product, so they must be one palette.
 * They were not: the same colours were spelled out in eight separate places —
 * `:root`, the auto dark block, both pinned themes, the website's `.rb-public`
 * and `.rb-public-dark`, the Tag card and the customer card — and nothing but
 * hand and memory held them together.
 *
 * They had already come apart. The website's dark band carried
 * `--rb-border: #2a332e` and `--rb-brand-text: #32cf94`; the app's carried
 * `#303a34` and `#45cf99`. Same two names, two different colours, same canvas.
 * Nobody noticed, because nothing was watching.
 *
 * This is what watches. A colour may be written down once. Every scope that
 * needs it maps to that one declaration with `var(--rb-l-*)` or `var(--rb-d-*)`.
 * Add a ninth copy and this fails before it can drift.
 */

const SHEETS = ["styles/globals.css", "styles/public-showcase.css", "styles/customer-page.css"];

/** A literal colour, as opposed to a reference to one. */
const LITERAL = /^\s*(#|rgb|hsl|oklch|color-mix|white\b|black\b|transparent\b)/i;

interface Decl {
  token: string;
  value: string;
  sheet: string;
  line: number;
}

function declarations(): Decl[] {
  const found: Decl[] = [];
  for (const sheet of SHEETS) {
    const text = readFileSync(join(process.cwd(), sheet), "utf8");
    text.split("\n").forEach((raw, index) => {
      const match = /^\s*(--rb-[a-z0-9-]+)\s*:\s*([^;]+);/.exec(raw);
      if (!match) return;
      found.push({ token: match[1]!, value: match[2]!.trim(), sheet, line: index + 1 });
    });
  }
  return found;
}

describe("a colour is written down once", () => {
  const all = declarations();
  const literals = all.filter((d) => LITERAL.test(d.value));

  it("declares every colour token in exactly one place", () => {
    const byToken = new Map<string, Decl[]>();
    for (const decl of literals) {
      byToken.set(decl.token, [...(byToken.get(decl.token) ?? []), decl]);
    }

    const duplicated = [...byToken.entries()]
      .filter(([, decls]) => decls.length > 1)
      .map(([token, decls]) => `${token} in ${decls.map((d) => `${d.sheet}:${d.line}`).join(", ")}`);

    // A second literal for the same name is a second source of truth, and the
    // two will disagree eventually whether or not they disagree today.
    expect(duplicated).toEqual([]);
  });

  it("keeps every literal colour inside the palette block", () => {
    // --rb-l-* and --rb-d-* are the palette. Anything else holding a literal
    // is a scope that has started keeping its own colours again.
    const strays = literals
      .filter((d) => !/^--rb-[ld]-/.test(d.token))
      // Not themed, declared once, and deliberately the same in both modes.
      .filter((d) => !["--rb-info-soft", "--rb-warning-soft"].includes(d.token))
      .map((d) => `${d.token} = ${d.value} (${d.sheet}:${d.line})`);

    expect(strays).toEqual([]);
  });

  it("resolves the website's scopes from the same palette as the app's", () => {
    const mapped = all.filter((d) => /^var\(--rb-[ld]-/.test(d.value));
    const scopes = new Set(mapped.map((d) => d.sheet));
    // All three sheets must be drawing from the shared palette, not just one.
    expect([...scopes].sort()).toEqual([...SHEETS].sort());
    expect(mapped.length).toBeGreaterThan(100);
  });
});

/**
 * The app is the other door.
 *
 * `apps/mobile/theme.ts` is React Native, so it cannot read a CSS custom
 * property — it keeps its own copy of the colours. That copy had drifted in
 * three places: border #D8DED9, borderLight #B7C0BA and starFilled #BF7D00
 * against the web's #dce2de, #b9c3bd and #b97d0c. The stars in the app were
 * a different gold from the stars on the website.
 *
 * It cannot import the palette, so this holds the two together instead. The
 * mobile-only entries below have no web counterpart and are not checked;
 * everything that exists on both sides must be the same colour.
 */
describe("the app and the website are painted from one palette", () => {
  const MOBILE_TO_WEB: Record<string, string> = {
    brand: "brand",
    brandText: "brand-text",
    onBrand: "on-brand",
    brandSoft: "brand-soft",
    brandHover: "brand-hover",
    brandActive: "brand-active",
    action: "action",
    actionHover: "action-hover",
    actionPressed: "action-pressed",
    onAction: "on-action",
    canvas: "canvas",
    surface: "surface",
    surfaceAlt: "quiet",
    ink: "ink",
    inkFaint: "muted",
    border: "border",
    borderLight: "border-strong",
    danger: "danger",
    starFilled: "star",
  };

  it("gives the same name the same colour on both sides", () => {
    const css = readFileSync(join(process.cwd(), "styles/globals.css"), "utf8");
    const theme = readFileSync(join(process.cwd(), "../apps/mobile/theme.ts"), "utf8");

    const disagreements: string[] = [];
    for (const [mobileName, webName] of Object.entries(MOBILE_TO_WEB)) {
      const web = new RegExp(`--rb-l-${webName}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1];
      const app = new RegExp(`\\b${mobileName}:\\s*"(#[0-9a-fA-F]{6})"`).exec(theme)?.[1];
      if (!web || !app) {
        disagreements.push(`${mobileName}: missing (web ${web ?? "—"}, app ${app ?? "—"})`);
      } else if (web.toLowerCase() !== app.toLowerCase()) {
        disagreements.push(`${mobileName}: app ${app} vs web ${web}`);
      }
    }

    expect(disagreements).toEqual([]);
  });
});
