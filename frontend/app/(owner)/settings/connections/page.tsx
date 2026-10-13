import type { Metadata } from "next";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";

import { AppShell } from "@/features/dashboard/app-shell";
import { ConnectionsView } from "@/features/settings/connections-view";
import { readOwnerConnections } from "@/lib/server/connections";
import { requireOwner } from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Connections",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Settings → Connections.
 *
 * What this business is connected to, read from real state, with the one
 * action that changes it. Readable by every member; each action leads to the
 * screen that already enforces who may change it.
 */
export default async function ConnectionsPage() {
  const { user, organization } = await requireOwner("/settings/connections");
  const cards = await readOwnerConnections(organization.orgId, user);

  return (
    <AppShell businessName={organization.name}>
      <div className="mb-8">
        <Link
          href="/settings"
          className="mb-3 -ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Settings
        </Link>
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Connections</h1>
        <p className="mt-1 text-base text-muted">What ReviewBoost is connected to, and whether it&apos;s working.</p>
      </div>

      <ConnectionsView cards={cards} />
    </AppShell>
  );
}
