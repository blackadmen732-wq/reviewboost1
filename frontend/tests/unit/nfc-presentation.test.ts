import { describe, expect, it } from "vitest";

import {
  failureCopy,
  HOLD_HINT,
  isWorking,
  NFC_FAILURE_COPY,
  NFC_SCENE_COPY,
  NOTHING_CHANGED,
  sceneForPhase,
  tagDetected,
  webFailureFromError,
  writingCopy,
  type NfcFailure,
  type NfcScene,
} from "@/lib/owner/nfc-presentation";
import { PROGRAM_PHASE_COPY, type ProgramPhase } from "@/lib/owner/nfc-phases";

const ALL_PHASES = Object.keys(PROGRAM_PHASE_COPY) as ProgramPhase[];
const ALL_SCENES: NfcScene[] = ["ready", "writing", "success", "error", "conflict", "partial"];
const ALL_FAILURES = Object.keys(NFC_FAILURE_COPY) as NfcFailure[];

/**
 * Programming a Tag is one action to the person doing it.
 *
 * The machine runs eleven phases — looking, reading, found, programming,
 * checking — and each is a real step with its own failure mode. Showing them in
 * sequence turned holding a sticker near a phone into something that looked
 * like a firmware update, and invited the owner to intervene mid-write.
 */
describe("the machine's phases collapse into four owner-visible states", () => {
  const WORKING: ProgramPhase[] = ["hold", "looking", "reading", "found", "programming", "checking"];

  it("shows a single writing scene for every step of the work", () => {
    for (const phase of WORKING) {
      expect(sceneForPhase(phase), `${phase} should not be its own screen`).toBe("writing");
    }
    expect(new Set(WORKING.map(sceneForPhase)).size).toBe(1);
  });

  it("is ready → writing → success or error on the normal path", () => {
    expect(sceneForPhase("idle")).toBe("ready");
    expect(sceneForPhase("ready")).toBe("success");
    expect(sceneForPhase("failed")).toBe("error");
  });

  it("treats a Tag that already pointed here as simply ready", () => {
    expect(sceneForPhase("already")).toBe("success");
  });

  it("keeps the two exceptions where a person has to decide", () => {
    expect(sceneForPhase("conflict")).toBe("conflict");
    expect(sceneForPhase("unconfirmed")).toBe("partial");
  });

  it("maps every phase, so no state can render a blank sheet", () => {
    for (const phase of ALL_PHASES) {
      expect(NFC_SCENE_COPY[sceneForPhase(phase)], `${phase} has no copy`).toBeDefined();
    }
  });

  it("marks only the writing scene as live", () => {
    expect(ALL_SCENES.filter(isWorking)).toEqual(["writing"]);
  });

  it("changes the words, not the screen, once the Tag is found", () => {
    expect(tagDetected("looking")).toBe(false);
    expect(tagDetected("reading")).toBe(false);
    expect(tagDetected("programming")).toBe(true);
    expect(writingCopy(false, "android").title).toBe("Hold near your Tag");
    expect(writingCopy(true, "android").title).toBe("Writing Tag…");
    expect(writingCopy(true, "android").body).toBe("Keep it there while ReviewBoost programs it.");
  });

  it("tells each phone where its reader is, without assuming Android's", () => {
    expect(writingCopy(false, "ios").body).toBe("Hold the top of your iPhone near the Tag.");
    expect(HOLD_HINT.android).not.toMatch(/top|iphone/i);
    expect(HOLD_HINT.android).toMatch(/back/i);
  });
});

describe("the copy is for a business owner, not an engineer", () => {
  const TECHNICAL = [
    "NDEF", "RPC", "token", "provision", "endpoint", "payload",
    "record", "API", "HTTP", "database", "server", "verify",
  ];

  function allCopy(): Array<[string, string]> {
    const scenes = ALL_SCENES.map((scene): [string, string] => {
      const copy = NFC_SCENE_COPY[scene];
      return [scene, [copy.title, copy.body, copy.action, copy.dismiss].filter(Boolean).join(" ")];
    });
    const failures = ALL_FAILURES.map((failure): [string, string] => {
      const copy = failureCopy(failure);
      return [failure, [copy.title, copy.body, copy.action, copy.dismiss].filter(Boolean).join(" ")];
    });
    return [...scenes, ...failures, ["hint", Object.values(HOLD_HINT).join(" ")]];
  }

  it("names no internal machinery anywhere on screen", () => {
    for (const [where, text] of allCopy()) {
      for (const word of TECHNICAL) {
        expect(text.toLowerCase().includes(word.toLowerCase()), `${where} says "${word}"`).toBe(false);
      }
    }
  });

  it("never says Stand, and never claims a distance or a percentage", () => {
    for (const [where, text] of allCopy()) {
      expect(/\bstand(s)?\b/i.test(text), `${where} says Stand`).toBe(false);
      expect(/%|\bcm\b|inch|centimet|closer and closer/i.test(text), `${where} measures`).toBe(false);
    }
  });

  it("gives the success scene nothing to press", () => {
    expect(NFC_SCENE_COPY.success.action).toBeUndefined();
    expect(NFC_SCENE_COPY.success.dismiss).toBeUndefined();
  });

  it("offers a way out of every scene that can stall", () => {
    for (const scene of ["ready", "writing", "error", "conflict", "partial"] as NfcScene[]) {
      expect(NFC_SCENE_COPY[scene].dismiss, `${scene} traps the owner`).toBeTruthy();
    }
    for (const failure of ALL_FAILURES) {
      expect(failureCopy(failure).dismiss, `${failure} traps the owner`).toBeTruthy();
    }
  });

  it("does not tell someone to rewrite a Tag that already works", () => {
    const partial = NFC_SCENE_COPY.partial;
    expect(partial.title).toMatch(/works/i);
    expect(partial.action).toMatch(/finish/i);
    expect(partial.action).not.toMatch(/again|retry|program/i);
  });

  it("never replaces what is on a Tag without asking", () => {
    expect(NFC_SCENE_COPY.conflict.action).toBe("Replace");
    expect(NFC_SCENE_COPY.conflict.dismiss).toBe("Cancel");
    expect(NFC_SCENE_COPY.conflict.body).toMatch(/erase/i);
  });
});

describe("failures say what happened, and only promise what is true", () => {
  it("says nothing changed wherever the write was never attempted", () => {
    for (const failure of ALL_FAILURES.filter((f) => f !== "write")) {
      expect(failureCopy(failure).body, failure).toContain(NOTHING_CHANGED);
    }
  });

  it("does not claim nothing changed when a write failed part-way", () => {
    expect(failureCopy("write").body).not.toContain(NOTHING_CHANGED);
  });

  it("falls back to the plain error when the reason is unknown", () => {
    expect(failureCopy(null)).toEqual(NFC_SCENE_COPY.error);
    expect(failureCopy(null).title).toBe("Couldn’t program this Tag");
  });

  it("does not offer Try again where trying again cannot help", () => {
    expect(failureCopy("unsupported").action).toBeUndefined();
    expect(failureCopy("signed-out").action).toBeUndefined();
    expect(failureCopy("timeout").action).toBe("Try again");
  });

  it("reads Chrome's Web NFC errors as reasons", () => {
    const err = (name: string) => new DOMException("x", name);
    expect(webFailureFromError(err("NotAllowedError"), "read")).toBe("permission");
    expect(webFailureFromError(err("NotReadableError"), "read")).toBe("nfc-off");
    expect(webFailureFromError(err("NotSupportedError"), "read")).toBe("unsupported");
    expect(webFailureFromError(err("NotSupportedError"), "write")).toBe("not-writable");
    expect(webFailureFromError(err("NetworkError"), "write")).toBe("write");
    expect(webFailureFromError(new Error("?"), "read")).toBe("unreadable");
  });
});
