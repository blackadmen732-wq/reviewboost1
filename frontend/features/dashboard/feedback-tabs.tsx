"use client";

import Link from "next/link";
import { useState } from "react";

import { cn } from "@/lib/utils/cn";

export type FeedbackView = "needs-you" | "everything" | "insights";

const TABS: ReadonlyArray<{ view: FeedbackView; label: string; href: string }> = [
  { view: "needs-you", label: "Needs you", href: "/feedback" },
  { view: "everything", label: "Everything", href: "/feedback?show=all" },
  { view: "insights", label: "Insights", href: "/feedback/insights" },
];

/**
 * Needs you · Everything · Insights.
 *
 * Two ways through the inbox and one step back from it. Insights answers a
 * different question — what are customers telling me, all together — but it is
 * the same people's ratings, so it lives here rather than as its own
 * destination in the bar.
 *
 * Pills, each a 44px target: the chosen one is filled, the others outlined.
 * The pill tapped fills at once, before the next screen has loaded, so a tap
 * is never met with nothing. `active` is absent while the screen is loading:
 * the fill then stays on the pill just tapped, and with nothing tapped (a
 * fresh load) no pill claims to be current.
 */
export function FeedbackTabs({ active }: { active?: FeedbackView | undefined }) {
  const [chosen, setChosen] = useState<FeedbackView | undefined>(active);
  const [shown, setShown] = useState<FeedbackView | undefined>(active);
  // Follow the page when it moves on by itself (back button, a link).
  if (active !== shown) {
    setShown(active);
    if (active) setChosen(active);
  }

  return (
    <nav aria-label="Feedback views" className="mb-6">
      <ul className="flex gap-2 overflow-x-auto">
        {TABS.map((tab) => (
          <li key={tab.view} className="shrink-0">
            <Link
              href={tab.href}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                setChosen(tab.view);
              }}
              aria-current={tab.view === active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium",
                "transition-colors duration-150 motion-reduce:transition-none",
                "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
                tab.view === chosen
                  ? "border-transparent bg-brand-soft text-brand-text"
                  : "border-border bg-surface text-muted hover:border-[color:var(--rb-border-strong)] hover:text-ink",
              )}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
