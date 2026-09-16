import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireOrganizationContext, requireRole } from "@/lib/server/auth";
import { CsvCustomerSourceAdapter, runCustomerImport } from "@/lib/server/customers";
import { ApiError, ERROR_CODE, rateLimited } from "@/lib/server/errors";
import { handle, json } from "@/lib/server/http";
import { serviceRoleClient } from "@/lib/server/supabase";
import { parseOrThrow } from "@/lib/server/validation";

/**
 * Customer imports — start a CSV import for the caller's organization.
 *
 * Owner/admin only. Rate-limited per org (a shared DB-backed limiter that
 * holds across serverless instances; fail-closed on limiter errors). CSV body
 * is size-capped; header→field mapping is caller-supplied so the adapter
 * never guesses which column is "phone".
 *
 * A `dryRun: true` request runs normalization + validation + within-batch
 * dedupe and returns per-row outcomes and tallies WITHOUT touching the
 * canonical `customers` table — the preview owners see before committing.
 *
 * Idempotent per (org, idempotencyKey): a retry of the same upload returns
 * the same job row, never a duplicate.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/customers/imports";
const IMPORT_LIMIT_PER_MINUTE = 6;
const CSV_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const CSV_MAX_ROWS = 10_000;

const mappingSchema = z
  .object({
    displayName: z.string().min(1).max(120).optional(),
    phone: z.string().min(1).max(120),
    email: z.string().min(1).max(120).optional(),
    externalId: z.string().min(1).max(120).optional(),
    observedAt: z.string().min(1).max(120).optional(),
  })
  .strict();

const importSchema = z
  .object({
    csv: z.string().min(1),
    mapping: mappingSchema,
    idempotencyKey: z.string().min(8).max(200),
    dryRun: z.boolean().optional().default(false),
    defaultCountryCallingCode: z
      .string()
      .regex(/^\+?\d{1,3}$/)
      .optional(),
  })
  .strict();

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiError(400, ERROR_CODE.validationFailed, "The request could not be accepted.", {
      details: [{ field: "Content-Type", message: "Expected application/json." }],
    });
  }
  const raw = await request.text();
  if (raw.length > CSV_MAX_BYTES) {
    throw new ApiError(400, ERROR_CODE.validationFailed, "The request could not be accepted.", {
      details: [{ field: "body", message: "Upload is too large." }],
    });
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ApiError(400, ERROR_CODE.validationFailed, "The request could not be accepted.", {
      details: [{ field: "body", message: "Request body is not valid JSON." }],
    });
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    requireRole(context.role, ["owner", "admin"]);

    // Fail-closed rate limit shared across instances.
    const { data: rl, error: rlError } = await serviceRoleClient().rpc("rpc_consume_rate_limit", {
      p_bucket: "customer_import",
      p_bucket_key: context.orgId,
      p_limit: IMPORT_LIMIT_PER_MINUTE,
      p_window_seconds: 60,
    });
    if (rlError) {
      throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
    }
    const decision = Array.isArray(rl) ? rl[0] : rl;
    if (decision && decision.allowed === false) {
      throw rateLimited((decision.retry_after_seconds as number) ?? 60);
    }

    const body = parseOrThrow(importSchema, await readBoundedJson(request));

    // exactOptionalPropertyTypes rejects `undefined` on optional keys; drop
    // any missing mapping columns before handing them to the adapter.
    const mapping: { [k in keyof typeof body.mapping]: string } = Object.fromEntries(
      Object.entries(body.mapping).filter(([, v]) => v !== undefined),
    ) as { [k in keyof typeof body.mapping]: string };
    const adapter = new CsvCustomerSourceAdapter(body.csv, mapping, { maxRows: CSV_MAX_ROWS });

    const result = await runCustomerImport(serviceRoleClient(), adapter, {
      orgId: context.orgId,
      actorUserId: context.userId,
      sourceKind: "csv",
      sourceConnectionId: null,
      idempotencyKey: body.idempotencyKey,
      dryRun: body.dryRun,
      ...(body.defaultCountryCallingCode
        ? { defaultCountryCallingCode: body.defaultCountryCallingCode }
        : {}),
    });

    return json(request, requestId, 200, { data: result, requestId });
  });
}
