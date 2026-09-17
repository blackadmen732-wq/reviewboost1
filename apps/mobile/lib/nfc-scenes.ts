/**
 * The owner-visible NFC scenes, native side.
 *
 * Deliberately the same six scenes and the same words as the web sheet
 * (`frontend/lib/owner/nfc-presentation.ts`). Someone who programs a Tag on
 * their phone in the morning and from the dashboard in the afternoon should be
 * doing the same thing twice, not learning two products.
 *
 * The write machine keeps all eight of its states — each is a real step with
 * its own failure mode — but checking, writing and verifying are not three
 * screens. To the person holding a Tag against a phone it is one action.
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

export type NfcScene = "start" | "waiting" | "done" | "conflict" | "unreadable" | "partial";

export function sceneForWriteState(state: WriteState): NfcScene {
  switch (state) {
    case "idle":
      return "start";
    case "checking":
    case "writing":
    case "verifying":
      return "waiting";
    case "success":
      return "done";
    case "confirm-overwrite":
      return "conflict";
    case "partial":
      return "partial";
    case "error":
      return "unreadable";
  }
}

export interface SceneCopy {
  title: string;
  body?: string;
  action?: string;
  dismiss?: string;
}

export const NFC_SCENE_COPY: Record<NfcScene, SceneCopy> = {
  start: {
    title: "Program your Tag",
    body: "Hold your Tag near your phone.",
    action: "Program NFC",
  },
  waiting: {
    // No progress and no distance: the hardware reports neither, and a bar
    // stuck at 80% is how people decide software is broken.
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
    // The chip is written. Telling somebody to redo a physical write that
    // succeeded is how a Tag gets programmed twice for no reason.
    title: "Your Tag works",
    body: "ReviewBoost couldn’t finish saving its setup.",
    action: "Finish setup",
    dismiss: "Close",
  },
};

/** How long the check stays up before the screen returns to Tag detail. */
export const DONE_DWELL_MS = 1_200;
