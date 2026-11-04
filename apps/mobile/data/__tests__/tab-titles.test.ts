import { describe, expect, it } from "vitest";

import { TAB_TITLES, tabTitle } from "@/lib/tab-titles";

/**
 * A screen pushed over the tabs names its back button after the tab beneath
 * it. The tab group had no title, so VoiceOver read the folder name:
 * "(tabs), back".
 */
describe("tab titles", () => {
  it("names each tab route with the owner's words, the same as the website's bar", () => {
    expect(TAB_TITLES).toEqual({ home: "Home", feedback: "Feedback", "text-requests": "Texts", stands: "Tags" });
  });

  it("names the back button after the open tab, and never the folder", () => {
    expect(tabTitle("feedback")).toBe("Feedback");
    expect(tabTitle("stands")).toBe("Tags");
    expect(tabTitle(undefined)).toBe("Home");
    expect(tabTitle("(tabs)")).toBe("Home");
  });
});
