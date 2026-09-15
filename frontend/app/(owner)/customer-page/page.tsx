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

  const canEdit = organization.role === "owner" || organization.role === "admin";

  return (
    <AppShell unreadCount={counts.unread}>
      <h1 className="mb-1 text-2xl font-semibold tracking-[-0.02em] text-ink">Customer Page</h1>
      <p className="mb-6 text-sm text-muted">
        What customers see when they scan one of your tags.
      </p>

      {canEdit ? (
        <CustomerPageEditor
          businessName={organization.name}
          initialTagline={null}
          initialHeroUrl={null}
          isPublished={false}
        />
      ) : (
        <p className="text-sm text-muted">
          Only owners and admins can edit the customer page. Ask the account owner to make changes.
        </p>
      )}
    </AppShell>
  );
}
