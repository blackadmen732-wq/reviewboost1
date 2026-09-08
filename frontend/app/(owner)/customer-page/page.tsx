import type { Metadata } from "next";

import { AppShell } from "@/features/dashboard/app-shell";
import { CustomerPageDesigner } from "@/features/customer-page-designer/customer-page-designer";
import { listLocations, requireOwner } from "@/lib/server/owner-data";
import { supportedLocales } from "@/lib/i18n/config";

export const metadata: Metadata = {
  title: "Customer Page — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Editing and publishing are org-setting writes, so they follow the same rule as
 * the rest of them: owners and admins change the page, everyone else can look at
 * it. The gate is repeated server-side when there is an API to gate.
 */
const editingRoles = ["owner", "admin"];

export default async function CustomerPageDesignerPage() {
  const { organization } = await requireOwner("/customer-page");
  const locations = await listLocations(organization.orgId);

  return (
    <AppShell businessName={organization.name}>
      <CustomerPageDesigner
        orgId={organization.orgId}
        businessName={organization.name}
        locations={locations.map((location) => ({
          locationId: location.locationId,
          name: location.name,
        }))}
        languages={supportedLocales}
        canEdit={editingRoles.includes(organization.role)}
      />
    </AppShell>
  );
}
