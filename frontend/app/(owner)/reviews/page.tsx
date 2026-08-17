import type { Metadata } from "next";
import { Star } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { Stars } from "@/components/ui/stars";
import { AppShell } from "@/features/dashboard/app-shell";
import { RatingBreakdown } from "@/features/dashboard/rating-breakdown";
import { getOwnerCounts, getRatingBreakdown, listReviews, requireOwner } from "@/lib/server/owner-data";
import { relativeDay } from "@/lib/utils/relative-day";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = {
  title: "Reviews — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Every rating, browsable.
 *
 * WHY THIS IS NOT THE FEEDBACK SCREEN
 * -----------------------------------
 * Feedback is the inbox: things that may need a reply, with unread state and an
 * action attached. Reviews is the record: everything, filterable, with nothing
 * to do. Merging them would either bury a complaint inside a run of silent 5s or
 * make a silent 5 look like an unread task, and an owner checking between
 * customers needs the actionable list to stay short and true.
 *
 * REVIEW INTEGRITY ON THIS SCREEN
 * -------------------------------
 * The filters are a *lens on history*, not a routing rule. Nothing an owner does
 * here can change what a future customer is offered — every rating already
 * received the identical Google opportunity by the time it appeared in this
 * list.
 *
 * So there is no "reviews prevented" figure, no intercept rate, and no framing
 * of low ratings as caught or contained. Each star value gets the same row, the
 * same gold, and the same weight. The breakdown bars are the only place counts
 * are compared, and they are neutral: a tall 1-star bar is information, not a
 * score.
 */
export default async function ReviewsPage() {
  const { organization } = await requireOwner("/reviews");
  return (
    <AppShell>
      <h1 className="mb-2 text-2xl font-semibold tracking-[-0.02em] text-ink">Reviews</h1>
      <p className="mb-6 text-base text-muted">Every rating customers gave you.</p>
      <ReviewsBody orgId={organization.orgId} timezone={organization.timezone} />
    </AppShell>
  );
}

async function ReviewsBody({ orgId, timezone }: { orgId: string; timezone: string }) {
  const [breakdown, counts, page] = await Promise.all([
    getRatingBreakdown(orgId),
    getOwnerCounts(orgId, timezone),
    listReviews(orgId, { limit: 50 }),
  ]);

  if (breakdown.total === 0) {
    return (
      <EmptyState
        icon={Star}
        title="No ratings yet"
        description="When someone scans your code and taps a star, it appears here straight away."
      />
    );
  }

  return (
    <>
      <section className="mb-6 rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="mb-5 flex items-center gap-4">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[3rem] font-semibold leading-none tabular-nums tracking-[-0.04em] text-ink">
              {breakdown.average?.toFixed(1) ?? "—"}
            </span>
            <span className="text-lg text-muted">/ 5</span>
          </div>
          <div className="min-w-0">
            <Stars rating={Math.round(breakdown.average ?? 0)} size="md" />
            <p className="mt-1 text-sm text-muted">
              {breakdown.total} {breakdown.total === 1 ? "rating" : "ratings"} all time
            </p>
          </div>
        </div>

        <RatingBreakdown counts={breakdown.counts} total={breakdown.total} />
      </section>

      {counts.ratingsToday > 0 ? (
        <p className="mb-4 text-sm font-medium text-brand-text">
          {counts.ratingsToday} {counts.ratingsToday === 1 ? "rating" : "ratings"} today
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {page.items.map((review) => (
          <li
            key={review.responseId}
            className={cn(
              "rounded-[var(--radius-card)] border border-border bg-surface p-4",
              "shadow-[var(--shadow-control)]",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <Stars rating={review.rating} />
              <time dateTime={review.submittedAt} className="shrink-0 text-sm text-muted">
                {relativeDay(review.submittedAt)}
              </time>
            </div>

            {review.note ? (
              <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-ink">
                {review.note}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {page.hasMore ? (
        <p className="mt-6 text-center text-sm text-muted">
          Showing your 50 most recent.{" "}
          <Link href="/feedback" className="font-medium text-brand-text underline">
            Messages that need you
          </Link>{" "}
          are on the Feedback screen.
        </p>
      ) : null}
    </>
  );
}
