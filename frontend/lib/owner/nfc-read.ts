/**
 * What is already on an NFC chip, decided before anything is written to it.
 *
 * Kept separate from the sheet, and free of any Web NFC type, so the decision
 * that guards an irreversible write is testable without a phone. The sheet's
 * job is to obtain the records; this file's job is to decide what they mean.
 */

import { describeExistingRecord, type TagContents } from "@/lib/owner/nfc-phases";

/** One NDEF record, reduced to what the decision actually needs. */
export interface ReadRecord {
  recordType: string;
  /** Already decoded to text where the record carried any. */
  text: string | null;
}

/**
 * Two ReviewBoost URLs are the same Tag when they address the same token.
 *
 * Compared on origin and path rather than as strings: a chip written before the
 * site moved to https, or carrying a trailing slash or a tracking parameter,
 * still points at this Tag, and rewriting it would be a pointless write to a
 * chip that has a limited number of them.
 */
export function isSameStandUrl(candidate: string, standUrl: string): boolean {
  try {
    const a = new URL(candidate);
    const b = new URL(standUrl);
    const normalise = (path: string) => path.replace(/\/+$/, "");
    return a.host === b.host && normalise(a.pathname) === normalise(b.pathname);
  } catch {
    return false;
  }
}

/**
 * Classify a chip's contents against the Tag we are about to write.
 *
 * An empty record list is only `blank` when the read genuinely succeeded — the
 * caller says so with `readSucceeded`. A read that threw, timed out, or was
 * refused is `unreadable`, which is never safe to overwrite: the chip may be
 * someone's building pass, and "we could not read it" is not evidence that it
 * is empty.
 */
export function classifyTagContents(
  records: ReadRecord[],
  standUrl: string,
  readSucceeded: boolean,
): TagContents {
  if (!readSucceeded) return { kind: "unreadable" };
  if (records.length === 0) return { kind: "blank" };

  const ours = records.find(
    (record) => record.text !== null && isSameStandUrl(record.text, standUrl),
  );
  if (ours && ours.text) return { kind: "ours", url: ours.text };

  // Any record we did not put there is someone else's data, including records
  // pointing at a different ReviewBoost Tag — overwriting that would silently
  // retarget a sticker already on another counter.
  const first = records[0];
  if (!first) return { kind: "blank" };
  return { kind: "other", description: describeExistingRecord(first.recordType, first.text) };
}

/** Whether writing may proceed without asking the owner first. */
export function mayWriteWithoutConfirmation(contents: TagContents): boolean {
  return contents.kind === "blank";
}
