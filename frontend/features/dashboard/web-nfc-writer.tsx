"use client";

import { Smartphone, AlertTriangle, CheckCircle } from "lucide-react";
import { useState, useCallback, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/browser";

interface WebNfcWriterProps {
  standId: string;
  standUrl: string | null;
}

type WriteState = "idle" | "checking" | "writing" | "verifying" | "success" | "error";

function isWebNfcAvailable(): boolean {
  return typeof window !== "undefined" && "NDEFReader" in window;
}

export function WebNfcWriter({ standId, standUrl }: WebNfcWriterProps) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [writeState, setWriteState] = useState<WriteState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [tagUid, setTagUid] = useState<string | null>(null);

  useEffect(() => {
    setSupported(isWebNfcAvailable());
  }, []);

  const recordProvision = useCallback(
    async (nfcUid: string | null) => {
      const {
        data: { session },
      } = await supabaseBrowser().auth.getSession();
      if (!session) return;

      try {
        await fetch(`/api/v1/review-stands/${standId}/nfc-provision`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ nfcUid }),
        });
      } catch {
        // Non-fatal
      }
    },
    [standId],
  );

  const handleWrite = useCallback(async () => {
    if (!standUrl) {
      setWriteState("error");
      setErrorMessage("Stand URL is not available. Please reload the page.");
      return;
    }

    setWriteState("checking");
    setErrorMessage(null);
    setTagUid(null);

    if (!isWebNfcAvailable()) {
      setWriteState("error");
      setErrorMessage("Web NFC is not available in this browser. Use Chrome on Android.");
      return;
    }

    try {
      setWriteState("writing");

      // @ts-expect-error Web NFC API types not in standard lib
      const ndef = new NDEFReader();

      await ndef.write({
        records: [{ recordType: "url", data: standUrl }],
      });

      // Read back for verification
      setWriteState("verifying");

      const verifyResult = await new Promise<{ verified: boolean; serialNumber: string | null }>(
        (resolve) => {
          const timeout = setTimeout(() => {
            resolve({ verified: false, serialNumber: null });
          }, 5000);

          ndef.addEventListener(
            "reading",
            ({ serialNumber, message }: { serialNumber: string; message: { records: Array<{ recordType: string; data?: unknown }> } }) => {
              clearTimeout(timeout);
              let verified = false;
              if (message?.records) {
                for (const record of message.records) {
                  if (record.recordType === "url") {
                    const decoder = new TextDecoder();
                    const readUrl = decoder.decode(record.data as BufferSource);
                    if (readUrl === standUrl) {
                      verified = true;
                    }
                  }
                }
              }
              resolve({ verified, serialNumber: serialNumber || null });
            },
            { once: true },
          );

          ndef.scan().catch(() => {
            clearTimeout(timeout);
            resolve({ verified: false, serialNumber: null });
          });
        },
      );

      setTagUid(verifyResult.serialNumber);

      if (verifyResult.verified) {
        await recordProvision(verifyResult.serialNumber);
        setWriteState("success");
        notify.success("NFC tag written", "The tag has been verified.");
      } else {
        // Write succeeded but verification was inconclusive
        await recordProvision(verifyResult.serialNumber);
        setWriteState("success");
        notify.success(
          "NFC tag written",
          "Tap the tag with your phone to confirm it works.",
        );
      }
    } catch (e) {
      setWriteState("error");
      if (e instanceof DOMException && e.name === "NotAllowedError") {
        setErrorMessage("NFC permission was denied. Allow NFC access and try again.");
      } else if (e instanceof DOMException && e.name === "NotSupportedError") {
        setErrorMessage("This device does not support NFC writing.");
      } else {
        setErrorMessage(
          e instanceof Error ? e.message : "NFC write failed. Please try again.",
        );
      }
    }
  }, [standUrl, recordProvision]);

  if (supported === null) return null;
  if (!supported) return null;

  return (
    <div className="rounded-[var(--radius-control)] border border-border p-4">
      <div className="mb-3 flex items-center gap-2">
        <Smartphone className="size-4 text-ink" aria-hidden="true" />
        <p className="text-sm font-medium text-ink">Write NFC Tag (Android Chrome)</p>
      </div>

      {writeState === "idle" && (
        <Button variant="secondary" onClick={handleWrite} disabled={!standUrl}>
          <Smartphone className="size-5" aria-hidden="true" />
          Write to NFC Tag
        </Button>
      )}

      {(writeState === "checking" || writeState === "writing") && (
        <div className="flex items-center gap-3 text-sm text-muted">
          <div className="size-5 animate-spin rounded-full border-2 border-border border-t-brand-text" />
          <p>Hold your phone to the NFC tag...</p>
        </div>
      )}

      {writeState === "verifying" && (
        <div className="flex items-center gap-3 text-sm text-muted">
          <div className="size-5 animate-spin rounded-full border-2 border-border border-t-brand-text" />
          <p>Verifying tag contents...</p>
        </div>
      )}

      {writeState === "success" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm text-[color:var(--rb-success)]">
            <CheckCircle className="size-4" aria-hidden="true" />
            <p>
              NFC tag written successfully
              {tagUid ? ` (UID: ${tagUid})` : ""}
            </p>
          </div>
          <Button variant="secondary" onClick={handleWrite}>
            Write Another Tag
          </Button>
        </div>
      )}

      {writeState === "error" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm text-danger">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <p>{errorMessage}</p>
          </div>
          <Button variant="secondary" onClick={handleWrite}>
            Try Again
          </Button>
        </div>
      )}
    </div>
  );
}
