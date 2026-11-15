import { z } from "zod";
import { enrollLoyalty } from "@/lib/server/engagement/service";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { requestMetaOf } from "@/lib/server/request-meta";
import { parseOrThrow, parseTokenOrThrow, tokenSchema } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ROUTE = "/api/v1/public/q/[token]/loyalty";
const schema = z.strictObject({ sessionId: tokenSchema, acceptLoyalty: z.literal(true), remindersConsent: z.boolean() });

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const token = parseTokenOrThrow((await params).token);
    const body = parseOrThrow(schema, await readJsonBody(request));
    const member = await enrollLoyalty(token, body.sessionId, body.remindersConsent, requestMetaOf(request, requestId));
    return json(request, requestId, 200, member);
  });
}
export async function OPTIONS(request: Request) { return preflight(request); }
