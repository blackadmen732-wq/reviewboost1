import { describe, expect, it } from "vitest";

import {
  NFC_SCENE_COPY,
  sceneForWriteState,
  type NfcScene,
  type WriteState,
} from "../../lib/nfc-scenes";

/**
 * Native and web must be the same product.
 *
 * The native Tag screen used to show its machine states directly: "Checking NFC
 * and reading tag…", then "Hold your phone to the NFC tag…", then "Verifying…",
 * each its own block. The web sheet had the same problem and was collapsed into
 * six scenes; this keeps the two from drifting apart again.
 */
describe("the native write machine collapses into one visible operation", () => {
  const WORKING: WriteState[] = ["checking", "writing", "verifying"];

  it("shows one waiting scene for every step of the work", () => {
    for (const state of WORKING) {
      expect(sceneForWriteState(state), `${state} should not be its own screen`).toBe("waiting");
    }
    expect(new Set(WORKING.map(sceneForWriteState)).size).toBe(1);
  });

  it("maps the states that need a person to their own scene", () => {
    expect(sceneForWriteState("confirm-overwrite")).toBe("conflict");
    expect(sceneForWriteState("error")).toBe("unreadable");
    expect(sceneForWriteState("partial")).toBe("partial");
    expect(sceneForWriteState("success")).toBe("done");
    expect(sceneForWriteState("idle")).toBe("start");
  });
});

describe("the native words are the owner's, not the machine's", () => {
  const ALL: NfcScene[] = ["start", "waiting", "done", "conflict", "unreadable", "partial"];

  function text(scene: NfcScene): string {
    const copy = NFC_SCENE_COPY[scene];
    return [copy.title, copy.body, copy.action, copy.dismiss].filter(Boolean).join(" ");
  }

  it("never says Stand, which is not what the product calls them", () => {
    for (const scene of ALL) {
      expect(/\bstand(s)?\b/i.test(text(scene)), `${scene} says Stand`).toBe(false);
    }
  });

  it("names no internal machinery", () => {
    for (const scene of ALL) {
      expect(/NDEF|NTAG|RPC|provision|verify|overwrite/i.test(text(scene)), scene).toBe(false);
    }
  });

  it("gives the success scene nothing to press", () => {
    expect(NFC_SCENE_COPY.done.action).toBeUndefined();
    expect(NFC_SCENE_COPY.done.dismiss).toBeUndefined();
  });

  it("does not tell someone to rewrite a Tag that already works", () => {
    expect(NFC_SCENE_COPY.partial.action).toBe("Finish setup");
    expect(NFC_SCENE_COPY.partial.action).not.toMatch(/again|retry|write/i);
  });
});
