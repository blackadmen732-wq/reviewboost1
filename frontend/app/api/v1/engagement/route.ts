import { requireOrganizationContext } from "@/lib/server/auth";
import { getProgram, programSchema, setProgram } from "@/lib/server/engagement/service";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { parseOrThrow } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ROUTE = "/api/v1/engagement";

export async function GET(request: Request): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    return json(request, requestId, 200, { program: await getProgram(context), walletDelivery: "not_configured" });
  });
}

export async function PUT(request: Request): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    const program = parseOrThrow(programSchema, await readJsonBody(request));
    await setProgram(context, program);
    return json(request, requestId, 200, { program, walletDelivery: "not_configured" });
  });
}

export async function OPTIONS(request: Request): Promise<Response> {
  const response = preflight(request);
  response.headers.set("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  return response;
}
