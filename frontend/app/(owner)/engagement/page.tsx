import type { Metadata } from "next";
import { AppShell } from "@/features/dashboard/app-shell";
import { EngagementConsole } from "@/features/dashboard/engagement-console";
import { requireOwner } from "@/lib/server/owner-data";
export const metadata: Metadata = {
  title: "Loyalty & Growth — ReviewBoost",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export default async function EngagementPage() {
  const { organization } = await requireOwner("/engagement");
  return (
    <AppShell businessName={organization.name}>
      <div className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Loyalty & Growth
        </h1>
        <p className="mt-2 text-muted">
          Bring customers back. Measure recorded purchases and improve your
          messages over time.
        </p>
      </div>
      <EngagementConsole
        key={organization.orgId}
        orgId={organization.orgId}
        businessName={organization.name}
        canManage={["owner", "admin"].includes(organization.role)}
      />
    </AppShell>
  );
}
