"use client";

import { Check, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/browser";

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
}: {
  responseId: string;
  isResolved: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function setResolved(resolved: boolean) {
    setBusy(true);

    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();

    if (!session) {
      setBusy(false);
      notify.error("Please sign in again", "Your session expired.");
      return;
    }

    const response = await fetch(`/api/v1/customer-responses/${responseId}/resolve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ resolved }),
    });

    setBusy(false);

    if (!response.ok) {
      notify.error("Could not save that", "Please try again.");
      return;
    }

    router.refresh();
    if (resolved) notify.success("Sorted", "Nice one.");
  }

  if (isResolved) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => void setResolved(false)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-sm font-medium text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)] disabled:opacity-50"
      >
        <RotateCcw className="size-4" aria-hidden="true" />
        Not sorted after all
      </button>
    );
  }

  return (
    <Button loading={busy} loadingLabel="Saving…" onClick={() => void setResolved(true)}>
      <Check className="size-5" aria-hidden="true" />
      Mark as sorted
    </Button>
  );
}
