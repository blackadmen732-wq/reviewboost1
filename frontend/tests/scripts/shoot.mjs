import { mkdir } from "node:fs/promises";
import { chromium, devices } from "@playwright/test";

const base = "http://127.0.0.1:3100";
const outDir = process.argv[2] ?? "/tmp/shots";
const shots = JSON.parse(process.argv[3] ?? "[]");

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();

for (const shot of shots) {
  const context = await browser.newContext({
    ...(shot.desktop
      ? { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 }
      : { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } }),
    colorScheme: shot.dark ? "dark" : "light",
  });
  const page = await context.newPage();
  if (shot.blockExternal) {
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  }
  await page.goto(`${base}${shot.path}`, { waitUntil: "networkidle" });
  if (shot.offline) await context.setOffline(true);
  if (shot.click) {
    for (const selector of [].concat(shot.click)) await page.click(selector);
  }
  if (shot.eval) await page.evaluate(shot.eval);
  await page.waitForTimeout(shot.wait ?? 700);
  await page.screenshot({ path: `${outDir}/${shot.name}.png`, fullPage: Boolean(shot.full) });
  console.log("shot", shot.name);
  await context.close();
}

await browser.close();
