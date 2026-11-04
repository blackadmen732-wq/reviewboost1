// Keep development-only permissions out of the App Store binary.
//
// expo-dev-client is a dependency so the development build can load bundles
// from a computer on the same network. Its config plugin writes
// NSLocalNetworkUsageDescription ("Expo Dev Launcher uses the local network…")
// and NSBonjourServices into every build's Info.plist, including production,
// where the dev launcher is not even compiled in. A purpose string that names a
// tool the shipped app does not contain is exactly the kind of inaccurate
// permission text App Review questions (Guideline 5.1.1(ii)), so production
// builds drop both keys.
//
// EAS sets EAS_BUILD_PROFILE for every build; local prebuilds can set it too:
//   EAS_BUILD_PROFILE=production npx expo prebuild --platform ios
const { withInfoPlist } = require("expo/config-plugins");

const DEVELOPMENT_ONLY_KEYS = ["NSLocalNetworkUsageDescription", "NSBonjourServices"];

function withProductionInfoPlist(config) {
  return withInfoPlist(config, (mod) => {
    if (process.env.EAS_BUILD_PROFILE !== "production") return mod;
    for (const key of DEVELOPMENT_ONLY_KEYS) delete mod.modResults[key];
    return mod;
  });
}

module.exports = withProductionInfoPlist;
