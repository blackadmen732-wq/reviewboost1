import type { Metadata } from "next";
import { MessageSquare } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { AppShell } from "@/features/dashboard/app-shell";
import { FeedbackList } from "@/features/dashboard/feedback-list";
import { getOwnerCounts, listReviews, requireOwner } from "@/lib/server/owner-data";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = {
  title: "Feedback — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The private messages customers left, newest first.
 *
 * FEEDBACK VS REVIEWS
 * -------------------
 * Two screens on purpose. Feedback is the *inbox* — things that may need doing,
 * with unread state and an action attached. Reviews is the *record* — every
 * rating, browsable, with nothing to do.
 *
 * Collapsing them would mean either burying complaints in a list of 5s, or
 * pretending a silent 5 is an unread task. An owner between customers needs the
 * first list short and true.
 *
 * Notes are decrypted on the server and never logged. The rating appears here
 * because this is the private workspace — the one place an owner is meant to see
 * it. Team Praise deliberately does not.
 */
export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { organization } = await requireOwner("/feedback");

  const { show } = await searchParams;
  const showAll = show === "all";

  const [{ items }, counts] = await Promise.all([
    listReviews(organization.orgId, { withNotesOnly: true, limit: 50, ...(showAll ? {} : { openOnly: true }) }),
    getOwnerCounts(organization.orgId, organization.timezone),
  ]);

  return (
    <AppShell unreadCount={counts.unread}>
      <h1 className="mb-2 text-2xl font-semibold tracking-[-0.02em] text-ink">Feedback</h1>
      <p className="mb-5 text-base text-muted">Messages customers wrote for you.</p>

      <div className="mb-5 flex gap-2" role="group" aria-label="Filter feedback">
        <FilterTab href="/feedback" label="Needs you" active={!showAll} />
        <FilterTab href="/feedback?show=all" label="Everything" active={showAll} />
      </div>

      {items.length === 0 ? (
        showAll ? (
          <EmptyState
            icon={MessageSquare}
            title="Nothing yet"
            // Explains the cause, not just the absence.
            description="When a customer scans your code and writes something, it shows up here."
          />
        ) : (
          // A genuinely different state, and a good one. "Nothing needs you" is
          // an answer worth giving, not an empty screen to apologise for.
          <EmptyState
            icon={MessageSquare}
            title="All caught up"
            description="Nothing is waiting on you. Anything already sorted is under Everything."
          />
        )
      ) : (
        <FeedbackList
          items={items.map((item) => ({
            id: item.responseId,
            rating: item.rating,
            note: item.note,
            submittedAt: item.submittedAt,
            isRead: item.isRead,
            isResolved: item.isResolved,
            noteCount: item.noteCount,
          }))}
        />
      )}
    </AppShell>
  );
}

/**
 * Two tabs, not a dropdown.
 *
 * Both options are visible without a tap, which is the whole point for someone
 * who will not go hunting inside a menu to discover that a second view exists.
 */
function FilterTab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium",
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
        active
          ? "bg-brand-soft text-brand-text"
          : "border border-border bg-surface text-muted hover:text-ink",
      )}
    >
      {label}
    </Link>
  );
}
