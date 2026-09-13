import type { Metadata } from "next";
import { QrCode } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { AppShell } from "@/features/dashboard/app-shell";
import { StandCard } from "@/features/dashboard/stand-card";
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

  const locationMap = new Map(locations.map((l) => [l.locationId, l.name]));
  const grouped = new Map<string, typeof stands>();
  for (const stand of stands) {
    const key = stand.locationId;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(stand);
  }

  return (
    <AppShell>
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
        <div className="flex flex-col gap-8">
          {[...grouped.entries()].map(([locationId, locationStands]) => (
            <div key={locationId}>
              {grouped.size > 1 && (
                <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">
                  {locationMap.get(locationId) ?? "Unknown location"}
                </h2>
              )}
              <div className="flex flex-col gap-5">
                {locationStands.map((stand) => (
                  <StandCard
                    key={stand.standId}
                    standId={stand.standId}
                    label={stand.label}
                    standType={stand.standType}
                    status={stand.status}
                    tokenPrefix={stand.tokenPrefix}
                    tokenRotatedAt={stand.tokenRotatedAt}
                    nfcProvisionedAt={stand.nfcProvisionedAt}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
