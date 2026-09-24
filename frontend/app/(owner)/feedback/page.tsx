import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { FeedbackList } from "@/features/dashboard/feedback-list";
import { OwnerShell } from "@/features/dashboard/owner-shell";
import { getOwnerCounts, listReviews, requireOwner } from "@/lib/server/owner-data";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = {
  title: "Feedback",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { organization } = await requireOwner("/feedback");

  const { show } = await searchParams;
  const showAll = show === "all";

  const [{ items }, counts] = await Promise.all([
    listReviews(organization.orgId, { limit: 50, ...(showAll ? {} : { openOnly: true }) }),
    getOwnerCounts(organization.orgId, organization.timezone),
  ]);

  return (
    <OwnerShell unreadCount={counts.unread} businessName={organization.name}>
      <PageHeader title="Feedback" description="Ratings and messages from your customers." />

      <div
        className="mb-8 inline-flex w-fit items-center gap-1 rounded-full border border-border bg-surface p-1 shadow-[var(--shadow-control)]"
        role="group"
        aria-label="Filter feedback"
      >
        <FilterTab href="/feedback" label="Needs you" active={!showAll} />
        <FilterTab href="/feedback?show=all" label="Everything" active={showAll} />
      </div>

      {items.length === 0 ? (
        showAll ? (
          <EmptyState
            title="Nothing yet"
            description="When a customer rates you, it shows up here."
          />
        ) : (
          <EmptyState
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
    </OwnerShell>
  );
}

function FilterTab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex min-h-9 items-center rounded-full px-4 text-sm transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
        active
          ? "bg-ink font-semibold text-canvas"
          : "font-medium text-muted hover:text-ink",
      )}
    >
      {label}
    </Link>
  );
}
