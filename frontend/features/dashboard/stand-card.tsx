"use client";

import { Download, Printer, RefreshCw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { AlertDialog } from "@/components/ui/dialog";
import { notify } from "@/components/ui/toast";
import { useAuthenticatedQr } from "@/lib/hooks/use-authenticated-qr";
import { supabaseBrowser } from "@/lib/supabase/browser";

interface StandCardProps {
  standId: string;
  label: string;
  status: string;
  tokenPrefix: string;
}

export function StandCard({ standId, label, status, tokenPrefix }: StandCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const qr = useAuthenticatedQr(standId);

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

    qr.reload();
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
        {qr.status === "error" || qr.status === "expired" ? (
          <div className="mx-auto flex aspect-square w-full max-w-[240px] items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-muted">
                {qr.status === "expired" ? "Please sign in again" : "Could not load QR code"}
              </p>
              <button
                type="button"
                onClick={qr.reload}
                className="inline-flex items-center gap-1 text-sm font-medium text-brand-text"
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
                Try again
              </button>
            </div>
          </div>
        ) : qr.objectUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qr.objectUrl}
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

        <Button
          variant="secondary"
          onClick={() => qr.download(`reviewboost-${tokenPrefix}.svg`)}
          loading={qr.downloading}
        >
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
