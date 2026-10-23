import type { Metadata } from "next";
import { cookies } from "next/headers";

import { tagLabels } from "@/features/dashboard/feedback-list";
import { OwnerHome } from "@/features/dashboard/owner-home";
import { deriveHomeModel } from "@/features/dashboard/home-model";
import { OwnerShell } from "@/features/dashboard/owner-shell";
import { InstallPrompt } from "@/features/dashboard/install-prompt";
import { parseSetupSeen, SETUP_SEEN_COOKIE } from "@/features/dashboard/setup-seen-cookie";
import { permissionsFor } from "@/lib/owner/permissions";
import { insightsHomeLine } from "@/lib/owner/insights";
import {
  getFeedbackInsights,
  getOwnerCounts,
  getServiceState,
  hasPublishedCustomerPhoto,
  listLocations,
  listReviews,
  listStands,
  requireOwner,
} from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Home",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The screen an owner opens every morning.
 *
 * Data still comes from the shared owner data layer. This file only
 * assembles what Home already knows how to ask for.
 */
export default async function HomePage() {
  const { organization } = await requireOwner("/home");

  const [counts, stands, locations, unread, hasCustomerPhoto, insights, service] = await Promise.all([
    getOwnerCounts(organization.orgId, organization.timezone),
    listStands(organization.orgId),
    listLocations(organization.orgId),
    listReviews(organization.orgId, {
      unreadOnly: true,
      openOnly: true,
      limit: 5,
    }),
    hasPublishedCustomerPhoto(organization.orgId),
    getFeedbackInsights(organization.orgId, organization.timezone, { range: 30 }),
    getServiceState(organization.orgId),
  ]);
  const can = permissionsFor(organization.role);
  const tagLabel = tagLabels(stands);

  const model = deriveHomeModel({
    counts,
    stands,
    hasLocation: locations.length > 0,
    canManage: can.manageTags,
    hasCustomerPhoto,
    service,
    canManageBilling: can.manageBilling,
  });

  return (
    <OwnerShell unreadCount={counts.unread} businessName={organization.name}>
      <InstallPrompt />
      <OwnerHome
        businessName={organization.name}
        model={model}
        insightsLine={insightsHomeLine(insights)}
        seenDone={parseSetupSeen((await cookies()).get(SETUP_SEEN_COOKIE)?.value)}
        unreadItems={unread.items.map((item) => ({
          id: item.responseId,
          rating: item.rating,
          note: item.note,
          submittedAt: item.submittedAt,
          isRead: item.isRead,
          isResolved: item.isResolved,
          noteCount: item.noteCount,
          tagLabel: tagLabel(item.standId),
        }))}
      />
    </OwnerShell>
  );
}
