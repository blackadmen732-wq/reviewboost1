import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/features/dashboard/app-shell";
import { ConnectionsDirectory } from "@/features/connections/connections-directory";
import { listConnections, providerDirectory } from "@/lib/server/integrations/connection-service";
import { CATEGORY_LABELS } from "@/lib/server/integrations/registry";
import { requireOwner } from "@/lib/server/owner-data";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Connections — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Connections, under Settings (docs/connections/03).
 *
 * Connect, bring in customers, and text are three separate things. This screen
 * only covers the first two: connecting an app never texts anyone, and Text
 * Requests keep their own consent check whatever an app says.
 */
export default async function ConnectionsPage() {
  const { organization } = await requireOwner("/settings/connections");
  if (!["owner", "admin"].includes(organization.role)) notFound();

  const connections = await listConnections(await supabaseServer(), organization.orgId, "page:/settings/connections");
  const stateByProvider = new Map(connections.map((connection) => [connection.providerId, connection.state]));
  const providers = providerDirectory().map((provider) => ({
    ...provider,
    connectionState: stateByProvider.get(provider.id) ?? null,
  }));

  return (
    <AppShell businessName={organization.name}>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Connections</h1>
        <p className="mt-1 text-base text-muted">
          Bring in customers from the apps you already use. Connecting an app never texts anyone.
        </p>
      </div>

      <ConnectionsDirectory providers={providers} categoryLabels={CATEGORY_LABELS} />
    </AppShell>
  );
}
