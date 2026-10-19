import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { AppShell } from "@/features/dashboard/app-shell";
import { TextRequestComposer } from "@/features/dashboard/text-request-composer";
import { permissionsFor } from "@/lib/owner/permissions";
import { listStands, requireOwner } from "@/lib/server/owner-data";
import { readSmsBalance, listRecentTextRequests } from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Text Requests",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Text Requests.
 *
 * Not "campaigns", and not a marketing tool. V1 sends one kind of message: a
 * review request carrying the business's own Tag link. Anything else would be
 * a different product with a different compliance story.
 *
 * Every number on this page comes from the ledger. There is no "150" written
 * anywhere in the UI — a business on Growth sees 500, a business mid-month
 * sees what is left, and a trial sees zero, because that is what it has.
 */
export default async function TextRequestsPage() {
  const { organization } = await requireOwner("/text-requests");

  const [balance, stands, recent] = await Promise.all([
    readSmsBalance(organization.orgId),
    listStands(organization.orgId),
    listRecentTextRequests(organization.orgId),
  ]);

  const sendable = stands.filter((stand) => stand.status === "active");

  return (
    <AppShell businessName={organization.name}>
      <PageHeader
        title="Text Requests"
        description="Send a customer the link to your Tag. One message, one review request."
      />

      <TextRequestComposer
        balance={balance}
        tags={sendable.map((stand) => ({
          standId: stand.standId,
          label: stand.label,
          locationName: stand.locationName,
        }))}
        recent={recent}
        canSendRequests={permissionsFor(organization.role).sendTextRequests}
      />
    </AppShell>
  );
}
