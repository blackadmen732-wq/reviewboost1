"use client";

import { Download, ExternalLink, MoreHorizontal, Printer, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { AlertDialog } from "@/components/ui/dialog";
import { notify } from "@/components/ui/toast";
import { ProgramTagSheet } from "@/features/tags/program-tag-sheet";
import { useAuthenticatedQr, type AuthenticatedQr } from "@/lib/hooks/use-authenticated-qr";
import {
  lastUsedLabel,
  tagReadiness,
  tagReadinessLabel,
} from "@/lib/owner/tag-readiness";
import { ownerOrAdmin } from "@/lib/owner/permissions";
import type { Stand } from "@/lib/server/owner-data";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * A Tag. Everything on the managed view — loading the code, printing, saving,
 * programming NFC, making a new code — goes through routes that only an owner
 * or admin may call, so a member or viewer gets the read-only view instead of
 * a spinner that fails and buttons that 403.
 */
export function TagDetail({ stand, canManage }: { stand: Stand; canManage: boolean }) {
  return canManage ? <ManagedTagDetail stand={stand} /> : <ReadOnlyTagDetail stand={stand} />;
}

function ReadOnlyTagDetail({ stand }: { stand: Stand }) {
  const status = tagReadiness(stand);
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-[length:var(--rb-text-display)] font-semibold tracking-[-0.03em] text-ink">
          {stand.label}
        </h1>
        <p className="mt-2 text-base text-muted">
          {stand.locationName ?? "Place"} · {tagReadinessLabel(status)} · {lastUsedLabel(stand.lastOpenedAt)}
        </p>
      </header>
      <p className="text-base text-muted" data-tag-access="read-only">
        {ownerOrAdmin("print, program or change this Tag")}
      </p>
    </div>
  );
}

function ManagedTagDetail({ stand }: { stand: Stand }) {
  const router = useRouter();
  const qr = useAuthenticatedQr(stand.standId);
  // Set the moment a Tag is programmed so the header stops saying "Needs NFC"
  // while router.refresh() fetches the server's version. Without it the owner
  // programmed a Tag, watched it succeed, and was still told it needed doing.
  const [justProgrammedAt, setJustProgrammedAt] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [program, setProgram] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const status = tagReadiness(
    justProgrammedAt ? { ...stand, nfcProvisionedAt: justProgrammedAt } : stand,
  );

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
        {/* The hook already distinguishes loading from expired from failed. The
            view used to collapse all of them into "no objectUrl" and spin
            forever, so an owner whose session had expired watched an
            indefinite spinner with nothing to click. */}
        <QrPanel
          status={qr.status}
          objectUrl={qr.objectUrl}
          label={stand.label}
          needsReprint={status === "needs-qr" || status === "both"}
          onReload={qr.reload}
        />
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
        onReady={() => {
          setJustProgrammedAt(new Date().toISOString());
          router.refresh();
        }}
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

/**
 * Every state the code can be in, each with its own way out.
 */
function QrPanel({
  status,
  objectUrl,
  label,
  needsReprint,
  onReload,
}: {
  status: AuthenticatedQr["status"];
  objectUrl: string | null;
  label: string;
  needsReprint: boolean;
  onReload: () => void;
}) {
  const frame = "mx-auto flex aspect-square w-full max-w-[280px] items-center justify-center";

  if (status === "ready" && objectUrl) {
    return (
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={objectUrl} alt={`Code for ${label}`} className="mx-auto aspect-square w-full max-w-[280px]" />
        {needsReprint ? (
          <p className="mt-3 text-center text-sm text-muted" data-qr-state="rotation-required">
            This is the new code. The one already printed no longer works — print
            this and replace it.
          </p>
        ) : null}
      </div>
    );
  }

  if (status === "expired") {
    return (
      <div className={`${frame} flex-col gap-3 text-center`} data-qr-state="expired">
        <p className="text-sm text-muted">Your session expired, so the code could not load.</p>
        <Button variant="secondary" onClick={onReload}>
          Sign in again and retry
        </Button>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className={`${frame} flex-col gap-3 text-center`} data-qr-state="error">
        <p className="text-sm text-muted">The code could not be loaded.</p>
        <Button variant="secondary" onClick={onReload}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className={frame} data-qr-state="loading">
      <div className="size-8 animate-spin rounded-full border-4 border-border border-t-brand-text" aria-label="Loading code" role="status" />
    </div>
  );
}
