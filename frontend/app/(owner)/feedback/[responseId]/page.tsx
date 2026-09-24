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
        className="mb-10 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All feedback
      </Link>

      <article className="max-w-[36rem]">
        <Stars rating={review.rating} size="lg" />
        <time dateTime={review.submittedAt} className="mt-3 block text-sm text-muted">
          {relativeDay(review.submittedAt)}
        </time>

        {review.note ? (
          <p className="mt-6 whitespace-pre-wrap text-xl leading-relaxed text-ink">{review.note}</p>
        ) : (
          <p className="mt-6 text-base italic text-muted">They gave a rating without writing anything.</p>
        )}
      </article>

      <div className="mt-10 flex items-center justify-between gap-3 border-t border-border pt-6">
        <p className="text-sm text-muted">{review.isResolved ? "Sorted" : "Not sorted yet"}</p>
        <ResolveButton responseId={review.responseId} isResolved={review.isResolved} />
      </div>

      <ActionThread responseId={review.responseId} actions={actions} />
    </OwnerShell>
  );
}
