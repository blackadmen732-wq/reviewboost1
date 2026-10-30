import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OwnerShell } from "@/features/dashboard/owner-shell";
import { ConnectionsDirectory } from "@/features/connections/connections-directory";
import { listCustomerLists } from "@/lib/server/customers/list-import";
import { listConnections, providerDirectory } from "@/lib/server/integrations/connection-service";
import { providerLogo } from "@/lib/server/integrations/logos";
import { CATEGORY_LABELS } from "@/lib/server/integrations/registry";
import { BackLink } from "@/components/ui/back-link";
import { getUnreadCount, requireOwner } from "@/lib/server/owner-data";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Connections",
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

  const requestId = "page:/settings/connections";
  const db = await supabaseServer();
  const [connections, sheetLists, csvLists, unread] = await Promise.all([
    listConnections(db, organization.orgId, requestId),
    listCustomerLists(db, organization.orgId, requestId, "google_sheets"),
    listCustomerLists(db, organization.orgId, requestId, "csv"),
    getUnreadCount(organization.orgId),
  ]);
  const stateByProvider = new Map<string, string>(connections.map((connection) => [connection.providerId, connection.state]));
  if (sheetLists.length > 0) stateByProvider.set("google_sheets", "list_added");
  if (csvLists.length > 0) stateByProvider.set("csv", "list_added");
  const providers = providerDirectory().map((provider) => ({
    ...provider,
    logoSrc: providerLogo(provider.id),
    connectionState: stateByProvider.get(provider.id) ?? null,
  }));

  return (
    <OwnerShell unreadCount={unread} businessName={organization.name}>
      <BackLink href="/settings">Settings</BackLink>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Connections</h1>
        <p className="mt-1 text-base text-muted">
          Bring in customers from the apps you already use. Connecting an app never texts anyone.
        </p>
      </div>

      <ConnectionsDirectory providers={providers} categoryLabels={CATEGORY_LABELS} />
    </OwnerShell>
  );
}
