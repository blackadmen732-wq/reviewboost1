#!/usr/bin/env node
/**
 * The two objects in the iPhone app's "Set up tap" picture: the owner's Tag
 * and their phone, as PNGs at 1x, 2x and 3x.
 *
 * The website draws the same picture as live SVG
 * (`frontend/features/tags/nfc-visuals.tsx`). The app has no SVG renderer and
 * adding one means a native module and a new build for two drawings, so the
 * app animates these images instead. Same numbers as the web drawing, in each
 * object's own box; keep the two in step.
 *
 *   node scripts/brand/generate-nfc-art.mjs
 *
 * Uses the frontend's own `sharp` (run `npm ci` in frontend/ first). Never
 * edit the PNGs by hand.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(root, "frontend", "package.json"));
const sharp = require("sharp");

const geometry = readFileSync(join(root, "frontend/components/brand/mark-geometry.ts"), "utf8");
const MARK_W = Number(/MARK_WIDTH = ([\d.]+)/.exec(geometry)[1]);
const MARK_H = Number(/MARK_HEIGHT = ([\d.]+)/.exec(geometry)[1]);
const MARK_PATHS = [...geometry.matchAll(/^\s+"(M[^"]+)",$/gm)].map((m) => m[1]);
if (MARK_PATHS.length !== 2) throw new Error("mark-geometry.ts did not give the two mark paths");

const BRAND = "#00a86b";
const INK = "#1a1a19";

const mark = (x, y) =>
  `<svg x="${x}" y="${y}" width="34" height="32" viewBox="0 0 ${MARK_W} ${MARK_H}">` +
  MARK_PATHS.map((d) => `<path d="${d}" fill="${BRAND}" fill-rule="evenodd"/>`).join("") +
  `</svg>`;

// A QR code's look, not a readable code: the same scatter as the web drawing.
const MODULES = [
  [8, 0], [10, 1], [12, 0], [9, 3], [11, 4], [8, 6], [12, 6], [10, 8],
  [0, 8], [2, 9], [4, 8], [6, 10], [1, 11], [3, 12], [5, 12],
  [8, 9], [9, 11], [11, 10], [13, 9], [15, 8], [17, 9], [19, 8], [20, 10],
  [14, 11], [16, 12], [18, 11], [20, 13], [8, 13], [10, 14], [12, 13],
  [9, 16], [11, 17], [8, 19], [10, 20], [12, 18], [14, 15], [16, 16],
  [18, 15], [20, 16], [15, 18], [17, 19], [19, 18], [14, 20], [18, 20], [20, 20],
];

function qr(x, y, size) {
  const c = size / 21;
  const r = (rx, ry, w, h, rr, fill = INK) =>
    `<rect x="${(x + rx * c).toFixed(2)}" y="${(y + ry * c).toFixed(2)}" width="${(w * c).toFixed(2)}" height="${(h * c).toFixed(2)}" rx="${(rr * c).toFixed(2)}" fill="${fill}"/>`;
  const finders = [[0, 0], [14, 0], [0, 14]]
    .map(([fx, fy]) => r(fx, fy, 7, 7, 1.2) + r(fx + 1, fy + 1, 5, 5, 0.8, "#ffffff") + r(fx + 2, fy + 2, 3, 3, 0.5))
    .join("");
  return finders + MODULES.map(([mx, my]) => r(mx, my, 1, 1, 0)).join("");
}

const TAG_W = 180;
const TAG_H = 116;
const tagSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TAG_W}" height="${TAG_H}" viewBox="0 0 ${TAG_W} ${TAG_H}">
<rect x="0.5" y="0.5" width="${TAG_W - 1}" height="${TAG_H - 1}" rx="19.5" fill="#ffffff" stroke="#000000" stroke-opacity="0.08"/>
${mark(16, 16)}
${qr(78, 14, 88)}
<g fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round">
<path d="M21 85.3a7.4 7.4 0 0 1 0 7.4"/><path d="M24.5 83.2a11.8 11.8 0 0 1 0 11.6"/><path d="M27.9 81.1a15.9 15.9 0 0 1 0 15.8"/>
</g>
</svg>`;

const PHONE_W = 104;
const PHONE_H = 204;
const phoneSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PHONE_W}" height="${PHONE_H}" viewBox="0 0 ${PHONE_W} ${PHONE_H}">
<defs>
<linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#e6e6ea"/><stop offset="0.3" stop-color="#9c9ca3"/><stop offset="0.52" stop-color="#f3f3f5"/><stop offset="0.76" stop-color="#8a8a91"/><stop offset="1" stop-color="#d6d6db"/>
</linearGradient>
<linearGradient id="glass" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#f1f1ef"/></linearGradient>
</defs>
<rect width="${PHONE_W}" height="${PHONE_H}" rx="26" fill="url(#metal)"/>
<rect x="3" y="3" width="98" height="198" rx="23" fill="#0c0d10"/>
<rect x="8" y="8" width="88" height="188" rx="18" fill="url(#glass)"/>
<rect x="35" y="14" width="34" height="10" rx="5" fill="#0c0d10"/>
${mark(35, 86)}
</svg>`;

const written = [];
for (const [name, svg, w, h] of [
  ["nfc-tag", tagSvg, TAG_W, TAG_H],
  ["nfc-phone", phoneSvg, PHONE_W, PHONE_H],
]) {
  for (const [scale, suffix] of [[1, ""], [2, "@2x"], [3, "@3x"]]) {
    const out = `apps/mobile/assets/${name}${suffix}.png`;
    const png = await sharp(Buffer.from(svg), { density: 72 * scale })
      .resize(w * scale, h * scale)
      .png({ compressionLevel: 9 })
      .toBuffer();
    writeFileSync(join(root, out), png);
    written.push(`${out} (${png.length} bytes)`);
  }
}
console.log(written.map((line) => `wrote ${line}`).join("\n"));
