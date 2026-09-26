#!/usr/bin/env node
/**
 * Generate every ReviewBoost logo, icon and raster from one source.
 *
 *   Branding/Mark.svg      the R speech-bubble mark (hand-drawn, canonical)
 *   Branding/Wordmark.svg  "ReviewBoost" in outlines (scripts/brand/outline-wordmark.py)
 *
 * Everything else is output, and is overwritten on every run:
 *
 *   Branding/AppIcon.svg, Logo.svg, Logo-on-dark.svg
 *   frontend/components/brand/mark-geometry.ts   (the web mark reads this)
 *   frontend/public/brand/*                      (favicon, PWA, Apple touch, OG)
 *   apps/mobile/assets/*                         (iOS icon, Android adaptive layers)
 *
 * Nothing is edited by hand. Change the mark, run this, commit the result:
 *
 *   node scripts/brand/generate-brand-assets.mjs
 *
 * Uses the frontend's own `sharp` (run `npm ci` in frontend/ first).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(root, "frontend", "package.json"));
const sharp = require("sharp");

/** The one ReviewBoost green. A darker action green exists for UI text, never for the logo. */
const BRAND = "#00A86B";
const INK = "#171A18";
const INK_ON_DARK = "#F7F9F7";
const WHITE = "#FFFFFF";
const CANVAS = "#F6F7F5";

// ---------------------------------------------------------------------------
// Sources

function readSvg(path) {
  const source = readFileSync(join(root, path), "utf8");
  const viewBox = /viewBox="([^"]+)"/.exec(source)?.[1].split(/\s+/).map(Number);
  const paths = [...source.matchAll(/<path fill="(#[0-9A-Fa-f]{6})" d="([^"]+)"\/>/g)].map((m) => ({
    fill: m[1],
    d: m[2],
  }));
  if (!viewBox || viewBox.length !== 4 || paths.length === 0) {
    throw new Error(`${path} is not in the shape this script expects.`);
  }
  return { viewBox, paths };
}

const mark = readSvg("Branding/Mark.svg");
const wordmark = readSvg("Branding/Wordmark.svg");
const [, , MARK_W, MARK_H] = mark.viewBox;

// Where the mark's weight sits: left of the box centre, toward the heavy stem.
// Icons centre this point, not the bounding box. Documented in Mark.svg.
const OPTICAL = { x: 140, y: 134.5 };
// Farthest ink from that point (measured). Sizing to it keeps the leg and the
// foot inside every platform safe zone without guessing.
const OPTICAL_REACH = 198;

// ---------------------------------------------------------------------------
// SVG builders

const fmt = (n) => Number(n.toFixed(3)).toString();

/** The mark as a group, recoloured, scaled so its optical centre lands on (cx, cy). */
function markGroup({ fill, scale, cx, cy }) {
  const tx = cx - OPTICAL.x * scale;
  const ty = cy - OPTICAL.y * scale;
  const body = mark.paths.map((p) => `<path fill="${fill}" d="${p.d}"/>`).join("");
  return `<g transform="translate(${fmt(tx)} ${fmt(ty)}) scale(${fmt(scale)})">${body}</g>`;
}

function svg(width, height, body, extra = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width)} ${fmt(height)}" width="${fmt(width)}" height="${fmt(height)}"${extra}>${body}</svg>`;
}

/**
 * The app-icon artwork: a full square of brand green, the white mark centred.
 * No rounded corners and no rotation — iOS and Android apply their own mask.
 * `reach` is how far from the centre the farthest ink may go, as a fraction of
 * the canvas; 0.38 clears Apple's squircle and the PWA maskable 40% circle.
 */
function appIcon(size, { reach = 0.38, background = BRAND, ink = WHITE } = {}) {
  const scale = (size * reach) / OPTICAL_REACH;
  const bg = background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : "";
  return svg(size, size, bg + markGroup({ fill: ink, scale, cx: size / 2, cy: size / 2 }));
}

/**
 * Android adaptive foreground/monochrome: a transparent 108dp canvas of which a
 * launcher shows the middle 72dp. The mark gets the same reach, relative to
 * that visible 72dp, as it has on the iOS icon, so the two platforms look the
 * same size. That lands well inside the 66dp safe circle (reach 0.253 of the
 * canvas against 0.306), so no launcher mask can clip the leg or the foot.
 */
function adaptiveLayer(size, ink) {
  return appIcon(size, { reach: 0.38 * (72 / 108), background: null, ink });
}

/** Horizontal lockup: [mark] ReviewBoost, the wordmark centred on the mark. */
function lockup({ reviewInk }) {
  const [wx, wy, ww, wh] = wordmark.viewBox;
  // Cap height is 71 of the wordmark's 74-unit box; set it at 1/2.3 of the
  // mark's height, the proportion the web header uses (28px mark, 17px type).
  const wScale = MARK_H / 2.3 / 71;
  const gap = MARK_H * 0.25;
  const width = MARK_W + gap + ww * wScale;
  const ty = (MARK_H - wh * wScale) / 2;
  const [review, boost] = wordmark.paths;
  const words =
    `<g transform="translate(${fmt(MARK_W + gap - wx * wScale)} ${fmt(ty - wy * wScale)}) scale(${fmt(wScale)})">` +
    `<path fill="${reviewInk}" d="${review.d}"/><path fill="${BRAND}" d="${boost.d}"/></g>`;
  const markBody = mark.paths.map((p) => `<path fill="${BRAND}" d="${p.d}"/>`).join("");
  return svg(width, MARK_H, `<title>ReviewBoost</title>${markBody}${words}`, ' role="img"');
}

// ---------------------------------------------------------------------------
// Writers

const written = [];

function writeText(path, text) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
  written.push(path);
}

async function writePng(path, svgText, size, { opaque = false } = {}) {
  const [width, height] = Array.isArray(size) ? size : [size, size];
  const svgWidth = Number(/width="([\d.]+)"/.exec(svgText)[1]);
  // Rasterise at the target resolution rather than scaling a bitmap.
  let image = sharp(Buffer.from(svgText), { density: Math.max(72, (72 * width) / svgWidth) * 2 }).resize(
    width,
    height,
  );
  // App Store icons must have no alpha channel at all, not merely an opaque one.
  if (opaque) image = image.flatten({ background: BRAND }).removeAlpha();
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  await image.png({ compressionLevel: 9 }).toFile(full);
  written.push(path);
}

const HEADER = "<!-- Generated by scripts/brand/generate-brand-assets.mjs from Branding/Mark.svg. Do not edit by hand. -->\n";
const withHeader = (text) => text.replace(/^(<svg[^>]*>)/, `$1\n${HEADER}`);

// Brand SVGs
const appIconSvg = appIcon(1024);
writeText("Branding/AppIcon.svg", withHeader(appIconSvg) + "\n");
writeText("Branding/Logo.svg", withHeader(lockup({ reviewInk: INK })) + "\n");
writeText("Branding/Logo-on-dark.svg", withHeader(lockup({ reviewInk: INK_ON_DARK })) + "\n");

// The web component's geometry. logo-mark.tsx imports this; it never holds paths.
writeText(
  "frontend/components/brand/mark-geometry.ts",
  `// Generated by scripts/brand/generate-brand-assets.mjs from Branding/Mark.svg.
// Do not edit by hand: change Branding/Mark.svg and run the script.

/** The mark's own box. Ink touches every edge; there is no padding. */
export const MARK_WIDTH = ${MARK_W};
export const MARK_HEIGHT = ${MARK_H};

/**
 * The mark's paths, in order: the bowl (its counter is a hole wound the other
 * way, so the page shows through) and the rising leg.
 */
export const MARK_PATHS = [
${mark.paths.map((p) => `  ${JSON.stringify(p.d)},`).join("\n")}
] as const;

/**
 * The wordmark, "ReviewBoost" in Geist SemiBold outlines (Branding/Wordmark.svg).
 * Drawn as a logotype rather than live text so "Boost" can carry the brand
 * green, which text at this size could not (WCAG exempts logotypes).
 * The box is the cap height plus overshoot: 0.74em of the outlined type.
 */
export const WORDMARK_VIEWBOX = ${JSON.stringify(wordmark.viewBox.join(" "))};
export const WORDMARK_WIDTH = ${wordmark.viewBox[2]};
export const WORDMARK_HEIGHT = ${wordmark.viewBox[3]};
export const WORDMARK_REVIEW = ${JSON.stringify(wordmark.paths[0].d)};
export const WORDMARK_BOOST = ${JSON.stringify(wordmark.paths[1].d)};
`,
);

// Website
writeText("frontend/public/brand/mark.svg", readFileSync(join(root, "Branding/Mark.svg"), "utf8"));
writeText("frontend/public/brand/logo.svg", readFileSync(join(root, "Branding/Logo.svg"), "utf8"));
writeText("frontend/public/brand/icon.svg", readFileSync(join(root, "Branding/AppIcon.svg"), "utf8"));
for (const size of [16, 32, 180, 192, 512, 1024]) {
  await writePng(`frontend/public/brand/icon-${size}.png`, appIconSvg, size, { opaque: true });
}
// Same artwork: the 0.38 reach already sits inside the maskable 40% circle.
await writePng("frontend/public/brand/icon-maskable-512.png", appIconSvg, 512, { opaque: true });

{
  // Link previews: the lockup on the product canvas.
  const logo = lockup({ reviewInk: INK });
  const [lw, lh] = [Number(/width="([\d.]+)"/.exec(logo)[1]), MARK_H];
  const scale = 760 / lw;
  const inner = logo.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  const og = svg(
    1200,
    630,
    `<rect width="1200" height="630" fill="${CANVAS}"/>` +
      `<g transform="translate(${fmt((1200 - lw * scale) / 2)} ${fmt((630 - lh * scale) / 2)}) scale(${fmt(scale)})">${inner}</g>`,
  );
  await writePng("frontend/public/brand/og.png", og, [1200, 630], { opaque: true });
}

// Mobile app
await writePng("apps/mobile/assets/icon.png", appIconSvg, 1024, { opaque: true });
await writePng("apps/mobile/assets/favicon.png", appIconSvg, 48, { opaque: true });
await writePng("apps/mobile/assets/android-icon-foreground.png", adaptiveLayer(512, WHITE), 512);
await writePng(
  "apps/mobile/assets/android-icon-background.png",
  svg(512, 512, `<rect width="512" height="512" fill="${BRAND}"/>`),
  512,
);
await writePng("apps/mobile/assets/android-icon-monochrome.png", adaptiveLayer(432, WHITE), 432);

// The in-app mark (BrandLockup): 48pt tall at 1x, 2x and 3x, so it is sharp
// at any height the app sets up to that.
const markSvg = svg(MARK_W, MARK_H, mark.paths.map((p) => `<path fill="${BRAND}" d="${p.d}"/>`).join(""));
for (const [scale, suffix] of [
  [1, ""],
  [2, "@2x"],
  [3, "@3x"],
]) {
  const height = 48 * scale;
  await writePng(`apps/mobile/assets/logo-mark${suffix}.png`, markSvg, [Math.round((height * MARK_W) / MARK_H), height]);
}

// Retired outputs from the old hand-made set. Removing them here keeps a stale
// copy from being picked up again.
for (const stale of [
  "frontend/public/brand/icon-1024-square.png",
  "frontend/public/brand/icon-square.svg",
  "apps/mobile/assets/splash-icon.png",
]) {
  rmSync(join(root, stale), { force: true });
}

console.log(written.map((path) => `wrote ${path}`).join("\n"));
