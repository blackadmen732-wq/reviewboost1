import type { Metadata } from "next";
import { QrCode } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { AppShell } from "@/features/dashboard/app-shell";
import { TagsList } from "@/features/tags/tags-list";
import { AddStandButton } from "@/features/dashboard/add-stand-button";
import { listStands, listLocations, requireOwner } from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Your tags — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function StandsPage() {
  const { organization } = await requireOwner("/stands");
  const [stands, locations] = await Promise.all([
    listStands(organization.orgId),
    listLocations(organization.orgId),
  ]);

  return (
    <AppShell businessName={organization.name}>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Your tags</h1>
          <p className="mt-1 text-base text-muted">Put these where customers pay.</p>
        </div>
        {locations.length > 0 && (
          <AddStandButton locations={locations.map((l) => ({ locationId: l.locationId, name: l.name }))} />
        )}
      </div>

      {stands.length === 0 ? (
        <EmptyState
          icon={QrCode}
          title="No tags yet"
          description="Finish setting up and your first tag appears here."
        />
      ) : (
        <TagsList stands={stands} />
      )}
    </AppShell>
  );
}
