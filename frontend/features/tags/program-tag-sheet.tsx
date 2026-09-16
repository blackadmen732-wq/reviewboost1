"use client";

import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  PROGRAM_PHASE_COPY,
  programFailureMessage,
  type ProgramPhase,
  type TagContents,
} from "@/lib/owner/nfc-phases";
import { classifyTagContents, type ReadRecord } from "@/lib/owner/nfc-read";
import { supabaseBrowser } from "@/lib/supabase/browser";

/** How long to wait for the chip to announce itself before giving up on a read. */
const READ_TIMEOUT_MS = 4_000;

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
  const [phase, setPhase] = useState<ProgramPhase>("hold");
  const [error, setError] = useState<string | null>(null);
  const [standUrl, setStandUrl] = useState<string | null>(null);
  const [existing, setExisting] = useState<TagContents | null>(null);

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

  /** Retry only the server half. The chip is already correct. */
  const retryConfirmation = useCallback(async () => {
    setError(null);
    setPhase("checking");

    const token = await accessToken();
    if (!token) {
      setPhase("unconfirmed");
      setError("Please sign in again, then retry. Your Tag is already programmed.");
      return;
    }

    if (await confirmWithServer(token)) {
      setPhase("ready");
      onReady();
      return;
    }
    setPhase("unconfirmed");
  }, [accessToken, confirmWithServer, onReady]);

  /**
   * Write the URL, then confirm. Called only once the contents are known and,
   * where they were not blank, the owner has agreed to replace them.
   */
  const writeAndConfirm = useCallback(
    async (url: string, token: string) => {
      setPhase("programming");
      try {
        // @ts-expect-error Web NFC is not in lib.dom yet.
        const ndef = new NDEFReader();
        await ndef.write({ records: [{ recordType: "url", data: url }] });
      } catch (caught) {
        setPhase("failed");
        setError(programFailureMessage(caught));
        return;
      }

      // Past this line the chip is correct whatever happens next, so no failure
      // below may send the owner back to writing it again.
      setPhase("checking");
      if (await confirmWithServer(token)) {
        setPhase("ready");
        onReady();
        return;
      }
      setPhase("unconfirmed");
    },
    [confirmWithServer, onReady],
  );

  /** Owner saw what was on the chip and chose to replace it. */
  const overwrite = useCallback(async () => {
    const token = await accessToken();
    if (!standUrl || !token) {
      setPhase("failed");
      setError("Please sign in again.");
      return;
    }
    await writeAndConfirm(standUrl, token);
  }, [accessToken, standUrl, writeAndConfirm]);

  const run = useCallback(async () => {
    setError(null);
    setExisting(null);
    setPhase("looking");

    const token = await accessToken();
    if (!token) {
      setPhase("failed");
      setError("Please sign in again.");
      return;
    }

    let url: string;
    try {
      const res = await fetch(`/api/v1/review-stands/${standId}/qr?format=json`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "omit",
      });
      if (!res.ok) throw new Error("url");
      const json = (await res.json()) as { data?: { standUrl?: string } };
      if (!json.data?.standUrl) throw new Error("url");
      url = json.data.standUrl;
      setStandUrl(url);
    } catch (caught) {
      setPhase("failed");
      setError(programFailureMessage(caught));
      return;
    }

    if (!("NDEFReader" in window)) {
      setPhase("failed");
      setError("This phone cannot program a Tag. Use Chrome on Android, or NFC Tools.");
      return;
    }

    // Read first, always.
    setPhase("reading");
    const contents = await readTag(url);
    setExisting(contents);

    if (contents.kind === "ours") {
      // Already pointing here. Writing again would burn a write cycle and risk
      // corrupting a chip that is correct; only the server record is missing.
      setPhase("already");
      if (await confirmWithServer(token)) {
        setPhase("ready");
        onReady();
      } else {
        setPhase("unconfirmed");
      }
      return;
    }

    if (contents.kind === "unreadable") {
      setPhase("failed");
      setError(
        "This Tag could not be read, so nothing was written to it. It may be locked, or held too briefly. Try again, or use a Tag you know is blank.",
      );
      return;
    }

    if (contents.kind === "other") {
      setPhase("conflict");
      return;
    }

    await writeAndConfirm(url, token);
  }, [accessToken, confirmWithServer, onReady, standId, writeAndConfirm]);

  if (!open) return null;

  const copy = PROGRAM_PHASE_COPY[phase];
  const conflictBody =
    existing?.kind === "other"
      ? `This Tag already has ${existing.description} on it. Programming replaces it, and whatever used it will stop working.`
      : copy.body;

  return (
    <div className="nfc-sheet" role="dialog" aria-modal="true" aria-labelledby="nfc-title">
      <div className="nfc-sheet__panel" data-nfc-phase={phase}>
        <div className="nfc-sheet__phase">
          <p className="nfc-sheet__title" id="nfc-title">
            {copy.title}
          </p>
          <p className="nfc-sheet__body">
            {error ?? (phase === "conflict" ? conflictBody : copy.body)}
          </p>
        </div>
        <div className="flex flex-col gap-3">
          {phase === "conflict" ? (
            <>
              <Button variant="action" size="lg" onClick={() => void overwrite()}>
                Replace what is on it
              </Button>
              <Button variant="secondary" size="lg" onClick={onClose}>
                Keep it as it is
              </Button>
            </>
          ) : phase === "unconfirmed" ? (
            <>
              <Button variant="action" size="lg" onClick={() => void retryConfirmation()}>
                Retry
              </Button>
              <Button variant="secondary" size="lg" onClick={onClose}>
                Done
              </Button>
            </>
          ) : phase === "ready" ? (
            <>
              <Button
                variant="action"
                size="lg"
                onClick={() => {
                  if (standUrl) window.open(standUrl, "_blank", "noopener,noreferrer");
                }}
              >
                Test customer page
              </Button>
              <Button variant="secondary" size="lg" onClick={onClose}>
                Done
              </Button>
            </>
          ) : (
            <>
              <Button variant="action" size="lg" onClick={() => void run()}>
                {phase === "failed" ? "Try again" : "Hold near Tag"}
              </Button>
              <Button variant="secondary" size="lg" onClick={onClose}>
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
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
async function readTag(standUrl: string): Promise<TagContents> {
  try {
    // @ts-expect-error Web NFC is not in lib.dom yet.
    const reader = new NDEFReader();
    const controller = new AbortController();

    const records = await new Promise<ReadRecord[] | null>((resolve) => {
      const timer = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, READ_TIMEOUT_MS);

      reader.addEventListener(
        "reading",
        (event: { message?: { records?: Array<{ recordType: string; data?: BufferSource; encoding?: string }> } }) => {
          clearTimeout(timer);
          const found = event.message?.records ?? [];
          resolve(found.map(decodeRecord));
          controller.abort();
        },
        { once: true },
      );

      reader.addEventListener(
        "readingerror",
        () => {
          clearTimeout(timer);
          resolve(null);
          controller.abort();
        },
        { once: true },
      );

      reader.scan({ signal: controller.signal }).catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
    });

    return classifyTagContents(records ?? [], standUrl, records !== null);
  } catch {
    return { kind: "unreadable" };
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
