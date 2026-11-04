import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { FeedbackTabs } from "@/features/dashboard/feedback-tabs";
import { InsightsView } from "@/features/dashboard/insights/insights-view";
import { OwnerShell } from "@/features/dashboard/owner-shell";
import { parseRange } from "@/lib/owner/insights";
import {
  getFeedbackInsights,
  getOwnerCounts,
  listLocations,
  requireOwner,
} from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Insights",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Feedback → Insights.
 *
 * Read-only, and open to everyone who can read Feedback: owner, admin, member
 * and viewer alike. There is nothing here to change, so there is no role to
 * check beyond membership, which requireOwner and row level security already
 * enforce.
 */
export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; location?: string }>;
}) {
  const { organization } = await requireOwner("/feedback/insights");
  const { days, location } = await searchParams;
  const range = parseRange(days);

  const [counts, view] = await Promise.all([
    getOwnerCounts(organization.orgId, organization.timezone),
    (async () => {
      const locations = await listLocations(organization.orgId);
      // Only this business's own places. Anything else in the URL is dropped
      // here, before it can reach a query.
      const locationId = locations.some((place) => place.locationId === location)
        ? (location ?? null)
        : null;
      const insights = await getFeedbackInsights(organization.orgId, organization.timezone, {
        range,
        locationId,
      });
      return { locations, locationId, insights };
    })(),
  ]);

  return (
    <OwnerShell unreadCount={counts.unread} businessName={organization.name}>
      <PageHeader title="Feedback" description="Ratings from your customers." />
      <FeedbackTabs active="insights" />
      <InsightsView
        insights={view.insights}
        locations={view.locations.map(({ locationId, name }) => ({ locationId, name }))}
        locationId={view.locationId}
      />
    </OwnerShell>
  );
}
