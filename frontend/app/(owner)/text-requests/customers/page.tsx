import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/features/dashboard/app-shell";
import { CustomersManager } from "@/features/text-requests/customers-manager";
import { TextRequestTabs } from "@/features/text-requests/text-request-tabs";
import { permissionsFor } from "@/lib/owner/permissions";
import { listLocations, listOwnerCustomers, requireOwner } from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Customers",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Text Requests → Customers.
 *
 * Owner and admin only, like the consent ledger it reads. A member or viewer
 * who follows a link here is taken back to Text Requests rather than shown an
 * empty list that looks like nobody was ever saved.
 */
export default async function CustomersPage() {
  const { user, organization } = await requireOwner("/text-requests/customers");
  if (!permissionsFor(organization.role).sendTextRequests) redirect("/text-requests");

  const [customers, locations] = await Promise.all([
    listOwnerCustomers(organization.orgId, user.id, organization.role),
    listLocations(organization.orgId),
  ]);

  return (
    <AppShell businessName={organization.name}>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Text Requests</h1>
        <p className="mt-1 text-base text-muted">
          The people you text. Pick one and send them your Tag link.
        </p>
      </div>

      <TextRequestTabs active="customers" />

      <CustomersManager
        customers={customers}
        places={locations.map(({ locationId, name }) => ({ locationId, name }))}
      />
    </AppShell>
  );
}
