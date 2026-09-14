"use client";

import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  PROGRAM_PHASE_COPY,
  programFailureMessage,
  type ProgramPhase,
} from "@/lib/owner/nfc-phases";
import { supabaseBrowser } from "@/lib/supabase/browser";

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

  const run = useCallback(async () => {
    setError(null);
    setPhase("looking");

    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();
    if (!session) {
      setPhase("failed");
      setError("Please sign in again.");
      return;
    }

    try {
      const res = await fetch(`/api/v1/review-stands/${standId}/qr?format=json`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        credentials: "omit",
      });
      if (!res.ok) throw new Error("url");
      const json = (await res.json()) as { data?: { standUrl?: string } };
      const url = json.data?.standUrl;
      if (!url) throw new Error("url");
      setStandUrl(url);

      if (!("NDEFReader" in window)) {
        setPhase("failed");
        setError("This phone cannot program a Tag. Use Chrome on Android, or NFC Tools.");
        return;
      }

      // @ts-expect-error Web NFC
      const ndef = new NDEFReader();
      setPhase("found");
      setPhase("programming");
      await ndef.write({ records: [{ recordType: "url", data: url }] });
      setPhase("checking");
      await fetch(`/api/v1/review-stands/${standId}/nfc-provision`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      setPhase("ready");
      onReady();
    } catch (caught) {
      setPhase("failed");
      setError(programFailureMessage(caught));
    }
  }, [onReady, standId]);

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
                variant="primary"
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
              <Button variant="primary" size="lg" onClick={() => void run()}>
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
