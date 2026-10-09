import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { AppShell } from "@/features/dashboard/app-shell";
import { BillingPanel } from "@/features/dashboard/billing-panel";
import { PUBLIC_PLANS } from "@/features/public/pricing-plans";
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
/**
 * `?plan=` is what this owner chose on the public pricing page, carried here
 * through setup. It marks a card; it never starts a payment. Validated
 * against the published plans so the parameter can only name a real one.
 */
function chosenPlanFrom(raw: string | undefined): string | null {
  if (!raw) return null;
  return PUBLIC_PLANS.some((plan) => plan.id === raw) ? raw : null;
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan } = await searchParams;
  const { organization } = await requireOwner("/settings/billing");
  const billing = await readOwnerBilling(organization.orgId);

  return (
    <AppShell businessName={organization.name}>
      <PageHeader
        title="Billing & Usage"
        description="Your plan, what it includes, and what you are using."
        tight
      />

      <BillingPanel
        billing={billing}
        canManage={permissionsFor(organization.role).manageBilling}
        chosenPlan={chosenPlanFrom(plan)}
      />
    </AppShell>
  );
}
