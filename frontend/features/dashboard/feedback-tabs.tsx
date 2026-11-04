"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils/cn";

export type FeedbackView = "needs-you" | "everything" | "insights";

const TABS: ReadonlyArray<{ view: FeedbackView; label: string; href: string }> = [
  { view: "needs-you", label: "Needs you", href: "/feedback" },
  { view: "everything", label: "Everything", href: "/feedback?show=all" },
  { view: "insights", label: "Insights", href: "/feedback/insights" },
];

/**
 * Where the underline was last placed, and when. Insights is its own route,
 * so these tabs are drawn afresh when it opens; the new underline starts where
 * the old one was and slides across, instead of one disappearing and another
 * appearing. Only a position from a moment ago counts: coming back to Feedback
 * from Home, the underline is simply where it belongs.
 */
let handoff: { view: FeedbackView; left: number; width: number; at: number } | null = null;
const HANDOFF_MS = 2000;

function recentHandoff() {
  return handoff && Date.now() - handoff.at < HANDOFF_MS ? handoff : null;
}

/**
 * Needs you · Everything · Insights.
 *
 * Two ways through the inbox and one step back from it. Insights answers a
 * different question — what are customers telling me, all together — but it is
 * the same people's ratings, so it lives here rather than as its own
 * destination in the bar.
 *
 * One underline, moved on the tap rather than redrawn on arrival: 200ms,
 * transform only, and nothing waits for it. `active` is absent while the
 * screen is loading: the underline then stays on the tab just tapped, and with
 * nothing tapped (a fresh load) there is none rather than a guess.
 */
export function FeedbackTabs({ active }: { active?: FeedbackView | undefined }) {
  const [chosen, setChosen] = useState<FeedbackView | undefined>(() => active ?? recentHandoff()?.view);
  const [shown, setShown] = useState<FeedbackView | undefined>(active);
  // Follow the page when it moves on by itself (back button, a link).
  if (active !== shown) {
    setShown(active);
    if (active) setChosen(active);
  }

  const tabs = useRef<Map<FeedbackView, HTMLAnchorElement>>(new Map());
  const bar = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const line = bar.current;
    const tab = chosen ? tabs.current.get(chosen) : undefined;
    if (!line) return;
    if (!tab) {
      line.style.opacity = "0";
      return;
    }
    const next = { left: tab.offsetLeft, width: tab.offsetWidth };
    const from = recentHandoff();
    handoff = { view: chosen!, ...next, at: Date.now() };

    const place = ({ left, width }: { left: number; width: number }) => {
      line.style.transform = `translateX(${left}px) scaleX(${width})`;
    };

    if (line.dataset.placed !== "true") {
      // Newly drawn: appear where the last underline was (or straight where it
      // belongs), with no transition from the element's unset position.
      line.style.transition = "none";
      place(from ?? next);
      line.style.opacity = "1";
      void line.getBoundingClientRect();
      line.style.transition = "";
    }
    place(next);
    line.style.opacity = "1";
    line.dataset.placed = "true";
    // The row stops drawing per-tab underlines once the moving one is there.
    line.parentElement?.setAttribute("data-placed", "");
  }, [chosen]);

  return (
    <nav aria-label="Feedback views" className="mb-8">
      {/* Until the moving underline has been placed, the chosen tab draws its
          own, so the first paint (and a page without script) always has one. */}
      <ul className="group/tabs relative flex gap-6 overflow-x-auto">
        {TABS.map((tab) => (
          <li key={tab.view} className="shrink-0">
            <Link
              ref={(node) => {
                if (node) tabs.current.set(tab.view, node);
                else tabs.current.delete(tab.view);
              }}
              href={tab.href}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                setChosen(tab.view);
              }}
              aria-current={tab.view === active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center border-b-2 text-sm transition-[color] duration-200",
                "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
                tab.view === chosen ? "border-ink group-data-[placed]/tabs:border-transparent" : "border-transparent",
                tab.view === chosen ? "font-semibold text-ink" : "font-medium text-muted hover:text-ink",
              )}
            >
              {tab.label}
            </Link>
          </li>
        ))}
        {/* 1px wide, scaled to the tab's width: moving and resizing are both a
            transform, so the slide never lays the row out again. */}
        <span
          ref={bar}
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-0 h-0.5 w-px origin-left bg-ink opacity-0 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]"
          data-tab-indicator
        />
      </ul>
    </nav>
  );
}
