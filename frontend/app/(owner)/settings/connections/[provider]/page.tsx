import type { Metadata } from "next";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/features/dashboard/app-shell";
import { ConnectionDetail } from "@/features/connections/connection-detail";
import {
  listConnections,
  listMappings,
  listOpenIssues,
  listRuns,
} from "@/lib/server/integrations/connection-service";
import { GoogleSheetsImport } from "@/features/connections/google-sheets-import";
import { listCustomerLists } from "@/lib/server/customers/list-import";
import { getAdapter } from "@/lib/server/integrations/adapters";
import { providerLogo } from "@/lib/server/integrations/logos";
import { getProvider } from "@/lib/server/integrations/registry";
import { listLocations, requireOwner } from "@/lib/server/owner-data";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Connections — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** One app: what it reads, how to connect it, and once connected, how it is doing. */
export default async function ProviderPage({ params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerId } = await params;
  const provider = getProvider(providerId);
  if (!provider) notFound();

  const { organization } = await requireOwner(`/settings/connections/${provider.id}`);
  if (!["owner", "admin"].includes(organization.role)) notFound();

  const requestId = `page:/settings/connections/${provider.id}`;
  const db = await supabaseServer();

  if (provider.connectKind === "list") {
    const lists = await listCustomerLists(db, organization.orgId, requestId);
    const available = provider.availability === "available";
    return (
      <AppShell businessName={organization.name}>
        <Link href="/settings/connections" className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted hover:text-ink">
          <ChevronLeft className="size-4" aria-hidden="true" />
          Connections
        </Link>
        <GoogleSheetsImport
          provider={{
            displayName: provider.displayName,
            monogram: provider.monogram,
            logoSrc: providerLogo(provider.id),
            summary: provider.summary,
            dataRead: provider.dataRead,
            cannotDo: provider.cannotDo,
            available,
          }}
          google={
            available
              ? {
                  clientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
                  apiKey: process.env.NEXT_PUBLIC_GOOGLE_API_KEY!,
                  projectNumber: process.env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER!,
                }
              : null
          }
          lists={lists}
        />
      </AppShell>
    );
  }
  const connection =
    (await listConnections(db, organization.orgId, requestId)).find((item) => item.providerId === provider.id) ?? null;
  const [mappings, runs, issues, places] = connection
    ? await Promise.all([
        listMappings(db, connection.id, requestId),
        listRuns(db, connection.id, requestId),
        listOpenIssues(db, connection.id, requestId),
        listLocations(organization.orgId),
      ])
    : [[], [], [], await listLocations(organization.orgId)];

  return (
    <AppShell businessName={organization.name}>
      <Link href="/settings/connections" className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden="true" />
        Connections
      </Link>

      <ConnectionDetail
        provider={{
          id: provider.id,
          displayName: provider.displayName,
          monogram: provider.monogram,
          summary: provider.summary,
          dataRead: provider.dataRead,
          cannotDo: provider.cannotDo,
          availability: provider.availability === "available" && getAdapter(provider.id) ? "available" : provider.availability === "planned" ? "planned" : "in_setup",
          workflows: provider.workflows.map((workflow) => ({
            id: workflow.id,
            label: workflow.label,
            permissions: workflow.permissions,
          })),
        }}
        connection={connection}
        mappings={mappings}
        runs={runs}
        issues={issues}
        places={places.map((place) => ({ id: place.locationId, name: place.name }))}
      />
    </AppShell>
  );
}
