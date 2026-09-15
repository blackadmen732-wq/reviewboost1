import type { Metadata } from "next";

import { AppShell } from "@/features/dashboard/app-shell";
import { CustomerPageEditor } from "@/features/customer-page/customer-page-editor";
import { getOwnerCounts, requireOwner } from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Customer Page — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function CustomerPagePage() {
  const { organization } = await requireOwner("/customer-page");
  const counts = await getOwnerCounts(organization.orgId, organization.timezone);

  return (
    <AppShell unreadCount={counts.unread}>
      <h1 className="mb-1 text-2xl font-semibold tracking-[-0.02em] text-ink">Customer Page</h1>
      <p className="mb-6 text-sm text-muted">
        What customers see when they scan one of your tags.
      </p>

      <CustomerPageLoader businessName={organization.name} />
    </AppShell>
  );
}

// Thin server wrapper around the client-side editor.
// The editor loads its own initial state via the API so we stay out of
// the service-role path entirely from a page component.
function CustomerPageLoader({ businessName }: { businessName: string }) {
  return (
    <CustomerPageEditor
      businessName={businessName}
      initialTagline={null}
      initialHeroUrl={null}
      isPublished={false}
    />
  );
}
