import { describe, expect, it } from "vitest";

import * as native from "../../../apps/mobile/lib/nfc-scenes";
import * as web from "@/lib/owner/nfc-presentation";

/**
 * Someone who programs a Tag in the app in the morning and from the dashboard
 * in the afternoon should be doing the same thing twice, not learning two
 * products. The two copy files are separate because the two builds cannot
 * share a module; this is what keeps them one file in spirit.
 */
describe("the web sheet and the native screen say the same things", () => {
  const SCENES = ["ready", "writing", "success", "error", "conflict", "partial"] as const;

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
      if (key !== "unsupported") expect(b.body, key).toBe(a.body);
    }
  });
});
