import "server-only";

import { randomUUID } from "node:crypto";

import type {
  CreateSessionResponse,
  CustomerReviewContext,
  SubmitResponseResponse,
  TeamPraiseResponse,
} from "@/lib/api/customer-flow-types";
import {
  KEY_VERSION,
  clientFingerprint,
  decrypt,
  digestIdempotencyKey,
  digestRequestBody,
  digestResponseToken,
  digestSessionToken,
  digestStandToken,
  digestStandTokenWithPreviousKey,
  encrypt,
  generateToken,
} from "@/lib/server/crypto";
import { tokenDigestKeyVersion } from "@/lib/server/env";
import { ApiError, ERROR_CODE, rateLimited, reviewLinkInactive } from "@/lib/server/errors";
import { isValidGoogleReviewUrl } from "@/lib/server/google-review-url";
import { logger } from "@/lib/server/logger";
import { serviceRoleClient } from "@/lib/server/supabase";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  canonicalJson,
  normalizeCustomerText,
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
  | "response_not_found"
  | "praise_conflict";

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
    case "praise_conflict":
      throw new ApiError(
        409,
        ERROR_CODE.responseConflict,
        "Praise has already been recorded for this response.",
      );
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

async function consume(budget: Budget, key: string, requestId: string): Promise<void> {
  const { data, error } = await serviceRoleClient().rpc("rpc_consume_rate_limit", {
    p_bucket: budget.bucket,
    p_bucket_key: key,
    p_limit: budget.limit,
    p_window_seconds: budget.windowSeconds,
  });

  if (error) {
    // Fails open. A customer standing at a counter must not be turned away
    // because a limiter is unavailable; the abuse this bounds is a nuisance,
    // not a breach. Authentication would fail closed — this is not that.
    logger.warn("public.rate_limit_unavailable", { bucket: budget.bucket, requestId, error });
    return;
  }

  const row = Array.isArray(data) ? (data[0] as { allowed: boolean; retry_after_seconds: number } | undefined) : undefined;
  if (row && !row.allowed) {
    logger.warn("public.rate_limited", { bucket: budget.bucket, requestId });
    throw rateLimited(row.retry_after_seconds);
  }
}

async function guardRead(tokenHash: string, meta: RequestMeta): Promise<void> {
  await consume(CONTEXT_BUDGET, tokenHash, meta.requestId);
}

async function guardWrite(tokenHash: string, meta: RequestMeta): Promise<void> {
  await consume(STAND_WRITE_BUDGET, tokenHash, meta.requestId);
  await consume(CLIENT_WRITE_BUDGET, clientFingerprint(meta.address, meta.userAgent), meta.requestId);
}

interface ResolvedStand {
  business_name: string;
  location_name: string | null;
  google_review_url: string | null;
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

  // The contract makes googleReviewUrl required and non-nullable, and the
  // client re-validates it. A stand without a validated destination cannot
  // produce a usable page, so it fails identically to an unknown token rather
  // than serving a context the client will reject with no explanation.
  if (!stand.google_review_url || !isValidGoogleReviewUrl(stand.google_review_url)) {
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
    googleReviewUrl: stand.google_review_url,
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
    // Bots get a working session but are never counted, so scan numbers stay
    // meaningful to the business paying for them.
    p_record_scan: !looksLikeBot(meta.userAgent),
    p_response_body_encrypted: encrypt(JSON.stringify(body)),
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
 * Store the rating and the optional private note.
 *
 * Every rating from 1 to 5 is stored, and the note is optional for all of them.
 * Nothing about the result varies with the value chosen.
 */
export async function submitResponse(
  token: string,
  input: { sessionId: string; rating: number; note?: string; idempotencyKey: string },
  meta: RequestMeta,
): Promise<OperationResult<SubmitResponseResponse>> {
  const tokenHash = digestStandToken(token);
  await guardWrite(tokenHash, meta);

  const responseToken = generateToken();
  const body: SubmitResponseResponse = { responseId: responseToken };
  const note = normalizeCustomerText(input.note);

  const { data, error } = await serviceRoleClient().rpc("rpc_public_submit_response", {
    p_token_hash: tokenHash,
    p_idempotency_key: digestIdempotencyKey(`response|${input.idempotencyKey}`),
    p_request_hash: digestRequestBody(
      canonicalJson({ sessionId: input.sessionId, rating: input.rating, note: input.note }),
    ),
    p_session_token_hash: digestSessionToken(input.sessionId),
    p_response_token_hash: digestResponseToken(responseToken),
    p_rating: input.rating,
    p_note_encrypted: note === "" ? null : encrypt(note),
    p_note_key_version: KEY_VERSION,
    p_idempotency_ttl_seconds: IDEMPOTENCY_TTL_SECONDS,
    p_response_body_encrypted: encrypt(JSON.stringify(body)),
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

// ---------------------------------------------------------- google click --

/**
 * Record that the customer selected the Google action.
 *
 * That is the entire claim. It does not mean a review was written, submitted,
 * or published — ReviewBoost cannot observe any of that, and no metric built on
 * it may imply otherwise. The API never redirects: the client owns the
 * navigation, so a tracking failure can never stand between a customer and the
 * public review page.
 */
export async function recordGoogleClick(
  token: string,
  input: { sessionId: string; responseId: string; idempotencyKey: string },
  meta: RequestMeta,
): Promise<OperationResult<null>> {
  const tokenHash = digestStandToken(token);
  await guardWrite(tokenHash, meta);

  const { data, error } = await serviceRoleClient().rpc("rpc_public_record_google_click", {
    p_token_hash: tokenHash,
    p_idempotency_key: digestIdempotencyKey(`google-click|${input.idempotencyKey}`),
    p_request_hash: digestRequestBody(
      canonicalJson({ sessionId: input.sessionId, responseId: input.responseId }),
    ),
    p_session_token_hash: digestSessionToken(input.sessionId),
    p_response_token_hash: digestResponseToken(input.responseId),
    p_idempotency_ttl_seconds: IDEMPOTENCY_TTL_SECONDS,
  });

  if (error) fail("google_click", error, meta.requestId);

  const result = firstRow(data);
  if (!result) fail("google_click", new Error("empty rpc result"), meta.requestId);

  // 204 on a first record and on a replay alike: the contract documents one
  // success status for this operation.
  if (result.outcome === "replay" || result.outcome === "created") {
    return { status: 204, body: null };
  }

  throwForOutcome(result.outcome);
}

// ------------------------------------------------------------ team praise -

/**
 * Store praise for a colleague.
 *
 * Name and note are encrypted at rest and stored unmatched. ReviewBoost never
 * guesses which colleague the customer meant — matching is a decision a human
 * makes later, with the rating deliberately out of view. The response carries
 * only the new id: no rating, no Google state, no contact detail.
 */
export async function submitTeamPraise(
  token: string,
  input: {
    sessionId: string;
    responseId: string;
    firstName: string;
    note?: string;
    idempotencyKey: string;
  },
  meta: RequestMeta,
): Promise<OperationResult<TeamPraiseResponse>> {
  const tokenHash = digestStandToken(token);
  await guardWrite(tokenHash, meta);

  const firstName = normalizeCustomerText(input.firstName);
  const note = normalizeCustomerText(input.note);
  // Generated here, not in the database, so the replay body can be encrypted
  // with it before the call. A retry with no stored body has nothing to return.
  const praiseId = randomUUID();
  const body: TeamPraiseResponse = { teamPraiseId: praiseId };

  if (firstName === "") {
    throw new ApiError(400, ERROR_CODE.validationFailed, "The request could not be accepted.", {
      details: [{ field: "firstName", message: "A first name is required." }],
    });
  }

  const { data, error } = await serviceRoleClient().rpc("rpc_public_submit_team_praise", {
    p_token_hash: tokenHash,
    p_idempotency_key: digestIdempotencyKey(`team-praise|${input.idempotencyKey}`),
    p_request_hash: digestRequestBody(
      canonicalJson({
        sessionId: input.sessionId,
        responseId: input.responseId,
        firstName: input.firstName,
        note: input.note,
      }),
    ),
    p_session_token_hash: digestSessionToken(input.sessionId),
    p_response_token_hash: digestResponseToken(input.responseId),
    p_praise_id: praiseId,
    p_first_name_encrypted: encrypt(firstName),
    p_note_encrypted: note === "" ? null : encrypt(note),
    p_key_version: KEY_VERSION,
    p_idempotency_ttl_seconds: IDEMPOTENCY_TTL_SECONDS,
    p_response_body_encrypted: encrypt(JSON.stringify(body)),
  });

  if (error) fail("team_praise", error, meta.requestId);

  const result = firstRow(data);
  if (!result) fail("team_praise", new Error("empty rpc result"), meta.requestId);

  if (result.outcome === "replay") {
    return {
      status: replayStatus(result.response_status),
      body: decodeBody<TeamPraiseResponse>(result.response_body_encrypted),
    };
  }
  if (result.outcome !== "created") throwForOutcome(result.outcome);

  return { status: 201, body };
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
