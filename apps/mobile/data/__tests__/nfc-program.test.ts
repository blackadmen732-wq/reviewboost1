import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The NFC library, faked: one Tag in range, whose contents and behaviour each
 * test sets. The real NDEF encoder is used, so records are the bytes a phone
 * would really read.
 */
const tag = {
  id: "04A1B2C3" as string | null,
  records: [] as unknown[],
  readOnly: false,
  writeError: null as Error | null,
  readBackRecords: null as unknown[] | null,
  requestError: null as Error | null,
};
const calls: string[] = [];

vi.mock("react-native-nfc-manager", async () => {
  const Ndef = (await import("react-native-nfc-manager/ndef-lib")).default;
  class NfcErrorBase extends Error {}
  const NfcError = {
    NfcErrorBase,
    UserCancel: class extends NfcErrorBase {},
    Timeout: class extends NfcErrorBase {},
    TagNotWritable: class extends NfcErrorBase {},
    RadioDisabled: class extends NfcErrorBase {},
    UnsupportedFeature: class extends NfcErrorBase {},
  };
  let written: unknown[] | null = null;
  const manager = {
    requestTechnology: vi.fn(async () => {
      calls.push("request");
      written = null;
      if (tag.requestError) throw tag.requestError;
    }),
    getTag: vi.fn(async () => ({ id: tag.id, ndefMessage: tag.records })),
    cancelTechnologyRequest: vi.fn(async () => calls.push("cancel")),
    setAlertMessageIOS: vi.fn(async () => undefined),
    invalidateSessionWithErrorIOS: vi.fn(async () => undefined),
    ndefHandler: {
      getNdefStatus: vi.fn(async () => ({ status: tag.readOnly ? 3 : 2, capacity: 137 })),
      writeNdefMessage: vi.fn(async (bytes: number[]) => {
        calls.push("write");
        if (tag.writeError) throw tag.writeError;
        written = Ndef.decodeMessage(bytes);
      }),
      getNdefMessage: vi.fn(async () => ({ ndefMessage: tag.readBackRecords ?? written ?? [] })),
    },
  };
  return {
    default: manager,
    Ndef,
    NfcError,
    NfcTech: { Ndef: "Ndef" },
    NdefStatus: { NotSupported: 1, ReadWrite: 2, ReadOnly: 3 },
  };
});

import { Ndef, NfcError } from "react-native-nfc-manager";
import { programTag } from "../../lib/nfc";

const URL = "https://reviewboost.fit/q/abc123";
const OPTIONS = { platform: "ios" as const, alertMessage: "Hold the top of your iPhone near the Tag." };

function uri(link: string) {
  return Ndef.decodeMessage(Ndef.encodeMessage([Ndef.uriRecord(link)]))[0];
}

beforeEach(() => {
  tag.id = "04A1B2C3";
  tag.records = [];
  tag.readOnly = false;
  tag.writeError = null;
  tag.readBackRecords = null;
  tag.requestError = null;
  calls.length = 0;
});

describe("programming a Tag in one session", () => {
  it("reads, writes and reads back a blank Tag without a second session", async () => {
    const detected = vi.fn();
    const outcome = await programTag(URL, { ...OPTIONS, onDetected: detected });

    expect(outcome).toEqual({ kind: "written" });
    expect(detected).toHaveBeenCalledTimes(1);
    // One system sheet on an iPhone, not two.
    expect(calls.filter((c) => c === "request")).toHaveLength(1);
    expect(calls.filter((c) => c === "write")).toHaveLength(1);
  });

  it("does not rewrite a Tag that already points here", async () => {
    tag.records = [uri(URL)];
    expect(await programTag(URL, OPTIONS)).toEqual({ kind: "already" });
    expect(calls).not.toContain("write");
  });

  it("never writes over something else without being told to", async () => {
    tag.records = [uri("https://hotel.example/room-402")];
    const outcome = await programTag(URL, OPTIONS);

    expect(outcome).toEqual({ kind: "conflict", description: "a link to hotel.example", tagId: "04A1B2C3" });
    expect(calls).not.toContain("write");
  });

  it("replaces it once the owner says so — that Tag, and only that Tag", async () => {
    tag.records = [uri("https://hotel.example/room-402")];
    const replace = { tagId: "04A1B2C3", description: "a link to hotel.example" };

    tag.id = "04FFFFFF"; // a different chip brought up after the owner agreed
    const other = await programTag(URL, { ...OPTIONS, replace });
    expect(other.kind).toBe("conflict");
    expect(calls).not.toContain("write");

    tag.id = "04A1B2C3";
    expect(await programTag(URL, { ...OPTIONS, replace })).toEqual({ kind: "written" });
  });

  it("refuses a locked Tag before trying, and says nothing was written", async () => {
    tag.readOnly = true;
    expect(await programTag(URL, OPTIONS)).toEqual({ kind: "failed", failure: "not-writable" });
    expect(calls).not.toContain("write");
  });

  it("is not ready when the read-back does not show our link", async () => {
    tag.readBackRecords = [uri("https://elsewhere.example")];
    expect(await programTag(URL, OPTIONS)).toEqual({ kind: "failed", failure: "unconfirmed-write" });
  });

  it("reports a failed write as a write failure, not as nothing changed", async () => {
    tag.writeError = new Error("connection lost");
    expect(await programTag(URL, OPTIONS)).toEqual({ kind: "failed", failure: "write" });
  });

  it("names the reason when the library knows it", async () => {
    tag.requestError = new NfcError.Timeout();
    expect(await programTag(URL, OPTIONS)).toEqual({ kind: "failed", failure: "timeout" });

    tag.requestError = new NfcError.UserCancel();
    expect(await programTag(URL, OPTIONS)).toEqual({ kind: "cancelled" });
  });

  it("always ends the session", async () => {
    tag.writeError = new Error("boom");
    await programTag(URL, OPTIONS);
    expect(calls.at(-1)).toBe("cancel");
  });
});
