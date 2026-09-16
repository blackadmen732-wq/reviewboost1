import { describe, expect, it } from "vitest";

import {
  isWorking,
  NFC_SCENE_COPY,
  sceneForPhase,
  type NfcScene,
} from "@/lib/owner/nfc-presentation";
import { PROGRAM_PHASE_COPY, type ProgramPhase } from "@/lib/owner/nfc-phases";

const ALL_PHASES = Object.keys(PROGRAM_PHASE_COPY) as ProgramPhase[];

/**
 * Programming a Tag is one action to the person doing it.
 *
 * The machine runs eleven phases — looking, reading, found, programming,
 * checking — and each is a real step with its own failure mode. Showing them in
 * sequence turned holding a sticker near a phone into something that looked
 * like a firmware update, and invited the owner to intervene mid-write.
 */
describe("the machine's phases collapse into one owner-visible operation", () => {
  const WORKING: ProgramPhase[] = [
    "hold",
    "looking",
    "reading",
    "found",
    "programming",
    "checking",
  ];

  it("shows a single waiting scene for every step of the work", () => {
    for (const phase of WORKING) {
      expect(sceneForPhase(phase), `${phase} should not be its own screen`).toBe("waiting");
    }
    // The decisive assertion: the owner cannot tell these apart, because to
    // them there is nothing to tell apart.
    expect(new Set(WORKING.map(sceneForPhase)).size).toBe(1);
  });

  it("treats a Tag that already pointed here as simply done", () => {
    // No rewrite happened, and the owner has no use for that distinction.
    expect(sceneForPhase("already")).toBe("done");
    expect(sceneForPhase("ready")).toBe("done");
  });

  it("interrupts only where a person actually has to decide", () => {
    expect(sceneForPhase("conflict")).toBe("conflict");
    expect(sceneForPhase("failed")).toBe("unreadable");
    expect(sceneForPhase("unconfirmed")).toBe("partial");
  });

  it("maps every phase, so no state can render a blank sheet", () => {
    for (const phase of ALL_PHASES) {
      expect(NFC_SCENE_COPY[sceneForPhase(phase)], `${phase} has no copy`).toBeDefined();
    }
  });

  it("marks only the waiting scene as live", () => {
    const scenes: NfcScene[] = ["start", "waiting", "done", "conflict", "unreadable", "partial"];
    expect(scenes.filter(isWorking)).toEqual(["waiting"]);
  });
});

describe("the copy is for a business owner, not an engineer", () => {
  const TECHNICAL = [
    "NDEF", "RPC", "token", "provision", "endpoint", "payload",
    "record", "API", "HTTP", "database", "server",
  ];

  it("names no internal machinery anywhere on screen", () => {
    for (const [scene, copy] of Object.entries(NFC_SCENE_COPY)) {
      const text = [copy.title, copy.body, copy.action, copy.dismiss]
        .filter(Boolean)
        .join(" ");
      for (const word of TECHNICAL) {
        expect(
          text.toLowerCase().includes(word.toLowerCase()),
          `${scene} says "${word}"`,
        ).toBe(false);
      }
    }
  });

  it("never says Stand, which is not what the product calls them", () => {
    for (const copy of Object.values(NFC_SCENE_COPY)) {
      const text = [copy.title, copy.body, copy.action, copy.dismiss].filter(Boolean).join(" ");
      expect(/\bstand(s)?\b/i.test(text)).toBe(false);
    }
  });

  it("gives the success scene nothing to press", () => {
    // It closes itself. A button here is one more decision after the work is
    // finished, and an invitation to program the same Tag twice.
    expect(NFC_SCENE_COPY.done.action).toBeUndefined();
    expect(NFC_SCENE_COPY.done.dismiss).toBeUndefined();
  });

  it("offers a way out of every scene that can stall", () => {
    for (const scene of ["start", "waiting", "conflict", "unreadable", "partial"] as NfcScene[]) {
      expect(NFC_SCENE_COPY[scene].dismiss, `${scene} traps the owner`).toBeTruthy();
    }
  });

  it("does not tell someone to rewrite a Tag that already works", () => {
    const partial = NFC_SCENE_COPY.partial;
    expect(partial.title).toMatch(/works/i);
    expect(partial.action).toMatch(/finish/i);
    // "Try again" here would mean redoing a physical write that succeeded.
    expect(partial.action).not.toMatch(/again|retry|program/i);
  });
});
