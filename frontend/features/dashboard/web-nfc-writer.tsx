"use client";

import { Smartphone, AlertTriangle, CheckCircle, Info } from "lucide-react";
import { useState, useCallback, useRef } from "react";

import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/browser";

interface WebNfcWriterProps {
  standId: string;
}

type WriteState = "idle" | "checking" | "confirm-overwrite" | "writing" | "verifying" | "success" | "partial" | "error";

function isWebNfcAvailable(): boolean {
  return typeof window !== "undefined" && "NDEFReader" in window;
}

export function WebNfcWriter({ standId }: WebNfcWriterProps) {
  const [supported] = useState(() => isWebNfcAvailable());
  const [writeState, setWriteState] = useState<WriteState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const standUrlRef = useRef<string | null>(null);

  const fetchStandUrl = useCallback(async (): Promise<string | null> => {
    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();
    if (!session) return null;

    try {
      const res = await fetch(`/api/v1/review-stands/${standId}/qr?format=json`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        credentials: "omit",
      });
      if (!res.ok) return null;
      const json = await res.json();
      return json.data?.standUrl ?? null;
    } catch {
      return null;
    }
  }, [standId]);

  const recordProvision = useCallback(
    async (): Promise<boolean> => {
      const {
        data: { session },
      } = await supabaseBrowser().auth.getSession();
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
    },
    [standId],
  );

  const retryServerRecord = useCallback(async () => {
    setWriteState("verifying");
    const recorded = await recordProvision();
    if (recorded) {
      setWriteState("success");
      notify.success("Status saved", "NFC provisioning status has been recorded.");
    } else {
      setWriteState("partial");
    }
  }, [recordProvision]);

  const handleWrite = useCallback(async (skipContentCheck = false) => {
    setWriteState("checking");
    setErrorMessage(null);

    if (!isWebNfcAvailable()) {
      setWriteState("error");
      setErrorMessage("Web NFC is not available in this browser. Use Chrome on Android.");
      return;
    }

    const url = await fetchStandUrl();
    if (!url) {
      setWriteState("error");
      setErrorMessage("Could not load the stand URL. Please reload the page.");
      return;
    }
    standUrlRef.current = url;

    try {
      // @ts-expect-error Web NFC API types not in standard lib
      const ndef = new NDEFReader();

      // Check existing content before writing
      if (!skipContentCheck) {
        const existingContent = await new Promise<{ hasContent: boolean; isSameUrl: boolean; description: string; readFailed: boolean }>(
          (resolve) => {
            const timeout = setTimeout(() => {
              resolve({ hasContent: false, isSameUrl: false, description: "", readFailed: true });
            }, 8000);

            ndef.addEventListener(
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
                    if (readUrl === url) {
                      isSameUrl = true;
                    }
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

            ndef.scan().catch(() => {
              clearTimeout(timeout);
              resolve({ hasContent: false, isSameUrl: false, description: "", readFailed: true });
            });
          },
        );

        if (existingContent.readFailed) {
          setWriteState("error");
          setErrorMessage(
            "ReviewBoost couldn't safely read this tag. Try again or use a blank NFC tag.",
          );
          return;
        }

        if (existingContent.isSameUrl) {
          const recorded = await recordProvision();
          if (recorded) {
            setWriteState("success");
            notify.success(
              "NFC tag verified",
              "The tag already has the correct link. Status recorded.",
            );
          } else {
            setWriteState("partial");
          }
          return;
        }

        if (existingContent.hasContent) {
          setWriteState("confirm-overwrite");
          setErrorMessage(
            `This tag already has content (${existingContent.description}). Writing will replace it.`,
          );
          return;
        }
      }

      // Write the URL
      setWriteState("writing");
      await ndef.write({
        records: [{ recordType: "url", data: url }],
      });

      // Read back for verification
      setWriteState("verifying");

      const verifyResult = await new Promise<{ verified: boolean }>(
        (resolve) => {
          const timeout = setTimeout(() => {
            resolve({ verified: false });
          }, 5000);

          ndef.addEventListener(
            "reading",
            ({ message }: { message: { records: Array<{ recordType: string; data?: unknown }> } }) => {
              clearTimeout(timeout);
              let verified = false;
              if (message?.records) {
                for (const record of message.records) {
                  if (record.recordType === "url") {
                    const decoder = new TextDecoder();
                    const readUrl = decoder.decode(record.data as BufferSource);
                    if (readUrl === url) {
                      verified = true;
                    }
                  }
                }
              }
              resolve({ verified });
            },
            { once: true },
          );

          ndef.scan().catch(() => {
            clearTimeout(timeout);
            resolve({ verified: false });
          });
        },
      );

      if (verifyResult.verified) {
        const recorded = await recordProvision();
        if (recorded) {
          setWriteState("success");
          notify.success("NFC tag written", "The tag has been verified and recorded.");
        } else {
          setWriteState("partial");
        }
      } else {
        setWriteState("error");
        setErrorMessage(
          "Tag was written but read-back verification failed. Tap the tag to check, then try again.",
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
  }, [fetchStandUrl, recordProvision]);

  if (!supported) return null;

  return (
    <div className="rounded-[var(--radius-control)] border border-border p-4">
      <div className="mb-3 flex items-center gap-2">
        <Smartphone className="size-4 text-ink" aria-hidden="true" />
        <p className="text-sm font-medium text-ink">Write NFC Tag (Android Chrome)</p>
      </div>

      {writeState === "idle" && (
        <Button variant="secondary" onClick={() => void handleWrite()}>
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

      {writeState === "confirm-overwrite" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm text-[color:var(--rb-warning,var(--rb-info))]">
            <Info className="size-4 shrink-0" aria-hidden="true" />
            <p>{errorMessage}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void handleWrite(true)}>
              Overwrite tag
            </Button>
            <Button variant="secondary" onClick={() => setWriteState("idle")}>
              Cancel
            </Button>
          </div>
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
            <p>NFC tag written successfully</p>
          </div>
          <Button variant="secondary" onClick={() => void handleWrite()}>
            Write Another Tag
          </Button>
        </div>
      )}

      {writeState === "partial" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm text-[color:var(--rb-info,var(--rb-success))]">
            <Info className="size-4 shrink-0" aria-hidden="true" />
            <p>
              Your NFC tag works, but ReviewBoost couldn&apos;t save its setup status.
            </p>
          </div>
          <Button variant="secondary" onClick={() => void retryServerRecord()}>
            Retry saving status
          </Button>
        </div>
      )}

      {writeState === "error" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm text-danger">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <p>{errorMessage}</p>
          </div>
          <Button variant="secondary" onClick={() => void handleWrite()}>
            Try Again
          </Button>
        </div>
      )}
    </div>
  );
}
