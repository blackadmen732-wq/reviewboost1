import "server-only";

import type {
  CreateSessionResponse,
  CustomerReviewContext,
  SubmitResponseResponse,
} from "@/lib/api/customer-flow-types";
import {
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
import { destinationFromGoogleUrl } from "@/lib/server/destination";
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
 * the same response shape, and receive the same Google opportunity. The
 * opportunity itself comes from `getContext`, which runs *before any rating
 * exists* and is never re-fetched with one — that is the structural reason it
 * cannot vary by rating, rather than a rule someone has to remember.
 *
 * The private note and Team Praise are additive: extra things a customer may
 * choose to do, never a substitute for the public review.
 *
 * If a change ever makes a customer-facing value depend on `rating`, that
 * change is wrong.
 *
 * ATOMICITY
 * ---------
 * Each operation is one RPC, because each PostgREST call is one transaction.
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
const CONTEXT_BUDGET: Budget = { bucket: "public-context", limit: 240, windowSeconds: 60 };
const STAND_WRITE_BUDGET: Budget = { bucket: "public-write-stand", limit: 60, windowSeconds: 60 };
const CLIENT_WRITE_BUDGET: Budget = { bucket: "public-write-client", limit: 30, windowSeconds: 300 };

async function consumeRead(budget: Budget, key: string, requestId: string): Promise<void> {
  const { data, error } = await serviceRoleClient().rpc("rpc_consume_rate_limit", {
    p_bucket: budget.bucket,
    p_bucket_key: key,
    p_limit: budget.limit,
    p_window_seconds: budget.windowSeconds,
  });

  if (error) {
    // Read/context limiter fails open: a customer loading the page must not be
    // turned away because the limiter is temporarily unavailable. Reads carry
    // no mutation risk; the worst case is a page load that succeeds when it
    // should have been throttled — a nuisance, not a breach.
    logger.warn("public.rate_limit_unavailable", { bucket: budget.bucket, requestId, error });
    return;
  }

  const row = Array.isArray(data) ? (data[0] as { allowed: boolean; retry_after_seconds: number } | undefined) : undefined;
  if (row && !row.allowed) {
    logger.warn("public.rate_limited", { bucket: budget.bucket, requestId });
    throw rateLimited(row.retry_after_seconds);
  }
}

async function consumeWrite(budget: Budget, key: string, requestId: string): Promise<void> {
  const { data, error } = await serviceRoleClient().rpc("rpc_consume_rate_limit", {
    p_bucket: budget.bucket,
    p_bucket_key: key,
    p_limit: budget.limit,
    p_window_seconds: budget.windowSeconds,
  });

  if (error) {
    // Write limiter fails CLOSED. If enforcement cannot be established, we do
    // not allow an unlimited flood of rating/session/click mutations. A brief
    // outage is tolerable; an undetected abuse storm against production data is
    // not. The error is logged so the on-call team can distinguish a limiter
    // outage from a real rate-limit event.
    logger.error("public.rate_limit_write_unavailable", { bucket: budget.bucket, requestId, error });
    throw rateLimited(60);
  }

  const row = Array.isArray(data) ? (data[0] as { allowed: boolean; retry_after_seconds: number } | undefined) : undefined;
  if (row && !row.allowed) {
    logger.warn("public.rate_limited", { bucket: budget.bucket, requestId });
    throw rateLimited(row.retry_after_seconds);
  }
}

async function guardRead(tokenHash: string, meta: RequestMeta): Promise<void> {
  await consumeRead(CONTEXT_BUDGET, tokenHash, meta.requestId);
}

async function guardWrite(tokenHash: string, meta: RequestMeta): Promise<void> {
  await consumeWrite(STAND_WRITE_BUDGET, tokenHash, meta.requestId);
  await consumeWrite(CLIENT_WRITE_BUDGET, clientFingerprint(meta.address, meta.userAgent), meta.requestId);
}

interface ResolvedStand {
  business_name: string;
  location_name: string | null;
  google_review_url: string | null;
  destination_provider: string | null;
  destination_url: string | null;
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

  // A stand without a validated destination cannot open the door — it fails
  // identically to an unknown token so callers cannot distinguish an unconfigured
  // stand from a paused or retired one.
  //
  // Use the authoritative destination_provider/url columns when available
  // (populated by migration 20260915000100). Fall back to google_review_url
  // during the compatibility window for rows not yet backfilled.
  let destination: import("@/lib/server/destination").ReviewDestination | null = null;
  if (stand.destination_provider && stand.destination_url) {
    destination = { provider: stand.destination_provider as "google", url: stand.destination_url };
  } else {
    destination = destinationFromGoogleUrl(stand.google_review_url);
  }
  if (!destination) {
    throw reviewLinkInactive();
  }

  const locale = stand.default_locale;
  const defaultLocale: SupportedLocale =
    locale !== null && (SUPPORTED_LOCALES as readonly string[]).includes(locale)
      ? (locale as SupportedLocale)
      : DEFAULT_LOCALE;

  return {
    business: { name: stand.business_name, logoUrl: null },
    location: { name: stand.location_name },
    destination,
    // Backward-compatibility alias: googleReviewUrl equals destination.url
    // when destination.provider is "google". Clients that predate the
    // destination abstraction continue to work without modification.
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
 * V1 contract: sessionId + rating only. Notes are not collected from customers
 * in V1 — the note_encrypted column remains in the database for historical rows,
 * but no new submission includes one.
 *
 * Every rating from 1 to 5 is stored identically. Nothing about the result
 * varies with the value chosen, and the destination was already delivered
 * before any rating existed.
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

// ---------------------------------------- destination review step (click) --

/**
 * Record that the customer selected the configured review destination.
 *
 * That is the entire claim. It does not mean a review was written, submitted,
 * or published — ReviewBoost cannot observe any of that, and no metric built on
 * it may imply otherwise. The provider (e.g. "google") is stored with the event
 * so analytics are not permanently Google-only.
 *
 * The API never redirects: the client owns the navigation, so a tracking failure
 * can never stand between a customer and the public review page.
 */
export async function recordDestinationStep(
  token: string,
  input: { sessionId: string; responseId: string; idempotencyKey: string },
  meta: RequestMeta,
): Promise<OperationResult<null>> {
  const tokenHash = digestStandToken(token);
  await guardWrite(tokenHash, meta);

  const { data, error } = await serviceRoleClient().rpc("rpc_public_record_destination_step", {
    p_token_hash: tokenHash,
    p_idempotency_key: digestIdempotencyKey(`destination-step|${input.idempotencyKey}`),
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

  if (error) fail("destination_step", error, meta.requestId);

  const result = firstRow(data);
  if (!result) fail("destination_step", new Error("empty rpc result"), meta.requestId);

  // 204 on a first record and on a replay alike.
  if (result.outcome === "replay" || result.outcome === "created") {
    return { status: 204, body: null };
  }

  throwForOutcome(result.outcome);
}

/** @deprecated Use recordDestinationStep — kept for any in-flight callers. */
export const recordGoogleClick = recordDestinationStep;

// ------------------------------------------------------------ team praise -

/**
 * Team Praise is not active in V1.
 *
 * Historical team_praise_records are preserved for owners. New public
 * submissions are not accepted. Returns 410 Gone to any caller.
 */
export async function submitTeamPraise(
  _token: string,
  _input: unknown,
  _meta: RequestMeta,
): Promise<never> {
  throw new ApiError(410, ERROR_CODE.gone, "Team Praise is no longer active.");
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
