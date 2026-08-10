"use client";

import { Download, Printer, RefreshCw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { AlertDialog } from "@/components/ui/dialog";
import { notify } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * One stand: its code, and the three things you can do with it.
 *
 * Print and download are one tap. Rotating is not, and deliberately so.
 *
 * ROTATION IS DESTRUCTIVE AND MUST LOOK IT
 * ----------------------------------------
 * Rotating a token kills the code already printed and sitting on a customer's
 * table. An owner who taps this expecting "refresh" silently destroys their own
 * signage and will not find out until scans stop arriving — days later, with no
 * obvious cause.
 *
 * So it is placed apart from the safe actions, it is not the brand colour, it
 * states the consequence in plain words before anything happens, and the
 * confirming button says what it does rather than "OK". This is the one screen
 * in the product where friction is the feature.
 */

interface StandCardProps {
  standId: string;
  label: string;
  status: string;
  tokenPrefix: string;
}

export function StandCard({ standId, label, status, tokenPrefix }: StandCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rotatedAt, setRotatedAt] = useState<number>(0);

  const qrSrc = `/api/v1/review-stands/${standId}/qr${rotatedAt ? `?v=${rotatedAt}` : ""}`;

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

    // Cache-busts the image so the new code appears immediately. Showing the
    // old one after rotating would be actively dangerous — it is now dead.
    setRotatedAt(Date.now());
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
        {/* White background regardless of theme: a QR code inverted in dark
            mode does not scan on many phones. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrSrc}
          alt={`QR code for ${label}`}
          className="mx-auto aspect-square w-full max-w-[240px]"
        />
      </div>

      <div className="flex flex-col gap-3">
        <Button onClick={() => window.print()}>
          <Printer className="size-5" aria-hidden="true" />
          Print this code
        </Button>

        <Button variant="secondary" asChild>
          <a href={qrSrc} download={`reviewboost-${tokenPrefix}.svg`}>
            <Download className="size-5" aria-hidden="true" />
            Save to my phone
          </a>
        </Button>
      </div>

      {/* Separated by a rule and pushed to the bottom. Nothing dangerous should
          sit next to something you tap every day. */}
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
