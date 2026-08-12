"use client";

import { Download, Printer, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { AlertDialog } from "@/components/ui/dialog";
import { notify } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/browser";

interface StandCardProps {
  standId: string;
  label: string;
  status: string;
  tokenPrefix: string;
}

async function fetchQrBlob(standId: string, accessToken: string): Promise<Blob> {
  const res = await fetch(`/api/v1/review-stands/${standId}/qr`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: "omit",
  });
  if (res.status === 401 || res.status === 403) throw new Error("unauthorized");
  if (!res.ok) throw new Error("qr_failed");
  return res.blob();
}

export function StandCard({ standId, label, status, tokenPrefix }: StandCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [qrObjectUrl, setQrObjectUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const objectUrlRef = useRef<string | null>(null);
  const loadGeneration = useRef(0);

  const loadQr = useCallback(async () => {
    const generation = ++loadGeneration.current;

    const { data: { session } } = await supabaseBrowser().auth.getSession();
    if (!session) {
      setQrError(true);
      return;
    }

    try {
      const blob = await fetchQrBlob(standId, session.access_token);
      if (generation !== loadGeneration.current) return;

      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      setQrObjectUrl(url);
      setQrError(false);
    } catch {
      if (generation !== loadGeneration.current) return;
      setQrError(true);
    }
  }, [standId]);

  useEffect(() => {
    void loadQr();
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [loadQr]);

  async function handleDownload() {
    setDownloading(true);
    const { data: { session } } = await supabaseBrowser().auth.getSession();
    if (!session) {
      setDownloading(false);
      notify.error("Please sign in again", "Your session expired.");
      return;
    }

    try {
      const blob = await fetchQrBlob(standId, session.access_token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reviewboost-${tokenPrefix}.svg`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      notify.error("Could not download the code", "Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  async function rotate() {
    setBusy(true);

    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();

    if (!session) {
      setBusy(false);
      notify.error("Please sign in again", "Your session expired.");
      return;
    }

    const response = await fetch(`/api/v1/review-stands/${standId}/rotate-token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    setBusy(false);
    setConfirming(false);

    if (!response.ok) {
      notify.error("Could not make a new code", "Please try again.");
      return;
    }

    void loadQr();
    notify.success("New code ready", "Print it and replace the old one.");
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-ink">{label}</p>
          <p className="text-sm text-muted">
            Code {tokenPrefix}… · {status === "active" ? "Working" : status}
          </p>
        </div>
      </div>

      <div className="mb-5 rounded-[var(--radius-control)] bg-white p-4">
        {qrError ? (
          <div className="mx-auto flex aspect-square w-full max-w-[240px] items-center justify-center">
            <p className="text-sm text-muted">Could not load QR code</p>
          </div>
        ) : qrObjectUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrObjectUrl}
            alt={`QR code for ${label}`}
            className="mx-auto aspect-square w-full max-w-[240px]"
          />
        ) : (
          <div className="mx-auto flex aspect-square w-full max-w-[240px] items-center justify-center">
            <div className="size-8 animate-spin rounded-full border-4 border-border border-t-brand-text" />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <Button onClick={() => window.print()}>
          <Printer className="size-5" aria-hidden="true" />
          Print this code
        </Button>

        <Button variant="secondary" onClick={handleDownload} loading={downloading}>
          <Download className="size-5" aria-hidden="true" />
          Save to my phone
        </Button>
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] px-2 text-sm font-medium text-muted transition-colors hover:text-danger focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Make a new code
        </button>
      </div>

      <AlertDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Your printed code will stop working"
        description="Anyone who scans the old one will see nothing. You will have to print the new code and replace it on every table."
        confirmLabel="Yes, make a new code"
        cancelLabel="Keep my code"
        loading={busy}
        onConfirm={() => void rotate()}
      />
    </div>
  );
}
