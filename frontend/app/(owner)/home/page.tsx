import type { Metadata } from "next";

import { OwnerHome } from "@/features/dashboard/owner-home";
import { deriveHomeModel, deriveSetupChecklist } from "@/features/dashboard/home-model";
import { OwnerShell } from "@/features/dashboard/owner-shell";
import { InstallPrompt } from "@/features/dashboard/install-prompt";
import {
  getOwnerCounts,
  hasPublishedCustomerPage,
  listLocations,
  listReviews,
  listStands,
  readOwnerBilling,
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

  const [counts, stands, locations, unread, billing, customerPagePublished] = await Promise.all([
    getOwnerCounts(organization.orgId, organization.timezone),
    listStands(organization.orgId),
    listLocations(organization.orgId),
    listReviews(organization.orgId, {
      unreadOnly: true,
      openOnly: true,
      limit: 5,
    }),
    readOwnerBilling(organization.orgId),
    hasPublishedCustomerPage(organization.orgId),
  ]);

  const model = deriveHomeModel({
    counts,
    stands,
    hasLocation: locations.length > 0,
  });

  // Same "paying/committed" condition the billing panel uses: a trial with no
  // plan behind it is a business that predates billing, not a finished goal.
  const subscriptionComplete = !(
    billing.status === null ||
    billing.status === "cancelled" ||
    billing.status === "suspended" ||
    (billing.status === "trialing" && billing.planId === null)
  );

  const checklist = deriveSetupChecklist({
    subscriptionComplete,
    hasGoogleLink: counts.hasGoogleLink,
    customerPagePublished,
    hasFirstTag: stands.length > 0,
  });

  return (
    <OwnerShell unreadCount={counts.unread} businessName={organization.name}>
      <InstallPrompt />
      <OwnerHome
        businessName={organization.name}
        model={model}
        checklist={checklist}
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
