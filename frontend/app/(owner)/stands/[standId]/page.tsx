import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/ui/back-link";
import { OwnerShell } from "@/features/dashboard/owner-shell";
import { TagDetail } from "@/features/tags/tag-detail";
import { permissionsFor } from "@/lib/owner/permissions";
import { serviceNotice } from "@/lib/owner/service-state";
import { getServiceState, getStand, getUnreadCount, requireOwner } from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Tag",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TagDetailPage({
  params,
}: {
  params: Promise<{ standId: string }>;
}) {
  const { standId } = await params;
  const { organization } = await requireOwner(`/stands/${standId}`);
  if (!UUID.test(standId)) notFound();
  const [stand, service, unread] = await Promise.all([
    getStand(organization.orgId, standId),
    getServiceState(organization.orgId),
    getUnreadCount(organization.orgId),
  ]);
  if (!stand) notFound();
  const can = permissionsFor(organization.role);
  const billing = serviceNotice(service);

  return (
    <OwnerShell unreadCount={unread} businessName={organization.name}>
      <BackLink href="/stands">Set up</BackLink>
      <TagDetail
        organizationId={organization.orgId}
        stand={stand}
        canManage={can.manageTags}
        closedNotice={
          billing?.kind === "plan"
            ? { title: billing.title, action: can.manageBilling ? billing.action : null }
            : null
        }
      />
    </OwnerShell>
  );
}
