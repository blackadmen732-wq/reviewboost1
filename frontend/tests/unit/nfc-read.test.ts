import { describe, expect, it } from "vitest";

import {
  classifyTagContents,
  isSameStandUrl,
  mayWriteWithoutConfirmation,
  type ReadRecord,
} from "@/lib/owner/nfc-read";

/**
 * What the chip already holds decides whether we may write to it.
 *
 * The sheet used to write immediately, so a hotel key, a transit card or
 * another business's Tag was replaced without being read. An NFC write cannot
 * be undone and owners program whatever sticker is in the drawer.
 */

const STAND = "https://reviewboost.fit/q/abc123";
const url = (text: string): ReadRecord => ({ recordType: "url", text });

describe("what is already on the Tag", () => {
  it("treats a blank Tag as safe to write", () => {
    const contents = classifyTagContents([], STAND, true);
    expect(contents).toEqual({ kind: "blank" });
    expect(mayWriteWithoutConfirmation(contents)).toBe(true);
  });

  it("recognises its own Tag and does not call for a rewrite", () => {
    const contents = classifyTagContents([url(STAND)], STAND, true);
    expect(contents.kind).toBe("ours");
    // "ours" is not "write without asking" — it is "do not write at all".
    expect(mayWriteWithoutConfirmation(contents)).toBe(false);
  });

  it("recognises its own Tag across trailing slashes, scheme and query", () => {
    for (const variant of [
      "https://reviewboost.fit/q/abc123/",
      "http://reviewboost.fit/q/abc123",
      "https://reviewboost.fit/q/abc123?utm_source=nfc",
    ]) {
      expect(isSameStandUrl(variant, STAND)).toBe(true);
      expect(classifyTagContents([url(variant)], STAND, true).kind).toBe("ours");
    }
  });

  it("does not mistake a different Tag for its own", () => {
    // Overwriting this would silently retarget a sticker on another counter.
    const other = "https://reviewboost.fit/q/zzz999";
    expect(isSameStandUrl(other, STAND)).toBe(false);

    const contents = classifyTagContents([url(other)], STAND, true);
    expect(contents.kind).toBe("other");
    expect(mayWriteWithoutConfirmation(contents)).toBe(false);
  });

  it("requires confirmation for somebody else's data, and says what it is", () => {
    const contents = classifyTagContents([url("https://example.com/door")], STAND, true);
    expect(contents).toEqual({ kind: "other", description: "a link to example.com" });
    expect(mayWriteWithoutConfirmation(contents)).toBe(false);

    const text = classifyTagContents([{ recordType: "text", text: "room 402" }], STAND, true);
    expect(text).toEqual({ kind: "other", description: "some text" });

    const file = classifyTagContents([{ recordType: "mime", text: null }], STAND, true);
    expect(file).toEqual({ kind: "other", description: "a file" });
  });

  it("never reads a failed read as blank", () => {
    // The whole point: "we could not find out" is not "there is nothing there".
    const contents = classifyTagContents([], STAND, false);
    expect(contents).toEqual({ kind: "unreadable" });
    expect(mayWriteWithoutConfirmation(contents)).toBe(false);
  });

  it("treats a Tag carrying records it cannot decode as somebody else's", () => {
    const contents = classifyTagContents([{ recordType: "unknown", text: null }], STAND, true);
    expect(contents.kind).toBe("other");
    expect(mayWriteWithoutConfirmation(contents)).toBe(false);
  });

  it("only writes unasked on a genuinely blank Tag", () => {
    const every = [
      classifyTagContents([], STAND, true),
      classifyTagContents([url(STAND)], STAND, true),
      classifyTagContents([url("https://example.com")], STAND, true),
      classifyTagContents([], STAND, false),
    ];
    expect(every.filter(mayWriteWithoutConfirmation)).toHaveLength(1);
  });

  it("does not treat unparseable text as a matching URL", () => {
    expect(isSameStandUrl("not a url", STAND)).toBe(false);
    expect(classifyTagContents([{ recordType: "text", text: "not a url" }], STAND, true).kind).toBe(
      "other",
    );
  });
});
