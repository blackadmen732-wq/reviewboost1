"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { NfcSheetView } from "@/features/tags/nfc-sheet-view";
import {
  DONE_DWELL_MS,
  failureCopy,
  NFC_SCENE_COPY,
  sceneForPhase,
  tagDetected,
  webFailureFromError,
  writingCopy,
  type NfcFailure,
  type SceneCopy,
} from "@/lib/owner/nfc-presentation";
import type { ProgramPhase, TagContents } from "@/lib/owner/nfc-phases";
import { classifyTagContents, type ReadRecord } from "@/lib/owner/nfc-read";
import { supabaseBrowser } from "@/lib/supabase/browser";

/** How long to wait for the chip to announce itself before giving up on a read. */
const READ_TIMEOUT_MS = 4_000;

/**
 * Web NFC exists only in Chrome on Android, so on the web the reader is always
 * somewhere on the back of the phone. The iPhone wording lives in the app.
 */
const PLATFORM = "android" as const;

/** A run that the owner cancelled, or that a newer run replaced. */
class Superseded extends Error {}

/**
 * Write the Tag, then record that it was written — and never confuse the two.
 *
 * Two things this sheet used to get wrong, both of which cost the owner
 * something real:
 *
 * It wrote immediately. Whatever was on the chip — a hotel key, a transit card,
 * another business's Tag — was replaced without being read, let alone mentioned.
 * An NFC write is not reversible and the owner is usually holding a sticker they
 * grabbed from a drawer.
 *
 * And it ignored the server's answer. The provisioning POST's result was
 * discarded, so a chip that was written while the network was down still showed
 * "Tag ready" — and then the Tag list kept saying it needed NFC, with no way to
 * reconcile the two except by rewriting a chip that was already correct.
 *
 * On screen all of that is one action: ready, writing, then success or an
 * error — with two interruptions only where a person has to decide.
 */
export function ProgramTagSheet({
  standId,
  open,
  onClose,
  onReady,
}: {
  standId: string;
  open: boolean;
  onClose: () => void;
  onReady: () => void;
}) {
  // Opens on the ready scene, not mid-operation. Web NFC will only scan or
  // write inside a user gesture, so the first tap has to come from the owner —
  // and a sheet that opens already saying "hold it there" is describing
  // something that has not begun.
  const [phase, setPhase] = useState<ProgramPhase>("idle");
  const [failure, setFailure] = useState<NfcFailure | null>(null);
  const [partialSignedOut, setPartialSignedOut] = useState(false);
  const [standUrl, setStandUrl] = useState<string | null>(null);
  const [existing, setExisting] = useState<TagContents | null>(null);

  /**
   * The run in flight. Cancelling aborts its scan and makes every later step of
   * it a no-op — above all the write. Closing the sheet used to leave the scan
   * running underneath, so a Tag brought near the phone afterwards could still
   * be written by a run the owner had already walked away from.
   */
  const run = useRef<AbortController | null>(null);

  const begin = useCallback((): AbortController => {
    run.current?.abort();
    const controller = new AbortController();
    run.current = controller;
    return controller;
  }, []);

  const guard = useCallback((controller: AbortController) => {
    if (controller.signal.aborted || run.current !== controller) throw new Superseded();
  }, []);

  const fail = useCallback((next: NfcFailure) => {
    setFailure(next);
    setPhase("failed");
  }, []);

  const close = useCallback(() => {
    run.current?.abort();
    run.current = null;
    setPhase("idle");
    setFailure(null);
    setExisting(null);
    setPartialSignedOut(false);
    onClose();
  }, [onClose]);

  const accessToken = useCallback(async (): Promise<string | null> => {
    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();
    return session?.access_token ?? null;
  }, []);

  /**
   * Tell the server this Tag is programmed.
   *
   * Separated from the write so it can be retried on its own: once the chip
   * carries the right URL, retrying must never mean writing to it again.
   */
  const confirmWithServer = useCallback(
    async (token: string): Promise<boolean> => {
      try {
        const response = await fetch(`/api/v1/review-stands/${standId}/nfc-provision`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: "{}",
        });
        return response.ok;
      } catch {
        return false;
      }
    },
    [standId],
  );

  /** Confirmed, or written-but-unrecorded. Never a reason to write again. */
  const settle = useCallback(
    async (controller: AbortController, token: string) => {
      setPhase("checking");
      const confirmed = await confirmWithServer(token);
      guard(controller);
      if (confirmed) {
        setPhase("ready");
        onReady();
      } else {
        setPhase("unconfirmed");
      }
    },
    [confirmWithServer, guard, onReady],
  );

  /** Retry only the server half. The chip is already correct. */
  const retryConfirmation = useCallback(async () => {
    const controller = begin();
    setPartialSignedOut(false);
    try {
      setPhase("checking");
      const token = await accessToken();
      guard(controller);
      if (!token) {
        setPartialSignedOut(true);
        setPhase("unconfirmed");
        return;
      }
      await settle(controller, token);
    } catch (caught) {
      if (!(caught instanceof Superseded)) throw caught;
    }
  }, [accessToken, begin, guard, settle]);

  /**
   * Write the URL, then confirm. Called only once the contents are known and,
   * where they were not blank, the owner has agreed to replace them.
   */
  const writeAndConfirm = useCallback(
    async (controller: AbortController, url: string, token: string) => {
      guard(controller);
      setPhase("programming");
      try {
        // @ts-expect-error Web NFC is not in lib.dom yet.
        const ndef = new NDEFReader();
        await ndef.write(
          { records: [{ recordType: "url", data: url }] },
          { signal: controller.signal },
        );
      } catch (caught) {
        guard(controller);
        fail(webFailureFromError(caught, "write"));
        return;
      }

      // Past this line the chip is correct whatever happens next, so no failure
      // below may send the owner back to writing it again.
      await settle(controller, token);
    },
    [fail, guard, settle],
  );

  /** Owner saw what was on the chip and chose to replace it. */
  const overwrite = useCallback(async () => {
    const controller = begin();
    try {
      const token = await accessToken();
      guard(controller);
      if (!standUrl || !token) {
        fail("signed-out");
        return;
      }
      await writeAndConfirm(controller, standUrl, token);
    } catch (caught) {
      if (!(caught instanceof Superseded)) throw caught;
    }
  }, [accessToken, begin, fail, guard, standUrl, writeAndConfirm]);

  const program = useCallback(async () => {
    const controller = begin();
    setFailure(null);
    setExisting(null);
    setPhase("looking");

    try {
      const token = await accessToken();
      guard(controller);
      if (!token) {
        fail("signed-out");
        return;
      }

      let url: string;
      try {
        const res = await fetch(`/api/v1/review-stands/${standId}/qr?format=json`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: "omit",
        });
        guard(controller);
        if (res.status === 401) {
          fail("signed-out");
          return;
        }
        if (!res.ok) throw new Error("url");
        const json = (await res.json()) as { data?: { standUrl?: string } };
        if (!json.data?.standUrl) throw new Error("url");
        url = json.data.standUrl;
        setStandUrl(url);
      } catch (caught) {
        if (caught instanceof Superseded) throw caught;
        fail("network");
        return;
      }

      if (!("NDEFReader" in window)) {
        fail("unsupported");
        return;
      }

      // Read first, always.
      setPhase("reading");
      const read = await readTag(url, controller.signal);
      guard(controller);
      setExisting(read.contents);

      if (read.contents.kind === "ours") {
        // Already pointing here. Writing again would burn a write cycle and
        // risk corrupting a chip that is correct; only the record is missing.
        setPhase("already");
        await settle(controller, token);
        return;
      }

      if (read.contents.kind === "unreadable") {
        // Unreadable is not blank: it might be empty, or somebody's door key,
        // or locked. It is never written blind.
        fail(read.failure ?? "unreadable");
        return;
      }

      if (read.contents.kind === "other") {
        setPhase("conflict");
        return;
      }

      setPhase("found");
      await writeAndConfirm(controller, url, token);
    } catch (caught) {
      if (!(caught instanceof Superseded)) throw caught;
    }
  }, [accessToken, begin, fail, guard, settle, standId, writeAndConfirm]);

  // The success scene closes itself. Nobody should have to dismiss a green
  // check, and leaving it up invites a second, pointless programming run.
  const scene = sceneForPhase(phase);
  useEffect(() => {
    if (scene !== "success") return undefined;
    const timer = setTimeout(close, DONE_DWELL_MS);
    return () => clearTimeout(timer);
  }, [scene, close]);

  if (!open) return null;

  const copy: SceneCopy =
    scene === "writing"
      ? writingCopy(tagDetected(phase), PLATFORM)
      : scene === "error"
        ? failureCopy(failure)
        : scene === "conflict" && existing?.kind === "other"
          ? // The one place a description of what was found is worth showing,
            // because the owner is about to erase it.
            {
              ...NFC_SCENE_COPY.conflict,
              body: `This Tag already has ${existing.description} on it. Replacing it will erase what is there.`,
            }
          : scene === "partial" && partialSignedOut
            ? { ...NFC_SCENE_COPY.partial, body: "Sign in again, then finish setup. Your Tag already works." }
            : NFC_SCENE_COPY[scene];

  const primary =
    scene === "conflict"
      ? () => void overwrite()
      : scene === "partial"
        ? () => void retryConfirmation()
        : () => void program();

  return (
    <NfcSheetView scene={scene} phase={phase} copy={copy} onPrimary={primary} onDismiss={close} />
  );
}

/**
 * Read whatever is on the chip, with a deadline.
 *
 * A scan that never fires is indistinguishable to the owner from a slow one, so
 * it is bounded — and a timeout reports `unreadable` rather than `blank`,
 * because the difference between "nothing is on it" and "we did not find out"
 * is the difference between a safe write and destroying someone's data.
 */
async function readTag(
  standUrl: string,
  signal: AbortSignal,
): Promise<{ contents: TagContents; failure?: NfcFailure }> {
  try {
    // @ts-expect-error Web NFC is not in lib.dom yet.
    const reader = new NDEFReader();
    const controller = new AbortController();
    const stop = () => controller.abort();
    signal.addEventListener("abort", stop, { once: true });

    const outcome = await new Promise<
      { records: ReadRecord[] } | { failure: NfcFailure }
    >((resolve) => {
      const timer = setTimeout(() => {
        controller.abort();
        resolve({ failure: "timeout" });
      }, READ_TIMEOUT_MS);

      reader.addEventListener(
        "reading",
        (event: { message?: { records?: Array<{ recordType: string; data?: BufferSource; encoding?: string }> } }) => {
          clearTimeout(timer);
          const found = event.message?.records ?? [];
          resolve({ records: found.map(decodeRecord) });
          controller.abort();
        },
        { once: true },
      );

      reader.addEventListener(
        "readingerror",
        () => {
          clearTimeout(timer);
          resolve({ failure: "unreadable" });
          controller.abort();
        },
        { once: true },
      );

      Promise.resolve(reader.scan({ signal: controller.signal })).catch((caught: unknown) => {
        clearTimeout(timer);
        resolve({ failure: webFailureFromError(caught, "read") });
      });
    });

    signal.removeEventListener("abort", stop);

    if ("failure" in outcome) {
      return { contents: { kind: "unreadable" }, failure: outcome.failure };
    }
    return { contents: classifyTagContents(outcome.records, standUrl, true) };
  } catch (caught) {
    return { contents: { kind: "unreadable" }, failure: webFailureFromError(caught, "read") };
  }
}

function decodeRecord(record: {
  recordType: string;
  data?: BufferSource;
  encoding?: string;
}): ReadRecord {
  let text: string | null = null;
  try {
    if (record.data) {
      text = new TextDecoder(record.encoding ?? "utf-8").decode(record.data);
    }
  } catch {
    text = null;
  }
  return { recordType: record.recordType, text };
}
