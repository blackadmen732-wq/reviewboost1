#!/usr/bin/env node
// Offline Expo SDK 57 native dependency compatibility audit.
//
// Compares installed dependency versions against the versions Expo SDK 57
// bundles (expo/bundledNativeModules.json). Unlike `expo install --check`
// this needs no network, so it runs deterministically in CI and locally.
//
// Policy: any version OUTSIDE Expo SDK 57's bundled range is a failure by
// default — behind OR ahead. Expo only tests the bundled ranges, so a forward
// bump (especially a major jump) is untested, not automatically safe. Specific
// forward versions that have been vetted for this app are listed in ALLOWLIST
// with an exact version and rationale; anything not satisfying the range and
// not exactly matching its allowlist entry fails.
const semver = require("semver");
const bundled = require("expo/bundledNativeModules.json");
const pkg = require("../package.json");

// Vetted forward bumps: package -> { version (exact), why }. Only the exact
// version listed is accepted; bump the entry (and re-vet) when you change one.
const ALLOWLIST = {
  "@react-native-async-storage/async-storage": {
    version: "3.1.1",
    why: "3.x supports RN 0.86 new architecture; passes tsc/tests/prebuild",
  },
  "react-native-get-random-values": {
    version: "2.0.0",
    why: "2.0.0 is the current RN 0.86-compatible release",
  },
  "react-native-screens": {
    version: "4.27.0",
    why: "patch/minor ahead of ~4.26.0; passes tsc/tests/prebuild",
  },
  "react-native-safe-area-context": {
    version: "5.9.0",
    why: "minor ahead of ~5.7.0; passes tsc/tests/prebuild",
  },
};

const deps = { ...pkg.dependencies, ...pkg.devDependencies };
const failures = [];
const allowed = [];
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

  const entry = ALLOWLIST[name];
  const direction = semver.gtr(installed, want, { includePrerelease: true })
    ? "ahead of"
    : "BEHIND";
  if (entry && entry.version === installed && direction === "ahead of") {
    allowed.push(`${name} ${installed} (${direction} SDK-57 ${want}; vetted: ${entry.why})`);
  } else {
    failures.push(`${name} ${installed} is ${direction} SDK-57 ${want}`);
  }
}

console.log(`Audited ${checked} Expo-bundled dependencies against SDK 57.`);
for (const a of allowed) console.log(`::warning::vetted forward bump: ${a}`);
if (failures.length) {
  console.error(
    `::error::native dependency outside SDK 57 range (not in vetted allowlist): ${failures.join(" | ")}`,
  );
  process.exit(1);
}
console.log(
  `OK: every Expo-bundled dependency is within SDK 57 range or a vetted forward bump (${allowed.length} vetted).`,
);
