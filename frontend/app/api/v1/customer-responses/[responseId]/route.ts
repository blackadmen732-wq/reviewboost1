import type { NextRequest } from "next/server";

import { requireOrganizationContext } from "@/lib/server/auth";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json, preflight } from "@/lib/server/http";
import { listActionNotes, type OwnerDb } from "@/lib/server/owner-data";
import { getCustomerResponse } from "@/lib/server/owner-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/customer-responses/[responseId]";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ responseId: string }> },
): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    const { responseId } = await params;

    if (!UUID.test(responseId)) {
      throw new ApiError(400, ERROR_CODE.validationFailed, "The request could not be accepted.", {
        details: [{ field: "responseId", message: "Must be a UUID." }],
      });
    }

    const data = await getCustomerResponse(context, responseId, requestId, context.orgId);

    if (!data) {
      throw new ApiError(404, ERROR_CODE.notFound, "That feedback could not be found.");
    }

    // What the team did about it, and which Tag it came from: the iPhone app
    // shows the same detail as the website's. Both read as the caller (RLS).
    const db = context.db as OwnerDb;
    const [notes, stand] = await Promise.all([
      listActionNotes(context.orgId, responseId, db),
      data.standId
        ? db.from("review_stands").select("label").eq("org_id", context.orgId).eq("id", data.standId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    return json(request, requestId, 200, {
      data: {
        ...data,
        tagLabel: (stand.data as { label?: string } | null)?.label ?? null,
        notes: notes.map((note) => ({
          noteId: note.noteId,
          body: note.body,
          authorName: note.authorName,
          createdAt: note.createdAt,
        })),
      },
      requestId,
    });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
