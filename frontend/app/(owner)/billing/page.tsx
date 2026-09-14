import type { Metadata } from "next";

import { AppShell } from "@/features/dashboard/app-shell";
import { BillingOverview } from "@/features/billing/billing-overview";
import { requireOwner } from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Billing — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const { organization } = await requireOwner("/billing");

  return (
    <AppShell businessName={organization.name}>
      <h1 className="mb-2 text-2xl font-semibold tracking-[-0.02em] text-ink">Billing</h1>
      <p className="mb-6 text-base text-muted">Your plan and payment.</p>

      <BillingOverview
        state="trialing"
        planId="starter"
        trialDaysLeft={7}
        trialEndsAt={null}
        currentPeriodEnd={null}
        cancelAtPeriodEnd={false}
        smsSegmentsUsed={0}
        smsSegmentsIncluded={150}
      />
    </AppShell>
  );
}
