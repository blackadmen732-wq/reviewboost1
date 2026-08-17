import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const staticRoot = join(process.cwd(), ".next", "static");
const forbiddenMarkers = ["Mario’s Pizza", "__RB_FIXTURE_CALLS__", "fixture-response-error"];

async function filesUnder(path) {
  const entries = await readdir(path);
  const files = [];
  for (const entry of entries) {
    const absolute = join(path, entry);
    if ((await stat(absolute)).isDirectory()) files.push(...(await filesUnder(absolute)));
    else files.push(absolute);
  }
  return files;
}

for (const file of await filesUnder(staticRoot)) {
  if (!/\.(?:js|json)$/.test(file)) continue;
  const content = await readFile(file, "utf8");
  for (const marker of forbiddenMarkers) {
    if (content.includes(marker)) {
      throw new Error(`Development fixture marker ${JSON.stringify(marker)} leaked into ${file}`);
    }
  }
}

console.log("Production client assets contain no development fixture markers.");
