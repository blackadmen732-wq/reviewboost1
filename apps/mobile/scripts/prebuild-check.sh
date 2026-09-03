#!/usr/bin/env bash
# Regenerate the native iOS/Android projects to inspect what an EAS build will
# produce — without dirtying the tracked project.
#
# `expo prebuild` edits package.json in place (it rewrites the android/ios
# scripts to `expo run:*` and touches dependencies). This project is a managed
# workflow, so those edits are unwanted: we only want to LOOK at the generated
# native config. This wrapper snapshots package.json / package-lock.json and
# restores them afterward, leaving the generated ./ios and ./android dirs (both
# gitignored) in place for inspection.
set -euo pipefail

cd "$(dirname "$0")/.."

snapshot="$(mktemp -d)"
cp package.json "$snapshot/package.json"
cp package-lock.json "$snapshot/package-lock.json"

restore() {
  cp "$snapshot/package.json" package.json
  cp "$snapshot/package-lock.json" package-lock.json
  rm -rf "$snapshot"
}
trap restore EXIT

npx expo prebuild --no-install --clean --platform all

echo
echo "Generated ./ios and ./android (gitignored) for inspection."
echo "package.json and package-lock.json were restored — the tracked tree is unchanged."
