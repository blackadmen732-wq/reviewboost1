import type { Metadata } from "next";

import { OwnerHome } from "@/features/dashboard/owner-home";
import { deriveHomeModel } from "@/features/dashboard/home-model";
import { OwnerShell } from "@/features/dashboard/owner-shell";
import { InstallPrompt } from "@/features/dashboard/install-prompt";
import {
  getOwnerCounts,
  listLocations,
  listReviews,
  listStands,
  requireOwner,
} from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Home — ReviewBoost",
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

  const [counts, stands, locations, unread] = await Promise.all([
    getOwnerCounts(organization.orgId, organization.timezone),
    listStands(organization.orgId),
    listLocations(organization.orgId),
    listReviews(organization.orgId, {
      unreadOnly: true,
      withNotesOnly: true,
      openOnly: true,
      limit: 5,
    }),
  ]);

  const model = deriveHomeModel({
    counts,
    stands,
    hasLocation: locations.length > 0,
  });

  return (
    <OwnerShell unreadCount={counts.unread} businessName={organization.name}>
      <InstallPrompt />
      <OwnerHome
        businessName={organization.name}
        model={model}
        unreadItems={unread.items.map((item) => ({
          id: item.responseId,
          rating: item.rating,
          note: item.note,
          submittedAt: item.submittedAt,
          isRead: item.isRead,
          isResolved: item.isResolved,
          noteCount: item.noteCount,
        }))}
      />
    </OwnerShell>
  );
}
