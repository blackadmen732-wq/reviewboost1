import type { Metadata } from "next";
import Link from "next/link";

import { ChevronRight } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { OwnerShell } from "@/features/dashboard/owner-shell";
import { GoogleLinkCare } from "@/features/dashboard/google-link-care";
import { EditableRow } from "@/features/dashboard/settings-form";
import { SignOutButton } from "@/features/dashboard/sign-out-button";
import { getEntitlementSnapshot } from "@/lib/server/entitlements-service";
import { getPrimaryLocation, requireOwner } from "@/lib/server/owner-data";
import { supabaseServer } from "@/lib/supabase/server";
import { capabilityLabel } from "@/lib/owner/entitlements";

export const metadata: Metadata = {
  title: "Settings — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { user, organization } = await requireOwner("/settings");
  const location = await getPrimaryLocation(organization.orgId);
  const supabase = await supabaseServer();
  const entitlements = await getEntitlementSnapshot(
    { userId: user.id, db: supabase },
    organization.orgId,
  );

  return (
    <OwnerShell businessName={organization.name}>
      <PageHeader title="Settings" />

      <section className="mb-10">
        <Link
          href="/settings/customer-page"
          className="flex min-h-16 items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3 hover:bg-quiet/60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-ink">Customer page</p>
            <p className="text-sm text-muted">The page people see on a Tag</p>
          </div>
          <ChevronRight className="size-5 text-[color:var(--rb-border-strong)]" aria-hidden="true" />
        </Link>
      </section>

      <section className="mb-12">
        <h2 className="mb-4 text-sm font-medium text-muted">Google review link</h2>
        <p className="mb-4 max-w-[42ch] text-base leading-relaxed text-muted">
          This is the page customers are sent to after they rate you. Without it,
          a printed code cannot finish the job.
        </p>
        <GoogleLinkCare value={location?.googleReviewUrl ?? null} />
      </section>

      <section className="mb-12 flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted">Business</h2>
        <EditableRow
          field="businessName"
          label="Business"
          value={organization.name}
          placeholder="The Corner Cafe"
        />
        <EditableRow
          field="locationName"
          label="Place"
          value={location?.name ?? null}
          placeholder="High Street"
        />
        <div className="flex items-start gap-4 border-t border-border py-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-muted">Signed in as</p>
            <p className="break-words text-base text-ink">{user.email ?? "—"}</p>
          </div>
        </div>
      </section>

      <section className="mb-12">
        <h2 className="mb-3 text-sm font-medium text-muted">Plan</h2>
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <p className="text-base font-semibold text-ink">{entitlements.planName}</p>
          <p className="mt-1 text-sm text-muted">
            {entitlements.locationsUsed} of {entitlements.locationLimit} places ·{" "}
            {entitlements.tagsUsed} of {entitlements.tagLimit} Tags
          </p>
          <p className="mt-2 text-sm text-ink">{capabilityLabel(entitlements.tags)}</p>
        </div>
      </section>

      <section className="mb-12">
        <h2 className="mb-2 text-sm font-medium text-muted">Privacy</h2>
        <p className="max-w-[40ch] text-base leading-relaxed text-muted">
          We never ask customers for a name, phone number, or email. Private
          notes are locked so only you can read them.
        </p>
      </section>

      <p className="mb-8">
        <Link
          href="/settings/customer-page"
          className="text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          See what customers see
        </Link>
      </p>

      <SignOutButton />
    </OwnerShell>
  );
}
