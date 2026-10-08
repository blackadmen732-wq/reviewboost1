import "server-only";

import type {
  CreateSessionResponse,
  CustomerReviewContext,
  SubmitResponseResponse,
} from "@/lib/api/customer-flow-types";
import {
  KEY_VERSION,
  clientFingerprint,
  decrypt,
  digestIdempotencyKey,
  digestRequestBody,
  digestResponseToken,
  digestResponseTokenWithPreviousKey,
  digestSessionToken,
  digestSessionTokenWithPreviousKey,
  digestStandToken,
  digestStandTokenWithPreviousKey,
  encrypt,
  generateToken,
} from "@/lib/server/crypto";
import { tokenDigestKeyVersion } from "@/lib/server/env";
import { ApiError, ERROR_CODE, rateLimited, reviewLinkInactive } from "@/lib/server/errors";
import { resolveDestination } from "@/lib/server/destination";
import { logger } from "@/lib/server/logger";
import { serviceRoleClient } from "@/lib/server/supabase";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  canonicalJson,
  type SupportedLocale,
} from "@/lib/server/validation";

/**
 * The anonymous customer flow.
 *
 * REVIEW INTEGRITY — the rule this module exists to keep
 * ------------------------------------------------------
 * Nothing here branches on the rating. A 1 and a 5 take the same path, produce
 * the same response shape, and receive the same destination. The destination
 * itself comes from `getContext`, which runs *before any rating exists* and is
 * never re-fetched with one — that is the structural reason it cannot vary by
 * rating, rather than a rule someone has to remember.
 *
 * V1 contract: Tag/QR/NFC → tap a star (1–5) → the business's public review
 * destination opens in that same moment, and the private rating is recorded
 * alongside it (`submitRating`, one request the page sends as it leaves). No
 * public note. No Team Praise in the customer path. The same destination is
 * served for every rating, 1 through 5.
 *
 * If a change ever makes a customer-facing value depend on `rating`, that
 * change is wrong.
 *
 * ATOMICITY
 * ---------
 * Each operation is one RPC, because each PostgREST call is one transaction.
 * `submitRating` runs three of them in order under one client key; a failure
 * part way leaves the earlier steps standing and a retry with the same key
 * replays them and finishes the rest.
 * The idempotency claim, the domain write, and the stored result commit
 * together or not at all — so a timeout on a phone either replays a stored
 * result or performs the operation for the first time, never both.
 */

const SESSION_TTL_SECONDS = 24 * 60 * 60;
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/** Outcomes the database functions return. */
type Outcome =
  | "created"
  | "replay"
  | "conflict"
  | "in_progress"
  | "unknown_stand"
  | "session_invalid"
  | "session_expired"
  | "response_conflict"
  | "response_not_found";

interface RpcResult {
  outcome: Outcome;
  response_status: number | null;
  response_body_encrypted: string | null;
}

export interface RequestMeta {
  address: string | null;
  userAgent: string | null;
  requestId: string;
}

export interface OperationResult<T> {
  status: number;
  body: T;
}

// ------------------------------------------------------------ helpers -----

function fail(context: string, error: unknown, requestId: string): never {
  // The Supabase error is logged in full server-side and never returned: it can
  // carry SQL text, constraint names, and schema details.
  logger.error("public.database_error", { context, requestId, error });
  throw new ApiError(
    503,
    ERROR_CODE.serviceUnavailable,
    "This service is temporarily unavailable. Please try again shortly.",
  );
}

function firstRow(data: unknown): RpcResult | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  return data[0] as RpcResult;
}

/**
 * Map a database outcome onto the published error contract.
 *
 * `unknown_stand` deliberately produces the same 404 as an unknown token, so a
 * caller cannot learn that a stand exists but is paused.
 */
function throwForOutcome(outcome: Outcome): never {
  switch (outcome) {
    case "unknown_stand":
      throw reviewLinkInactive();
    case "conflict":
      throw new ApiError(
        409,
        ERROR_CODE.idempotencyConflict,
        "This request was already made with different data. Use a new request key.",
      );
    case "in_progress":
      throw new ApiError(
        409,
        ERROR_CODE.idempotencyInProgress,
        "An identical request is still being processed. Try again in a moment.",
      );
    case "session_invalid":
      throw new ApiError(404, ERROR_CODE.sessionInvalid, "This session is no longer available.");
    case "session_expired":
      throw new ApiError(
        410,
        ERROR_CODE.sessionExpired,
        "This session has expired. Please scan the code again.",
      );
    case "response_conflict":
      throw new ApiError(
        409,
        ERROR_CODE.responseConflict,
        "A response has already been recorded for this session.",
      );
    case "response_not_found":
      throw new ApiError(404, ERROR_CODE.sessionInvalid, "This response is no longer available.");
    default:
      throw new ApiError(500, ERROR_CODE.internalError, "Something went wrong on our side.");
  }
}

/** A replayed create is a 200: nothing was created this time. */
function replayStatus(stored: number | null): number {
  if (stored === 201) return 200;
  return stored ?? 200;
}

function decodeBody<T>(encrypted: string | null): T {
  const plaintext = decrypt(encrypted);
  if (plaintext === null) {
    throw new ApiError(500, ERROR_CODE.internalError, "Something went wrong on our side.");
  }
  return JSON.parse(plaintext) as T;
}

// -------------------------------------------------------- rate limiting ---

interface Budget {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

/**
 * Layered, because neither layer works alone.
 *
 * Per stand bounds abuse of one printed code — but a whole restaurant shares
 * one NAT address, so an address-keyed limit alone would block real customers
 * at exactly the busiest moment. Per client fingerprint stops one device
 * filling a business's feedback while everyone else at that stand carries on.
 */
/** How long to ask a customer to wait when the limiter itself is unavailable. */
const RETRY_WHEN_LIMITER_DOWN_SECONDS = 5;

const CONTEXT_BUDGET: Budget = { bucket: "public-context", limit: 240, windowSeconds: 60 };
const STAND_WRITE_BUDGET: Budget = { bucket: "public-write-stand", limit: 60, windowSeconds: 60 };
const CLIENT_WRITE_BUDGET: Budget = { bucket: "public-write-client", limit: 30, windowSeconds: 300 };

/**
 * Consume one unit of a budget.
 *
 * `onUnavailable` is the whole design decision. A read that cannot be
 * rate-limited still serves a page: the worst case is a crawler reading a
 * business name it could have read anyway, and turning a real customer away
 * from the only screen they will ever see costs that business a rating.
 *
 * A *write* is the opposite. With the limiter down, failing open means anyone
 * holding a token can fabricate unlimited feedback into a business's data —
 * and unlike a read, that is not recoverable by retrying later. So a write
 * whose budget cannot be enforced is refused, and the customer is asked to try
 * again in a moment.
 */
async function consume(
  budget: Budget,
  key: string,
  requestId: string,
  onUnavailable: "allow" | "refuse",
): Promise<void> {
  const { data, error } = await serviceRoleClient().rpc("rpc_consume_rate_limit", {
    p_bucket: budget.bucket,
    p_bucket_key: key,
    p_limit: budget.limit,
    p_window_seconds: budget.windowSeconds,
  });

  if (error) {
    logger.warn("public.rate_limit_unavailable", {
      bucket: budget.bucket,
      requestId,
      onUnavailable,
      error,
    });
    if (onUnavailable === "refuse") throw rateLimited(RETRY_WHEN_LIMITER_DOWN_SECONDS);
    return;
  }

  const row = Array.isArray(data) ? (data[0] as { allowed: boolean; retry_after_seconds: number } | undefined) : undefined;

  // No row is not a pass. The function is meant to return a decision, and a
  // missing one means it could not make it — which for a write is a refusal.
  if (!row) {
    logger.warn("public.rate_limit_no_decision", { bucket: budget.bucket, requestId });
    if (onUnavailable === "refuse") throw rateLimited(RETRY_WHEN_LIMITER_DOWN_SECONDS);
    return;
  }

  if (!row.allowed) {
    logger.warn("public.rate_limited", { bucket: budget.bucket, requestId });
    throw rateLimited(row.retry_after_seconds);
  }
}

async function guardRead(tokenHash: string, meta: RequestMeta): Promise<void> {
  await consume(CONTEXT_BUDGET, tokenHash, meta.requestId, "allow");
}

async function guardWrite(tokenHash: string, meta: RequestMeta): Promise<void> {
  await consume(STAND_WRITE_BUDGET, tokenHash, meta.requestId, "refuse");
  await consume(
    CLIENT_WRITE_BUDGET,
    clientFingerprint(meta.address, meta.userAgent),
    meta.requestId,
    "refuse",
  );
}

interface ResolvedStand {
  business_name: string;
  location_name: string | null;
  destination_provider: string | null;
  destination_url: string | null;
  /** Compatibility storage. Read only as a fallback; never written from here. */
  google_review_url: string | null;
  /** The business's *published* Customer Page. A draft never arrives here. */
  customer_page: unknown;
  default_locale: string | null;
  matched_key_version: number;
}

/**
 * Resolve a stand, migrating its token digest if a key rotation is in progress.
 *
 * The raw token exists in exactly one place — this request. That makes a scan
 * the only opportunity to re-digest a stand under a new key, which is what lets
 * a rotation happen without reprinting a single QR code. A stand nobody scans
 * stays on the old key until someone does, and an unscanned stand is not a live
 * exposure.
 *
 * The upgrade is deliberately fire-and-forget: a customer standing at a counter
 * must not wait on, or be failed by, a housekeeping write.
 */
async function resolveStand(
  token: string,
  tokenHash: string,
  meta: RequestMeta,
): Promise<ResolvedStand | null> {
  const previousHash = digestStandTokenWithPreviousKey(token);

  const { data, error } = await serviceRoleClient().rpc("rpc_public_resolve_stand", {
    p_token_hash: tokenHash,
    p_previous_token_hash: previousHash,
  });

  if (error) fail("resolve_stand", error, meta.requestId);

  const stand = Array.isArray(data) ? (data[0] as ResolvedStand | undefined) : undefined;
  if (!stand) return null;

  const currentVersion = tokenDigestKeyVersion();
  if (previousHash !== null && stand.matched_key_version < currentVersion) {
    void upgradeStandDigest(previousHash, tokenHash, currentVersion, meta);
  }

  return stand;
}

async function upgradeStandDigest(
  oldHash: string,
  newHash: string,
  version: number,
  meta: RequestMeta,
): Promise<void> {
  const { error } = await serviceRoleClient().rpc("rpc_upgrade_stand_token_digest", {
    p_old_token_hash: oldHash,
    p_new_token_hash: newHash,
    p_new_version: version,
  });

  if (error) {
    // Logged, never surfaced. The stand still resolves under the old key, so a
    // failed upgrade costs nothing but a retry on the next scan.
    logger.warn("public.token_digest_upgrade_failed", { requestId: meta.requestId, error });
    return;
  }

  logger.info("public.token_digest_upgraded", { requestId: meta.requestId, version });
}

// --------------------------------------------------------------- context --

/**
 * Public presentation for one stand.
 *
 * Read-only, and records nothing — a link preview, a crawler, or an owner
 * refreshing the page must not inflate a business's numbers. The scan is
 * recorded when a session is created.
 *
 * Returns only what the page needs. No organization id, no location id, no
 * stand id, no subscription state: a caller who learned the tenant could write
 * unlimited fabricated feedback into it.
 */
export async function getContext(token: string, meta: RequestMeta): Promise<CustomerReviewContext> {
  const tokenHash = digestStandToken(token);
  await guardRead(tokenHash, meta);

  const stand = await resolveStand(token, tokenHash, meta);
  if (!stand) throw reviewLinkInactive();

  // A door with no valid destination is a closed door, and a closed door is
  // the same neutral dead link as an unknown token. Never "this business has
  // not finished setting up": the customer is not who that message is for, and
  // a caller holding a guessed token learns nothing either way.
  const destination = resolveDestination(stand);
  if (!destination) throw reviewLinkInactive();

  const locale = stand.default_locale;
  const defaultLocale: SupportedLocale =
    locale !== null && (SUPPORTED_LOCALES as readonly string[]).includes(locale)
      ? (locale as SupportedLocale)
      : DEFAULT_LOCALE;

  const page = publishedPage(stand.customer_page);

  return {
    business: { name: stand.business_name, logoUrl: page?.logoUrl ?? null },
    location: { name: stand.location_name },
    page,
    destination,
    // Compatibility alias of destination.url while clients migrate. It is the
    // same value, never a second source of truth.
    googleReviewUrl: destination.url,
    supportedLocales: [...SUPPORTED_LOCALES],
    defaultLocale,
  };
}

// -------------------------------------------------------------- sessions --

/**
 * Start an anonymous session and record one logical scan.
 *
 * The session token is 256 bits of entropy, stored only as a keyed digest. It
 * is a capability, not an identity: it says "this browser is partway through
 * the flow at this stand" and nothing about who the customer is.
 */
export async function createSession(
  token: string,
  input: { locale: SupportedLocale; idempotencyKey: string },
  meta: RequestMeta,
): Promise<OperationResult<CreateSessionResponse>> {
  const tokenHash = digestStandToken(token);
  await guardWrite(tokenHash, meta);

  const sessionToken = generateToken();
  const body: CreateSessionResponse = { sessionId: sessionToken };

  const { data, error } = await serviceRoleClient().rpc("rpc_public_create_session", {
    p_token_hash: tokenHash,
    p_idempotency_key: digestIdempotencyKey(`session|${input.idempotencyKey}`),
    p_request_hash: digestRequestBody(canonicalJson({ locale: input.locale })),
    p_session_token_hash: digestSessionToken(sessionToken),
    p_locale: input.locale,
    p_client_hash: clientFingerprint(meta.address, meta.userAgent),
    p_session_ttl_seconds: SESSION_TTL_SECONDS,
    p_idempotency_ttl_seconds: IDEMPOTENCY_TTL_SECONDS,
    p_record_scan: !looksLikeBot(meta.userAgent),
    p_response_body_encrypted: encrypt(JSON.stringify(body)),
    p_previous_token_hash: digestStandTokenWithPreviousKey(token),
  });

  if (error) fail("create_session", error, meta.requestId);

  const result = firstRow(data);
  if (!result) fail("create_session", new Error("empty rpc result"), meta.requestId);

  if (result.outcome === "replay") {
    return {
      status: replayStatus(result.response_status),
      body: decodeBody<CreateSessionResponse>(result.response_body_encrypted),
    };
  }
  if (result.outcome !== "created") throwForOutcome(result.outcome);

  return { status: 201, body };
}

// ------------------------------------------------------------- responses --

/**
 * Store the rating.
 *
 * V1 public contract: sessionId + rating only. No note, no name, no contact
 * detail. Every rating from 1 to 5 takes the same path and receives the same
 * Google opportunity. Nothing about the result varies with the value chosen.
 */
export async function submitResponse(
  token: string,
  input: { sessionId: string; rating: number; idempotencyKey: string },
  meta: RequestMeta,
): Promise<OperationResult<SubmitResponseResponse>> {
  const tokenHash = digestStandToken(token);
  await guardWrite(tokenHash, meta);

  const responseToken = generateToken();
  const body: SubmitResponseResponse = { responseId: responseToken };

  const { data, error } = await serviceRoleClient().rpc("rpc_public_submit_response", {
    p_token_hash: tokenHash,
    p_idempotency_key: digestIdempotencyKey(`response|${input.idempotencyKey}`),
    p_request_hash: digestRequestBody(
      canonicalJson({ sessionId: input.sessionId, rating: input.rating }),
    ),
    p_session_token_hash: digestSessionToken(input.sessionId),
    p_response_token_hash: digestResponseToken(responseToken),
    p_rating: input.rating,
    p_note_encrypted: null,
    p_note_key_version: KEY_VERSION,
    p_idempotency_ttl_seconds: IDEMPOTENCY_TTL_SECONDS,
    p_response_body_encrypted: encrypt(JSON.stringify(body)),
    p_previous_token_hash: digestStandTokenWithPreviousKey(token),
    p_previous_session_token_hash: digestSessionTokenWithPreviousKey(input.sessionId),
  });

  if (error) fail("submit_response", error, meta.requestId);

  const result = firstRow(data);
  if (!result) fail("submit_response", new Error("empty rpc result"), meta.requestId);

  if (result.outcome === "replay") {
    return {
      status: replayStatus(result.response_status),
      body: decodeBody<SubmitResponseResponse>(result.response_body_encrypted),
    };
  }
  if (result.outcome !== "created") throwForOutcome(result.outcome);

  return { status: 201, body };
}

// --------------------------------------------------- destination handoff --

/**
 * Record that the customer was handed to the configured review destination.
 *
 * That is the entire claim. It does not mean a review was written, submitted,
 * or published — ReviewBoost cannot observe any of that, and no metric built on
 * it may imply otherwise. The provider is recorded by the database from the
 * location it resolves, not taken from the request, so the stored history says
 * which door was open at that moment rather than what a client asserted.
 *
 * The API never redirects: the client owns the navigation, so a tracking
 * failure can never stand between a customer and the public review page.
 */
export async function recordDestinationSelection(
  token: string,
  input: { sessionId: string; responseId: string; idempotencyKey: string },
  meta: RequestMeta,
): Promise<OperationResult<null>> {
  const tokenHash = digestStandToken(token);
  await guardWrite(tokenHash, meta);

  const { data, error } = await serviceRoleClient().rpc("rpc_public_record_destination_selection", {
    p_token_hash: tokenHash,
    p_idempotency_key: digestIdempotencyKey(`destination-selection|${input.idempotencyKey}`),
    p_request_hash: digestRequestBody(
      canonicalJson({ sessionId: input.sessionId, responseId: input.responseId }),
    ),
    p_session_token_hash: digestSessionToken(input.sessionId),
    p_response_token_hash: digestResponseToken(input.responseId),
    p_idempotency_ttl_seconds: IDEMPOTENCY_TTL_SECONDS,
    p_previous_token_hash: digestStandTokenWithPreviousKey(token),
    p_previous_session_token_hash: digestSessionTokenWithPreviousKey(input.sessionId),
    p_previous_response_token_hash: digestResponseTokenWithPreviousKey(input.responseId),
  });

  if (error) fail("destination_selection", error, meta.requestId);

  const result = firstRow(data);
  if (!result) fail("destination_selection", new Error("empty rpc result"), meta.requestId);

  // 204 on a first record and on a replay alike: the contract documents one
  // success status for this operation.
  if (result.outcome === "replay" || result.outcome === "created") {
    return { status: 204, body: null };
  }

  throwForOutcome(result.outcome);
}

// ------------------------------------------------------------ the tap --

/**
 * The whole tap in one request: the scan, the rating and the handoff.
 *
 * The customer page sends this at the moment a star is tapped, while the
 * browser is already opening the public review destination, so nothing here
 * stands between a customer and Google. It records exactly what the three
 * step-by-step writes record, through the same functions — the same
 * validation, rate limits, bot rule for scans, provider-from-location and
 * fail-closed limiter — so the dashboard's numbers mean what they meant.
 *
 * One Idempotency-Key covers all three steps. Each step already namespaces
 * the key ("session|", "response|", "destination-selection|"), so they cannot
 * collide, and a retry with the same key replays every step that happened and
 * finishes the rest: a page that comes back and re-sends cannot rate twice.
 * If a step fails, the error is returned and the steps before it stand; the
 * client keeps the request and re-sends it.
 *
 * Every rating from 1 to 5 takes this same path and gets the same answer.
 */
export async function submitRating(
  token: string,
  input: { locale: SupportedLocale; rating: number; idempotencyKey: string },
  meta: RequestMeta,
): Promise<OperationResult<null>> {
  const session = await createSession(
    token,
    { locale: input.locale, idempotencyKey: input.idempotencyKey },
    meta,
  );
  const response = await submitResponse(
    token,
    {
      sessionId: session.body.sessionId,
      rating: input.rating,
      idempotencyKey: input.idempotencyKey,
    },
    meta,
  );
  await recordDestinationSelection(
    token,
    {
      sessionId: session.body.sessionId,
      responseId: response.body.responseId,
      idempotencyKey: input.idempotencyKey,
    },
    meta,
  );
  return { status: 204, body: null };
}

/**
 * Narrow the published page snapshot to the fields the contract publishes.
 *
 * The snapshot is validated on the way in, but it is JSON in a column, so it
 * is treated as untrusted on the way out too: an unknown template or a
 * non-string tagline degrades to the plain default rather than reaching a
 * customer's browser. A business with no page is not an error — it still has
 * customers and must still be able to take a rating.
 */
function publishedPage(value: unknown): CustomerReviewContext["page"] {
  if (value === null || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  const templateId = raw["templateId"];
  const tagline = raw["tagline"];
  const logoUrl = raw["logoUrl"];
  const heroUrl = raw["heroUrl"];

  return {
    templateId:
      templateId === "classic" || templateId === "bold" || templateId === "minimal"
        ? templateId
        : "classic",
    tagline: typeof tagline === "string" && tagline.length <= 120 ? tagline : null,
    logoUrl: typeof logoUrl === "string" && logoUrl.startsWith("https://") ? logoUrl : null,
    heroUrl: typeof heroUrl === "string" && heroUrl.startsWith("https://") ? heroUrl : null,
  };
}

/**
 * Coarse bot detection, used only to decide whether a scan counts.
 *
 * Never used to deny service: a false positive must cost a business a number in
 * a chart, never cost a real customer their ability to leave feedback.
 */
function looksLikeBot(userAgent: string | null): boolean {
  if (!userAgent) return true;
  return /bot|crawler|spider|crawling|preview|facebookexternalhit|slackbot|headless/i.test(
    userAgent,
  );
}
