#!/usr/bin/env node
// Offline Expo SDK 57 native dependency compatibility audit.
//
// Compares installed dependency versions against the versions Expo SDK 57
// bundles (expo/bundledNativeModules.json). Unlike `expo install --check`
// this needs no network, so it runs deterministically in CI and locally.
//
// Policy:
//   - BEHIND the SDK-57 range  -> hard failure (a real incompatibility risk)
//   - AHEAD of the range       -> warning only (a deliberate forward bump,
//                                 typically safe; surfaced for visibility)
//   - within range             -> ok
const semver = require("semver");
const bundled = require("expo/bundledNativeModules.json");
const pkg = require("../package.json");

const deps = { ...pkg.dependencies, ...pkg.devDependencies };
const behind = [];
const ahead = [];
let checked = 0;

for (const [name, want] of Object.entries(bundled)) {
  if (!deps[name]) continue;
  let installed;
  try {
    installed = require(`${name}/package.json`).version;
  } catch {
    continue; // not installed at this level; skip
  }
  checked++;
  if (semver.satisfies(installed, want, { includePrerelease: true })) continue;
  if (semver.gtr(installed, want, { includePrerelease: true })) {
    ahead.push(`${name} ${installed} (ahead of SDK-57 ${want})`);
  } else {
    behind.push(`${name} ${installed} is BEHIND SDK-57 ${want}`);
  }
}

console.log(`Audited ${checked} Expo-bundled dependencies against SDK 57.`);
for (const a of ahead) console.log(`::warning::native dep ahead of pin: ${a}`);
if (behind.length) {
  console.error(
    `::error::native dependency incompatible (behind SDK 57): ${behind.join(" | ")}`,
  );
  process.exit(1);
}
console.log(
  `OK: no dependency is behind SDK 57 (${ahead.length} ahead, informational).`,
);
