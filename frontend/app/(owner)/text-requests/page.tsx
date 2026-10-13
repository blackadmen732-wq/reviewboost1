import type { Metadata } from "next";

import { AppShell } from "@/features/dashboard/app-shell";
import { TextRequestComposer } from "@/features/dashboard/text-request-composer";
import { TextRequestTabs } from "@/features/text-requests/text-request-tabs";
import { permissionsFor } from "@/lib/owner/permissions";
import {
  listOwnerCustomers,
  listRecentTextRequests,
  listStands,
  readSmsBalance,
  requireOwner,
} from "@/lib/server/owner-data";

export const metadata: Metadata = {
  title: "Text Requests",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Text Requests.
 *
 * Not a marketing tool. V1 sends one kind of message: a review request
 * carrying the business's own Tag link, to one person at a time. Anything else
 * would be a different product with a different compliance story.
 *
 * Every number on this page comes from the ledger. There is no "150" written
 * anywhere in the UI — a business on Growth sees 500, a business mid-month
 * sees what is left, and a trial sees zero, because that is what it has.
 *
 * Saved customers are read only for someone who can send; a member or viewer
 * sees the page without them, the same way the API refuses them the list.
 */
export default async function TextRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  const { user, organization } = await requireOwner("/text-requests");
  const can = permissionsFor(organization.role);
  const { customer } = await searchParams;

  const [balance, stands, recent, customers] = await Promise.all([
    readSmsBalance(organization.orgId),
    listStands(organization.orgId),
    listRecentTextRequests(organization.orgId),
    // A list that cannot be read must not take sending down with it, and must
    // not look like an empty list either: null is said out loud on the page.
    can.sendTextRequests
      ? listOwnerCustomers(organization.orgId, user.id, organization.role).catch(() => null)
      : Promise.resolve([]),
  ]);

  const sendable = stands.filter((stand) => stand.status === "active");

  return (
    <AppShell businessName={organization.name}>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Text Requests</h1>
        <p className="mt-1 text-base text-muted">
          Send a customer the link to your Tag. One message, one review request.
        </p>
      </div>

      {can.sendTextRequests ? <TextRequestTabs active="send" /> : null}

      <TextRequestComposer
        balance={balance}
        tags={sendable.map((stand) => ({
          standId: stand.standId,
          label: stand.label,
          locationName: stand.locationName,
          locationId: stand.locationId,
        }))}
        recent={recent}
        canSendRequests={can.sendTextRequests}
        customers={
          customers === null
            ? null
            : customers.map(({ id, name, lastFour, consent }) => ({ id, name, lastFour, agreement: consent }))
        }
        initialCustomerId={customer ?? null}
      />
    </AppShell>
  );
}
