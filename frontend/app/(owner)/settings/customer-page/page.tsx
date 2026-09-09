import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { CustomerPageEditor } from "@/features/customer-page/customer-page-editor";
import { OwnerShell } from "@/features/dashboard/owner-shell";
import { getCustomerPageState } from "@/lib/server/customer-page-service";
import { requireOwner } from "@/lib/server/owner-data";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Customer page — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function CustomerPageSettingsPage() {
  const { organization } = await requireOwner("/settings/customer-page");
  const supabase = await supabaseServer();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return null;
  }

  const context = {
    userId: session.user.id,
    db: supabase,
    orgId: organization.orgId,
    role: organization.role,
  };

  const state = await getCustomerPageState(context);

  return (
    <OwnerShell businessName={organization.name}>
      <p className="mb-4">
        <Link
          href="/settings"
          className="text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          Settings
        </Link>
      </p>
      <PageHeader
        title="Customer page"
        description="What you see in the phone is what they see. The stars stay put."
      />
      <CustomerPageEditor
        initial={{
          draft: state.draft,
          draftTagline: state.draftTagline,
          hasDraftHero: state.hasDraftHero,
          hasPublishedHero: state.hasPublishedHero,
          publishedAt: state.publishedAt,
          draftArtworkUrl: state.draftArtworkUrl,
        }}
      />
    </OwnerShell>
  );
}
