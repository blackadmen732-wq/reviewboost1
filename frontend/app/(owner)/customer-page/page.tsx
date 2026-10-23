import type { Metadata } from "next";

import { BackLink } from "@/components/ui/back-link";
import { OwnerShell } from "@/features/dashboard/owner-shell";
import { CustomerPageEditor } from "@/features/customer-page/customer-page-editor";
import {
  getOwnerCounts,
  listStands,
  requireOwner,
} from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Customer page",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function CustomerPagePage() {
  const { organization } = await requireOwner("/customer-page");
  const [counts, stands] = await Promise.all([
    getOwnerCounts(organization.orgId, organization.timezone),
    listStands(organization.orgId),
  ]);
  const previewStand = stands.find((stand) => stand.status === "active");

  const canEdit =
    organization.role === "owner" || organization.role === "admin";

  return (
    <OwnerShell unreadCount={counts.unread} businessName={organization.name}>
      <BackLink href="/stands">Set up</BackLink>
      {/* Tighter than the shared PageHeader: title, description, photo,
          preview and Publish read as one workflow on a phone. */}
      <header className="mb-6">
        <h1 className="text-[length:var(--rb-text-display)] font-semibold tracking-[-0.03em] text-ink">
          Customer page
        </h1>
        <p className="mt-2 max-w-[40ch] text-base leading-relaxed text-muted">
          What customers see when they scan one of your Tags.
        </p>
      </header>

      {canEdit ? (
        <CustomerPageEditor
          businessName={organization.name}
          previewStandId={previewStand?.standId ?? null}
        />
      ) : (
        <p className="text-sm text-muted">
          Only owners and admins can edit the customer page. Ask the account
          owner to make changes.
        </p>
      )}
    </OwnerShell>
  );
}
