import NfcManager, { Ndef, NdefStatus, NfcError, NfcTech, type NdefRecord } from "react-native-nfc-manager";

import type { NfcFailure, NfcPlatform } from "./nfc-scenes";

/**
 * Programming a Tag, as one NFC session.
 *
 * This used to be two: one session to read what was on the chip, then a second
 * to write it. On an iPhone every session is its own system sheet, so the
 * owner held the Tag up, watched it succeed, and was asked to hold it up again
 * — the opposite of one simple action. Now the chip is read, judged and
 * written while it is still in range, and the only reason to end the session
 * early is a Tag that already carries something, which a person has to decide
 * about.
 *
 * Nothing about safety changed in merging them:
 *   - the chip is always read before anything is written;
 *   - a chip carrying something else is never written without `replace`, and
 *     `replace` only covers the chip the owner was shown — a different one
 *     brought up afterwards is read and reported, not written;
 *   - after a write the chip is read back, and a mismatch is a failure;
 *   - recording the Tag with ReviewBoost stays the caller's job, so it can be
 *     retried without touching the chip again.
 */

export type TagContents =
  | { kind: "blank" }
  | { kind: "ours" }
  | { kind: "other"; description: string };

export type ProgramOutcome =
  /** Written, and read back as our link. */
  | { kind: "written" }
  /** It already pointed here, so nothing was written. */
  | { kind: "already" }
  /** Something else is on it. Nothing was written. */
  | { kind: "conflict"; description: string; tagId: string | null }
  /** The owner closed the system sheet. Nothing was written. */
  | { kind: "cancelled" }
  | { kind: "failed"; failure: NfcFailure };

export interface ProgramOptions {
  platform: NfcPlatform;
  /** The system sheet's words, on iPhone. */
  alertMessage: string;
  /** Set only after the owner has seen a conflict and chosen Replace. */
  replace?: { tagId: string | null; description: string } | null;
  /** Called once the chip is in range, so the screen can say "Writing Tag…". */
  onDetected?: () => void;
}

export async function isNfcSupported(): Promise<boolean> {
  try {
    return await NfcManager.isSupported();
  } catch {
    return false;
  }
}

export async function isNfcEnabled(): Promise<boolean> {
  try {
    return await NfcManager.isEnabled();
  } catch {
    return false;
  }
}

export async function initNfc(): Promise<boolean> {
  try {
    await NfcManager.start();
    return true;
  } catch {
    return false;
  }
}

/** What is on the chip, in words an owner can weigh before erasing it. */
export function classifyTag(records: NdefRecord[] | null | undefined, url: string): TagContents {
  const meaningful = (records ?? []).filter((record) => record.tnf !== Ndef.TNF_EMPTY);
  if (meaningful.length === 0) return { kind: "blank" };

  const first = meaningful[0]!;
  if (Ndef.isType(first, Ndef.TNF_WELL_KNOWN, Ndef.RTD_URI)) {
    const link = Ndef.uri.decodePayload(Uint8Array.from(first.payload));
    if (meaningful.length === 1 && link === url) return { kind: "ours" };
    return { kind: "other", description: describeLink(link) };
  }
  if (Ndef.isType(first, Ndef.TNF_WELL_KNOWN, Ndef.RTD_TEXT)) {
    return { kind: "other", description: "some text" };
  }
  return { kind: "other", description: "something else" };
}

function describeLink(link: string): string {
  try {
    return `a link to ${new URL(link).hostname}`;
  } catch {
    return "a link";
  }
}

/** A library exception, as a reason the owner can act on. */
export function nativeFailureFromError(error: unknown, attemptedWrite: boolean): NfcFailure | "cancelled" {
  if (error instanceof NfcError.UserCancel) return "cancelled";
  if (error instanceof NfcError.Timeout) return "timeout";
  if (error instanceof NfcError.TagNotWritable) return "not-writable";
  if (error instanceof NfcError.RadioDisabled) return "nfc-off";
  if (error instanceof NfcError.UnsupportedFeature) return "unsupported";
  return attemptedWrite ? "write" : "unreadable";
}

export async function programTag(url: string, options: ProgramOptions): Promise<ProgramOutcome> {
  let attemptedWrite = false;
  const ios = options.platform === "ios";

  try {
    await NfcManager.requestTechnology(NfcTech.Ndef, { alertMessage: options.alertMessage });
    options.onDetected?.();

    // Read first, always.
    const tag = await NfcManager.getTag();
    const contents = classifyTag(tag?.ndefMessage as NdefRecord[] | undefined, url);
    const tagId = typeof tag?.id === "string" && tag.id ? tag.id : null;

    if (contents.kind === "ours") {
      // Already pointing here: a write would spend a cycle on a correct chip.
      if (ios) await quietly(() => NfcManager.setAlertMessageIOS("Tag ready"));
      return { kind: "already" };
    }

    if (contents.kind === "other" && !coversThisTag(options.replace, tagId, contents.description)) {
      if (ios) {
        await quietly(() =>
          NfcManager.invalidateSessionWithErrorIOS("This Tag already has something on it."),
        );
      }
      return { kind: "conflict", description: contents.description, tagId };
    }

    const status = await NfcManager.ndefHandler.getNdefStatus().catch(() => null);
    if (status?.status === NdefStatus.ReadOnly) {
      return { kind: "failed", failure: "not-writable" };
    }

    const bytes = Ndef.encodeMessage([Ndef.uriRecord(url)]);
    if (!bytes) return { kind: "failed", failure: "write" };

    attemptedWrite = true;
    await NfcManager.ndefHandler.writeNdefMessage(bytes);

    // Read it back. A chip that does not now say our link is not "ready",
    // whatever the write call returned.
    const back = await NfcManager.ndefHandler.getNdefMessage().catch(() => null);
    const readBack = classifyTag(back?.ndefMessage as NdefRecord[] | undefined, url);
    if (readBack.kind !== "ours") {
      return { kind: "failed", failure: "unconfirmed-write" };
    }

    if (ios) await quietly(() => NfcManager.setAlertMessageIOS("Tag ready"));
    return { kind: "written" };
  } catch (error) {
    const failure = nativeFailureFromError(error, attemptedWrite);
    return failure === "cancelled" ? { kind: "cancelled" } : { kind: "failed", failure };
  } finally {
    await quietly(() => NfcManager.cancelTechnologyRequest());
  }
}

/**
 * Replace covers the chip the owner was shown and nothing else. Where the
 * phone reports an identifier that decides it; where it does not (an iPhone
 * reading NDEF), the same contents must still be on it.
 */
function coversThisTag(
  replace: ProgramOptions["replace"],
  tagId: string | null,
  description: string,
): boolean {
  if (!replace) return false;
  if (replace.tagId && tagId) return replace.tagId === tagId;
  return replace.description === description;
}

export async function cancelNfcRequest(): Promise<void> {
  await quietly(() => NfcManager.cancelTechnologyRequest());
}

async function quietly(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch {
    // Closing or captioning a session that has already ended is not an error.
  }
}
