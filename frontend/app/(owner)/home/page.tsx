import type { Metadata } from "next";

import { AppShell } from "@/features/dashboard/app-shell";
import { OwnerHome } from "@/features/dashboard/owner-home";
import { InstallPrompt } from "@/features/dashboard/install-prompt";
import { deriveHomeModel, type HomeCounts } from "@/features/dashboard/home-model";
import { getOwnerCounts, listStands, getPrimaryLocation, requireOwner } from "@/lib/server/owner-data";
import { googleLinkState } from "@/features/dashboard/google-link-copy";

export const metadata: Metadata = {
  title: "Home — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { organization } = await requireOwner("/home");
  const [counts, stands, location] = await Promise.all([
    getOwnerCounts(organization.orgId, organization.timezone),
    listStands(organization.orgId),
    getPrimaryLocation(organization.orgId),
  ]);

  const homeCounts: HomeCounts = {
    ratingsToday: counts.ratingsToday,
    unread: counts.unread,
    activeStands: counts.activeStands,
    recentCount: counts.recentCount,
    hasGoogleLink: counts.hasGoogleLink,
    googleLinkInvalid: location?.googleReviewUrl
      ? googleLinkState(location.googleReviewUrl) === "invalid"
      : false,
  };

  const homeStands = stands.map((s) => ({
    standId: s.standId,
    label: s.label,
    status: s.status,
    nfcProvisionedAt: s.nfcProvisionedAt,
    tokenRotatedAt: s.tokenRotatedAt,
  }));

  const model = deriveHomeModel({
    counts: homeCounts,
    stands: homeStands,
    hasLocation: location !== null,
  });

  return (
    <AppShell unreadCount={counts.unread} businessName={organization.name}>
      <InstallPrompt />
      <OwnerHome
        businessName={organization.name}
        model={model}
        unreadItems={[]}
      />
    </AppShell>
  );
}
