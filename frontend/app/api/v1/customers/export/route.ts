import type { NextRequest } from "next/server";

import { requireOrganizationContext, requireRole } from "@/lib/server/auth";
import { handle } from "@/lib/server/http";
import { exportCustomers } from "@/lib/server/customers/customer-service";

/**
 * Download the business's own customer list as CSV.
 *
 * Owner/admin. The export is written to the audit log, with a count, before
 * the file is returned; if that record cannot be written, no file is.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/customers/export";

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireRole(context.role, ["owner", "admin"]);

    const { csv } = await exportCustomers(context, requestId);
    const day = new Date().toISOString().slice(0, 10);

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="reviewboost-customers-${day}.csv"`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": requestId,
      },
    });
  });
}
