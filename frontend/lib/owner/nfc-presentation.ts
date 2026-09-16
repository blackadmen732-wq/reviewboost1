import type { ProgramPhase } from "@/lib/owner/nfc-phases";

/**
 * What the owner sees, as opposed to what the machine is doing.
 *
 * The sequence underneath has eleven phases — looking, reading, found,
 * programming, checking — because each one is a real step with its own failure
 * mode, and the safety of the whole thing depends on keeping them distinct.
 *
 * None of that is the owner's problem. Showing five screens in a row made
 * holding a sticker near a phone feel like a firmware update. To the person at
 * the counter this is ONE action: hold the Tag there until it says Done.
 *
 * So the phases collapse into six scenes, and only the ones that genuinely
 * need a human decision interrupt.
 */
export type NfcScene =
  | "start"
  | "waiting"
  | "done"
  | "conflict"
  | "unreadable"
  | "partial";

/**
 * The single mapping from machine state to what is on screen.
 *
 * Every phase that is just work in progress lands on `waiting`. That is the
 * whole point: the owner is holding a Tag against a phone and cannot act on
 * "checking" any differently than on "programming".
 */
export function sceneForPhase(phase: ProgramPhase): NfcScene {
  switch (phase) {
    case "idle":
      return "start";
    case "hold":
    case "looking":
    case "reading":
    case "found":
    case "programming":
    case "checking":
      return "waiting";
    case "ready":
    // A Tag that already pointed here was not rewritten, and the owner does not
    // need to know the difference — it is ready either way.
    case "already":
      return "done";
    case "conflict":
      return "conflict";
    case "unconfirmed":
      return "partial";
    case "failed":
      return "unreadable";
  }
}

export interface SceneCopy {
  /** The one line that carries the scene. Short enough to read while holding a phone. */
  title: string;
  /** At most one supporting sentence. Often none. */
  body?: string;
  /** The main action, when the scene needs one. */
  action?: string;
  /** The way out, when leaving is a real choice rather than a cancel. */
  dismiss?: string;
}

export const NFC_SCENE_COPY: Record<NfcScene, SceneCopy> = {
  start: {
    title: "Program your Tag",
    body: "Hold your Tag near your phone.",
    action: "Start",
    dismiss: "Cancel",
  },
  waiting: {
    // The instruction on screen while the phone hunts for the chip. No progress,
    // no percentage: NFC gives no distance, so anything quantitative is a lie.
    title: "Hold Near Reader",
    body: "Keep the Tag close.",
    dismiss: "Cancel",
  },
  done: {
    title: "Done",
    body: "Customers can tap it now.",
  },
  conflict: {
    title: "This Tag already has something on it",
    body: "Replacing it will erase what is there.",
    action: "Replace",
    dismiss: "Cancel",
  },
  unreadable: {
    title: "Couldn’t read this Tag",
    body: "Nothing was written. Try again with the Tag held closer.",
    action: "Try again",
    dismiss: "Cancel",
  },
  partial: {
    // The chip is genuinely written. Telling someone to redo a physical write
    // that already succeeded is how a Tag gets programmed twice for no reason.
    title: "Your Tag works",
    body: "ReviewBoost couldn’t finish saving its setup.",
    action: "Finish setup",
    dismiss: "Close",
  },
};

/** Scenes where the phone is actively working, so the card reads as live. */
export function isWorking(scene: NfcScene): boolean {
  return scene === "waiting";
}

/**
 * How long the green check stays up before the sheet closes itself.
 *
 * Long enough to register as success, short enough that nobody reaches for a
 * button. Apple Pay's confirmation sits in about this range.
 */
export const DONE_DWELL_MS = 1_200;
