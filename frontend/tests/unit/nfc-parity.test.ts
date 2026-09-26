import { describe, expect, it } from "vitest";

import * as native from "../../../apps/mobile/lib/nfc-scenes";
import * as web from "@/lib/owner/nfc-presentation";

/**
 * Someone who programs a Tag in the app in the morning and from the dashboard
 * in the afternoon should be doing the same thing twice, not learning two
 * products. The two copy files are separate because the two builds cannot
 * share a module; this is what keeps them one file in spirit.
 *
 * The native file is compiled for this suite without the Expo app's tsconfig
 * (see the mobile-source plugin in vitest.config.mts), because the web jobs
 * never install Expo.
 */
describe("the web sheet and the native screen say the same things", () => {
  const SCENES = ["ready", "writing", "success", "error", "conflict", "partial"] as const;

  it("loads the native copy as it ships, not a stand-in", () => {
    expect(Object.keys(native.NFC_SCENE_COPY).sort()).toEqual([...SCENES].sort());
    expect(typeof native.sceneForWriteState).toBe("function");
  });

  it("has the same scenes, word for word", () => {
    for (const scene of SCENES) {
      expect(native.NFC_SCENE_COPY[scene], scene).toEqual(web.NFC_SCENE_COPY[scene]);
    }
  });

  it("tells each phone the same thing about where to hold it", () => {
    expect(native.HOLD_HINT).toEqual(web.HOLD_HINT);
    expect(native.WRITING_DETECTED).toEqual(web.WRITING_DETECTED);
    expect(native.NOTHING_CHANGED).toBe(web.NOTHING_CHANGED);
    expect(native.DONE_DWELL_MS).toBe(web.DONE_DWELL_MS);
    for (const platform of ["ios", "android"] as const) {
      for (const detected of [false, true]) {
        expect(native.writingCopy(detected, platform), `${platform} ${detected}`).toEqual(
          web.writingCopy(detected, platform),
        );
      }
    }
  });

  it("names shared failures the same way", () => {
    // Where a failure exists on both, its title, promise and retry match.
    // Bodies may differ only where the platform genuinely does: what to use
    // instead of an unsupported phone.
    const shared = Object.keys(web.NFC_FAILURE_COPY).filter(
      (key) => key in native.NFC_FAILURE_COPY,
    ) as Array<keyof typeof web.NFC_FAILURE_COPY & keyof typeof native.NFC_FAILURE_COPY>;
    expect(shared.length).toBeGreaterThanOrEqual(7);
    for (const key of shared) {
      const a = web.NFC_FAILURE_COPY[key];
      const b = native.NFC_FAILURE_COPY[key];
      expect(b.title, key).toBe(a.title);
      expect(b.nothingChanged, key).toBe(a.nothingChanged);
      expect(b.retry, key).toBe(a.retry);
      if (key !== "unsupported") {
        expect(b.body, key).toBe(a.body);
        expect(native.failureCopy(key), key).toEqual(web.failureCopy(key));
      }
    }
    expect(native.failureCopy(null)).toEqual(web.failureCopy(null));
  });

  it("maps its machine onto the same four states and two exceptions", () => {
    const nativeStates = [
      "idle", "checking", "confirm-overwrite", "writing", "verifying", "success", "partial", "error",
    ] as const;
    const reached = new Set(nativeStates.map((state) => native.sceneForWriteState(state)));
    expect([...reached].sort()).toEqual([...SCENES].sort());
    // The working steps are one screen on both platforms.
    expect(native.sceneForWriteState("checking")).toBe(web.sceneForPhase("reading"));
    expect(native.sceneForWriteState("verifying")).toBe(web.sceneForPhase("checking"));
  });
});
