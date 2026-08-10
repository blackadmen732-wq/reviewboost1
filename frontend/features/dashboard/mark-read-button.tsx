"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { supabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils/cn";

/**
 * Mark one piece of feedback as read.
 *
 * Optimistic: the dot disappears the instant it is tapped, before the network
 * answers. Marking something read is not a decision that needs confirming, and
 * a spinner on a trivial action makes an app feel slow even when it is not.
 *
 * On failure it reverts and says nothing. The cost of a silently failed
 * mark-as-read is that the owner sees it again next time — which is the safe
 * direction to fail in, and not worth an error message that interrupts them.
 */
export function MarkReadButton({ responseId }: { responseId: string }) {
  const router = useRouter();
  const [done, setDone] = useState(false);

  async function markRead() {
    setDone(true);

    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();

    if (!session) {
      setDone(false);
      return;
    }

    const response = await fetch(`/api/v1/customer-responses/${responseId}/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (!response.ok) {
      setDone(false);
      return;
    }

    // Refreshes the Server Component so the unread badge in the nav agrees with
    // what is on screen. Two counters disagreeing is worse than either.
    router.refresh();
  }

  if (done) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted">
        <Check className="size-4" aria-hidden="true" />
        Read
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void markRead()}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-sm font-semibold",
        "text-brand transition-colors hover:bg-brand-soft",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
      )}
    >
      <Check className="size-4" aria-hidden="true" />
      Mark read
    </button>
  );
}
