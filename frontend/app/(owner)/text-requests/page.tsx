import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/features/dashboard/app-shell";
import { TextRequestsScreen } from "@/features/text-requests/text-requests-screen";
import { listStandTokens, requireOwner } from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Text Requests — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function TextRequestsPage() {
  const { organization } = await requireOwner("/text-requests");
  const standOptions = await listStandTokens(organization.orgId);

  return (
    <AppShell businessName={organization.name}>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Text Requests</h1>
          <p className="mt-1 text-base text-muted">
            Ask a customer for a review by text message.
          </p>
        </div>
        <Link
          href="/billing"
          className="shrink-0 text-sm font-medium text-brand-text hover:underline"
        >
          View plan
        </Link>
      </div>

      <TextRequestsScreen stands={standOptions} />
    </AppShell>
  );
}
