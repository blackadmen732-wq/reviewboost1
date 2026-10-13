import type { NextRequest } from "next/server";

import { requireOrganizationContext, requireRole } from "@/lib/server/auth";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { parseOrThrow } from "@/lib/server/validation";
import {
  deleteCustomer,
  updateCustomer,
  updateCustomerSchema,
} from "@/lib/server/customers/customer-service";

/**
 * Change or remove one saved customer.
 *
 * PATCH replaces the name and place; the number changes only when a new one is
 * sent, because the browser never holds the old one. DELETE removes the entry
 * and leaves the consent history and past Text Requests as they were.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/customers/[customerId]";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function customerIdFrom(params: Promise<{ customerId: string }>): Promise<string> {
  const { customerId } = await params;
  if (!UUID_RE.test(customerId)) throw new ApiError(404, ERROR_CODE.notFound, "Not found.");
  return customerId;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ customerId: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireRole(context.role, ["owner", "admin"]);

    const customerId = await customerIdFrom(params);
    const body = parseOrThrow(updateCustomerSchema, await readJsonBody(request));
    const saved = await updateCustomer(context, customerId, body, requestId);
    return json(request, requestId, 200, { data: saved, requestId });
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ customerId: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireRole(context.role, ["owner", "admin"]);

    const customerId = await customerIdFrom(params);
    await deleteCustomer(context, customerId, requestId);
    return json(request, requestId, 200, { data: { id: customerId, deleted: true }, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
