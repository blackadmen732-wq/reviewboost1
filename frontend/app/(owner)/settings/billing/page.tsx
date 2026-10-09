import type { Metadata } from "next";

import { AppShell } from "@/features/dashboard/app-shell";
import { BillingPanel } from "@/features/dashboard/billing-panel";
import { permissionsFor } from "@/lib/owner/permissions";
import { readOwnerBilling, requireOwner } from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Billing",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Billing.
 *
 * Every value on this page comes from the backend. Nothing here writes
 * "Starter", "trialing", "150", "7 days remaining", a next invoice date, or a
 * card — because a page that fills those in when the data is missing is a page
 * that tells a business it is subscribed when it is not.
 */
export default async function BillingPage() {
  const { organization } = await requireOwner("/settings/billing");
  const billing = await readOwnerBilling(organization.orgId);

  return (
    <AppShell businessName={organization.name}>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Billing &amp; Usage</h1>
        <p className="mt-1 text-base text-muted">
          Your plan, what it includes, and what you are using.
        </p>
      </div>

      <BillingPanel
        billing={billing}
        canManage={permissionsFor(organization.role).manageBilling}
      />
    </AppShell>
  );
}
