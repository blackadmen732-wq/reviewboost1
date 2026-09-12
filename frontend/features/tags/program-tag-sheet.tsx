"use client";

import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  PROGRAM_PHASE_COPY,
  programFailureMessage,
  type ProgramPhase,
} from "@/lib/owner/nfc-phases";
import { supabaseBrowser } from "@/lib/supabase/browser";

interface NdefReadResult {
  hasContent: boolean;
  isSameUrl: boolean;
  description: string;
  readFailed: boolean;
}

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
  const standUrlRef = useRef<string | null>(null);
  const ndefRef = useRef<unknown>(null);
  const sessionRef = useRef<{ access_token: string } | null>(null);

  const getSession = useCallback(async () => {
    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();
    if (!session) throw new Error("auth");
    sessionRef.current = session;
    return session;
  }, []);

  const fetchStandUrl = useCallback(async (): Promise<string> => {
    const session = await getSession();
    const res = await fetch(`/api/v1/review-stands/${standId}/qr?format=json`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      credentials: "omit",
    });
    if (!res.ok) throw new Error("url");
    const json = (await res.json()) as { data?: { standUrl?: string } };
    const url = json.data?.standUrl;
    if (!url) throw new Error("url");
    return url;
  }, [getSession, standId]);

  const recordProvision = useCallback(async (): Promise<boolean> => {
    const session = sessionRef.current;
    if (!session) return false;
    try {
      const res = await fetch(`/api/v1/review-stands/${standId}/nfc-provision`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      return res.ok;
    } catch {
      return false;
    }
  }, [standId]);

  const readCurrentNdef = useCallback(async (ndef: unknown, canonicalUrl: string): Promise<NdefReadResult> => {
    return new Promise<NdefReadResult>((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ hasContent: false, isSameUrl: false, description: "", readFailed: true });
      }, 8000);

      const reader = ndef as { addEventListener: Function; scan: () => Promise<void> };
      reader.addEventListener(
        "reading",
        ({ message }: { message: { records: Array<{ recordType: string; data?: unknown }> } }) => {
          clearTimeout(timeout);
          if (!message?.records || message.records.length === 0) {
            resolve({ hasContent: false, isSameUrl: false, description: "", readFailed: false });
            return;
          }
          const decoder = new TextDecoder();
          let isSameUrl = false;
          let description = "";
          for (const record of message.records) {
            if (record.recordType === "url" && record.data) {
              const readUrl = decoder.decode(record.data as BufferSource);
              if (readUrl === canonicalUrl) isSameUrl = true;
              description = `URL: ${readUrl.slice(0, 60)}`;
            } else if (record.recordType === "text" && record.data) {
              description = `Text: ${decoder.decode(record.data as BufferSource).slice(0, 60)}`;
            } else {
              description = `${record.recordType} record`;
            }
          }
          resolve({ hasContent: true, isSameUrl, description, readFailed: false });
        },
        { once: true },
      );

      reader.scan().catch(() => {
        clearTimeout(timeout);
        resolve({ hasContent: false, isSameUrl: false, description: "", readFailed: true });
      });
    });
  }, []);

  const verifyWriteback = useCallback(async (ndef: unknown, canonicalUrl: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 5000);
      const reader = ndef as { addEventListener: Function; scan: () => Promise<void> };
      reader.addEventListener(
        "reading",
        ({ message }: { message: { records: Array<{ recordType: string; data?: unknown }> } }) => {
          clearTimeout(timeout);
          if (!message?.records) { resolve(false); return; }
          const decoder = new TextDecoder();
          for (const record of message.records) {
            if (record.recordType === "url" && record.data) {
              if (decoder.decode(record.data as BufferSource) === canonicalUrl) {
                resolve(true);
                return;
              }
            }
          }
          resolve(false);
        },
        { once: true },
      );
      reader.scan().catch(() => { clearTimeout(timeout); resolve(false); });
    });
  }, []);

  const writeAndVerify = useCallback(async (url: string) => {
    const ndef = ndefRef.current as { write: (msg: unknown) => Promise<void> };
    setPhase("programming");
    await ndef.write({ records: [{ recordType: "url", data: url }] });

    setPhase("checking");
    const verified = await verifyWriteback(ndefRef.current, url);
    if (!verified) {
      setPhase("failed");
      setError("The Tag was programmed but could not be verified. Tap the Tag, then try again.");
      return;
    }

    setPhase("verifying");
    const recorded = await recordProvision();
    if (recorded) {
      setPhase("ready");
      onReady();
    } else {
      setPhase("partial");
    }
  }, [onReady, recordProvision, verifyWriteback]);

  const retryServerRecord = useCallback(async () => {
    setPhase("verifying");
    const recorded = await recordProvision();
    if (recorded) {
      setPhase("ready");
      onReady();
    } else {
      setPhase("partial");
      setError("Still could not record. Check your connection and try again.");
    }
  }, [onReady, recordProvision]);

  const run = useCallback(async (skipContentCheck = false) => {
    setError(null);
    setPhase("looking");

    try {
      await getSession();
    } catch {
      setPhase("failed");
      setError("Please sign in again.");
      return;
    }

    try {
      const url = await fetchStandUrl();
      standUrlRef.current = url;

      if (!("NDEFReader" in window)) {
        setPhase("failed");
        setError("This phone cannot program a Tag. Use Chrome on Android, or NFC Tools.");
        return;
      }

      // @ts-expect-error Web NFC API
      const ndef = new NDEFReader();
      ndefRef.current = ndef;

      if (!skipContentCheck) {
        setPhase("reading");
        const existing = await readCurrentNdef(ndef, url);

        if (existing.readFailed) {
          setPhase("failed");
          setError("Could not read this Tag. Try again, or use a blank one.");
          return;
        }

        if (existing.isSameUrl) {
          setPhase("verifying");
          const recorded = await recordProvision();
          if (recorded) {
            setPhase("ready");
            onReady();
          } else {
            setPhase("partial");
          }
          return;
        }

        if (existing.hasContent) {
          setPhase("confirm-overwrite");
          setError(`This Tag already has content: ${existing.description}. Programming will replace it.`);
          return;
        }
      }

      await writeAndVerify(url);
    } catch (caught) {
      setPhase("failed");
      setError(programFailureMessage(caught));
    }
  }, [fetchStandUrl, getSession, onReady, readCurrentNdef, recordProvision, writeAndVerify]);

  const confirmOverwrite = useCallback(async () => {
    setError(null);
    const url = standUrlRef.current;
    if (!url) { setPhase("failed"); setError("Missing Tag URL. Please try again."); return; }
    try {
      await writeAndVerify(url);
    } catch (caught) {
      setPhase("failed");
      setError(programFailureMessage(caught));
    }
  }, [writeAndVerify]);

  if (!open) return null;

  const copy = PROGRAM_PHASE_COPY[phase];

  return (
    <div className="nfc-sheet" role="dialog" aria-modal="true" aria-labelledby="nfc-title">
      <div className="nfc-sheet__panel">
        <div className="nfc-sheet__phase">
          <p className="nfc-sheet__title" id="nfc-title">
            {copy.title}
          </p>
          <p className="nfc-sheet__body">{error ?? copy.body}</p>
        </div>
        <div className="flex flex-col gap-3">
          {phase === "ready" ? (
            <>
              <Button
                variant="action"
                size="lg"
                onClick={() => {
                  const url = standUrlRef.current;
                  if (url) window.open(url, "_blank", "noopener,noreferrer");
                }}
              >
                Test customer page
              </Button>
              <Button variant="secondary" size="lg" onClick={onClose}>
                Done
              </Button>
            </>
          ) : phase === "confirm-overwrite" ? (
            <>
              <Button variant="action" size="lg" onClick={() => void confirmOverwrite()}>
                Replace what is on it
              </Button>
              <Button variant="secondary" size="lg" onClick={() => { setPhase("hold"); setError(null); }}>
                Cancel
              </Button>
            </>
          ) : phase === "partial" ? (
            <>
              <Button variant="action" size="lg" onClick={() => void retryServerRecord()}>
                Retry verification
              </Button>
              <Button variant="secondary" size="lg" onClick={onClose}>
                Close
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="action"
                size="lg"
                onClick={() => void run()}
                disabled={phase === "looking" || phase === "reading" || phase === "programming" || phase === "checking" || phase === "verifying"}
              >
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
