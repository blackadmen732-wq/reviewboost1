import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/ui/back-link";
import { Stars } from "@/components/ui/stars";
import { ActionThread } from "@/features/dashboard/action-thread";
import { MarkReadOnOpen } from "@/features/dashboard/mark-read-on-open";
import { OwnerShell } from "@/features/dashboard/owner-shell";
import { ResolveButton } from "@/features/dashboard/resolve-button";
import { getReview, getUnreadCount, listStands, requireOwner } from "@/lib/server/owner-data";
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

  const [found, tags, unread] = await Promise.all([
    getReview(organization.orgId, responseId),
    listStands(organization.orgId),
    getUnreadCount(organization.orgId),
  ]);

  if (!found) notFound();

  const { review, actions } = found;
  const tag = tags.find((item) => item.standId === review.standId) ?? null;
  const submitted = new Date(review.submittedAt);
  const clock = submitted.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: organization.timezone,
  });
  const full = submitted.toLocaleString("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: organization.timezone,
  });
  // Where it came from, so "the patio" and "the counter" can be told apart.
  const from = [tag?.label, tags.length > 1 ? tag?.locationName : null].filter(Boolean).join(" · ");
  // A low rating is the one that may need doing something about; praise can
  // still be marked sorted, quietly.
  const needsAction = review.rating <= 3 && !review.isResolved;

  return (
    <OwnerShell unreadCount={unread} businessName={organization.name}>
      {review.isRead ? null : <MarkReadOnOpen responseId={review.responseId} />}
      <BackLink href="/feedback">Feedback</BackLink>

      <article className="max-w-[36rem]">
        <header className="mb-5">
          <h1 className="text-ink">
            <Stars rating={review.rating} size="lg" />
          </h1>
          <p className="mt-3 text-base text-muted">
            <time dateTime={review.submittedAt} title={full}>
              {relativeDay(review.submittedAt)} at {clock}
            </time>
            {from ? <> · {from}</> : null}
          </p>
        </header>

        {review.note ? (
          <p className="whitespace-pre-wrap text-lg leading-relaxed text-ink">
            {review.note}
          </p>
        ) : (
          <p className="text-base text-muted">
            A rating with no message.
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-y border-border py-4">
          {review.isResolved || needsAction ? (
            <p
              key={String(review.isResolved)}
              className="animate-fade-in text-sm text-muted"
            >
              {review.isResolved ? "Sorted" : "Not sorted yet"}
            </p>
          ) : null}
          <ResolveButton
            responseId={review.responseId}
            isResolved={review.isResolved}
            quiet={!needsAction}
          />
        </div>
      </article>

      <ActionThread responseId={review.responseId} actions={actions} />
    </OwnerShell>
  );
}
