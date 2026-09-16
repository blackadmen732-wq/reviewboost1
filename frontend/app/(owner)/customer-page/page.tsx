import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { OwnerShell } from "@/features/dashboard/owner-shell";
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
    <OwnerShell unreadCount={counts.unread} businessName={organization.name}>
      <PageHeader
        title="Customer page"
        description="What customers see when they scan one of your Tags."
      />

      {canEdit ? (
        <CustomerPageEditor
          businessName={organization.name}
          isPublished={false}
        />
      ) : (
        <p className="text-sm text-muted">
          Only owners and admins can edit the customer page. Ask the account owner to make changes.
        </p>
      )}
    </OwnerShell>
  );
}
