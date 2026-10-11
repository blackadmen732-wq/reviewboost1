import { Card } from "@/components/ui/card";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { RatingBreakdown } from "@/features/dashboard/rating-breakdown";
import type { FeedbackInsights } from "@/lib/owner/insights";

/**
 * How many ratings came in, and how they split, at the top of the inbox.
 *
 * The numbers already existed — on Insights, a tab away. An owner opening
 * Feedback wants to read what came in, and the one thing they ask before
 * reading it is "how much came in". Making them leave the inbox to find out
 * is a tab too many, so the short version lives here and the long one stays
 * where it was.
 *
 * It reuses `RatingBreakdown` rather than drawing its own bars: same
 * component, same neutral ink tint, same counts-not-percentages rule. Two
 * charts of the same data that disagree about colour is how a screen starts
 * teaching an owner that a two is a failure.
 *
 * Nothing is invented when there is nothing to show. Under MIN_SAMPLE the
 * average is null and this prints the count alone; with no ratings at all it
 * renders nothing and the inbox opens straight onto its own empty state.
 */
export function FeedbackSummary({ insights }: { insights: FeedbackInsights }) {
  const { total, average, counts } = insights.current;
  if (total === 0) return null;

  return (
    <Card as="section" className="mb-8" aria-labelledby="feedback-summary-heading">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <h2 id="feedback-summary-heading" className="sr-only">
            The last 30 days
          </h2>
          <p className="text-[length:var(--rb-text-title)] font-semibold tabular-nums tracking-[-0.02em] text-ink">
            {total}
            <span className="ml-2 text-sm font-medium text-muted">
              {total === 1 ? "rating" : "ratings"}
            </span>
          </p>
          {average !== null ? (
            <p className="text-[length:var(--rb-text-title)] font-semibold tabular-nums tracking-[-0.02em] text-ink">
              {average.toFixed(1)}
              <span className="ml-2 text-sm font-medium text-muted">average</span>
            </p>
          ) : null}
          <p className="text-sm text-muted">Last 30 days</p>
        </div>

        <Link
          href="/feedback/insights"
          className="group inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          View insights
          <ChevronRight
            aria-hidden="true"
            className="size-4 transition-transform duration-150 group-hover:translate-x-0.5"
          />
        </Link>
      </div>

      {/* Each row opens those ratings in the inbox below it. */}
      <RatingBreakdown
        counts={counts}
        rowHref={(rating) => `/feedback?show=all&rating=${rating}`}
      />
    </Card>
  );
}
