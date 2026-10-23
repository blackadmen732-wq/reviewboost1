import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { OwnerShell } from "@/features/dashboard/owner-shell";
import { TextRequestComposer } from "@/features/dashboard/text-request-composer";
import { permissionsFor } from "@/lib/owner/permissions";
import { listStands, requireOwner } from "@/lib/server/owner-data";
import { listTextableCustomers, type TextableCustomer } from "@/lib/server/customers/textable";
import { logger } from "@/lib/server/logger";
import { supabaseServer } from "@/lib/supabase/server";
import { getUnreadCount, readSmsBalance, listRecentTextRequests } from "@/lib/server/owner-data";

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

  const [balance, stands, recent, unread] = await Promise.all([
    readSmsBalance(organization.orgId),
    listStands(organization.orgId),
    listRecentTextRequests(organization.orgId),
    getUnreadCount(organization.orgId),
  ]);

  const sendable = stands.filter((stand) => stand.status === "active");

  // Customers brought in through Connections, for the picker. Owners and
  // admins only (the same people who may send). A failed read is passed on as
  // null so the page can say so, not shown as "no customers".
  let customers: TextableCustomer[] | null = [];
  if (organization.role === "owner" || organization.role === "admin") {
    try {
      customers = await listTextableCustomers(await supabaseServer(), organization.orgId, "page:text-requests");
    } catch (error) {
      logger.warn("text_requests.customers_unavailable", { error: String(error) });
      customers = null;
    }
  }

  return (
    <OwnerShell unreadCount={unread} businessName={organization.name}>
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
        customers={customers}
      />
    </OwnerShell>
  );
}
