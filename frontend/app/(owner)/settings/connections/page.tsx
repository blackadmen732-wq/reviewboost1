import type { Metadata } from "next";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/features/dashboard/app-shell";
import { ConnectionsDirectory } from "@/features/connections/connections-directory";
import { ConnectionsView } from "@/features/settings/connections-view";
import { readOwnerConnections } from "@/lib/server/connections";
import { listConnections, providerDirectory } from "@/lib/server/integrations/connection-service";
import { CATEGORY_LABELS } from "@/lib/server/integrations/registry";
import { requireOwner } from "@/lib/server/owner-data";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Connections",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Settings → Connections (docs/connections/03).
 *
 * Top: the apps a business can connect, from the provider registry, each with
 * this business's real connection state. Only an app that genuinely works here
 * offers Connect; the rest say Coming soon or Planned and open a description.
 *
 * Below: the account things ReviewBoost already depends on (Google review
 * link, billing, texting, sign-in), each read from real state with a link to
 * the screen that changes it.
 *
 * Connecting, bringing in customers and texting are three separate acts.
 * Connecting an app never texts anyone, and Text Requests keep their own
 * consent check whatever an app says. Owner and admin only: an app connection
 * reads customer data.
 */
export default async function ConnectionsPage() {
  const { user, organization } = await requireOwner("/settings/connections");
  if (!["owner", "admin"].includes(organization.role)) notFound();

  const [connections, accountCards] = await Promise.all([
    listConnections(await supabaseServer(), organization.orgId, "page:/settings/connections"),
    readOwnerConnections(organization.orgId, user),
  ]);
  const stateByProvider = new Map(connections.map((connection) => [connection.providerId, connection.state]));
  const providers = providerDirectory().map((provider) => ({
    ...provider,
    connectionState: stateByProvider.get(provider.id) ?? null,
  }));

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
        <p className="mt-1 text-base text-muted">
          Bring in customers from the apps you already use. Connecting an app never texts anyone.
        </p>
      </div>

      <section aria-labelledby="apps-heading" className="mb-12">
        <h2 id="apps-heading" className="sr-only">
          Apps
        </h2>
        <ConnectionsDirectory providers={providers} categoryLabels={CATEGORY_LABELS} />
      </section>

      <section aria-labelledby="account-heading">
        <h2 id="account-heading" className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
          Your account
        </h2>
        <ConnectionsView cards={accountCards} />
      </section>
    </AppShell>
  );
}
