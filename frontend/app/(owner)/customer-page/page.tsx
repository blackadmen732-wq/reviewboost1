import type { Metadata } from "next";

import { AppShell } from "@/features/dashboard/app-shell";
import { CustomerPageEditor } from "@/features/dashboard/customer-page-editor";
import { requireOwner } from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Customer Page — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function CustomerPageEditorPage() {
  const { organization } = await requireOwner("/customer-page");

  return (
    <AppShell>
      <h1 className="mb-2 text-2xl font-semibold tracking-[-0.02em] text-ink">Customer Page</h1>
      <p className="mb-6 text-base text-muted">
        Customise what customers see when they scan your tag.
      </p>
      <CustomerPageEditor businessName={organization.name} />
    </AppShell>
  );
}
