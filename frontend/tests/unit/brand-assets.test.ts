import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MARK_HEIGHT,
  MARK_PATHS,
  MARK_WIDTH,
  WORDMARK_BOOST,
  WORDMARK_REVIEW,
} from "@/components/brand/mark-geometry";

/**
 * One ReviewBoost mark, one green, one source.
 *
 * The brand drifted twice before: first to a placeholder "B" set in a
 * typeface, then to two hand-made variants of the R (a bright-green mark and a
 * dark-green tile rotated 1.12 degrees, with the dark green leaking into the
 * Android icon). `Branding/Mark.svg` is now the only drawing, and
 * `scripts/brand/generate-brand-assets.mjs` writes everything else from it.
 * These tests fail when anything starts drawing or colouring the mark on its
 * own again.
 */

const REPO = join(process.cwd(), "..");
const BRAND_GREEN = "#00A86B";

function read(path: string): string {
  return readFileSync(join(REPO, path), "utf8");
}

/** Every `d="…"` in an SVG, which is the geometry itself. */
function pathData(source: string): string[] {
  return [...source.matchAll(/\sd="([^"]+)"/g)].map((match) => match[1]!.trim());
}

function hexColours(source: string): string[] {
  return [...source.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((match) => match[0].toUpperCase());
}

/** PNG width, height and colour type, straight from the IHDR chunk. */
function pngHeader(path: string) {
  const bytes = readFileSync(join(REPO, path));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colourType: bytes[25] };
}

describe("Branding/Mark.svg is the one mark", () => {
  const source = read("Branding/Mark.svg");

  it("is the mark alone: no container, rotation, text or second colour", () => {
    expect(source).not.toMatch(/<rect|<circle|<ellipse/);
    expect(source).not.toMatch(/rotate\(/);
    expect(source).not.toMatch(/<text|<image|filter=/);
    expect(new Set(hexColours(source))).toEqual(new Set([BRAND_GREEN]));
  });

  it("is what the web component draws, via the generated geometry", () => {
    expect([...MARK_PATHS]).toEqual(pathData(source));
    const [, , width, height] = /viewBox="([^"]+)"/.exec(source)![1]!.split(" ").map(Number);
    expect([MARK_WIDTH, MARK_HEIGHT]).toEqual([width, height]);
  });

  it("is copied, not redrawn, into every exported SVG", () => {
    const mark = pathData(source);
    for (const file of [
      "Branding/AppIcon.svg",
      "Branding/Logo.svg",
      "Branding/Logo-on-dark.svg",
      "frontend/public/brand/icon.svg",
      "frontend/public/brand/logo.svg",
      "frontend/public/brand/mark.svg",
    ]) {
      const paths = pathData(read(file));
      for (const d of mark) expect(paths, file).toContain(d);
    }
  });
});

describe("the wordmark is the outlined Branding/Wordmark.svg", () => {
  it("is what the web lockup draws", () => {
    expect([WORDMARK_REVIEW, WORDMARK_BOOST]).toEqual(pathData(read("Branding/Wordmark.svg")));
  });
});

describe("the mark lives in exactly one place", () => {
  it("no brand component holds path data of its own", () => {
    const dir = join(REPO, "frontend/components/brand");
    const offenders = readdirSync(dir)
      .filter((file) => file.endsWith(".tsx"))
      .filter((file) => pathData(readFileSync(join(dir, file), "utf8")).length > 0);
    expect(offenders).toEqual([]);
  });

  it("the old hand-made variants are gone", () => {
    const branding = readdirSync(join(REPO, "Branding"));
    expect(branding).not.toContain("Icon_only.svg");
    expect(branding).not.toContain("IconOnly.tsx");
    expect(branding).not.toContain("Logo.tsx");
    expect(readdirSync(join(REPO, "frontend/public/brand"))).not.toContain("icon-square.svg");
  });

  it("no route generates an icon from a glyph", () => {
    const app = readdirSync(join(REPO, "frontend/app"));
    expect(app).not.toContain("icon.tsx");
    expect(app).not.toContain("apple-icon.tsx");
  });

  it("no shipped brand SVG sets live text", () => {
    const dir = join(REPO, "frontend/public/brand");
    const lettered = readdirSync(dir)
      .filter((file) => file.endsWith(".svg"))
      .filter((file) => /<text/.test(readFileSync(join(dir, file), "utf8")));
    expect(lettered).toEqual([]);
  });
});

describe("one ReviewBoost green", () => {
  it("every brand file uses only the brand green, white, and ink", () => {
    const allowed = new Set([BRAND_GREEN, "#FFFFFF", "#171A18", "#F7F9F7"]);
    for (const file of [
      "Branding/Mark.svg",
      "Branding/Wordmark.svg",
      "Branding/AppIcon.svg",
      "Branding/Logo.svg",
      "Branding/Logo-on-dark.svg",
    ]) {
      for (const colour of hexColours(read(file))) expect(allowed, `${file} uses ${colour}`).toContain(colour);
    }
  });

  it("the Android adaptive background and the web token are that green", () => {
    const app = JSON.parse(read("apps/mobile/app.json"));
    expect(app.expo.android.adaptiveIcon.backgroundColor.toUpperCase()).toBe(BRAND_GREEN);
    // The palette declares each colour once; both themes must be the green.
    expect(read("frontend/styles/globals.css")).toMatch(/--rb-l-brand: #00a86b;/i);
    expect(read("frontend/styles/globals.css")).toMatch(/--rb-d-brand: #00a86b;/i);
    expect(read("apps/mobile/theme.ts")).toMatch(/brand: "#00a86b"/i);
  });

  it("the old dark logo green is not a brand colour anywhere", () => {
    for (const file of ["apps/mobile/app.json", "frontend/components/brand/logo-mark.tsx", "Branding/AppIcon.svg"]) {
      expect(read(file).toUpperCase()).not.toContain("#035B3B");
    }
  });
});

describe("app icons are OS-ready", () => {
  it("the App Store icon is 1024 square with no alpha channel", () => {
    // Colour type 2 is RGB. 6 would be RGBA, which App Store Connect rejects.
    expect(pngHeader("apps/mobile/assets/icon.png")).toEqual({ width: 1024, height: 1024, colourType: 2 });
  });

  it("the app-icon artwork is a full square, left for the OS to mask", () => {
    const icon = read("Branding/AppIcon.svg");
    expect(icon).toMatch(/<rect width="1024" height="1024" fill="#00A86B"\/>/);
    expect(icon).not.toMatch(/\srx=|rotate\(/);
  });

  it("Android adaptive layers are transparent over a flat background", () => {
    // 6 = RGBA: the foreground and monochrome must be see-through around the mark.
    expect(pngHeader("apps/mobile/assets/android-icon-foreground.png").colourType).toBe(6);
    expect(pngHeader("apps/mobile/assets/android-icon-monochrome.png").colourType).toBe(6);
  });

  it("every icon the manifest and layout declare exists at its declared size", () => {
    const manifest = read("frontend/app/manifest.ts");
    for (const match of manifest.matchAll(/src: "\/brand\/([^"]+)", sizes: "(\d+)x\d+"/g)) {
      const { width } = pngHeader(`frontend/public/brand/${match[1]}`);
      expect(width, match[1]).toBe(Number(match[2]));
    }
  });
});

describe("store listing assets", () => {
  it("the Google Play icon is 512 square, 32-bit, under 1 MB", () => {
    // Colour type 6 is RGBA, the "32-bit PNG" Play asks for.
    expect(pngHeader("store-assets/google-play/icon-512.png")).toEqual({ width: 512, height: 512, colourType: 6 });
    expect(readFileSync(join(REPO, "store-assets/google-play/icon-512.png")).length).toBeLessThan(1024 * 1024);
  });

  it("the App Store reference copy is the build's icon, byte for byte", () => {
    const reference = readFileSync(join(REPO, "store-assets/app-store/app-icon-1024.png"));
    expect(reference.equals(readFileSync(join(REPO, "apps/mobile/assets/icon.png")))).toBe(true);
  });

  it("the store docs name the real bundle ID and the generated icon", () => {
    const appStore = read("docs/app-store/SUBMISSION.md");
    expect(appStore).toContain("`fit.reviewboost.app`");
    expect(appStore).not.toContain("fit.reviewboost.fit");
    expect(read("docs/google-play/SUBMISSION.md")).toContain("store-assets/google-play/icon-512.png");
  });
});
