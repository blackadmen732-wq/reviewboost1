import type { Metadata } from "next";

import { OwnerShell } from "@/features/dashboard/owner-shell";
import { BillingPanel } from "@/features/dashboard/billing-panel";
import { billingForPlan, parsePlanChoice } from "@/lib/owner/plan-choice";
import { permissionsFor } from "@/lib/owner/permissions";
import { BackLink } from "@/components/ui/back-link";
import { getUnreadCount, readOwnerBilling, requireOwner } from "@/lib/server/owner-data";

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
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const selectedPlan = parsePlanChoice((await searchParams).plan);
  const { organization } = await requireOwner(billingForPlan(selectedPlan));
  const [billing, unread] = await Promise.all([
    readOwnerBilling(organization.orgId),
    getUnreadCount(organization.orgId),
  ]);

  return (
    <OwnerShell unreadCount={unread} businessName={organization.name}>
      <BackLink href="/settings">Settings</BackLink>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">
          Billing
        </h1>
        <p className="mt-1 text-base text-muted">
          Your plan, what it includes, and what you are using.
        </p>
      </div>

      <BillingPanel
        selectedPlan={selectedPlan}
        billing={billing}
        canManage={permissionsFor(organization.role).manageBilling}
      />
    </OwnerShell>
  );
}
