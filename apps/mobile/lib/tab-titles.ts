/**
 * The name of each tab, by its route file in `app/(tabs)/`.
 *
 * The tab bar shows these, and a screen pushed on top of the tabs (a rating,
 * a Tag, Settings) names its back button after the tab underneath. Without a
 * title the tab group's back button was named after its folder, so VoiceOver
 * read "(tabs), back".
 */
export const TAB_TITLES = {
  home: "Home",
  feedback: "Feedback",
  "text-requests": "Texts",
  stands: "Tags",
} as const;

export type TabRoute = keyof typeof TAB_TITLES;

/** The tab a back button returns to. Before any tab is chosen, that is Home. */
export function tabTitle(routeName: string | undefined): string {
  return routeName && routeName in TAB_TITLES ? TAB_TITLES[routeName as TabRoute] : TAB_TITLES.home;
}
