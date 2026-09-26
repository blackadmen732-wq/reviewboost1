/**
 * The public pages the app links to. App Store 5.1.1(i) requires the privacy
 * policy to be reachable inside the app, and 1.5 wants a way to reach us.
 *
 * They live on the same origin the app already calls (EXPO_PUBLIC_API_URL), so
 * a preview build links to the preview site's pages rather than production's.
 */
const SITE = (process.env.EXPO_PUBLIC_API_URL || "https://reviewboost.fit").replace(/\/+$/, "");

export const PUBLIC_LINKS = [
  { key: "privacy", label: "Privacy", url: `${SITE}/privacy` },
  { key: "terms", label: "Terms", url: `${SITE}/terms` },
  { key: "support", label: "Support", url: `${SITE}/support` },
] as const;
