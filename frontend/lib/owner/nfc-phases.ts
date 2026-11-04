/**
 * Program Tag — Apple Pay–feel sequence.
 * Owner-facing words only. No NDEF, token, or RPC in these strings.
 */

export type ProgramPhase =
  | "idle"
  | "hold"
  | "looking"
  | "reading"
  | "found"
  | "conflict"
  | "already"
  | "programming"
  | "checking"
  | "ready"
  | "unconfirmed"
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
    title: "Checking the Tag…",
    body: "Seeing what is on it before writing anything.",
  },
  found: {
    title: "Found",
    body: "This Tag is ready to program.",
  },
  conflict: {
    title: "This Tag is already used",
    body: "Something else is written on it. Programming replaces it, and whatever used it will stop working.",
  },
  already: {
    title: "Already this Tag",
    body: "It points here. Nothing was rewritten.",
  },
  programming: {
    title: "Programming…",
    body: "Keep holding.",
  },
  checking: {
    title: "Checking…",
    body: "Making sure the right page opens.",
  },
  ready: {
    title: "Tag ready",
    body: "A customer can tap this now.",
  },
  unconfirmed: {
    title: "Tag programmed, ReviewBoost could not confirm it",
    body: "The Tag was written and works. We could not record it here, so it may still show as needing NFC. Retry — this does not rewrite the Tag.",
  },
  failed: {
    title: "Could not program",
    body: "Try again, or use a blank Tag.",
  },
};

/**
 * What was already on the chip, as far as we could tell.
 *
 * `unreadable` is not `blank`. A chip that cannot be read might be empty, might
 * be someone's door key, and might be locked — so it is the one case that must
 * never be silently overwritten.
 */
export type TagContents =
  | { kind: "blank" }
  | { kind: "ours"; url: string }
  | { kind: "other"; description: string }
  | { kind: "unreadable" };

/** A short, non-technical description of a record already on the chip. */
export function describeExistingRecord(recordType: string, text: string | null): string {
  if (text && /^https?:\/\//i.test(text)) {
    try {
      return `a link to ${new URL(text).hostname}`;
    } catch {
      return "a link";
    }
  }
  if (recordType === "url") return "a link";
  if (recordType === "text") return "some text";
  if (recordType === "mime") return "a file";
  return "something else";
}
