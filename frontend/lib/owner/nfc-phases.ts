/**
 * Program Tag — Apple Pay–feel sequence.
 * Owner-facing words only. No NDEF, token, or RPC in these strings.
 */

export type ProgramPhase =
  | "idle"
  | "hold"
  | "looking"
  | "reading"
  | "confirm-overwrite"
  | "found"
  | "programming"
  | "checking"
  | "verifying"
  | "ready"
  | "partial"
  | "failed";

export const PROGRAM_PHASE_COPY: Record<
  ProgramPhase,
  { title: string; body: string }
> = {
  idle: {
    title: "Program this Tag",
    body: "Hold your phone near the Tag.",
  },
  hold: {
    title: "Hold near Tag",
    body: "Keep the phone still.",
  },
  looking: {
    title: "Looking…",
    body: "Hold near the Tag.",
  },
  reading: {
    title: "Reading Tag…",
    body: "Checking what is on this Tag.",
  },
  "confirm-overwrite": {
    title: "Tag has existing content",
    body: "This Tag already has something on it. Programming will replace it.",
  },
  found: {
    title: "Found",
    body: "This Tag is ready to program.",
  },
  programming: {
    title: "Programming…",
    body: "Keep holding.",
  },
  checking: {
    title: "Checking…",
    body: "Verifying the Tag.",
  },
  verifying: {
    title: "Recording…",
    body: "Saving the provisioning record.",
  },
  ready: {
    title: "Tag ready",
    body: "A customer can tap this now.",
  },
  partial: {
    title: "Tag programmed",
    body: "The Tag is programmed but ReviewBoost could not record it. Retry verification.",
  },
  failed: {
    title: "Could not program",
    body: "Try again, or use a blank Tag.",
  },
};

export function programFailureMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "This phone did not allow tagging. Allow it and try again.";
  }
  if (error instanceof DOMException && error.name === "NotSupportedError") {
    return "This phone cannot program a Tag.";
  }
  return "Could not program the Tag. Hold near it and try again.";
}
