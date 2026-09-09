import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { OwnerShell } from "@/features/dashboard/owner-shell";
import { EditableRow, GoogleLinkHelp } from "@/features/dashboard/settings-form";
import { SignOutButton } from "@/features/dashboard/sign-out-button";
import { getPrimaryLocation, requireOwner } from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Settings — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { user, organization } = await requireOwner("/settings");
  const location = await getPrimaryLocation(organization.orgId);

  return (
    <OwnerShell businessName={organization.name}>
      <PageHeader title="Settings" />

      <section className="mb-12">
        <h2 className="mb-4 text-sm font-medium text-muted">Google review link</h2>
        <p className="mb-4 max-w-[42ch] text-base leading-relaxed text-muted">
          This is the page customers are sent to after they rate you. Without it,
          a printed code cannot finish the job.
        </p>
        <EditableRow
          field="googleReviewUrl"
          label="Google link"
          value={location?.googleReviewUrl ?? null}
          type="url"
          placeholder="https://g.page/..."
          help="Paste the link customers use to review you on Google. Leave it empty to remove it."
          emptyText="Not set yet — codes cannot send people to Google"
          warnWhenEmpty
        />
        <GoogleLinkHelp />
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
        <h2 className="mb-2 text-sm font-medium text-muted">Billing</h2>
        <p className="max-w-[36ch] text-base leading-relaxed text-muted">
          Billing is not set up yet.
        </p>
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
          href="/stands"
          className="text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          See what customers see
        </Link>
      </p>

      <SignOutButton />
    </OwnerShell>
  );
}
