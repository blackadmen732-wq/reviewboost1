import { describe, expect, it } from "vitest";

import {
  failureCopy,
  NFC_FAILURE_COPY,
  NFC_SCENE_COPY,
  NOTHING_CHANGED,
  sceneForWriteState,
  tagDetected,
  writingCopy,
  type NfcFailure,
  type NfcScene,
  type WriteState,
} from "../../lib/nfc-scenes";

/**
 * Native and web must be the same product.
 *
 * The native Tag screen used to show its machine states directly: "Checking NFC
 * and reading tag…", then "Hold your phone to the NFC tag…", then "Verifying…",
 * each its own block. Now it is ready → writing → success or error, with two
 * exceptions, exactly as on the web.
 */
describe("the native write machine collapses into four visible states", () => {
  const WORKING: WriteState[] = ["checking", "writing", "verifying"];

  it("shows one writing scene for every step of the work", () => {
    for (const state of WORKING) {
      expect(sceneForWriteState(state), `${state} should not be its own screen`).toBe("writing");
    }
    expect(new Set(WORKING.map(sceneForWriteState)).size).toBe(1);
  });

  it("maps the normal path and the two exceptions", () => {
    expect(sceneForWriteState("idle")).toBe("ready");
    expect(sceneForWriteState("success")).toBe("success");
    expect(sceneForWriteState("error")).toBe("error");
    expect(sceneForWriteState("confirm-overwrite")).toBe("conflict");
    expect(sceneForWriteState("partial")).toBe("partial");
  });

  it("changes its words, not its screen, once the Tag is in range", () => {
    expect(tagDetected("checking")).toBe(false);
    expect(tagDetected("writing")).toBe(true);
    expect(writingCopy(false, "ios").body).toBe("Hold the top of your iPhone near the Tag.");
    expect(writingCopy(false, "android").body).not.toMatch(/top|iphone/i);
    expect(writingCopy(true, "ios").title).toBe("Writing Tag…");
  });
});

describe("the native words are the owner's, not the machine's", () => {
  const ALL: NfcScene[] = ["ready", "writing", "success", "error", "conflict", "partial"];
  const FAILURES = Object.keys(NFC_FAILURE_COPY) as NfcFailure[];

  function text(copy: { title: string; body?: string; action?: string; dismiss?: string }): string {
    return [copy.title, copy.body, copy.action, copy.dismiss].filter(Boolean).join(" ");
  }

  it("never says Stand, and names no internal machinery", () => {
    for (const copy of [...ALL.map((s) => NFC_SCENE_COPY[s]), ...FAILURES.map(failureCopy)]) {
      expect(/\bstand(s)?\b/i.test(text(copy))).toBe(false);
      expect(/NDEF|NTAG|RPC|provision|verify|overwrite|%|\bcm\b/i.test(text(copy))).toBe(false);
    }
  });

  it("gives the success scene nothing to press", () => {
    expect(NFC_SCENE_COPY.success.action).toBeUndefined();
    expect(NFC_SCENE_COPY.success.dismiss).toBeUndefined();
  });

  it("does not tell someone to rewrite a Tag that already works", () => {
    expect(NFC_SCENE_COPY.partial.action).toBe("Finish setup");
    expect(NFC_SCENE_COPY.partial.action).not.toMatch(/again|retry|write/i);
  });

  it("promises nothing changed only where no write was attempted", () => {
    expect(failureCopy("timeout").body).toContain(NOTHING_CHANGED);
    expect(failureCopy("not-writable").body).toContain(NOTHING_CHANGED);
    expect(failureCopy("write").body).not.toContain(NOTHING_CHANGED);
    expect(failureCopy("unconfirmed-write").body).not.toContain(NOTHING_CHANGED);
  });
});
