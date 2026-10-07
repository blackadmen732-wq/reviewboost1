import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import Link from "next/link";

import {
  InsightsFigures,
  InsightsNavigationProvider,
  PeriodSwitch,
} from "@/features/dashboard/insights/insights-navigation";
import { LocationPicker } from "@/features/dashboard/insights/location-picker";
import { RatingSummaryCard } from "@/features/dashboard/insights/rating-summary-card";
import { RatingTrendChart } from "@/features/dashboard/insights/rating-trend-chart";
import {
  DIRECTION_LABEL,
  formatDateRange,
  formatDay,
  INSIGHT_RANGES,
  MIN_SAMPLE,
  plottedPoints,
  ratingsCount,
  unitName,
  changeSentence,
  type Direction,
  type FeedbackInsights,
  type InsightRange,
} from "@/lib/owner/insights";
import { localDaysBetween } from "@/lib/utils/local-day";

const DIRECTION_ICON: Record<Direction, typeof ArrowUp> = {
  improving: ArrowUp,
  steady: ArrowRight,
  declining: ArrowDown,
};

/**
 * Feedback → Insights. What customers are collectively telling the business,
 * readable in about ten seconds.
 *
 * Top to bottom: the period (and place); the rating card — the average and
 * how many ratings it rests on, whether that moved, and how the stars were
 * spread, each row of which opens the ratings behind it; then one quiet line
 * over time.
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
    <InsightsNavigationProvider>
      <div className="flex flex-col gap-6">
        {/* A business that has never had a rating has nothing to filter. One
            looking at a single empty location keeps the way back. */}
        {state !== "none" || locationId !== null ? (
          <Filters range={periods.range} locations={locations} locationId={locationId} />
        ) : null}

        <InsightsFigures>
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
              <RatingSummaryCard insights={insights} locationId={locationId}>
                {insights.comparison ? <ComparisonLine insights={insights} /> : null}
                <TodayNote count={insights.todayTotal} />
                {state === "starting" ? (
                  <p className="mt-4 max-w-[44ch] text-base leading-relaxed text-muted">
                    You’re starting to collect feedback. The average and the trend appear once a period has{" "}
                    {MIN_SAMPLE} ratings.
                  </p>
                ) : null}
              </RatingSummaryCard>

              {state === "full" ? (
                <section
                  aria-labelledby="insights-trend"
                  className="rounded-[var(--radius-card)] border border-border bg-surface p-5 sm:p-6"
                >
                  <h2 id="insights-trend" className="text-base font-semibold text-ink">
                    Average rating
                  </h2>
                  <p className="mb-5 mt-1 text-sm text-muted">
                    {[changeSentence(insights), `Each point is one ${unitName(insights.trendUnit)}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {plottedPoints(insights.trend) >= 2 ? (
                    <RatingTrendChart
                      points={insights.trend.map((point, index) => ({
                        label: formatDateRange(point.startDate, point.endDate),
                        // A short oldest week is read out, never labelled under the
                        // axis, where it would crowd the next date.
                        tick:
                          index === 0 &&
                          insights.trendUnit === "week" &&
                          localDaysBetween(point.startDate, point.endDate) < 6
                            ? ""
                            : formatDay(point.startDate),
                        average: point.average,
                        total: point.total,
                      }))}
                      unit={insights.trendUnit}
                      caption={`Average rating by ${unitName(insights.trendUnit)}, ${formatDateRange(
                        periods.current.startDate,
                        periods.current.endDate,
                      )}`}
                    />
                  ) : (
                    <p className="max-w-[40ch] text-base leading-relaxed text-muted">
                      Not enough rated {unitName(insights.trendUnit)}s to draw a line yet.
                    </p>
                  )}
                </section>
              ) : null}
            </>
          )}
        </InsightsFigures>
      </div>
    </InsightsNavigationProvider>
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
      <PeriodSwitch
        options={INSIGHT_RANGES.map((option) => ({
          label: `${option} days`,
          href: rangeHref(option, locationId),
          current: option === range,
        }))}
      />

      {locations.length > 1 ? (
        <LocationPicker locations={locations} selected={locationId} range={range} />
      ) : null}
    </div>
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
export function TodayNote({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <p className="mt-3 text-sm text-muted">
      Plus {ratingsCount(count)} today. {count === 1 ? "It joins" : "They join"} these numbers tomorrow.
    </p>
  );
}
