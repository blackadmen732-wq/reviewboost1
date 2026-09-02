import "server-only";

import { z } from "zod";

import type { OrganizationContext } from "@/lib/server/auth";
import { KEY_VERSION, digestStandToken, encrypt } from "@/lib/server/crypto";
import { publicFrontendUrl } from "@/lib/server/env";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { standUrl } from "@/lib/server/google-review-url";
import { logger } from "@/lib/server/logger";
import { serviceRoleClient } from "@/lib/server/supabase";
import { getProviderRate } from "@/lib/server/sms/provider";
import { estimateMessageCost } from "@/lib/server/sms/cost";
import { reviewRequestDedupeKey } from "@/lib/server/sms/dedupe";
import { normalizePhone, phoneHash, toStoredPhone } from "@/lib/server/sms/phone";
import { nextAllowedSendTime } from "@/lib/server/sms/quiet-hours";

/**
 * Owner-facing Text Requests service.
 *
 * Scheduling and cancellation run through the caller's own RLS-scoped client
 * and the SECURITY DEFINER `rpc_*` wrappers, so tenant isolation and role
 * enforcement live in the database. All PII is normalised, hashed, and encrypted
 * here before any identifier reaches a query; the raw phone never leaves memory.
 *
 * The message body carries the stand's /q link. The caller supplies the stand's
 * opaque token (which they hold from QR/NFC provisioning); the token is verified
 * against the stored keyed digest so a caller cannot target another business's
 * stand, and only the *encrypted* rendered message is persisted.
 */

const DEFAULT_TEMPLATE = "How was your visit? Tap here to leave a review: {{link}}";
const DEDUPE_WINDOW_SECONDS = 24 * 60 * 60;

// A national number needs a country to become E.164; the org can carry a
// default. Kept configurable rather than hardcoded to one market.
function defaultCountryCallingCode(): string | undefined {
  const raw = process.env.SMS_DEFAULT_COUNTRY_CALLING_CODE;
  return raw && /^\d{1,3}$/.test(raw) ? raw : undefined;
}

// Only pass the option when a code is configured — exactOptionalPropertyTypes
// forbids an explicit `undefined`.
function phoneOptions(): { defaultCountryCallingCode: string } | undefined {
  const cc = defaultCountryCallingCode();
  return cc ? { defaultCountryCallingCode: cc } : undefined;
}

const standTokenSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid stand token.");

const templateSchema = z
  .string()
  .trim()
  .min(1)
  .max(480)
  .refine((v) => v.includes("{{link}}"), "Template must contain the {{link}} placeholder.");

export const previewSchema = z.strictObject({
  phone: z.string().min(3).max(40),
  standToken: standTokenSchema,
  messageTemplate: templateSchema.optional(),
});

export const scheduleSchema = z.strictObject({
  phone: z.string().min(3).max(40),
  standToken: standTokenSchema,
  messageTemplate: templateSchema.optional(),
  // An explicit client idempotency key makes a deliberate retry exact.
  idempotencyKey: z.string().min(8).max(200).optional(),
  // Consent the owner is asserting at schedule time (an import, a point-of-sale
  // capture). Without a prior opted_in, the send is suppressed at dispatch.
  consent: z
    .strictObject({
      source: z.enum(["owner_import", "customer_flow", "api", "admin"]),
      evidence: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

export type ScheduleInput = z.infer<typeof scheduleSchema>;
export type PreviewInput = z.infer<typeof previewSchema>;

function renderMessage(template: string | undefined, link: string): string {
  return (template ?? DEFAULT_TEMPLATE).replace(/\{\{link\}\}/g, link);
}

/** Map a definer-wrapper error message to a clean, opaque client error. */
function mapRpcError(error: { message?: string } | null, requestId: string): ApiError {
  const msg = error?.message ?? "";
  if (msg.includes("not_authenticated")) {
    return new ApiError(401, ERROR_CODE.validationFailed, "Authentication is required.");
  }
  if (msg.includes("not_found_or_forbidden")) {
    return new ApiError(404, ERROR_CODE.notFound, "Not found.");
  }
  if (msg.includes("quota_exhausted")) {
    return new ApiError(409, ERROR_CODE.quotaExhausted, "You have no Text Request credit remaining.");
  }
  logger.error("sms.rpc_error", { requestId, error });
  return new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
}

interface ResolvedStand {
  standId: string;
  locationId: string;
  link: string;
  timezone: string;
}

// The deliberate fallback timezone when a location has no zone configured (or an
// unrecognised one). Quiet-hours math treats an invalid zone as UTC too, so this
// is the documented, intentional default — NOT a substitute for a failed query,
// which must fail closed instead (see resolveStand).
export const DEFAULT_LOCATION_TIMEZONE = "UTC";

/**
 * Apply the timezone fallback policy: a valid IANA zone is used as-is; a missing,
 * empty, or unrecognised value falls back to DEFAULT_LOCATION_TIMEZONE. This is a
 * deliberate policy for *known* data, distinct from a database error (which the
 * caller turns into a 503 rather than silently defaulting).
 */
export function resolveTimezone(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw.trim() === "") return DEFAULT_LOCATION_TIMEZONE;
  const tz = raw.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_LOCATION_TIMEZONE;
  }
}

/**
 * Verify the caller's stand token belongs to their organization and build the
 * link — without ever storing the raw token. The token is digested and matched
 * against `public_token_hash` through the RLS-scoped client, so a token for
 * another business simply returns no row. The location's timezone is read too:
 * quiet hours are computed in the stand's local time, the closest proxy we have
 * for the recipient's.
 */
export async function resolveStand(context: OrganizationContext, token: string): Promise<ResolvedStand> {
  const { data, error } = await context.db
    .from("review_stands")
    .select("id, location_id")
    .eq("org_id", context.orgId)
    .eq("public_token_hash", digestStandToken(token))
    .eq("status", "active")
    .maybeSingle();

  if (error) throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
  if (!data) throw new ApiError(404, ERROR_CODE.notFound, "That review stand was not found.");

  const locationId = data.location_id as string;
  const { data: loc, error: locError } = await context.db
    .from("locations")
    .select("timezone")
    .eq("org_id", context.orgId)
    .eq("id", locationId)
    .maybeSingle();

  // Fail CLOSED on a database error: a transient failure must not silently
  // substitute UTC and risk scheduling a text into the recipient's quiet hours.
  // Only a successfully-read missing/invalid zone takes the documented fallback.
  if (locError) throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");

  return {
    standId: data.id as string,
    locationId,
    link: standUrl(publicFrontendUrl(), token),
    timezone: resolveTimezone(loc?.timezone as string | null | undefined),
  };
}

export interface PreviewResult {
  encoding: string;
  unitCount: number;
  segments: number;
  perSegmentMicros: number;
  totalMicros: number;
  currency: string;
  recipientLastFour: string;
}

export async function previewTextRequest(
  context: OrganizationContext,
  input: PreviewInput,
): Promise<PreviewResult> {
  const normalized = normalizePhone(input.phone, phoneOptions());
  const stand = await resolveStand(context, input.standToken);
  const body = renderMessage(input.messageTemplate, stand.link);
  const cost = estimateMessageCost(body, getProviderRate());

  return {
    encoding: cost.encoding,
    unitCount: cost.unitCount,
    segments: cost.segments,
    perSegmentMicros: cost.perSegmentMicros,
    totalMicros: cost.totalMicros,
    currency: cost.currency,
    recipientLastFour: normalized.lastFour,
  };
}

export interface ScheduleResult {
  requestId: string;
  created: boolean;
  status: "scheduled";
  scheduledFor: string;
  segments: number;
  recipientLastFour: string;
}

export async function scheduleTextRequest(
  context: OrganizationContext,
  input: ScheduleInput,
  requestId: string,
): Promise<ScheduleResult> {
  const normalized = normalizePhone(input.phone, phoneOptions());
  const stored = toStoredPhone(normalized);
  const stand = await resolveStand(context, input.standToken);
  const body = renderMessage(input.messageTemplate, stand.link);
  const cost = estimateMessageCost(body, getProviderRate());

  // Optional consent assertion, recorded before scheduling through the
  // service-role wrapper (consent is never writable by a client role).
  if (input.consent) {
    const svc = serviceRoleClient();
    const { error } = await svc.rpc("rpc_sms_record_consent", {
      p_org_id: context.orgId,
      p_phone_hash: stored.phoneHash,
      p_phone_encrypted: stored.phoneEncrypted,
      p_phone_key_version: stored.phoneKeyVersion,
      p_phone_last_four: stored.lastFour,
      p_purpose: "review_request",
      p_status: "opted_in",
      p_source: input.consent.source,
      p_location_id: stand.locationId,
      p_evidence: input.consent.evidence ?? {},
      p_occurred_at: new Date().toISOString(),
    });
    if (error) {
      logger.error("sms.consent_record_failed", { requestId, error });
      throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
    }
  }

  const scheduledFor = nextAllowedSendTime(new Date(), stand.timezone);
  const dedupeKey = reviewRequestDedupeKey({
    orgId: context.orgId,
    phoneHash: stored.phoneHash,
    standId: stand.standId,
    now: new Date(),
    windowSeconds: DEDUPE_WINDOW_SECONDS,
    explicitKey: input.idempotencyKey,
  });

  // Scheduling runs as the service role, not the caller's RLS client: the
  // segment count drives quota and the real message length, so it must be the
  // server's own computation over the true body, never a value the client could
  // forge by calling the RPC directly. Tenant/role are re-verified inside the
  // RPC against the acting user we pass here.
  const { data, error } = await serviceRoleClient().rpc("rpc_schedule_text_request", {
    p_org_id: context.orgId,
    p_actor_user: context.userId,
    p_location_id: stand.locationId,
    p_stand_id: stand.standId,
    p_phone_hash: stored.phoneHash,
    p_phone_encrypted: stored.phoneEncrypted,
    p_phone_key_version: stored.phoneKeyVersion,
    p_last_four: stored.lastFour,
    p_message_encrypted: encrypt(body),
    p_message_key_version: KEY_VERSION,
    p_encoding: cost.encoding,
    p_unit_count: cost.unitCount,
    p_segments: cost.segments,
    p_cost_micros: cost.totalMicros,
    p_cost_currency: cost.currency,
    p_timezone: stand.timezone,
    p_scheduled_for: scheduledFor.toISOString(),
    p_dedupe_key: dedupeKey,
    p_request_id: requestId,
  });

  if (error) throw mapRpcError(error, requestId);

  const row = Array.isArray(data) ? data[0] : data;
  return {
    requestId: row.request_id as string,
    created: Boolean(row.created),
    status: "scheduled",
    scheduledFor: scheduledFor.toISOString(),
    segments: cost.segments,
    recipientLastFour: stored.lastFour,
  };
}

export async function cancelTextRequest(
  context: OrganizationContext,
  textRequestId: string,
  requestId: string,
): Promise<boolean> {
  const { data, error } = await context.db.rpc("rpc_cancel_text_request", {
    p_org_id: context.orgId,
    p_request_id: textRequestId,
  });
  if (error) throw mapRpcError(error, requestId);
  return Boolean(data);
}

export interface TextRequestListItem {
  id: string;
  status: string;
  segments: number;
  recipientLastFour: string | null;
  scheduledFor: string;
  createdAt: string;
}

export async function listTextRequests(
  context: OrganizationContext,
  limit = 25,
): Promise<TextRequestListItem[]> {
  const bounded = Math.min(Math.max(1, limit), 100);
  const { data, error } = await context.db
    .from("text_requests")
    .select("id, status, segments, recipient_last_four, scheduled_for, created_at")
    .eq("org_id", context.orgId)
    .order("created_at", { ascending: false })
    .limit(bounded);

  if (error) throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");

  return (data ?? []).map((r) => ({
    id: r.id as string,
    status: r.status as string,
    segments: r.segments as number,
    recipientLastFour: (r.recipient_last_four as string | null) ?? null,
    scheduledFor: r.scheduled_for as string,
    createdAt: r.created_at as string,
  }));
}

export { phoneHash };
