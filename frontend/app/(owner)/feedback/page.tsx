import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { FeedbackList } from "@/features/dashboard/feedback-list";
import { FeedbackTabs } from "@/features/dashboard/feedback-tabs";
import { RatingSummaryCard } from "@/features/dashboard/insights/rating-summary-card";
import { TodayNote } from "@/features/dashboard/insights/insights-view";
import { OwnerShell } from "@/features/dashboard/owner-shell";
import {
  filterInstants,
  formatDateRange,
  hasFeedbackFilters,
  parseFeedbackFilters,
  type FeedbackFilters,
} from "@/lib/owner/insights";
import {
  getFeedbackInsights,
  getOwnerCounts,
  listLocations,
  listReviews,
  listStands,
  requireOwner,
} from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Feedback",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The inbox: Needs you, and Everything.
 *
 * Everything can arrive filtered from Insights — one star value, one place,
 * the same days the breakdown counted — so an owner who taps "2 stars: 6
 * ratings" sees those six. The filter is read from the URL and trusted in no
 * part: see parseFeedbackFilters.
 */
export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; rating?: string; location?: string; from?: string; to?: string }>;
}) {
  const { organization } = await requireOwner("/feedback");

  const params = await searchParams;
  const showAll = params.show === "all";

  const locations = showAll ? await listLocations(organization.orgId) : [];
  const filters = showAll
    ? parseFeedbackFilters(params, locations.map((location) => location.locationId))
    : null;
  const filtered = filters !== null && hasFeedbackFilters(filters);
  const span = filters ? filterInstants(organization.timezone, filters) : null;

  // Everything, unfiltered, opens on the rating card: the last 30 days, the
  // same numbers Insights and Home show, so there is still one average.
  const withCard = showAll && !filtered;

  const [{ items, hasMore }, counts, insights, stands] = await Promise.all([
    listReviews(organization.orgId, {
      limit: 50,
      ...(showAll ? {} : { openOnly: true }),
      ...(filters?.rating ? { rating: filters.rating } : {}),
      ...(filters?.locationId ? { locationId: filters.locationId } : {}),
      ...(span ? { submittedFrom: span.from, submittedBefore: span.before } : {}),
    }),
    getOwnerCounts(organization.orgId, organization.timezone),
    withCard ? getFeedbackInsights(organization.orgId, organization.timezone, { range: 30 }) : null,
    listStands(organization.orgId),
  ]);
  // Which Tag a rating came through matters once there is more than one;
  // with a single Tag it would be the same word on every card.
  const tagLabels = stands.length > 1 ? new Map(stands.map((stand) => [stand.standId, stand.label])) : null;

  return (
    <OwnerShell unreadCount={counts.unread} businessName={organization.name}>
      <PageHeader title="Feedback" description="Ratings from your customers." />

      <FeedbackTabs active={showAll ? "everything" : "needs-you"} />

      {insights && (insights.state === "full" || insights.state === "starting") ? (
        <div className="mb-6">
          <RatingSummaryCard insights={insights}>
            <TodayNote count={insights.todayTotal} />
          </RatingSummaryCard>
        </div>
      ) : null}

      {filtered && filters ? (
        <FilterSummary
          filters={filters}
          locationName={locations.find((location) => location.locationId === filters.locationId)?.name ?? null}
        />
      ) : null}

      {items.length === 0 ? (
        filtered ? (
          <EmptyState
            title="No ratings match"
            description="Nothing in these ratings fits the filter."
          />
        ) : showAll ? (
          <EmptyState
            title="Nothing yet"
            description="When a customer rates you, it shows up here."
          />
        ) : (
          <EmptyState
            title="All caught up"
            description="Nothing is waiting on you. Anything already sorted is under Everything."
          />
        )
      ) : (
        <>
          <FeedbackList
            items={items.map((item) => ({
              id: item.responseId,
              rating: item.rating,
              note: item.note,
              submittedAt: item.submittedAt,
              isRead: item.isRead,
              isResolved: item.isResolved,
              noteCount: item.noteCount,
              tagLabel: tagLabels?.get(item.standId) ?? null,
            }))}
          />
          {hasMore ? (
            <p className="mt-4 text-sm text-muted">Showing the 50 most recent.</p>
          ) : null}
        </>
      )}
    </OwnerShell>
  );
}

/** What the list is filtered to, in words, and the way out of the filter. */
function FilterSummary({
  filters,
  locationName,
}: {
  filters: FeedbackFilters;
  locationName: string | null;
}) {
  const parts: string[] = [];
  if (filters.rating) parts.push(`${filters.rating} ${filters.rating === 1 ? "star" : "stars"}`);
  if (locationName) parts.push(locationName);
  if (filters.from && filters.to) parts.push(formatDateRange(filters.from, filters.to));

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1">
      <p className="text-base text-ink">
        <span className="text-muted">Showing </span>
        {parts.join(" · ")}
      </p>
      <Link
        href="/feedback?show=all"
        className="inline-flex min-h-11 items-center text-sm font-medium text-brand-text underline-offset-4 hover:underline"
      >
        Clear filter
      </Link>
    </div>
  );
}
