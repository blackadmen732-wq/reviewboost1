import { describe, expect, it, vi } from "vitest";

vi.mock("expo-router", () => ({ router: { navigate: vi.fn(), push: vi.fn() } }));
vi.mock("expo-linking", () => ({ openURL: vi.fn() }));

import { destinationFor } from "../../lib/destinations";

const TAG = "11111111-2222-3333-4444-555555555555";

describe("where a Home button goes in the app", () => {
  it("opens the app's own tab or screen for what the app can do", () => {
    expect(destinationFor("/feedback")).toEqual({ kind: "tab", path: "/(tabs)/feedback" });
    expect(destinationFor("/feedback?show=all")).toEqual({ kind: "tab", path: "/(tabs)/feedback" });
    expect(destinationFor("/stands")).toEqual({ kind: "tab", path: "/(tabs)/stands" });
    expect(destinationFor(`/stands/${TAG}`)).toEqual({ kind: "screen", path: `/stand/${TAG}` });
  });

  it("opens the website for what is edited there", () => {
    expect(destinationFor("/settings")).toMatchObject({ kind: "web" });
    expect(destinationFor("/customer-page")).toMatchObject({ kind: "web" });
  });

  it("never leads to Billing, whatever asks (App Store 3.1.3(f))", () => {
    expect(destinationFor("/settings/billing")).toEqual({ kind: "none" });
    expect(destinationFor("/settings/billing?plan=growth")).toEqual({ kind: "none" });
  });

  it("ignores anything it does not know", () => {
    expect(destinationFor("https://evil.example")).toEqual({ kind: "none" });
    expect(destinationFor("/stands/not-a-tag")).toEqual({ kind: "none" });
  });
});
