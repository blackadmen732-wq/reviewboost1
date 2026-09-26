/**
 * The owner-visible NFC scenes, native side.
 *
 * Deliberately the same scenes and the same words as the web sheet
 * (`frontend/lib/owner/nfc-presentation.ts`); `nfc-parity.test.ts` in the
 * frontend reads this file and fails if the two drift. Someone who programs a
 * Tag on their phone in the morning and from the dashboard in the afternoon
 * should be doing the same thing twice, not learning two products.
 *
 * The write machine keeps all of its states — each is a real step with its own
 * failure mode — but reading, writing and verifying are not three screens. To
 * the person holding a Tag against a phone it is one action: ready, writing,
 * then success or an error. Two exceptions interrupt only because a person has
 * to decide: a Tag that already carries something, and a Tag that was written
 * but not recorded.
 */

export type WriteState =
  | "idle"
  | "checking"
  | "confirm-overwrite"
  | "writing"
  | "verifying"
  | "success"
  | "partial"
  | "error";

export type NfcScene = "ready" | "writing" | "success" | "error" | "conflict" | "partial";

export type NfcPlatform = "ios" | "android";

export function sceneForWriteState(state: WriteState): NfcScene {
  switch (state) {
    case "idle":
      return "ready";
    case "checking":
    case "writing":
    case "verifying":
      return "writing";
    case "success":
      return "success";
    case "confirm-overwrite":
      return "conflict";
    case "partial":
      return "partial";
    case "error":
      return "error";
  }
}

/** Whether the chip has been found — the words change, the screen does not. */
export function tagDetected(state: WriteState): boolean {
  return state === "writing" || state === "verifying";
}

export interface SceneCopy {
  title: string;
  body?: string;
  action?: string;
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
    // No progress and no distance: the hardware reports neither, and a bar
    // stuck at 80% is how people decide software is broken.
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
    // The chip is written. Telling somebody to redo a physical write that
    // succeeded is how a Tag gets programmed twice for no reason.
    title: "Your Tag works",
    body: "ReviewBoost couldn’t finish saving its setup.",
    action: "Finish setup",
    dismiss: "Close",
  },
};

/**
 * Where the reader is. An iPhone's is at the top edge. Android phones put it
 * somewhere on the back, and where exactly varies by model — so Android is
 * told "the back", never a place we cannot know.
 */
export const HOLD_HINT: Record<NfcPlatform, string> = {
  ios: "Hold the top of your iPhone near the Tag.",
  android: "Hold the Tag against the back of your phone.",
};

export const WRITING_DETECTED: SceneCopy = {
  title: "Writing Tag…",
  body: "Keep it there while ReviewBoost programs it.",
  dismiss: "Cancel",
};

export function writingCopy(detected: boolean, platform: NfcPlatform): SceneCopy {
  if (detected) return WRITING_DETECTED;
  return { ...NFC_SCENE_COPY.writing, body: HOLD_HINT[platform] };
}

/**
 * Why programming stopped, when we know. `nothingChanged` is a promise to the
 * owner, so it is true only where no write was attempted.
 */
export type NfcFailure =
  | "unreadable"
  | "timeout"
  | "not-writable"
  | "nfc-off"
  | "unsupported"
  | "network"
  | "signed-out"
  | "write"
  | "unconfirmed-write";

interface FailureCopy {
  title: string;
  body: string;
  nothingChanged: boolean;
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
  "nfc-off": {
    title: "NFC is turned off",
    body: "Turn on NFC in your phone’s settings, then try again.",
    nothingChanged: true,
    retry: true,
  },
  unsupported: {
    title: "This phone can’t program Tags",
    body: "The QR code on the Tag still works. To add NFC, use a phone that supports it.",
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
  // Written, but reading it back did not show our link. Something may be on
  // the chip, so this never claims nothing changed.
  "unconfirmed-write": {
    title: "Couldn’t check this Tag",
    body: "It may not open your page yet. Keep the Tag near your phone and try again.",
    nothingChanged: false,
    retry: true,
  },
};

export function failureCopy(failure: NfcFailure | null): SceneCopy {
  if (!failure) return NFC_SCENE_COPY.error;
  const copy = NFC_FAILURE_COPY[failure];
  return {
    title: copy.title,
    body: copy.nothingChanged ? `${copy.body} ${NOTHING_CHANGED}` : copy.body,
    ...(copy.retry ? { action: "Try again", dismiss: "Cancel" } : { dismiss: "Close" }),
  };
}

/** How long the check stays up before the screen returns to Tag detail. */
export const DONE_DWELL_MS = 1_200;
