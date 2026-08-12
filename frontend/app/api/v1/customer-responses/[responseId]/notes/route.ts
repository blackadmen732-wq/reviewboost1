import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireOrganizationContext } from "@/lib/server/auth";
import { encrypt } from "@/lib/server/crypto";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json, preflight, readJsonBody } from "@/lib/server/http";
import { MAX_NOTE_BYTES, MAX_NOTE_LENGTH, byteLength, parseOrThrow } from "@/lib/server/validation";

/**
 * Record what the business did about a piece of feedback.
 *
 * NOT A REPLY TO THE CUSTOMER
 * ---------------------------
 * There is nobody to reply to. The public flow collects no email, phone or
 * name, so nothing in this schema can be turned into a delivery address — and
 * that anonymity is precisely why customers write what actually happened rather
 * than writing nothing.
 *
 * This is the internal record instead: "called them back", "spoke to Amara",
 * "refunded". It is what turns a complaint from something read into something
 * handled, and it is the thing an owner needs three weeks later when the same
 * problem shows up again.
 *
 * Append-only. There is no PATCH and no DELETE, and the database grants no
 * UPDATE on this table, because a record that can be quietly rewritten
 * afterwards is not a record. A note that was wrong is corrected by another
 * note.
 *
 * The body is encrypted at rest with the same key as customer notes. Internal
 * notes routinely hold more sensitive material than the customer's own message —
 * staff names, disciplinary detail, refund amounts.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/customer-responses/[responseId]/notes";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.strictObject({
  body: z
    .string()
    .trim()
    .min(1, "Write something first.")
    .max(MAX_NOTE_LENGTH)
    .refine((value) => byteLength(value) <= MAX_NOTE_BYTES, "That note is too long."),
});

export async function POST(
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

    const body = parseOrThrow(bodySchema, await readJsonBody(request));

    const { data: response, error: lookupError } = await context.db
      .from("customer_responses")
      .select("id, org_id")
      .eq("id", responseId)
      .eq("org_id", context.orgId)
      .maybeSingle();

    if (lookupError) {
      throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
    }

    if (!response) {
      throw new ApiError(404, ERROR_CODE.notFound, "That feedback could not be found.");
    }

    const { data, error } = await context.db
      .from("response_notes")
      .insert({
        org_id: response.org_id,
        response_id: responseId,
        author_id: context.userId,
        body_encrypted: encrypt(body.body),
      })
      .select("id, created_at")
      .single();

    if (error) {
      throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
    }

    await context.db
      .from("customer_responses")
      .update({ read_at: new Date().toISOString() })
      .eq("id", responseId)
      .eq("org_id", context.orgId)
      .is("read_at", null);

    return json(request, requestId, 201, {
      data: { noteId: data.id as string, createdAt: data.created_at as string },
      requestId,
    });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
