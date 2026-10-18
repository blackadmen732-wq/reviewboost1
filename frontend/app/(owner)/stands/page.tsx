import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { OwnerShell } from "@/features/dashboard/owner-shell";
import { AddStandButton } from "@/features/dashboard/add-stand-button";
import { isHomeEmpty } from "@/features/dashboard/home-model";
import { deriveSetupSteps } from "@/features/setup/setup-model";
import { SetupSteps } from "@/features/setup/setup-steps";
import { TagsList } from "@/features/tags/tags-list";
import { ownerOrAdmin, permissionsFor } from "@/lib/owner/permissions";
import { getEntitlementSnapshot } from "@/lib/server/entitlements-service";
import {
  getOwnerCounts,
  hasPublishedCustomerPhoto,
  listLocations,
  listStands,
  requireOwner,
} from "@/lib/server/owner-data";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Set up",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Set up: the one place an owner programs anything. Three steps (customer
 * page, Tag, test), then the Tags themselves. Home, Feedback and Texts never
 * ask the owner to configure something; this page does, one step at a time.
 *
 * The route stays /stands so existing links and Tag pages keep working.
 */
export default async function SetupPage() {
  const { user, organization } = await requireOwner("/stands");
  const supabase = await supabaseServer();
  const [stands, locations, entitlements, counts, hasCustomerPhoto] = await Promise.all([
    listStands(organization.orgId),
    listLocations(organization.orgId),
    getEntitlementSnapshot({ userId: user.id, db: supabase }, organization.orgId),
    getOwnerCounts(organization.orgId, organization.timezone),
    hasPublishedCustomerPhoto(organization.orgId),
  ]);
  // Creating a Tag is owner/admin at the API. A member or viewer sees the
  // steps and the list, and no button that would come back 403.
  const canManage = permissionsFor(organization.role).manageTags;
  const canCreate = canManage && locations.length > 0 && entitlements.canCreateTag;
  const addButton = canCreate ? (
    <AddStandButton locations={locations.map((l) => ({ locationId: l.locationId, name: l.name }))} />
  ) : null;

  const steps = deriveSetupSteps({
    hasGoogleLink: counts.hasGoogleLink,
    hasCustomerPhoto,
    hasLocation: locations.length > 0,
    stands,
    hasAnyRating: !isHomeEmpty(counts),
    canManage,
  });

  return (
    <OwnerShell unreadCount={counts.unread} businessName={organization.name}>
      <PageHeader title="Set up" description="Your customer page and your Tags, one step at a time." />

      <SetupSteps steps={steps} createTag={addButton} />

      <section aria-labelledby="tags-heading">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 id="tags-heading" className="text-sm font-medium text-muted">
            Your Tags
          </h2>
          {stands.length > 0 ? addButton : null}
        </div>

        {canManage && !entitlements.canCreateTag && locations.length > 0 ? (
          <p className="mb-4 text-base text-ink">
            {entitlements.status === "cancelled"
              ? "This plan is cancelled. Your Tags are still here."
              : `This plan includes ${entitlements.tagLimit} Tags. You are at the limit.`}
          </p>
        ) : null}

        {stands.length === 0 ? (
          <p className="text-base text-muted">
            {canManage ? "No tags yet. Create a Tag, print the code, and put it on the counter. Step 2 walks you through it." : ownerOrAdmin("create a Tag")}
          </p>
        ) : (
          <TagsList stands={stands} />
        )}
      </section>
    </OwnerShell>
  );
}
