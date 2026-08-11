import type { Metadata } from "next";
import { ArrowLeft, Check } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Stars } from "@/components/ui/stars";
import { ActionThread } from "@/features/dashboard/action-thread";
import { AppShell } from "@/features/dashboard/app-shell";
import { ResolveButton } from "@/features/dashboard/resolve-button";
import { getReview, requireOwner } from "@/lib/server/owner-data";
import { relativeDay } from "@/lib/utils/relative-day";

export const metadata: Metadata = {
  title: "Feedback — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * One piece of feedback, and what was done about it.
 *
 * The list can show what a customer said; it cannot show a conversation. So
 * anything with history gets its own screen, where the customer's words sit at
 * the top and everything the business did sits underneath in order.
 *
 * A real URL rather than a modal, deliberately. An owner dealing with a
 * complaint often wants to send it to someone — "look at this one" — and a modal
 * has no address to send. It also means the phone's back gesture does the
 * obvious thing.
 */
export default async function FeedbackDetailPage({
  params,
}: {
  params: Promise<{ responseId: string }>;
}) {
  const { responseId } = await params;
  await requireOwner(`/feedback/${responseId}`);

  const found = await getReview(responseId);

  // getReview returns null for "does not exist" and "another business's" alike,
  // because RLS makes them indistinguishable. Telling them apart would confirm
  // that somebody else's feedback exists.
  if (!found) notFound();

  const { review, actions } = found;

  return (
    <AppShell>
      <Link
        href="/feedback"
        className="mb-5 inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] pr-3 text-sm font-medium text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
        All feedback
      </Link>

      <article className="rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <Stars rating={review.rating} size="md" />
          <time dateTime={review.submittedAt} className="shrink-0 text-sm text-muted">
            {relativeDay(review.submittedAt)}
          </time>
        </div>

        {review.note ? (
          // The customer's own words, at the largest size on the screen. They
          // are the reason this page exists.
          <p className="whitespace-pre-wrap text-lg leading-relaxed text-ink">{review.note}</p>
        ) : (
          <p className="text-base italic text-muted">
            They gave a rating without writing anything.
          </p>
        )}
      </article>

      <div className="mt-5 flex items-center justify-between gap-3">
        {review.isResolved ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1.5 text-sm font-medium text-brand-text">
            <Check className="size-4" strokeWidth={3} aria-hidden="true" />
            Sorted
          </span>
        ) : (
          <span className="text-sm text-muted">Not sorted yet</span>
        )}

        <ResolveButton responseId={review.responseId} isResolved={review.isResolved} />
      </div>

      <ActionThread responseId={review.responseId} actions={actions} />
    </AppShell>
  );
}
