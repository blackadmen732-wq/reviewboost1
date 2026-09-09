"use client";

import { Download, ExternalLink, MoreHorizontal, Printer, Smartphone } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { AlertDialog } from "@/components/ui/dialog";
import { notify } from "@/components/ui/toast";
import { ProgramTagSheet } from "@/features/tags/program-tag-sheet";
import { useAuthenticatedQr } from "@/lib/hooks/use-authenticated-qr";
import {
  lastUsedLabel,
  tagReadiness,
  tagReadinessLabel,
} from "@/lib/owner/tag-readiness";
import type { Stand } from "@/lib/server/owner-data";
import { supabaseBrowser } from "@/lib/supabase/browser";

export function TagDetail({ stand }: { stand: Stand }) {
  const qr = useAuthenticatedQr(stand.standId);
  const [more, setMore] = useState(false);
  const [program, setProgram] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const status = tagReadiness(stand);

  async function openLive() {
    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();
    if (!session) {
      notify.error("Please sign in again", "Your session expired.");
      return;
    }
    const res = await fetch(`/api/v1/review-stands/${stand.standId}/qr?format=json`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      credentials: "omit",
    });
    if (!res.ok) {
      notify.error("Could not open the customer page", "Please try again.");
      return;
    }
    const json = (await res.json()) as { data?: { standUrl?: string } };
    if (!json.data?.standUrl) {
      notify.error("Could not open the customer page", "Please try again.");
      return;
    }
    window.open(json.data.standUrl, "_blank", "noopener,noreferrer");
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
    const response = await fetch(`/api/v1/review-stands/${stand.standId}/rotate-token`, {
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
    <div className="flex flex-col gap-8">
      <header>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[length:var(--rb-text-display)] font-semibold tracking-[-0.03em] text-ink">
              {stand.label}
            </h1>
            <p className="mt-2 text-base text-muted">
              {stand.locationName ?? "Place"} · {tagReadinessLabel(status)} · {lastUsedLabel(stand.lastOpenedAt)}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-[var(--radius-control)] text-ink hover:bg-quiet"
            aria-expanded={more}
            aria-label="More"
            onClick={() => setMore((value) => !value)}
          >
            <MoreHorizontal className="size-5" aria-hidden="true" />
          </button>
        </div>
        {more ? (
          <div className="mt-3 flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-3">
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer className="size-5" aria-hidden="true" />
              Print
            </Button>
            <Button variant="secondary" onClick={() => qr.download(`reviewboost-${stand.tokenPrefix}.svg`)}>
              <Download className="size-5" aria-hidden="true" />
              Save code
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(true)}>
              Make a new code
            </Button>
          </div>
        ) : null}
      </header>

      <section className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
        {qr.objectUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr.objectUrl} alt={`Code for ${stand.label}`} className="mx-auto aspect-square w-full max-w-[280px]" />
        ) : (
          <div className="mx-auto flex aspect-square w-full max-w-[280px] items-center justify-center">
            <div className="size-8 animate-spin rounded-full border-4 border-border border-t-brand-text" />
          </div>
        )}
        <div className="mt-5 flex flex-col gap-3">
          <Button variant="action" size="lg" onClick={() => window.print()}>
            <Printer className="size-5" aria-hidden="true" />
            Print this code
          </Button>
          <Button variant="secondary" size="lg" onClick={() => void openLive()}>
            <ExternalLink className="size-5" aria-hidden="true" />
            Preview customer page
          </Button>
        </div>
      </section>

      <section>
        <Button variant="action" size="lg" onClick={() => setProgram(true)}>
          <Smartphone className="size-5" aria-hidden="true" />
          Program NFC
        </Button>
      </section>

      <ProgramTagSheet
        standId={stand.standId}
        open={program}
        onClose={() => setProgram(false)}
        onReady={() => undefined}
      />

      <AlertDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Your printed code will stop working"
        description="Anyone who scans the old code will see nothing. Print the new one and put it out."
        confirmLabel="Yes, make a new code"
        cancelLabel="Keep my code"
        loading={busy}
        onConfirm={() => void rotate()}
      />
    </div>
  );
}
