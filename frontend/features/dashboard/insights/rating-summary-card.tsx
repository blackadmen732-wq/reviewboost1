import type { ReactNode } from "react";

import { CountUp } from "@/components/ui/count-up";
import { Stars } from "@/components/ui/stars";
import { RatingBreakdown } from "@/features/dashboard/rating-breakdown";
import {
  drilldownHref,
  formatDateRange,
  ratingsCount,
  roundAverage,
  type FeedbackInsights,
} from "@/lib/owner/insights";

/**
 * The rating card: the average out of 5, the stars it rounds to, how many
 * ratings and which days it rests on, and how the stars were spread — one
 * card an owner can read in a glance and tap into.
 *
 * It renders a `FeedbackInsights` period and nothing else, so wherever it
 * appears (Insights, the top of Everything) it shows the same number as Home
 * and Insights: there is one average in the product. Below MIN_SAMPLE ratings
 * there is no average and no stars, only the count and the spread.
 *
 * `children` sit under the headline (the comparison line, today's note).
 * Each breakdown row opens those ratings in Everything, for these days.
 *
 * It arrives in a short sequence: the card rises, the average counts up to
 * itself, the stars fill one by one and the bars grow out from their
 * baseline. The final numbers are in the markup from the start.
 */
export function RatingSummaryCard({
  insights,
  locationId = null,
  children,
}: {
  insights: FeedbackInsights;
  locationId?: string | null;
  children?: ReactNode;
}) {
  const { current, periods, state } = insights;
  const dates = formatDateRange(periods.current.startDate, periods.current.endDate);
  const average = state === "full" ? current.average : null;

  return (
    <section
      aria-labelledby="insights-summary"
      className="rb-rise rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-[var(--shadow-raised)] sm:p-6"
    >
      <h2 id="insights-summary" className="sr-only">
        Customer experience
      </h2>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {average !== null ? (
          <p className="flex items-baseline gap-1.5">
            <CountUp
              value={roundAverage(average)}
              decimals={1}
              delay={120}
              className="text-[3.25rem] font-semibold leading-none tabular-nums tracking-[-0.04em] text-ink"
            />
            <span className="text-lg text-muted">/ 5</span>
          </p>
        ) : (
          <p className="text-[length:var(--rb-text-title)] font-semibold tracking-[-0.02em] text-ink">
            {ratingsCount(current.total)}
          </p>
        )}

        <div className="min-w-0">
          {average !== null ? (
            // The number beside it is what a screen reader should hear; the
            // stars are its picture, rounded to whole stars.
            <span aria-hidden="true">
              <Stars rating={Math.round(average)} size="md" animated delay={220} />
            </span>
          ) : null}
          <p className={average !== null ? "mt-1 text-sm text-muted" : "text-sm text-muted"}>
            {average !== null ? `${ratingsCount(current.total)} · ${dates}` : dates}
          </p>
        </div>
      </div>

      {children}

      <div
        className="mt-5 border-t border-border pt-4"
        style={{ "--rb-bar-delay": "260ms" } as React.CSSProperties}
      >
        <h3 className="mb-2 text-sm font-semibold text-ink">How customers rated you</h3>
        <RatingBreakdown
          counts={current.counts}
          rowHref={(rating) => drilldownHref({ rating, locationId, period: periods.current })}
        />
      </div>
    </section>
  );
}
