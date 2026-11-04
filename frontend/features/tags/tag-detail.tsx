"use client";

import { Check, Download, MoreHorizontal, Nfc, Printer, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { AlertDialog } from "@/components/ui/dialog";
import { InlineNotice } from "@/components/ui/inline-notice";
import { OutcomeCheckNotice } from "@/components/ui/outcome-check-notice";
import { notify } from "@/components/ui/toast";
import { CodeLoadFailed } from "@/features/tags/code-load-failed";
import { PrintCodeSheet } from "@/features/tags/print-code-sheet";
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
import { ownerFetch, SessionExpiredError } from "@/lib/api/owner-fetch";
import { useOutcomeCheck } from "@/lib/recovery/use-outcome-check";
import { cn } from "@/lib/utils/cn";

/** The only action that invalidates a printed QR code or a programmed NFC chip. */
export const ROTATE_WARNING =
  "This is the only change that stops a Tag working. As soon as you confirm, the QR code you printed and the NFC chip you programmed for this Tag stop opening your Customer Page.";

/** Everything that does not need a new code — so nobody rotates to "apply" it. */
export const ROTATE_NOT_NEEDED =
  "You don’t need a new code to change your Google link, your Customer Page or this Tag’s place — those reach the Tag on its next tap. Only do this if the code was copied or you want the old one to stop working.";

/** Why the code on this Tag opens nothing for customers right now, if it doesn't. */
export interface ClosedNotice {
  title: string;
  /** Only for someone who may change the plan. */
  action: { label: string; href: string } | null;
}

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
  businessName,
  placeName,
  timeZone,
  closedNotice = null,
}: {
  stand: Stand;
  canManage: boolean;
  organizationId?: string;
  /** Printed above the code. */
  businessName?: string;
  /** Printed under the code: only a business with more than one place passes it. */
  placeName?: string | undefined;
  /** The business's, so "Used yesterday" is the business's yesterday. */
  timeZone: string;
  closedNotice?: ClosedNotice | null;
}) {
  return (
    <>
      {closedNotice ? (
        <div className="mb-6 max-w-[28rem]" data-tag-closed>
          <InlineNotice kind="error" title={closedNotice.title}>
            <p>This code won’t open your customer page until then. You can still print it.</p>
            {closedNotice.action ? (
              <Link
                href={closedNotice.action.href}
                className="mt-2 inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-4 hover:no-underline"
              >
                {closedNotice.action.label}
              </Link>
            ) : null}
          </InlineNotice>
        </div>
      ) : null}
      {canManage ? (
        <ManagedTagDetail
          stand={stand}
          organizationId={organizationId}
          businessName={businessName}
          placeName={placeName}
          timeZone={timeZone}
        />
      ) : (
        <ReadOnlyTagDetail stand={stand} timeZone={timeZone} />
      )}
    </>
  );
}

const noSubscription = () => () => {};

/**
 * Whether this browser can write NFC at all. Web NFC is Chrome on Android
 * only; on an iPhone or a computer the sheet could only ever end on "This
 * phone can't program Tags", so the page says so before the tap instead.
 * Unknown (null) while rendering on the server.
 */
function useNfcCapable(): boolean | null {
  return useSyncExternalStore(
    noSubscription,
    () => "NDEFReader" in window,
    () => null,
  );
}

function ReadOnlyTagDetail({ stand, timeZone }: { stand: Stand; timeZone: string }) {
  const status = tagReadiness(stand);
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-[length:var(--rb-text-display)] font-semibold tracking-[-0.03em] text-ink">
          {stand.label}
        </h1>
        <StatusLine stand={stand} status={status} timeZone={timeZone} />
      </header>
      <p className="text-base text-muted" data-tag-access="read-only">
        {ownerOrAdmin("print, set up or change this Tag")}
      </p>
    </div>
  );
}

function ManagedTagDetail({
  stand,
  organizationId,
  businessName,
  placeName,
  timeZone,
}: {
  stand: Stand;
  organizationId: string | undefined;
  businessName: string | undefined;
  placeName: string | undefined;
  timeZone: string;
}) {
  const router = useRouter();
  const qr = useAuthenticatedQr(stand.standId, organizationId);
  // Set the moment a Tag is programmed so the header stops saying "Tap not set up"
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
  const menuId = useId();
  const nfcCapable = useNfcCapable();
  const needsNfc = status === "needs-nfc" || status === "both";
  // One filled button: the thing this Tag still needs that this device can
  // do. A ready Tag needs nothing, so both actions are quiet.
  const primary: "nfc" | "print" | null =
    needsNfc && nfcCapable === true ? "nfc" : status === "ready" ? null : "print";

  function newCodeReady() {
    setJustProgrammedAt(null);
    setConfirming(false);
    router.refresh();
    qr.reload();
    notify.success(
      "New code ready",
      "The old code no longer works. Print this one and set up tap again.",
    );
  }

  const rotateCheck = useOutcomeCheck({
    onDone: newCodeReady,
    onNotDone: () => notify.error("Could not make a new code", "Your code is unchanged. Please try again."),
    onExpired: (message) => notify.error("Please sign in again", message),
  });

  async function rotate() {
    if (rotateCheck.pending) return;
    setBusy(true);
    // The code as it was: a new one has a new prefix and a new rotation time.
    const before = { prefix: stand.tokenPrefix, rotatedAt: stand.tokenRotatedAt };
    const orgHeaders: Record<string, string> = organizationId
      ? { "X-Organization-Id": organizationId }
      : {};
    const isNewCode = async (signal: AbortSignal): Promise<boolean> => {
      const response = await ownerFetch("/api/v1/review-stands", {
        signal,
        headers: orgHeaders,
      });
      if (!response.ok) throw new Error("No answer yet.");
      const { data } = (await response.json()) as {
        data: Array<{ standId: string; tokenPrefix: string; tokenRotatedAt: string | null }>;
      };
      const now = data.find((row) => row.standId === stand.standId);
      if (!now) throw new Error("No answer yet.");
      return now.tokenPrefix !== before.prefix || now.tokenRotatedAt !== before.rotatedAt;
    };
    try {
      const response = await ownerFetch(
        `/api/v1/review-stands/${stand.standId}/rotate-token`,
        { method: "POST", headers: orgHeaders },
      );
      if (!response.ok) {
        if (response.status >= 500) {
          // It may have happened before the error: find out, don't guess.
          setConfirming(false);
          rotateCheck.start(isNewCode, { serverAnswered: true });
          return;
        }
        notify.error("Could not make a new code", "Please try again.");
        return;
      }
      newCodeReady();
    } catch (caught) {
      if (caught instanceof SessionExpiredError) {
        notify.error("Please sign in again", "Your session expired.");
        return;
      }
      // The answer was lost. Making another code now could replace the new
      // one too, so look first: the Tag says whether its code changed.
      setConfirming(false);
      rotateCheck.start(isNewCode);
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
            <StatusLine stand={stand} status={status} timeZone={timeZone} />
          </div>
          <button
            type="button"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-ink transition-colors hover:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
            aria-expanded={more}
            aria-controls={menuId}
            aria-label="More"
            onClick={() => setMore((value) => !value)}
          >
            <MoreHorizontal className="size-5" aria-hidden="true" />
          </button>
        </div>
        {more ? (
          // Print is already the page's own button; this holds only what has
          // no other home.
          <div
            id={menuId}
            className="mt-3 flex max-w-[28rem] flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-3"
            onKeyDown={(event) => {
              if (event.key === "Escape") setMore(false);
            }}
          >
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
            <Button
              variant="secondary"
              disabled={rotateCheck.pending}
              onClick={() => setConfirming(true)}
            >
              Make a new code
            </Button>
          </div>
        ) : null}
      </header>

      <OutcomeCheckNotice check={rotateCheck} className="max-w-[28rem]" />

      <section className="max-w-[28rem] rounded-[var(--radius-card)] border border-border bg-surface p-5">
        {/* The hook already distinguishes loading from expired from failed. The
            view used to collapse all of them into "no objectUrl" and spin
            forever, so an owner whose session had expired watched an
            indefinite spinner with nothing to click. */}
        <QrPanel
          standId={stand.standId}
          status={qr.status}
          objectUrl={qr.objectUrl}
          label={stand.label}
          needsReprint={status === "needs-qr" || status === "both"}
          failures={qr.failures}
          onReload={qr.reload}
        />
      </section>

      {/* The two things a Tag does, as two big tiles: print the code, set up
          tap. The one this Tag still needs, and this device can do, is the
          filled one; a small chip says where each stands. */}
      <div className="grid max-w-[28rem] grid-cols-2 gap-3" data-tag-actions>
        <ActionTile
          icon={Printer}
          label="Print this code"
          filled={primary === "print"}
          chip={status === "needs-qr" || status === "both" ? { text: "Reprint", tone: "needs" } : null}
          disabled={qr.status !== "ready"}
          onClick={() => window.print()}
        />
        <ActionTile
          icon={Nfc}
          label={status === "both" ? "Set up tap again" : "Set up tap"}
          filled={primary === "nfc"}
          chip={
            status === "ready" || status === "needs-qr"
              ? { text: "Done", tone: "good" }
              : status === "both"
                ? { text: "Redo", tone: "needs" }
                : { text: "Not set", tone: "needs" }
          }
          onClick={() => setProgram(true)}
          data-nfc-section
        />
      </div>
      {nfcCapable === false ? (
        <p className="-mt-3 max-w-[28rem] text-sm leading-relaxed text-muted" data-nfc-unsupported>
          This browser can’t set up tap. Use the ReviewBoost iPhone app or
          Chrome on Android. The printed code works either way.
        </p>
      ) : null}
      <div className="max-w-[28rem]">
        <PreviewCustomerPage standId={stand.standId} variant="button" />
      </div>

      {/* Only the current code reaches paper: while a new one loads, the old
          image is still on screen, dimmed, and printing it would print a
          dead code. */}
      {qr.status === "ready" && qr.objectUrl ? (
        <PrintCodeSheet src={qr.objectUrl} businessName={businessName} placeName={placeName} />
      ) : null}

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
                  ? "Set up tap on this Tag again."
                  : "If this Tag has tap, set it up again."}
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
 * Where the Tag stands, first, in a word and a colour: green when it works,
 * amber when it needs the owner. Then when it was last used. The place is
 * named only when the Tag has one (a business with one place does not need
 * to read it on every Tag).
 */
function StatusLine({
  stand,
  status,
  timeZone,
}: {
  stand: Stand;
  status: ReturnType<typeof tagReadiness>;
  timeZone: string;
}) {
  // No Google link at its place: nothing else about the Tag matters yet.
  const closed = stand.placeHasGoogleLink === false;
  const good = status === "ready" && !closed;
  return (
    // No dots between the parts: a long status wraps, and a line that starts
    // with "·" reads as a mistake. The status is ink with its colour; the rest
    // is quiet.
    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-base text-muted" data-tag-status={closed ? "needs-google" : status}>
      <span className="inline-flex items-center gap-2 font-medium text-ink">
        <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", good ? "bg-brand" : "bg-star")} />
        {closed ? "Needs your Google link" : tagReadinessLabel(status)}
      </span>
      {closed ? (
        <Link href="/settings" className="inline-flex min-h-11 items-center font-medium text-ink underline underline-offset-4 hover:no-underline">
          Add it in Settings
        </Link>
      ) : null}
      <span>{lastUsedLabel(stand.lastOpenedAt, timeZone)}</span>
      {stand.locationName ? <span>{stand.locationName}</span> : null}
    </p>
  );
}

/** One of the Tag's two jobs: a big square to press, its word, and where it stands. */
function ActionTile({
  icon: Icon,
  label,
  filled,
  chip,
  disabled = false,
  onClick,
  ...rest
}: {
  icon: LucideIcon;
  label: string;
  filled: boolean;
  chip: { text: string; tone: "good" | "needs" } | null;
  disabled?: boolean;
  onClick: () => void;
  "data-nfc-section"?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-h-[8.5rem] flex-col items-start justify-between gap-4 rounded-[var(--radius-card)] p-4 text-left transition-[background-color,transform] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
        filled
          ? "bg-ink text-canvas shadow-[var(--shadow-button)] hover:bg-[color:var(--rb-action-hover)]"
          : "border border-border bg-surface text-ink hover:bg-quiet",
      )}
      {...rest}
    >
      <span className="flex w-full items-start justify-between gap-2">
        <Icon aria-hidden="true" className="size-7" strokeWidth={1.75} />
        {chip ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold",
              chip.tone === "good"
                ? "bg-brand-soft text-brand-text"
                : "bg-[color:var(--rb-warning-soft)] text-[color:var(--rb-warning)]",
            )}
          >
            {chip.tone === "good" ? <Check aria-hidden="true" className="size-3.5" strokeWidth={3} /> : null}
            {chip.text}
          </span>
        ) : null}
      </span>
      <span className="text-base font-semibold leading-snug">{label}</span>
    </button>
  );
}

/**
 * Every state the code can be in, each with its own way out.
 */
function QrPanel({
  standId,
  status,
  objectUrl,
  label,
  needsReprint,
  failures,
  onReload,
}: {
  standId: string;
  status: AuthenticatedQr["status"];
  objectUrl: string | null;
  label: string;
  needsReprint: boolean;
  failures: number;
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
        <CodeLoadFailed standId={standId} failures={failures} onReload={onReload} />
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
