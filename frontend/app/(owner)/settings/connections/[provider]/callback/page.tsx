import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/features/dashboard/app-shell";
import { ConnectionCallback } from "@/features/connections/connection-callback";
import { getProvider } from "@/lib/server/integrations/registry";
import { requireOwner } from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Connecting — ReviewBoost",
  robots: { index: false, follow: false },
  // The address carries a one-time code; keep it out of referrers.
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

/**
 * Where the app sends the owner back after they allow (or refuse) access. The
 * one-time code is posted to the server straight away and the address is
 * replaced, so it does not linger in history.
 */
export default async function ConnectionCallbackPage({
  params,
  searchParams,
}: {
  params: Promise<{ provider: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { provider: providerId } = await params;
  const provider = getProvider(providerId);
  if (!provider) notFound();
  const { organization } = await requireOwner(`/settings/connections/${provider.id}`);
  if (!["owner", "admin"].includes(organization.role)) notFound();

  const query = await searchParams;
  const pick = (key: string) => (typeof query[key] === "string" ? (query[key] as string) : null);

  return (
    <AppShell businessName={organization.name}>
      <ConnectionCallback
        providerId={provider.id}
        providerName={provider.displayName}
        state={pick("state")}
        code={pick("code")}
        error={pick("error")}
      />
    </AppShell>
  );
}
