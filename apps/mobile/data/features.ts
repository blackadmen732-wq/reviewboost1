import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Product switches the server decides (`frontend/lib/features.ts`), arriving
 * with Home as `features`. Texting is the only one: while it is off the app
 * shows Home, Feedback and Tags, and nothing that would offer a text.
 *
 * Two keys, both needed for the Texts tab:
 *
 * - this build must allow it — `EXPO_PUBLIC_TEXTING_ENABLED=true`, set in
 *   eas.json for the build that launches texting. App Review then sees the tab
 *   in the build it reviews, with the listing that describes it. A switch the
 *   server could turn on after review would be a hidden feature, which Apple
 *   does not allow (Guideline 2.3.1). The builds without it never show the tab.
 * - the server must say it is on. It can switch texting off at any moment,
 *   for every build, with no release.
 *
 * The server's last answer is kept on the phone so the tab bar is right from
 * the first frame of the next launch instead of growing a tab once Home loads
 * — the bar never jumps. Until the server has ever answered, texting reads as
 * off: a tab that appears late is a smaller fault than one that leads to a
 * refusal.
 */
export interface Features {
  texting: boolean;
}

export const FEATURES_OFF: Features = { texting: false };

/** Read at build time: Expo inlines `EXPO_PUBLIC_*` into the bundle. */
export const BUILD_ALLOWS_TEXTING = process.env.EXPO_PUBLIC_TEXTING_ENABLED === "true";

const KEY = "reviewboost.features.v1";

/** What the server said, read strictly: anything but `true` is off. */
export function featuresFrom(raw: unknown, buildAllowsTexting = BUILD_ALLOWS_TEXTING): Features {
  const said = (raw as { texting?: unknown } | null | undefined)?.texting === true;
  return { texting: buildAllowsTexting && said };
}

export async function readSavedFeatures(buildAllowsTexting = BUILD_ALLOWS_TEXTING): Promise<Features> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? featuresFrom(JSON.parse(raw), buildAllowsTexting) : FEATURES_OFF;
  } catch {
    return FEATURES_OFF;
  }
}

export function saveFeatures(features: Features): void {
  void AsyncStorage.setItem(KEY, JSON.stringify(features)).catch(() => undefined);
}
