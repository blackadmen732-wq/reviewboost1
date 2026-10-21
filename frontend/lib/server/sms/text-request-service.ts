import "server-only";

import { z } from "zod";

import type { OrganizationContext } from "@/lib/server/auth";
import { KEY_VERSION, decrypt, digestStandToken, encrypt } from "@/lib/server/crypto";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { canonicalTagUrl } from "@/lib/server/tag-url";
import { logger } from "@/lib/server/logger";
import { resolveCustomerPhone } from "@/lib/server/customers/textable";
import { serviceRoleClient } from "@/lib/server/supabase";
import { getProviderRate } from "@/lib/server/sms/provider";
import { estimateMessageCost } from "@/lib/server/sms/cost";
import { reviewRequestDedupeKey } from "@/lib/server/sms/dedupe";
import { normalizePhone, phoneHash, toStoredPhone } from "@/lib/server/sms/phone";
import { nextAllowedSendTime } from "@/lib/server/sms/quiet-hours";
import { uuidSchema } from "@/lib/server/validation";
import {
  CONSENT_ATTESTATION_VERSION,
  CONSENT_METHOD_IDS,
  DEFAULT_TEXT_REQUEST_TEMPLATE_ID,
  TEXT_REQUEST_TEMPLATE_IDS,
  type TextRequestTemplateId,
  consentAttestationText,
  renderTextRequest,
  senderName,
} from "@/lib/sms/text-request-templates";

/**
 * Owner-facing Text Requests service.
 *
 * Scheduling and cancellation run through the caller's own RLS-scoped client
 * and the SECURITY DEFINER `rpc_*` wrappers, so tenant isolation and role
 * enforcement live in the database. All PII is normalised, hashed, and encrypted
 * here before any identifier reaches a query; the raw phone never leaves memory.
 *
 * The message body carries the Tag's /q link. The caller names the Tag by id or
 * by its opaque token; either way the lookup is scoped to the caller's own
 * organization through RLS, so a Tag belonging to another business simply
 * returns no row. Only the *encrypted* rendered message is persisted.
 *
 * Consent is never implied by sending. A number with no recorded agreement is
 * refused here, before any credit is reserved, and the only way to record that
 * agreement is an explicit owner attestation (`recordConsentAttestation`) that
 * says how the customer agreed, who confirmed it, and to which wording.
 */

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

const templateIdSchema = z.enum(TEXT_REQUEST_TEMPLATE_IDS, {
  message: "Choose one of the approved messages.",
});

/**
 * A Tag is named by its id, or by its raw token.
 *
 * The owner UI only ever has the id: the raw token exists at creation and on a
 * reprint, and is otherwise only a keyed digest in the database. Requiring the
 * token here would have meant an owner could not send a Text Request for a Tag
 * already stuck to their counter. The token form stays for callers that hold
 * one; exactly one of the two is required.
 */
const standRefSchema = {
  standId: uuidSchema("Choose which Tag the link should point at.").optional(),
  standToken: standTokenSchema.optional(),
};

function requireOneStandRef(
  value: { standId?: string | undefined; standToken?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (Boolean(value.standId) === Boolean(value.standToken)) {
    ctx.addIssue({
      code: "custom",
      path: ["standId"],
      message: "Name exactly one Tag, by id or by token.",
    });
  }
}

/**
 * Who gets the text: a number typed by the owner, or a customer brought in
 * through Connections. Exactly one. A customer's number is looked up on the
 * server (`resolveCustomerPhone`) and never travels to the browser.
 */
const recipientSchema = {
  phone: z.string().min(3).max(40).optional(),
  customerId: uuidSchema("Choose a customer.").optional(),
};

function requireOneRecipient(
  value: { phone?: string | undefined; customerId?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (Boolean(value.phone) === Boolean(value.customerId)) {
    ctx.addIssue({
      code: "custom",
      path: ["phone"],
      message: "Type a mobile number or choose a customer.",
    });
  }
}

export const previewSchema = z
  .strictObject({
    ...recipientSchema,
    ...standRefSchema,
    templateId: templateIdSchema.optional(),
  })
  .superRefine(requireOneStandRef)
  .superRefine(requireOneRecipient);

/*
 * There is deliberately no `consent` field here any more. Sending used to
 * record "opted in" for whatever number was typed, with no evidence, which made
 * the consent check meaningless. Consent now has its own endpoint and its own
 * explicit confirmation.
 */
export const scheduleSchema = z
  .strictObject({
    ...recipientSchema,
    ...standRefSchema,
    templateId: templateIdSchema.optional(),
    // An explicit client idempotency key makes a deliberate retry exact.
    idempotencyKey: z.string().min(8).max(200).optional(),
  })
  .superRefine(requireOneStandRef)
  .superRefine(requireOneRecipient);

export const consentAttestationSchema = z.strictObject({
  ...recipientSchema,
  standId: uuidSchema("Choose which Tag the link should point at."),
  method: z.enum(CONSENT_METHOD_IDS, { message: "Say how the customer agreed." }),
  wordingVersion: z.literal(CONSENT_ATTESTATION_VERSION, {
    message: "Please reload the page and confirm again.",
  }),
  // Literally true: the owner ticked the confirmation, not merely sent the form.
  confirmed: z.literal(true, { message: "Please confirm the customer agreed." }),
}).superRefine(requireOneRecipient);

export type ScheduleInput = z.infer<typeof scheduleSchema>;

/** The number to text: the typed one, or the chosen customer's, looked up here. */
async function recipientPhone(
  context: OrganizationContext,
  input: { phone?: string | undefined; customerId?: string | undefined },
  requestId: string,
): Promise<string> {
  if (input.customerId) {
    return resolveCustomerPhone(context.db, context.orgId, input.customerId, requestId);
  }
  // The schema guarantees one of the two.
  return input.phone ?? "";
}
export type PreviewInput = z.infer<typeof previewSchema>;
export type ConsentAttestationInput = z.infer<typeof consentAttestationSchema>;

/**
 * The business name every text starts with. Read through the caller's own
 * RLS client, so it is always the caller's business. A database error fails
 * closed rather than sending an unidentified message.
 */
async function loadBusinessName(context: OrganizationContext): Promise<string> {
  const { data, error } = await context.db
    .from("organizations")
    .select("name")
    .eq("id", context.orgId)
    .maybeSingle();

  if (error) throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");

  const name = typeof data?.name === "string" ? data.name : "";
  if (!senderName(name)) {
    throw new ApiError(
      409,
      ERROR_CODE.validationFailed,
      "Add your business name in Settings first, so customers know who is texting.",
    );
  }
  return name;
}

function renderMessage(
  businessName: string,
  templateId: TextRequestTemplateId | undefined,
  link: string,
): string {
  return renderTextRequest({
    businessName,
    templateId: templateId ?? DEFAULT_TEXT_REQUEST_TEMPLATE_ID,
    link,
  });
}

/** Why a number may not be texted, in the words an owner reads. */
const BLOCK_REASON_COPY: Record<string, string> = {
  no_consent: "They haven't agreed to texts from you yet.",
  opt_out: "They asked not to get texts.",
  stop_keyword: "They asked not to get texts.",
  compliance: "Texting this number is on hold.",
  hard_bounce: "Texts to this number don't go through.",
  recent_send: "You texted them recently. Please wait before asking again.",
  completed_flow: "They already left a rating.",
  manual: "You've blocked texts to this number.",
};

export interface Eligibility {
  allowed: boolean;
  /** The gate's reason code, or null when allowed. */
  reason: string | null;
  /** Owner-facing explanation, or null when allowed. */
  message: string | null;
}

/**
 * Ask the database gate — the same `app.sms_can_send` dispatch runs — whether
 * this number may be texted. Fails closed: a gate that cannot answer is a no.
 */
export async function checkEligibility(
  orgId: string,
  phoneHashValue: string,
  requestId: string,
): Promise<Eligibility> {
  const { data, error } = await serviceRoleClient().rpc("rpc_sms_can_send", {
    p_org_id: orgId,
    p_phone_hash: phoneHashValue,
    p_purpose: "review_request",
  });

  if (error) {
    logger.error("sms.eligibility_check_failed", { requestId, error });
    throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { allowed?: boolean; reason?: string | null }
    | null
    | undefined;

  if (row?.allowed === true) return { allowed: true, reason: null, message: null };

  const reason = row?.reason ?? "unknown";
  return {
    allowed: false,
    reason,
    message: BLOCK_REASON_COPY[reason] ?? "This number can't be texted right now.",
  };
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
export async function resolveStand(
  context: OrganizationContext,
  ref: { standId?: string | undefined; standToken?: string | undefined },
): Promise<ResolvedStand> {
  const query = context.db
    .from("review_stands")
    .select("id, location_id, public_token_encrypted")
    .eq("org_id", context.orgId)
    .eq("status", "active");

  const { data, error } = await (ref.standToken
    ? query.eq("public_token_hash", digestStandToken(ref.standToken))
    : query.eq("id", ref.standId as string)
  ).maybeSingle();

  if (error) throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
  if (!data) throw new ApiError(404, ERROR_CODE.notFound, "That Tag was not found.");

  // When the caller named the Tag by id, the link is rebuilt from the stored
  // encrypted token — the same material a reprint uses. A Tag whose ciphertext
  // is missing cannot produce a link, and saying so is better than sending a
  // customer a URL that resolves to nothing.
  const token =
    ref.standToken ??
    decrypt((data.public_token_encrypted as string | null) ?? null) ??
    null;

  if (!token) {
    throw new ApiError(
      409,
      ERROR_CODE.validationFailed,
      "This Tag cannot be linked to. Rotate its token to make it usable again.",
    );
  }

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
    link: canonicalTagUrl(token),
    timezone: resolveTimezone(loc?.timezone as string | null | undefined),
  };
}

export interface PreviewResult {
  /** The exact text the customer would receive, business name and STOP line included. */
  body: string;
  encoding: string;
  unitCount: number;
  segments: number;
  perSegmentMicros: number;
  totalMicros: number;
  currency: string;
  recipientLastFour: string;
  eligibility: Eligibility;
  /** The statement an owner confirms when recording that this customer agreed. */
  consentStatement: string;
}

export async function previewTextRequest(
  context: OrganizationContext,
  input: PreviewInput,
  requestId: string,
): Promise<PreviewResult> {
  const normalized = normalizePhone(await recipientPhone(context, input, requestId), phoneOptions());
  const stored = toStoredPhone(normalized);
  const stand = await resolveStand(context, input);
  const businessName = await loadBusinessName(context);
  const body = renderMessage(businessName, input.templateId, stand.link);
  const cost = estimateMessageCost(body, getProviderRate());
  const eligibility = await checkEligibility(context.orgId, stored.phoneHash, requestId);

  return {
    body,
    encoding: cost.encoding,
    unitCount: cost.unitCount,
    segments: cost.segments,
    perSegmentMicros: cost.perSegmentMicros,
    totalMicros: cost.totalMicros,
    currency: cost.currency,
    recipientLastFour: normalized.lastFour,
    eligibility,
    consentStatement: consentAttestationText(businessName),
  };
}

export interface ConsentAttestationResult {
  recipientLastFour: string;
  eligibility: Eligibility;
}

/**
 * Record that the owner confirmed this customer agreed to a text, with how they
 * agreed, who confirmed it, and the wording they confirmed. Written through the
 * service-role wrapper: consent is never writable by a client role.
 *
 * Returns the number's eligibility afterwards, because an earlier STOP still
 * wins over a later attestation.
 */
export async function recordConsentAttestation(
  context: OrganizationContext,
  input: ConsentAttestationInput,
  requestId: string,
): Promise<ConsentAttestationResult> {
  const normalized = normalizePhone(await recipientPhone(context, input, requestId), phoneOptions());
  const stored = toStoredPhone(normalized);
  const stand = await resolveStand(context, { standId: input.standId });

  const { error } = await serviceRoleClient().rpc("rpc_sms_record_consent", {
    p_org_id: context.orgId,
    p_phone_hash: stored.phoneHash,
    p_phone_encrypted: stored.phoneEncrypted,
    p_phone_key_version: stored.phoneKeyVersion,
    p_phone_last_four: stored.lastFour,
    p_purpose: "review_request",
    p_status: "opted_in",
    p_source: "owner_import",
    p_location_id: stand.locationId,
    p_evidence: {
      method: input.method,
      wording_version: input.wordingVersion,
      attested_by: context.userId,
      stand_id: stand.standId,
      recorded_via: "text_requests_composer",
    },
    p_occurred_at: new Date().toISOString(),
  });
  if (error) {
    logger.error("sms.consent_record_failed", { requestId, error });
    throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
  }

  return {
    recipientLastFour: stored.lastFour,
    eligibility: await checkEligibility(context.orgId, stored.phoneHash, requestId),
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
  const normalized = normalizePhone(await recipientPhone(context, input, requestId), phoneOptions());
  const stored = toStoredPhone(normalized);
  const stand = await resolveStand(context, input);
  // Refuse before anything is reserved: no consent, an opt-out or a suppression
  // means no text and no charge. Dispatch checks again, so a STOP that arrives
  // after scheduling still wins.
  const eligibility = await checkEligibility(context.orgId, stored.phoneHash, requestId);
  if (!eligibility.allowed) {
    const message = eligibility.message ?? "This number can't be texted right now.";
    throw new ApiError(409, ERROR_CODE.notEligible, message, {
      details: [{ field: "phone", message }],
    });
  }

  const businessName = await loadBusinessName(context);
  const body = renderMessage(businessName, input.templateId, stand.link);
  const cost = estimateMessageCost(body, getProviderRate());

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
