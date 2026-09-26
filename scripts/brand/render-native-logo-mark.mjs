#!/usr/bin/env node
/**
 * Regenerate the native app's logo-mark PNGs from the canonical mark.
 *
 * The one source of the ReviewBoost R is `frontend/components/brand/logo-mark.tsx`:
 * the bubble body, the arrow tail, and the mask that cuts the counter and the
 * rising stroke out of the bubble. The app cannot render that component (it
 * has no SVG runtime), so it ships rasters of it — and this is the only way
 * those rasters are made. Nothing is redrawn by hand; the paths are read out of
 * the component file as they are, so a change to the mark is a change here the
 * next time this runs.
 *
 *   node scripts/brand/render-native-logo-mark.mjs
 *
 * Uses the frontend's own `sharp` (run `npm ci` in frontend/ first).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(root, "frontend", "package.json"));
const sharp = require("sharp");

const source = readFileSync(join(root, "frontend/components/brand/logo-mark.tsx"), "utf8");
const width = Number(/INTRINSIC_WIDTH = (\d+(?:\.\d+)?)/.exec(source)?.[1]);
const height = Number(/INTRINSIC_HEIGHT = (\d+(?:\.\d+)?)/.exec(source)?.[1]);
const paths = [...source.matchAll(/\bd="([^"]+)"/g)].map((match) => match[1]);

// In file order: bubble body, arrow tail, counter (mask), rising stroke (mask).
if (!width || !height || paths.length !== 4) {
  throw new Error(
    `logo-mark.tsx no longer has the shape this script expects (${paths.length} paths). ` +
      "Update the script to match the mark rather than editing the PNGs by hand.",
  );
}
const [body, tail, counter, stroke] = paths;

// The approved brand green, as the component's fallback carries it.
const green = /var\(--rb-brand, (#[0-9A-Fa-f]{6})\)/.exec(source)?.[1] ?? "#00A86B";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><mask id="cut" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">
<rect width="${width}" height="${height}" fill="#fff"/>
<path d="${counter}" fill="#000"/>
<path d="${stroke}" fill="#000" stroke="#000" stroke-width="10"/>
</mask></defs>
<path d="${body}" fill="${green}" mask="url(#cut)"/>
<path d="${tail}" fill="${green}"/>
</svg>`;

// 28pt tall on screen, at 1x, 2x and 3x.
for (const [scale, suffix] of [[1, ""], [2, "@2x"], [3, "@3x"]]) {
  const out = join(root, "apps/mobile/assets", `logo-mark${suffix}.png`);
  await sharp(Buffer.from(svg), { density: 300 }).resize({ height: 28 * scale }).png().toFile(out);
  console.log(`wrote ${out}`);
}
