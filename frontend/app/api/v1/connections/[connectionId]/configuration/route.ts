import type { NextRequest } from "next/server";

import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import {
  configurationSchema,
  listProviderLocations,
  saveConfiguration,
} from "@/lib/server/integrations/connection-service";
import { connectionIdOrThrow, consumeRateLimit, requireConnectionsAdmin } from "@/lib/server/integrations/route-helpers";
import { parseOrThrow } from "@/lib/server/validation";

/**
 * Which of the app's places feed which of yours. GET reads the app's places
 * live; POST saves the choice, which means the check has to run again.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/connections/[connectionId]/configuration";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireConnectionsAdmin(request);
    const connectionId = connectionIdOrThrow((await params).connectionId);
    await consumeRateLimit("integration_read_provider", context.orgId, 60, 3600);
    const locations = await listProviderLocations(context.orgId, connectionId, requestId);
    return json(request, requestId, 200, { data: { providerLocations: locations }, requestId });
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireConnectionsAdmin(request);
    const connectionId = connectionIdOrThrow((await params).connectionId);
    await consumeRateLimit("integration_read_provider", context.orgId, 60, 3600);
    const body = parseOrThrow(configurationSchema, await readJsonBody(request));
    const result = await saveConfiguration(context, connectionId, body, requestId);
    return json(request, requestId, 200, { data: result, requestId });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
