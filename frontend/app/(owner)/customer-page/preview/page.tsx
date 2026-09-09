import type { Metadata } from "next";

import { CustomerPagePreviewScreen } from "@/features/customer-page-designer/customer-page-preview-screen";
import { loadDesignerOwner } from "@/lib/server/designer-owner";

export const metadata: Metadata = {
  title: "Preview — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function CustomerPagePreviewRoute({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}) {
  const { location } = await searchParams;
  const { organization, locations } = await loadDesignerOwner();

  const locationId =
    location && locations.some((entry) => entry.locationId === location)
      ? location
      : null;
  const locationName =
    locations.find((entry) => entry.locationId === locationId)?.name ?? null;

  return (
    <CustomerPagePreviewScreen
      orgId={organization.orgId}
      locationId={locationId}
      businessName={organization.name}
      locationName={locationName}
    />
  );
}
