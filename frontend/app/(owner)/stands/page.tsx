import type { Metadata } from "next";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { OwnerShell } from "@/features/dashboard/owner-shell";
import { StandCard } from "@/features/dashboard/stand-card";
import { AddStandButton } from "@/features/dashboard/add-stand-button";
import { listStands, listLocations, requireOwner } from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Tags — ReviewBoost",
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
    <OwnerShell businessName={organization.name}>
      <PageHeader
        title="Tags"
        description="Print a code or program a tag. Put it where people pay."
        action={
          locations.length > 0 ? (
            <AddStandButton
              locations={locations.map((l) => ({ locationId: l.locationId, name: l.name }))}
            />
          ) : null
        }
      />

      {stands.length === 0 ? (
        <EmptyState
          title="No tags yet"
          description="Create a tag, print the code, and put it on the counter."
          action={
            locations.length > 0 ? (
              <AddStandButton
                locations={locations.map((l) => ({ locationId: l.locationId, name: l.name }))}
              />
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-12">
          {[...grouped.entries()].map(([locationId, locationStands]) => (
            <div key={locationId}>
              {grouped.size > 1 && (
                <h2 className="mb-4 text-sm font-medium text-muted">
                  {locationMap.get(locationId) ?? "Unknown location"}
                </h2>
              )}
              <div className="flex flex-col gap-10">
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
    </OwnerShell>
  );
}
