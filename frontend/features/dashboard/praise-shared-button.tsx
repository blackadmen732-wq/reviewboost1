"use client";

import { Check, MessageCircleHeart } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { notify } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils/cn";

/**
 * "I told them."
 *
 * The one thing this feature exists to cause. A customer said somebody did well;
 * the value is created when that person hears it, and that happens out loud in a
 * kitchen, not through a notification.
 *
 * Staff have no accounts here on purpose — giving them one would turn a
 * two-minute setup into a staff-onboarding project no café will finish. So the
 * app does not deliver the message. It remembers whether the message was
 * delivered, which is what stops the same praise being passed on twice or, far
 * more likely, never.
 *
 * Optimistic, with no confirmation step. Getting this wrong costs nothing, and a
 * dialog in front of a four-second kindness is how the kindness stops happening.
 */
export function PraiseSharedButton({
  praiseId,
  isShared,
  staffName,
}: {
  praiseId: string;
  isShared: boolean;
  staffName: string;
}) {
  const router = useRouter();
  const [optimistic, setOptimistic] = useState(isShared);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !optimistic;
    setOptimistic(next);
    setBusy(true);

    const {
      data: { session },
    } = await supabaseBrowser().auth.getSession();

    if (!session) {
      setOptimistic(!next);
      setBusy(false);
      notify.error("Please sign in again", "Your session expired.");
      return;
    }

    const response = await fetch(`/api/v1/team-praise/${praiseId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ shared: next }),
    });

    setBusy(false);

    if (!response.ok) {
      setOptimistic(!next);
      notify.error("Could not save that", "Please try again.");
      return;
    }

    router.refresh();
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void toggle()}
      aria-pressed={optimistic}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold",
        "transition-[background-color,transform] duration-150",
        "active:scale-[0.97] motion-reduce:active:scale-100",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
        "disabled:opacity-60",
        optimistic
          ? "bg-brand-soft text-brand-text"
          : "border border-border bg-surface text-ink hover:bg-quiet",
      )}
    >
      {optimistic ? (
        <>
          <Check className="size-4" strokeWidth={3} aria-hidden="true" />
          Told them
        </>
      ) : (
        <>
          <MessageCircleHeart className="size-4" aria-hidden="true" />
          Tell {staffName.split(" ")[0]}
        </>
      )}
    </button>
  );
}
