#!/usr/bin/env node
/**
 * Render the phone the owner previews their Customer Page in.
 *
 *   scripts/brand/phone-hardware.html   the 3D scene (source)
 *   frontend/public/devices/phone-hardware.webp   the picture (output)
 *
 * A drawn frame — gradients and box-shadows — cannot look like metal: metal is
 * what it reflects, and it reflects along its curve. So the phone is a 3D model
 * with a physically based titanium, lit by a small product-photography studio,
 * and rendered once to a transparent front view. The screen is an exact hole
 * where the live page shows through; the owner's preview is still the real
 * page, not part of this picture.
 *
 *   node scripts/brand/render-phone-hardware.mjs
 *
 * Uses the frontend's Playwright (run `npm ci` in frontend/ first) and a pinned
 * three.js it installs into the system temp directory — nothing is added to the
 * app. Where Chromium is preinstalled, set PLAYWRIGHT_CHROMIUM_EXECUTABLE, as
 * for the e2e tests.
 *
 * The geometry it prints is what frontend/styles/customer-page.css positions
 * the screen by (the .phone-frame section). Change the scene's sizes, change
 * those numbers with them.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const THREE_VERSION = "0.170.0";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const output = join(root, "frontend", "public", "devices", "phone-hardware.webp");
const require = createRequire(join(root, "frontend", "package.json"));
const { chromium } = require("playwright");

// A pinned three.js, outside the repository.
const threeHome = join(tmpdir(), `reviewboost-three-${THREE_VERSION}`);
const threeDir = join(threeHome, "node_modules", "three");
if (!existsSync(join(threeDir, "build", "three.module.js"))) {
  mkdirSync(threeHome, { recursive: true });
  execFileSync("npm", ["install", "--prefix", threeHome, "--no-save", "--no-audit", "--no-fund", `three@${THREE_VERSION}`], { stdio: "inherit" });
}

// Module scripts do not load from file://, so the scene is served locally.
const types = { ".html": "text/html", ".js": "text/javascript" };
const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  let file = null;
  if (path === "/") {
    file = join(here, "phone-hardware.html");
  } else if (path.startsWith("/three/")) {
    const candidate = normalize(join(threeDir, path.slice("/three/".length)));
    if (candidate.startsWith(threeDir + sep)) file = candidate;
  }
  if (!file || !existsSync(file)) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error(error));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.RESULT, null, { timeout: 300_000 });
  const { webp, geometry } = await page.evaluate(() => window.RESULT);

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, Buffer.from(webp.split(",")[1], "base64"));
  console.log(`wrote ${output}`);
  console.log(JSON.stringify(geometry, null, 2));
} finally {
  await browser.close();
  server.close();
}
