import type { ProgramPhase } from "@/lib/owner/nfc-phases";

/**
 * What the owner sees, as opposed to what the machine is doing.
 *
 * The sequence underneath has eleven phases — looking, reading, found,
 * programming, checking — because each one is a real step with its own failure
 * mode, and the safety of the whole thing depends on keeping them distinct.
 *
 * None of that is the owner's problem. To the person at the counter this is ONE
 * action: hold the Tag there until it says it is ready. So the normal path is
 * four states — ready, writing, success, error — and only two exceptions ever
 * interrupt it, both because a person genuinely has to decide something:
 * a Tag that already carries something, and a Tag that was written but not
 * recorded.
 *
 * The native app (`apps/mobile/lib/nfc-scenes.ts`) carries the same scenes and
 * the same words; `nfc-parity.test.ts` holds the two together.
 */
export type NfcScene = "ready" | "writing" | "success" | "error" | "conflict" | "partial";

/**
 * Where the reader is. An iPhone's antenna is at the top edge; Android phones
 * put it somewhere on the back, and where exactly varies by model — so Android
 * gets told "the back", never a place we cannot know.
 */
export type NfcPlatform = "ios" | "android";

/**
 * The single mapping from machine state to what is on screen.
 *
 * Every phase that is just work in progress lands on `writing`. The owner is
 * holding a Tag against a phone and cannot act on "checking" any differently
 * than on "programming".
 */
export function sceneForPhase(phase: ProgramPhase): NfcScene {
  switch (phase) {
    case "idle":
      return "ready";
    case "hold":
    case "looking":
    case "reading":
    case "found":
    case "programming":
    case "checking":
      return "writing";
    case "ready":
    // A Tag that already pointed here was not rewritten, and the owner does not
    // need to know the difference — it is ready either way.
    case "already":
      return "success";
    case "conflict":
      return "conflict";
    case "unconfirmed":
      return "partial";
    case "failed":
      return "error";
  }
}

/**
 * Whether the phone has found the chip yet. Before that the owner is being
 * told where to hold it; after, only to keep it there. Same screen either way.
 */
export function tagDetected(phase: ProgramPhase): boolean {
  return phase === "found" || phase === "programming" || phase === "checking";
}

export interface SceneCopy {
  /** The one line that carries the scene. Short enough to read while holding a phone. */
  title: string;
  /** At most one supporting sentence or two. */
  body?: string;
  /** The main action, when the scene needs one. */
  action?: string;
  /** The way out, when leaving is a real choice rather than a cancel. */
  dismiss?: string;
}

export const NFC_SCENE_COPY: Record<NfcScene, SceneCopy> = {
  ready: {
    title: "Program your Tag",
    body: "Hold the Tag near your phone when you’re ready.",
    action: "Program NFC",
    dismiss: "Cancel",
  },
  writing: {
    // No progress, no percentage, no distance: NFC reports none of them, so
    // anything quantitative here would be invented.
    title: "Hold near your Tag",
    body: "Keep it there while ReviewBoost programs it.",
    dismiss: "Cancel",
  },
  success: {
    title: "Tag ready",
    body: "Customers can tap it now.",
  },
  error: {
    title: "Couldn’t program this Tag",
    body: "Keep the Tag near your phone and try again.",
    action: "Try again",
    dismiss: "Cancel",
  },
  conflict: {
    title: "This Tag already has something on it",
    body: "Replacing it will erase what is there.",
    action: "Replace",
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

/** Where to hold it, before the chip has been found. */
export const HOLD_HINT: Record<NfcPlatform, string> = {
  ios: "Hold the top of your iPhone near the Tag.",
  android: "Hold the Tag against the back of your phone.",
};

/** Once the chip is found: the same screen, the next instruction. */
export const WRITING_DETECTED: SceneCopy = {
  title: "Writing Tag…",
  body: "Keep it there while ReviewBoost programs it.",
  dismiss: "Cancel",
};

/** The writing scene's words for this moment and this phone. */
export function writingCopy(detected: boolean, platform: NfcPlatform): SceneCopy {
  if (detected) return WRITING_DETECTED;
  return { ...NFC_SCENE_COPY.writing, body: HOLD_HINT[platform] };
}

/**
 * Why programming stopped, when we know.
 *
 * `nothingChanged` is a promise to the owner, so it is true only where the
 * write was never attempted. A write that threw part-way is not one of them:
 * we do not know what the chip holds, and saying otherwise would be a guess.
 */
export type NfcFailure =
  | "unreadable"
  | "timeout"
  | "not-writable"
  | "permission"
  | "nfc-off"
  | "unsupported"
  | "network"
  | "signed-out"
  | "write";

interface FailureCopy {
  title: string;
  body: string;
  nothingChanged: boolean;
  /** False where trying again cannot help, so the screen does not offer it. */
  retry: boolean;
}

export const NOTHING_CHANGED = "Nothing on the Tag was changed.";

export const NFC_FAILURE_COPY: Record<NfcFailure, FailureCopy> = {
  unreadable: {
    title: "Couldn’t read this Tag",
    body: "Hold it still near your phone and try again.",
    nothingChanged: true,
    retry: true,
  },
  timeout: {
    title: "No Tag found",
    body: "Hold the Tag near your phone and try again.",
    nothingChanged: true,
    retry: true,
  },
  "not-writable": {
    title: "This Tag can’t be programmed",
    body: "It’s locked against changes. Try a different Tag.",
    nothingChanged: true,
    retry: true,
  },
  permission: {
    title: "NFC isn’t allowed",
    body: "Allow NFC for this site in Chrome’s site settings, then try again.",
    nothingChanged: true,
    retry: true,
  },
  "nfc-off": {
    title: "NFC is turned off",
    body: "Turn on NFC in your phone’s settings, then try again.",
    nothingChanged: true,
    retry: true,
  },
  unsupported: {
    title: "This phone can’t program Tags",
    body: "The QR code on the Tag still works. To add NFC, use the ReviewBoost app or Chrome on Android.",
    nothingChanged: true,
    retry: false,
  },
  network: {
    title: "Couldn’t reach ReviewBoost",
    body: "Check your connection and try again.",
    nothingChanged: true,
    retry: true,
  },
  "signed-out": {
    title: "Please sign in again",
    body: "Your session ended before the Tag was touched.",
    nothingChanged: true,
    retry: false,
  },
  write: {
    title: "Couldn’t program this Tag",
    body: "Keep the Tag near your phone and try again.",
    nothingChanged: false,
    retry: true,
  },
};

/** The error scene's words for one failure. */
export function failureCopy(failure: NfcFailure | null): SceneCopy {
  if (!failure) return NFC_SCENE_COPY.error;
  const copy = NFC_FAILURE_COPY[failure];
  return {
    title: copy.title,
    body: copy.nothingChanged ? `${copy.body} ${NOTHING_CHANGED}` : copy.body,
    ...(copy.retry ? { action: "Try again", dismiss: "Cancel" } : { dismiss: "Close" }),
  };
}

/**
 * A Web NFC exception, as a reason the owner can act on.
 *
 * Chrome's names, as it uses them: NotAllowedError when the permission is
 * refused, NotReadableError when the phone's NFC is switched off,
 * NotSupportedError when there is no reader — or, once a scan has already
 * worked, when this chip cannot take what we would write.
 */
export function webFailureFromError(error: unknown, stage: "read" | "write"): NfcFailure {
  const name =
    error instanceof DOMException || error instanceof Error ? error.name : undefined;
  switch (name) {
    case "NotAllowedError":
      return "permission";
    case "NotReadableError":
      return "nfc-off";
    case "NotSupportedError":
      return stage === "write" ? "not-writable" : "unsupported";
    default:
      return stage === "write" ? "write" : "unreadable";
  }
}

/** Scenes where the phone is actively working, so the figure reads as live. */
export function isWorking(scene: NfcScene): boolean {
  return scene === "writing";
}

/**
 * How long the green check stays up before the sheet closes itself.
 *
 * Long enough to register as success, short enough that nobody reaches for a
 * button. Apple Pay's confirmation sits in about this range.
 */
export const DONE_DWELL_MS = 1_200;
