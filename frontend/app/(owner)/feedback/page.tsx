import type { Metadata } from "next";
import { MessageSquare } from "lucide-react";

import { AppShell } from "@/features/dashboard/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { FeedbackList } from "@/features/dashboard/feedback-list";
import { getOwnerCounts, listReviews, requireOwner } from "@/lib/server/owner-data";

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
 * These are two screens on purpose. Feedback is the *inbox* — things that may
 * need a reply, with unread state and an action attached. Reviews is the
 * *record* — every rating, browsable and filterable, with nothing to do.
 *
 * Collapsing them would mean either burying complaints in a list of 5s, or
 * pretending a silent 5 is an unread task. An owner between customers needs the
 * first list short and true.
 *
 * Notes are decrypted on the server and never logged. The rating appears here
 * because this is the private workspace — the one place an owner is meant to see
 * it. Team Praise deliberately does not.
 */
export default async function FeedbackPage() {
  await requireOwner("/feedback");

  const [{ items }, counts] = await Promise.all([
    listReviews({ withNotesOnly: true, limit: 50 }),
    getOwnerCounts(),
  ]);

  return (
    <AppShell unreadCount={counts.unread}>
      <h1 className="mb-2 text-2xl font-semibold tracking-[-0.02em] text-ink">Feedback</h1>
      <p className="mb-6 text-base text-muted">Messages customers wrote for you.</p>

      {items.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="Nothing yet"
          // Explains the cause, not just the absence.
          description="When a customer scans your code and writes something, it shows up here."
        />
      ) : (
        <FeedbackList
          items={items.map((item) => ({
            id: item.responseId,
            rating: item.rating,
            note: item.note,
            submittedAt: item.submittedAt,
            isRead: item.isRead,
          }))}
        />
      )}
    </AppShell>
  );
}
