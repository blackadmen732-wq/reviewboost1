import Link from "next/link";

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
 */
export function FeedbackTabs({ active }: { active: FeedbackView }) {
  return (
    <nav aria-label="Feedback views" className="mb-8">
      <ul className="flex gap-6 overflow-x-auto">
        {TABS.map((tab) => (
          <li key={tab.view} className="shrink-0">
            <Link
              href={tab.href}
              aria-current={tab.view === active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center border-b-2 text-sm transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
                tab.view === active
                  ? "border-ink font-semibold text-ink"
                  : "border-transparent font-medium text-muted hover:text-ink",
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
