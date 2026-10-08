import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Stars } from "@/components/ui/stars";
import { ActionThread } from "@/features/dashboard/action-thread";
import { OwnerShell } from "@/features/dashboard/owner-shell";
import { ResolveButton } from "@/features/dashboard/resolve-button";
import { getReview, requireOwner } from "@/lib/server/owner-data";
import { relativeDay } from "@/lib/utils/relative-day";

export const metadata: Metadata = {
  title: "Feedback",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function FeedbackDetailPage({
  params,
}: {
  params: Promise<{ responseId: string }>;
}) {
  const { responseId } = await params;
  const { organization } = await requireOwner(`/feedback/${responseId}`);

  const found = await getReview(organization.orgId, responseId);

  if (!found) notFound();

  const { review, actions } = found;

  return (
    <OwnerShell businessName={organization.name}>
      <Link
        href="/feedback"
        className="mb-8 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All feedback
      </Link>

      {/* The rating arrives as a card that rises in, its stars filling one by
          one, then what the team can do about it. */}
      <article className="rb-rise max-w-[36rem] rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-[var(--shadow-raised)] sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <Stars rating={review.rating} size="lg" animated delay={160} />
          <time dateTime={review.submittedAt} className="shrink-0 text-sm text-muted">
            {relativeDay(review.submittedAt)}
          </time>
        </div>

        {review.note ? (
          <p className="whitespace-pre-wrap text-lg leading-relaxed text-ink">{review.note}</p>
        ) : (
          <p className="text-base italic text-muted">They gave a rating without writing anything.</p>
        )}
      </article>

      <div
        className="rb-rise mt-6 flex max-w-[36rem] items-center justify-between gap-3"
        style={{ "--rb-rise-delay": "180ms" } as React.CSSProperties}
      >
        <p key={String(review.isResolved)} className="animate-fade-in text-sm text-muted">
          {review.isResolved ? "Sorted" : "Not sorted yet"}
        </p>
        <ResolveButton responseId={review.responseId} isResolved={review.isResolved} />
      </div>

      <div className="rb-rise" style={{ "--rb-rise-delay": "280ms" } as React.CSSProperties}>
        <ActionThread responseId={review.responseId} actions={actions} />
      </div>
    </OwnerShell>
  );
}
