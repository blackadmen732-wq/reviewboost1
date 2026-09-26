import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import Link from "next/link";

import { LocationPicker } from "@/features/dashboard/insights/location-picker";
import { RatingTrendChart } from "@/features/dashboard/insights/rating-trend-chart";
import { RatingBreakdown } from "@/features/dashboard/rating-breakdown";
import {
  DIRECTION_LABEL,
  drilldownHref,
  formatAverage,
  formatDateRange,
  formatDay,
  INSIGHT_RANGES,
  MIN_SAMPLE,
  plottedPoints,
  ratingsCount,
  stretchName,
  type Direction,
  type FeedbackInsights,
  type InsightRange,
} from "@/lib/owner/insights";
import { cn } from "@/lib/utils/cn";

const DIRECTION_ICON: Record<Direction, typeof ArrowUp> = {
  improving: ArrowUp,
  steady: ArrowRight,
  declining: ArrowDown,
};

/**
 * Feedback → Insights. What customers are collectively telling the business,
 * readable in about ten seconds.
 *
 * Top to bottom: the period (and place), the average and how many ratings it
 * rests on, whether that moved, one quiet line over time, and how the stars
 * were spread — each row of which opens the ratings behind it.
 *
 * What it will not do: show an average, a line or a direction on too few
 * ratings to mean anything (MIN_SAMPLE), weigh a half-finished today against
 * full days, colour anything good or bad, or say anything about what happened
 * after a customer left.
 */
export function InsightsView({
  insights,
  locations,
  locationId,
}: {
  insights: FeedbackInsights;
  locations: ReadonlyArray<{ locationId: string; name: string }>;
  locationId: string | null;
}) {
  const { periods, state } = insights;
  const place = locationId ? locations.find((location) => location.locationId === locationId)?.name : null;

  return (
    <div className="flex flex-col gap-10">
      {/* A business that has never had a rating has nothing to filter. One
          looking at a single empty location keeps the way back. */}
      {state !== "none" || locationId !== null ? (
        <Filters range={periods.range} locations={locations} locationId={locationId} />
      ) : null}

      {state === "none" ? (
        <section className="max-w-[36rem]">
          <h2 className="text-[length:var(--rb-text-title)] font-semibold tracking-[-0.02em] text-ink">
            {place ? `No customer feedback for ${place} yet.` : "No customer feedback yet."}
          </h2>
          <p className="mt-2 max-w-[36ch] text-base leading-relaxed text-muted">
            Your insights will appear as customers respond.
          </p>
        </section>
      ) : state === "quiet" ? (
        <section className="max-w-[36rem]">
          <h2 className="text-[length:var(--rb-text-title)] font-semibold tracking-[-0.02em] text-ink">
            No ratings in the last {periods.range} days.
          </h2>
          <p className="mt-2 text-base leading-relaxed text-muted">
            {formatDateRange(periods.current.startDate, periods.current.endDate)}
          </p>
          <TodayNote count={insights.todayTotal} />
          {periods.range < 90 ? (
            <p className="mt-4">
              <Link
                href={rangeHref(90, locationId)}
                className="inline-flex min-h-11 items-center text-base font-medium text-brand-text underline-offset-4 hover:underline"
              >
                See the last 90 days
              </Link>
            </p>
          ) : null}
        </section>
      ) : (
        <>
          <Summary insights={insights} />

          {state === "full" ? (
            <section aria-labelledby="insights-trend">
              <h2 id="insights-trend" className="mb-4 text-base font-semibold text-ink">
                Average rating
              </h2>
              {plottedPoints(insights.trend) >= 2 ? (
                <RatingTrendChart
                  points={insights.trend.map((point) => ({
                    label: formatDateRange(point.startDate, point.endDate),
                    average: point.average,
                    total: point.total,
                  }))}
                  startLabel={formatDay(periods.current.startDate)}
                  endLabel={formatDay(periods.current.endDate)}
                  stretchLabel={stretchName(periods.bucketDays)}
                />
              ) : (
                <p className="max-w-[40ch] text-base leading-relaxed text-muted">
                  Not enough ratings in each {stretchName(periods.bucketDays)} to draw a line yet.
                </p>
              )}
            </section>
          ) : null}

          <section aria-labelledby="insights-breakdown">
            <h2 id="insights-breakdown" className="mb-3 text-base font-semibold text-ink">
              How customers rated you
            </h2>
            <RatingBreakdown
              counts={insights.current.counts}
              rowHref={(rating) => drilldownHref({ rating, locationId, period: periods.current })}
            />
          </section>
        </>
      )}
    </div>
  );
}

function rangeHref(range: InsightRange, locationId: string | null): string {
  const params = new URLSearchParams();
  if (range !== 30) params.set("days", String(range));
  if (locationId) params.set("location", locationId);
  const query = params.toString();
  return `/feedback/insights${query ? `?${query}` : ""}`;
}

/**
 * One row, above everything it scopes: the period first, then the place — the
 * place only for a business that has more than one.
 */
function Filters({
  range,
  locations,
  locationId,
}: {
  range: InsightRange;
  locations: ReadonlyArray<{ locationId: string; name: string }>;
  locationId: string | null;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <nav aria-label="Period">
        <ul className="grid grid-cols-3 rounded-full border border-border bg-surface p-1 sm:inline-grid">
          {INSIGHT_RANGES.map((option) => (
            <li key={option}>
              <Link
                href={rangeHref(option, locationId)}
                aria-current={option === range ? "true" : undefined}
                className={cn(
                  "flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-medium tabular-nums transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
                  option === range ? "bg-ink text-canvas" : "text-muted hover:text-ink",
                )}
              >
                {option} days
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {locations.length > 1 ? (
        <LocationPicker locations={locations} selected={locationId} range={range} />
      ) : null}
    </div>
  );
}

function Summary({ insights }: { insights: FeedbackInsights }) {
  const { current, comparison, periods, state } = insights;
  const dates = formatDateRange(periods.current.startDate, periods.current.endDate);

  return (
    <section aria-labelledby="insights-summary">
      <h2 id="insights-summary" className="sr-only">
        Customer experience
      </h2>

      {state === "full" && current.average !== null ? (
        <p className="flex items-baseline gap-2">
          <span className="text-[3.5rem] font-semibold leading-none tabular-nums tracking-[-0.04em] text-ink">
            {formatAverage(current.average)}
          </span>
          <span className="text-xl text-muted">/ 5</span>
        </p>
      ) : (
        <p className="text-[length:var(--rb-text-title)] font-semibold tracking-[-0.02em] text-ink">
          {ratingsCount(current.total)}
        </p>
      )}

      <p className="mt-3 text-base text-muted">
        {state === "full" ? `${ratingsCount(current.total)} · ${dates}` : dates}
      </p>

      {comparison ? <ComparisonLine insights={insights} /> : null}

      <TodayNote count={insights.todayTotal} />

      {state === "starting" ? (
        <p className="mt-5 max-w-[44ch] text-base leading-relaxed text-muted">
          You’re starting to collect feedback. The average and the trend appear once a period has{" "}
          {MIN_SAMPLE} ratings.
        </p>
      ) : null}
    </section>
  );
}

/**
 * "Improving · from 4.0", and the exact days it was compared with. Ink, never
 * green or red: a direction is information, not a verdict.
 */
function ComparisonLine({ insights }: { insights: FeedbackInsights }) {
  const { comparison, periods } = insights;
  if (!comparison) return null;
  const Icon = DIRECTION_ICON[comparison.direction];

  return (
    <div className="mt-4">
      <p className="flex items-center gap-1.5 text-base font-medium text-ink">
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {DIRECTION_LABEL[comparison.direction]}
        {comparison.direction === "steady" ? (
          <span className="font-normal text-muted">· was {comparison.previous.toFixed(1)}</span>
        ) : (
          <span className="font-normal text-muted">· from {comparison.previous.toFixed(1)}</span>
        )}
      </p>
      <p className="mt-1 text-sm text-muted">
        Previous {periods.range} days: {formatDateRange(periods.previous.startDate, periods.previous.endDate)} ·{" "}
        {ratingsCount(insights.previous.total)}
      </p>
    </div>
  );
}

/** Today's ratings, counted but kept out of every number above until tomorrow. */
function TodayNote({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <p className="mt-3 text-sm text-muted">
      Plus {ratingsCount(count)} today. {count === 1 ? "It joins" : "They join"} these numbers tomorrow.
    </p>
  );
}
