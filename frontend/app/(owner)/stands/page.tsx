import type { Metadata } from "next";
import { QrCode } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { AppShell } from "@/features/dashboard/app-shell";
import { StandCard } from "@/features/dashboard/stand-card";
import { listStands, requireOwner } from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Your codes — ReviewBoost",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The codes an owner prints and puts on the counter.
 *
 * Called "Codes" everywhere a customer-facing word is needed. "Stand" is our
 * internal noun; the thing they are holding is a code.
 */
export default async function StandsPage() {
  await requireOwner("/stands");
  const stands = await listStands();

  return (
    <AppShell>
      <h1 className="mb-2 text-2xl font-semibold tracking-[-0.02em] text-ink">Your codes</h1>
      <p className="mb-6 text-base text-muted">Put these where customers pay.</p>

      {stands.length === 0 ? (
        <EmptyState
          icon={QrCode}
          title="No codes yet"
          description="Finish setting up and your first code appears here."
        />
      ) : (
        <div className="flex flex-col gap-5">
          {stands.map((stand) => (
            <StandCard
              key={stand.standId}
              standId={stand.standId}
              label={stand.label}
              status={stand.status}
              tokenPrefix={stand.tokenPrefix}
            />
          ))}
        </div>
      )}
    </AppShell>
  );
}
