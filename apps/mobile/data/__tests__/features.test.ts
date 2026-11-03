import { beforeEach, describe, expect, it, vi } from "vitest";

import eas from "../../eas.json";

const appStorage = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    setItem: vi.fn(async (k: string, v: string) => {
      appStorage.set(k, v);
    }),
    getItem: vi.fn(async (k: string) => appStorage.get(k) ?? null),
  },
}));

import { BUILD_ALLOWS_TEXTING, FEATURES_OFF, featuresFrom, readSavedFeatures, saveFeatures } from "../features";

/**
 * The Texts tab needs two keys: a build made to show it (App Review sees what
 * owners will see), and the server's switch (`features.texting` on Home).
 * Texting ships switched off, so anything short of a plain `true` — an older
 * server that sends nothing, a typo, a string — keeps the tab hidden.
 */
describe("featuresFrom", () => {
  it("turns texting on only for a real true, in a build that allows it", () => {
    expect(featuresFrom({ texting: true }, true)).toEqual({ texting: true });
    for (const raw of [undefined, null, {}, { texting: false }, { texting: "true" }, { texting: 1 }, "texting", 42]) {
      expect(featuresFrom(raw, true), JSON.stringify(raw)).toEqual({ texting: false });
    }
  });

  it("never shows the tab in a build that was not made for it, whatever the server says", () => {
    expect(featuresFrom({ texting: true }, false)).toEqual({ texting: false });
  });

  it("is a build made for it only when EXPO_PUBLIC_TEXTING_ENABLED is exactly true", () => {
    expect(BUILD_ALLOWS_TEXTING).toBe(process.env.EXPO_PUBLIC_TEXTING_ENABLED === "true");
  });

  it("is not what the store builds are made as, until the release that launches texting", () => {
    // Setting it in eas.json is that release's decision, made with the listing
    // that describes the Texts tab (docs/mobile/APP_STORE_METADATA.md §13).
    const profiles: Record<string, { env?: Record<string, string> }> = eas.build;
    for (const [profile, settings] of Object.entries(profiles)) {
      expect(settings.env?.EXPO_PUBLIC_TEXTING_ENABLED, profile).toBeUndefined();
    }
  });
});

describe("the saved answer", () => {
  beforeEach(() => appStorage.clear());

  it("is off before the server has ever answered", async () => {
    await expect(readSavedFeatures()).resolves.toEqual(FEATURES_OFF);
  });

  it("comes back as it was saved, so the tab bar is right on the next launch", async () => {
    saveFeatures({ texting: true });
    await vi.waitFor(() => expect(appStorage.size).toBe(1));
    await expect(readSavedFeatures(true)).resolves.toEqual({ texting: true });
    // ...and still off in a build that was not made for texting.
    await expect(readSavedFeatures(false)).resolves.toEqual({ texting: false });

    saveFeatures({ texting: false });
    await vi.waitFor(async () => expect(await readSavedFeatures(true)).toEqual({ texting: false }));
  });

  it("reads as off when what was saved is damaged", async () => {
    appStorage.set("reviewboost.features.v1", "{not json");
    await expect(readSavedFeatures(true)).resolves.toEqual(FEATURES_OFF);
  });
});
