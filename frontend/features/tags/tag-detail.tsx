"use client";

import { Download, MoreHorizontal, Printer, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { AlertDialog } from "@/components/ui/dialog";
import { notify } from "@/components/ui/toast";
import { ProgramTagSheet } from "@/features/tags/program-tag-sheet";
import {
  useAuthenticatedQr,
  type AuthenticatedQr,
} from "@/lib/hooks/use-authenticated-qr";
import {
  lastUsedLabel,
  tagReadiness,
  tagReadinessLabel,
} from "@/lib/owner/tag-readiness";
import { ownerOrAdmin } from "@/lib/owner/permissions";
import type { Stand } from "@/lib/server/owner-data";
import { PreviewCustomerPage } from "@/features/dashboard/preview-customer-page";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils/cn";

/** The only action that invalidates a printed QR code or a programmed NFC chip. */
export const ROTATE_WARNING =
  "This is the only change that stops a Tag working. As soon as you confirm, the QR code you printed and the NFC chip you programmed for this Tag stop opening your Customer Page.";

/** Everything that does not need a new code — so nobody rotates to "apply" it. */
export const ROTATE_NOT_NEEDED =
  "You don’t need a new code to change your Google link, your Customer Page or this Tag’s place — those reach the Tag on its next tap. Only do this if the code was copied or you want the old one to stop working.";

/**
 * A Tag. Everything on the managed view — loading the code, printing, saving,
 * programming NFC, making a new code — goes through routes that only an owner
 * or admin may call, so a member or viewer gets the read-only view instead of
 * a spinner that fails and buttons that 403.
 */
export function TagDetail({
  stand,
  canManage,
  organizationId,
}: {
  stand: Stand;
  canManage: boolean;
  organizationId?: string;
}) {
  return canManage ? (
    <ManagedTagDetail stand={stand} organizationId={organizationId} />
  ) : (
    <ReadOnlyTagDetail stand={stand} />
  );
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
          {stand.locationName ?? "Place"} · {tagReadinessLabel(status)} ·{" "}
          {lastUsedLabel(stand.lastOpenedAt)}
        </p>
      </header>
      <p className="text-base text-muted" data-tag-access="read-only">
        {ownerOrAdmin("print, program or change this Tag")}
      </p>
    </div>
  );
}

function ManagedTagDetail({
  stand,
  organizationId,
}: {
  stand: Stand;
  organizationId: string | undefined;
}) {
  const router = useRouter();
  const qr = useAuthenticatedQr(stand.standId, organizationId);
  // Set the moment a Tag is programmed so the header stops saying "NFC not programmed"
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

  async function rotate() {
    setBusy(true);
    try {
      const {
        data: { session },
      } = await supabaseBrowser().auth.getSession();
      if (!session) {
        notify.error("Please sign in again", "Your session expired.");
        return;
      }
      const response = await fetch(
        `/api/v1/review-stands/${stand.standId}/rotate-token`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );
      if (!response.ok) {
        notify.error("Could not make a new code", "Please try again.");
        return;
      }
      setJustProgrammedAt(null);
      setConfirming(false);
      router.refresh();
      qr.reload();
      notify.success(
        "New code ready",
        "The old code no longer works. Print this one and program NFC again.",
      );
    } catch {
      qr.reload();
      router.refresh();
      notify.error(
        "Could not confirm the new code",
        "Check this Tag before trying again.",
      );
    } finally {
      setBusy(false);
    }
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
              {stand.locationName ?? "Place"} · {tagReadinessLabel(status)} ·{" "}
              {lastUsedLabel(stand.lastOpenedAt)}
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
            <Button
              variant="secondary"
              disabled={qr.status !== "ready"}
              onClick={() => window.print()}
            >
              <Printer className="size-5" aria-hidden="true" />
              Print
            </Button>
            <Button
              variant="secondary"
              disabled={qr.status !== "ready" || qr.downloading}
              onClick={() =>
                qr.download(`reviewboost-${stand.tokenPrefix}.svg`)
              }
            >
              <Download className="size-5" aria-hidden="true" />
              Save code
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(true)}>
              Make a new code
            </Button>
          </div>
        ) : null}
      </header>

      <section className="max-w-[28rem] rounded-[var(--radius-card)] border border-border bg-surface p-5">
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
          <Button
            variant="action"
            size="lg"
            disabled={qr.status !== "ready"}
            onClick={() => window.print()}
          >
            <Printer className="size-5" aria-hidden="true" />
            Print this code
          </Button>
          <PreviewCustomerPage standId={stand.standId} variant="button" />
        </div>
      </section>

      <section className="max-w-[28rem]">
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

      {/* The one action that changes what is printed and programmed on this
          Tag. Everything else — the Google link, the Customer Page, the place,
          the name — is resolved when a customer opens the Tag, so it never
          needs a new code; the dialog says so, so nobody does this to "apply"
          a change. */}
      <AlertDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Make a new code? The old one stops working."
        description={ROTATE_WARNING}
        details={
          <>
            <ul className="list-disc space-y-1 pl-5" data-rotate-consequences>
              <li>Print the new code and replace the one on the counter.</li>
              <li>
                {(justProgrammedAt ?? stand.nfcProvisionedAt)
                  ? "Program this Tag’s NFC chip again."
                  : "If this Tag has an NFC chip, program it again."}
              </li>
            </ul>
            <p className="mt-3 text-sm text-muted" data-rotate-not-needed>
              {ROTATE_NOT_NEEDED}
            </p>
          </>
        }
        confirmLabel="Make a new code"
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
  const frame =
    "mx-auto flex aspect-square w-full max-w-[280px] items-center justify-center";

  // The code fades only when it is actually replaced — a new token after
  // "Make a new code" — never when it first appears or on a re-render.
  const [shown, setShown] = useState<{ url: string | null; replaced: boolean }>(
    { url: objectUrl, replaced: false },
  );
  if (status === "ready" && objectUrl !== shown.url) {
    setShown({ url: objectUrl, replaced: shown.url !== null });
  }

  // Reloading a code already on screen keeps it there, dimmed, rather than
  // swapping it for a spinner and back: the square never empties or jumps.
  if (status === "loading" && objectUrl) {
    return (
      <div className="relative" aria-busy="true" data-qr-state="replacing">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={objectUrl}
          alt=""
          className="mx-auto aspect-square w-full max-w-[280px] opacity-30 transition-opacity duration-150"
        />
        <span className="sr-only" role="status">
          Loading the new code
        </span>
      </div>
    );
  }

  if (status === "ready" && objectUrl) {
    return (
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={objectUrl}
          src={objectUrl}
          alt={`Code for ${label}`}
          className={cn(
            "mx-auto aspect-square w-full max-w-[280px]",
            shown.replaced && "animate-qr-in",
          )}
        />
        {needsReprint ? (
          <p
            className="mt-3 text-center text-sm text-muted"
            data-qr-state="rotation-required"
          >
            This is the new code. The one already printed no longer works —
            print this and replace it.
          </p>
        ) : null}
      </div>
    );
  }

  if (status === "expired") {
    return (
      <div
        className={`${frame} flex-col gap-3 text-center`}
        data-qr-state="expired"
      >
        <p className="text-sm text-muted">
          Your session expired, so the code could not load.
        </p>
        <Button variant="secondary" onClick={onReload}>
          Sign in again and retry
        </Button>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div
        className={`${frame} flex-col gap-3 text-center`}
        data-qr-state="error"
      >
        <p className="text-sm text-muted">The code could not be loaded.</p>
        <Button variant="secondary" onClick={onReload}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className={frame} data-qr-state="loading">
      <div
        className="size-8 animate-spin rounded-full border-4 border-border border-t-brand-text"
        aria-label="Loading code"
        role="status"
      />
    </div>
  );
}
