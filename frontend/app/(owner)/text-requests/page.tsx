import type { Metadata } from "next";

import { AppShell } from "@/features/dashboard/app-shell";
import { TextRequestComposer } from "@/features/dashboard/text-request-composer";
import { listStands, requireOwner } from "@/lib/server/owner-data";
import { readSmsBalance, listRecentTextRequests } from "@/lib/server/owner-data";
import { listTextableCustomers, type TextableCustomer } from "@/lib/server/customers/textable";
import { logger } from "@/lib/server/logger";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Text Requests — ReviewBoost",
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
    <AppShell businessName={organization.name}>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Text Requests</h1>
        <p className="mt-1 text-base text-muted">
          Send a customer the link to your Tag. One message, one review request.
        </p>
      </div>

      <TextRequestComposer
        balance={balance}
        tags={sendable.map((stand) => ({
          standId: stand.standId,
          label: stand.label,
          locationName: stand.locationName,
        }))}
        recent={recent}
        customers={customers}
      />
    </AppShell>
  );
}
