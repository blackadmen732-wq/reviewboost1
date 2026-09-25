import type { Metadata } from "next";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { OwnerShell } from "@/features/dashboard/owner-shell";
import { AddStandButton } from "@/features/dashboard/add-stand-button";
import { TagsList } from "@/features/tags/tags-list";
import { ownerOrAdmin, permissionsFor } from "@/lib/owner/permissions";
import { getEntitlementSnapshot } from "@/lib/server/entitlements-service";
import { listStands, listLocations, requireOwner } from "@/lib/server/owner-data";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Tags",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function StandsPage() {
  const { user, organization } = await requireOwner("/stands");
  const supabase = await supabaseServer();
  const [stands, locations, entitlements] = await Promise.all([
    listStands(organization.orgId),
    listLocations(organization.orgId),
    getEntitlementSnapshot({ userId: user.id, db: supabase }, organization.orgId),
  ]);
  // Creating a Tag is owner/admin at the API. A member or viewer sees the list
  // and no button that would come back 403.
  const canManage = permissionsFor(organization.role).manageTags;
  const canCreate = canManage && locations.length > 0 && entitlements.canCreateTag;

  return (
    <OwnerShell businessName={organization.name}>
      <PageHeader
        title="Tags"
        description="Print a code or program a Tag. Put it where people pay."
        action={
          canCreate ? (
            <AddStandButton
              locations={locations.map((l) => ({ locationId: l.locationId, name: l.name }))}
            />
          ) : null
        }
      />

      {canManage && !entitlements.canCreateTag && locations.length > 0 ? (
        <p className="mb-6 text-base text-ink">
          {entitlements.status === "cancelled"
            ? "This plan is cancelled. Your Tags are still here."
            : `This plan includes ${entitlements.tagLimit} Tags. You are at the limit.`}
        </p>
      ) : null}

      {stands.length === 0 ? (
        <EmptyState
          title="No tags yet"
          description={
            canManage
              ? "Create a Tag, print the code, and put it on the counter."
              : ownerOrAdmin("create a Tag")
          }
          action={
            canCreate ? (
              <AddStandButton
                locations={locations.map((l) => ({ locationId: l.locationId, name: l.name }))}
              />
            ) : undefined
          }
        />
      ) : (
        <TagsList stands={stands} />
      )}
    </OwnerShell>
  );
}
