import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The brand is the owner's, not something to approximate.
 *
 * Every mark in the product was a placeholder: `logo-mark.tsx` drew a rounded
 * square containing the letter "B", the favicon and app-icon routes generated
 * the same "B", and the shipped PNG icon set was a raster of it. The owner's
 * real artwork was sitting in `Branding/` the whole time.
 *
 * These tests tie the rendered mark to that supplied artwork, so a future
 * "quick placeholder" cannot quietly become the logo again.
 */

const REPO = join(process.cwd(), "..");

function read(path: string): string {
  return readFileSync(join(REPO, path), "utf8");
}

/** Every `d="…"` in an SVG or component, which is the geometry itself. */
function pathData(source: string): string[] {
  return [...source.matchAll(/\sd="([^"]+)"/g)].map((match) => match[1]!.trim());
}

describe("the mark is the owner's supplied artwork", () => {
  const supplied = pathData(read("Branding/Logo.svg"));
  const rendered = pathData(read("frontend/components/brand/logo-mark.tsx"));

  it("draws every path the supplied asset draws, unaltered", () => {
    expect(supplied.length).toBeGreaterThan(0);
    expect(rendered).toEqual(supplied);
  });

  it("is not a letter set in a typeface", () => {
    const source = read("frontend/components/brand/logo-mark.tsx");
    // The placeholder was <text>B</text> on a rect. A real mark has no glyph.
    expect(source).not.toMatch(/<text/);
    expect(source).not.toMatch(/fontFamily/);
  });

  it("carries the approved green, via the token", () => {
    expect(read("frontend/components/brand/logo-mark.tsx")).toContain("#00A86B");
  });
});

describe("the mark lives in exactly one place", () => {
  it("no other brand component defines mark geometry", () => {
    const dir = join(REPO, "frontend/components/brand");
    const offenders = readdirSync(dir)
      .filter((file) => file.endsWith(".tsx") && file !== "logo-mark.tsx")
      .filter((file) => pathData(readFileSync(join(dir, file), "utf8")).length > 0);

    // Two components drawing the same mark is how they drift apart.
    expect(offenders).toEqual([]);
  });
});

describe("the shipped icon is the owner's app icon", () => {
  it("public/brand/icon.svg is the supplied tile verbatim", () => {
    expect(read("frontend/public/brand/icon.svg")).toBe(read("Branding/Icon_only.svg"));
  });

  it("public/brand/logo.svg is the supplied mark verbatim", () => {
    expect(read("frontend/public/brand/logo.svg")).toBe(read("Branding/Logo.svg"));
  });

  it("no shipped brand SVG renders a letter instead of the mark", () => {
    const dir = join(REPO, "frontend/public/brand");
    const lettered = readdirSync(dir)
      .filter((file) => file.endsWith(".svg"))
      .filter((file) => /<text/.test(readFileSync(join(dir, file), "utf8")));

    expect(lettered).toEqual([]);
  });

  it("no route generates an icon from a glyph", () => {
    const app = readdirSync(join(REPO, "frontend/app"));
    // icon.tsx / apple-icon.tsx drew "B" with ImageResponse. The icons are now
    // the approved raster, declared in layout.tsx.
    expect(app).not.toContain("icon.tsx");
    expect(app).not.toContain("apple-icon.tsx");
  });
});

/**
 * A letter in a coloured tile is not the logo.
 *
 * The install prompt shipped `<span className="… bg-brand …">B</span>` long
 * after the real mark existed, and `wordmark.tsx` exported the same tile as a
 * "Monogram". Both matched the placeholder that `logo-mark.tsx` replaced.
 *
 * The check is narrow on purpose: it flags an element whose *entire* text is
 * "B" or "RB" (the substitute-logo shape), not copy that happens to contain
 * the letter. Comments are stripped so documentation can describe the bug.
 */
const PLACEHOLDER_TILE = [
  />\s*(?:B|RB)\s*<\//, // <span …>B</span>
  />\s*\{\s*["'`](?:B|RB)["'`]\s*\}\s*<\//, // <span …>{"B"}</span>
];

function withoutComments(source: string): string {
  return source.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function hasPlaceholderTile(source: string): boolean {
  const code = withoutComments(source);
  return PLACEHOLDER_TILE.some((pattern) => pattern.test(code));
}

function tsxUnder(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir, { recursive: true, encoding: "utf8" });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith(".tsx") && !entry.includes("node_modules"))
    .map((entry) => join(dir, entry));
}

describe("no letter tile stands in for the mark", () => {
  it("no screen or component renders a placeholder letter tile", () => {
    const files = [
      ...tsxUnder(join(REPO, "frontend/app")),
      ...tsxUnder(join(REPO, "frontend/features")),
      ...tsxUnder(join(REPO, "frontend/components")),
      ...tsxUnder(join(REPO, "apps/mobile/app")),
      ...tsxUnder(join(REPO, "apps/mobile/components")),
    ];
    expect(files.length).toBeGreaterThan(0);

    const offenders = files
      .filter((file) => hasPlaceholderTile(readFileSync(file, "utf8")))
      .map((file) => file.slice(REPO.length + 1));

    expect(offenders).toEqual([]);
  });

  it("the install prompt shows the canonical mark", () => {
    const source = read("frontend/features/dashboard/install-prompt.tsx");
    expect(source).toMatch(/from "@\/components\/brand\/reviewboost-logo"/);
    expect(source).toMatch(/<ReviewBoostLogo\b/);
  });

  it("catches the tile and nothing that merely contains the letter", () => {
    expect(hasPlaceholderTile(`<span className="bg-brand">B</span>`)).toBe(true);
    expect(hasPlaceholderTile(`<span className="bg-brand">\n  B\n</span>`)).toBe(true);
    expect(hasPlaceholderTile(`<div>{"RB"}</div>`)).toBe(true);

    expect(hasPlaceholderTile(`<p>Bring your team</p>`)).toBe(false);
    expect(hasPlaceholderTile(`<span>Plan B</span>`)).toBe(false);
    expect(hasPlaceholderTile(`<Button>Boost</Button>`)).toBe(false);
    expect(hasPlaceholderTile(`{/* it used to be <span>B</span> */}`)).toBe(false);
  });
});
