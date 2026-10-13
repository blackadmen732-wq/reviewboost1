import Link from "next/link";

import { cn } from "@/lib/utils/cn";

export type TextRequestView = "send" | "customers";

const TABS: ReadonlyArray<{ view: TextRequestView; label: string; href: string }> = [
  { view: "send", label: "Send", href: "/text-requests" },
  { view: "customers", label: "Customers", href: "/text-requests/customers" },
];

/**
 * Send · Customers.
 *
 * Customers are the people Text Requests go to, so they live here rather than
 * as a fifth destination in the bar, the same way Insights lives in Feedback.
 */
export function TextRequestTabs({ active }: { active: TextRequestView }) {
  return (
    <nav aria-label="Text Requests views" className="mb-8">
      <ul className="flex gap-6 border-b border-border">
        {TABS.map((tab) => (
          <li key={tab.view} className="shrink-0">
            <Link
              href={tab.href}
              aria-current={tab.view === active ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex min-h-11 items-center border-b-2 text-sm transition-[color] duration-150",
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
