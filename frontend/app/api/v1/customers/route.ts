import type { NextRequest } from "next/server";

import { requireOrganizationContext, requireRole } from "@/lib/server/auth";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { parseOrThrow } from "@/lib/server/validation";
import {
  createCustomer,
  listCustomers,
  saveCustomerSchema,
} from "@/lib/server/customers/customer-service";

/**
 * Customers — the people a business saved for Text Requests.
 *
 * Owner/admin only, like the consent ledger it reads: a phone list is more
 * sensitive than a rating. The list carries names and last four digits; whole
 * numbers stay on the server. Saving a customer records no consent.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/customers";

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireRole(context.role, ["owner", "admin"]);

    const customers = await listCustomers(context, requestId);
    return json(request, requestId, 200, { data: customers, requestId });
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireRole(context.role, ["owner", "admin"]);

    const body = parseOrThrow(saveCustomerSchema, await readJsonBody(request));
    const saved = await createCustomer(context, body, requestId);
    return json(request, requestId, 201, { data: saved, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
