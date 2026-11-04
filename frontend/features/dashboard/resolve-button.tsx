"use client";

import { Check, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { OutcomeCheckNotice } from "@/components/ui/outcome-check-notice";
import { notify } from "@/components/ui/toast";
import { ownerFetch, SessionExpiredError } from "@/lib/api/owner-fetch";
import { useOutcomeCheck } from "@/lib/recovery/use-outcome-check";

/**
 * "Sorted" — and the way back out of it.
 *
 * Separate from Mark read on purpose. Read means an owner's eyes crossed it;
 * sorted means the business did something. Collapsing the two turns the inbox
 * into a list that empties itself just by being scrolled past, which is exactly
 * how complaints get lost.
 *
 * Reopening is deliberately available and deliberately quiet: small, secondary,
 * no confirmation. Nothing is destroyed by either direction, so friction here
 * would only make an owner hesitate before a tap they should feel free to make.
 *
 * The word is "Sorted", not "Resolve". It is what someone running a cafe
 * actually says, and it does not sound like a support-ticket system.
 */
export function ResolveButton({
  responseId,
  isResolved,
  quiet = false,
}: {
  responseId: string;
  isResolved: boolean;
  /**
   * A 4 or 5 star rating, read: nothing is waiting on it, so sorting it is
   * offered but is not the screen's one black button.
   */
  quiet?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const wanted = useRef(false);
  const check = useOutcomeCheck({
    onDone: () => {
      router.refresh();
      if (wanted.current) notify.success("Sorted", "Nice one.");
    },
    onNotDone: () => notify.error("Could not save that", "Please try again."),
    onExpired: (message) => notify.error("Please sign in again", message),
  });

  function send(resolved: boolean): Promise<Response> {
    return ownerFetch(`/api/v1/customer-responses/${responseId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved }),
    });
  }

  async function setResolved(resolved: boolean) {
    setBusy(true);

    try {
      const response = await send(resolved);
      if (!response.ok) {
        notify.error("Could not save that", "Please try again.");
        return;
      }
      router.refresh();
      if (resolved) notify.success("Sorted", "Nice one.");
    } catch (caught) {
      if (caught instanceof SessionExpiredError) {
        notify.error("Please sign in again", caught.message);
        return;
      }
      // The answer was lost. Read the feedback rather than send it again
      // (a write is never replayed by itself): it says whether it is sorted.
      wanted.current = resolved;
      check.start(async (signal) => {
        const read = await ownerFetch(`/api/v1/customer-responses/${responseId}`, {
          signal,
        });
        if (!read.ok) throw new Error("No answer yet.");
        const { data } = (await read.json()) as {
          data: { isResolved?: boolean };
        };
        return data.isResolved === resolved;
      });
    } finally {
      setBusy(false);
    }
  }

  const holding = busy || check.pending;
  const notice = <OutcomeCheckNotice check={check} className="mt-3" />;

  if (isResolved) {
    return (
      <>
        <button
          type="button"
          disabled={holding}
          onClick={() => void setResolved(false)}
          className="animate-fade-in inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-sm font-medium text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)] disabled:opacity-50"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          Not sorted after all
        </button>
        {notice}
      </>
    );
  }

  return (
    <>
      <Button
        variant={quiet ? "secondary" : "action"}
        className="sm:w-auto"
        loading={busy}
        loadingLabel="Saving…"
        disabled={check.pending}
        onClick={() => void setResolved(true)}
      >
        <Check className="size-5" aria-hidden="true" />
        Mark as sorted
      </Button>
      {notice}
    </>
  );
}
