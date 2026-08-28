import "server-only";

import type { AuthenticatedContext } from "@/lib/server/auth";
import {
  KEY_VERSION,
  digestStandToken,
  encrypt,
  generateToken,
  tokenPrefix,
  tryDecrypt,
} from "@/lib/server/crypto";
import { publicFrontendUrl, tokenDigestKeyVersion } from "@/lib/server/env";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { isValidGoogleReviewUrl, standUrl } from "@/lib/server/google-review-url";
import { logger } from "@/lib/server/logger";

/**
 * The owner side of ReviewBoost.
 *
 * Every query here runs through the caller's own RLS-scoped client, so tenant
 * isolation is enforced by the database on every statement rather than by each
 * handler remembering a `where org_id = ...`. A missing clause returns fewer
 * rows; it cannot return somebody else's.
 *
 * THE TEAM PRAISE BARRIER
 * -----------------------
 * `listTeamPraise` never selects the rating, and cannot: `team_praise_records`
 * has no rating column, and the join to `customer_responses` is deliberately
 * absent. The owner decides recognition without seeing the stars that happened
 * to accompany it, and the barrier is the shape of the query rather than a
 * field someone must remember to delete from a DTO.
 */

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

function databaseFailure(context: string, error: unknown, requestId: string): never {
  // Logged in full server-side, never returned: a Supabase error carries SQL
  // text, constraint names, and schema details.
  logger.error("owner.database_error", { context, requestId, error });
  throw new ApiError(
    503,
    ERROR_CODE.serviceUnavailable,
    "This service is temporarily unavailable. Please try again shortly.",
  );
}

function invalid(field: string, message: string): ApiError {
  return new ApiError(400, ERROR_CODE.validationFailed, "The request could not be accepted.", {
    details: [{ field, message }],
  });
}

// ------------------------------------------------------------ onboarding ---

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  timezone: string;
  defaultLocale: string;
  locationName: string;
  googleReviewUrl: string | undefined;
  standLabel: string | undefined;
}

export interface CreatedOrganization {
  organizationId: string;
  locationId: string;
  standId: string;
  standUrl: string;
  standToken: string;
}

/**
 * Create an organization, its owner, its first location, and its first stand.
 *
 * One database call, so a failure cannot leave a user owning nothing or an
 * organization with no owner.
 *
 * The stand token is generated here and returned **once**. Only its digest is
 * stored, so this response is the only moment it exists in readable form — the
 * caller must show it or encode it immediately.
 */
export async function createOrganization(
  context: AuthenticatedContext,
  input: CreateOrganizationInput,
  requestId: string,
): Promise<CreatedOrganization> {
  if (input.googleReviewUrl !== undefined && !isValidGoogleReviewUrl(input.googleReviewUrl)) {
    // Refused at the door rather than stored and failed later: an invalid
    // destination means the stand serves a page the customer's browser rejects,
    // and the owner would have no idea why.
    throw invalid("googleReviewUrl", "Must be a Google review link.");
  }

  const token = generateToken();

  const { data, error } = await context.db.rpc("rpc_create_organization", {
    p_name: input.name,
    p_slug: input.slug,
    p_timezone: input.timezone,
    p_default_locale: input.defaultLocale,
    p_location_name: input.locationName,
    p_google_review_url: input.googleReviewUrl ?? null,
    p_stand_token_hash: digestStandToken(token),
    p_stand_token_prefix: tokenPrefix(token),
    p_stand_label: input.standLabel ?? "Front Desk",
    p_token_key_version: tokenDigestKeyVersion(),
    p_request_id: requestId,
    p_token_ciphertext: encrypt(token),
    p_cipher_key_version: KEY_VERSION,
  });

  if (error) {
    // 23505 is the unique violation on the slug — a real user mistake with a
    // clear fix, so it gets a useful message rather than an opaque 503.
    if (error.code === "23505") {
      throw new ApiError(409, ERROR_CODE.responseConflict, "That web address is already taken.", {
        details: [{ field: "slug", message: "Already in use." }],
      });
    }
    if (error.code === "54000") {
      throw new ApiError(409, ERROR_CODE.responseConflict, "You have reached the organization limit.");
    }
    databaseFailure("create_organization", error, requestId);
  }

  const row = Array.isArray(data)
    ? (data[0] as { org_id: string; location_id: string; stand_id: string } | undefined)
    : undefined;

  if (!row) databaseFailure("create_organization", new Error("empty result"), requestId);

  return {
    organizationId: row.org_id,
    locationId: row.location_id,
    standId: row.stand_id,
    standUrl: standUrl(publicFrontendUrl(), token),
    standToken: token,
  };
}

/**
 * What the owner still has to do, derived from real records.
 *
 * Deliberately computed rather than stored as booleans. A duplicate flag drifts
 * from reality the moment anything changes outside the onboarding flow, and
 * then the owner is trapped in a wizard that insists they have not done
 * something they have.
 */
export async function getOnboardingState(context: AuthenticatedContext, requestId: string) {
  const { data: memberships, error: membershipError } = await context.db
    .from("organization_members")
    .select("org_id, role, organizations(id, name, slug)")
    .eq("user_id", context.userId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (membershipError) databaseFailure("onboarding_memberships", membershipError, requestId);

  const organizations = memberships ?? [];
  if (organizations.length === 0) {
    return {
      hasOrganization: false,
      hasLocation: false,
      hasGoogleReviewUrl: false,
      hasStand: false,
      isComplete: false,
      organization: null,
    };
  }

  const first = organizations[0] as { org_id: string; role: string };

  const [{ data: locations, error: locationError }, { data: stands, error: standError }] =
    await Promise.all([
      context.db.from("locations").select("id, name, google_review_url").eq("org_id", first.org_id),
      context.db.from("review_stands").select("id").eq("org_id", first.org_id).limit(1),
    ]);

  if (locationError) databaseFailure("onboarding_locations", locationError, requestId);
  if (standError) databaseFailure("onboarding_stands", standError, requestId);

  const hasGoogle = (locations ?? []).some(
    (location) => typeof location.google_review_url === "string" && location.google_review_url !== "",
  );

  return {
    hasOrganization: true,
    hasLocation: (locations ?? []).length > 0,
    hasGoogleReviewUrl: hasGoogle,
    hasStand: (stands ?? []).length > 0,
    // A stand cannot serve customers without a validated Google destination, so
    // that is what "complete" means here.
    isComplete: (locations ?? []).length > 0 && hasGoogle && (stands ?? []).length > 0,
    organization: { id: first.org_id, role: first.role },
  };
}

// ----------------------------------------------------------------- stands --

export async function listStands(context: AuthenticatedContext, requestId: string, orgId: string) {
  const { data, error } = await context.db
    .from("review_stands")
    .select("id, org_id, location_id, label, stand_type, status, public_token_prefix, created_at, last_opened_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(MAX_PAGE_SIZE);

  if (error) databaseFailure("list_stands", error, requestId);

  return (data ?? []).map((stand) => ({
    standId: stand.id as string,
    locationId: stand.location_id as string,
    label: stand.label as string,
    standType: stand.stand_type as string,
    status: stand.status as string,
    // The prefix is not the token and cannot be used to resolve the stand. It
    // exists so an owner can tell two stands apart in a list.
    tokenPrefix: stand.public_token_prefix as string,
    createdAt: stand.created_at as string,
    lastOpenedAt: (stand.last_opened_at as string | null) ?? null,
  }));
}

/**
 * Issue a new token for an existing stand.
 *
 * **This invalidates the printed code immediately.** The old token stops
 * resolving the moment this commits, so any QR already on a table is dead and
 * has to be reprinted. That is the correct behaviour for a compromised stand
 * and a genuinely destructive one otherwise, which is why it is a separate,
 * explicit action rather than a side effect of editing a stand.
 */
export async function rotateStandToken(
  context: AuthenticatedContext,
  standId: string,
  orgId: string,
  requestId: string,
): Promise<{ standId: string; standUrl: string; standToken: string }> {
  const token = generateToken();

  const { error } = await context.db.rpc("rpc_rotate_stand_token", {
    p_stand_id: standId,
    p_org_id: orgId,
    p_new_token_hash: digestStandToken(token),
    p_new_token_prefix: tokenPrefix(token),
    p_key_version: tokenDigestKeyVersion(),
    p_request_id: requestId,
    p_token_ciphertext: encrypt(token),
    p_cipher_key_version: KEY_VERSION,
  });

  if (error) {
    if (error.message?.includes("not_found_or_forbidden")) {
      throw new ApiError(404, ERROR_CODE.reviewLinkInactive, "Not found.");
    }
    databaseFailure("rotate_stand", error, requestId);
  }

  return {
    standId,
    standUrl: standUrl(publicFrontendUrl(), token),
    standToken: token,
  };
}

/**
 * Recover a stand's token so it can be reprinted.
 *
 * Reads the encrypted copy rather than the digest, which is the only direction
 * that works — a digest cannot be reversed. Returns null for a stand created
 * before reprinting existed, so the caller can tell the owner to rotate instead
 * of showing them a broken QR code.
 */
export async function getStandTokenForReprint(
  context: AuthenticatedContext,
  standId: string,
  orgId: string,
  requestId: string,
): Promise<{ token: string; standUrl: string; label: string } | null> {
  const { data, error } = await context.db
    .from("review_stands")
    .select("id, label, public_token_encrypted")
    .eq("id", standId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) databaseFailure("stand_reprint", error, requestId);
  // Invisible under RLS when it belongs to another tenant, so a cross-tenant
  // attempt looks exactly like a typo.
  if (!data) throw new ApiError(404, ERROR_CODE.reviewLinkInactive, "Not found.");

  const token = tryDecrypt(data.public_token_encrypted as string | null);
  if (token === null) return null;

  return { token, standUrl: standUrl(publicFrontendUrl(), token), label: data.label as string };
}

// ------------------------------------------------------ customer feedback --

export interface Page {
  cursor: string | undefined;
  limit: number | undefined;
}

function pageSize(limit: number | undefined): number {
  // Bounded rather than trusted. An unbounded page is how a listing endpoint
  // becomes a way to pull an entire table in one request. Non-finite (NaN,
  // Infinity, missing) falls back to the default; fractional values are
  // truncated so `.limit()` and `.slice()` always see an integer.
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_SIZE);
}

/**
 * The private feedback workspace.
 *
 * Shows the rating, because this *is* the place an owner is meant to see it —
 * unlike Team Praise. Cursor-paginated on `submitted_at`, which is indexed with
 * `org_id`, so the query stays a range scan as the table grows rather than
 * degrading into an offset walk.
 */
export async function listCustomerResponses(
  context: AuthenticatedContext,
  page: Page,
  requestId: string,
  orgId: string,
) {
  const limit = pageSize(page.limit);

  let query = context.db
    .from("customer_responses")
    .select("id, location_id, rating, note_encrypted, submitted_at, read_at, resolved_at")
    .eq("org_id", orgId)
    .order("submitted_at", { ascending: false })
    .limit(limit + 1);

  if (page.cursor) query = query.lt("submitted_at", page.cursor);

  const { data, error } = await query;
  if (error) databaseFailure("list_responses", error, requestId);

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;

  return {
    data: visible.map((row) => ({
      responseId: row.id as string,
      locationId: row.location_id as string,
      rating: row.rating as number,
      // Decrypted for display and never logged. One row encrypted under a
      // rotated key must not fail the whole page, so this does not throw.
      note: tryDecrypt(row.note_encrypted as string | null),
      submittedAt: row.submitted_at as string,
      isRead: row.read_at !== null,
      isResolved: row.resolved_at !== null,
    })),
    meta: {
      hasMore,
      nextCursor: hasMore ? (visible[visible.length - 1]?.submitted_at as string) : null,
    },
  };
}

export async function getCustomerResponse(
  context: AuthenticatedContext,
  responseId: string,
  requestId: string,
  orgId: string,
) {
  const { data, error } = await context.db
    .from("customer_responses")
    .select("id, location_id, rating, note_encrypted, submitted_at, read_at, resolved_at")
    .eq("org_id", orgId)
    .eq("id", responseId)
    .maybeSingle();

  if (error) databaseFailure("get_response", error, requestId);
  if (!data) return null;

  return {
    responseId: data.id as string,
    locationId: data.location_id as string,
    rating: data.rating as number,
    note: tryDecrypt(data.note_encrypted as string | null),
    submittedAt: data.submitted_at as string,
    isRead: data.read_at !== null,
    isResolved: data.resolved_at !== null,
  };
}

// ---------------------------------------------------------------- live feed --

/**
 * The live feed: taps and feedback in one reverse-chronological stream.
 *
 * Two tables (`public_review_sessions` for taps, `customer_responses` for
 * feedback) are queried separately and merge-sorted in application code.
 * Supabase JS has no UNION, and adding a view would require a migration. Both
 * tables carry RLS on `org_id`, so the merge cannot leak across tenants.
 *
 * Cursor design (v1)
 * ------------------
 * A plain timestamp cursor loses events when multiple rows share the same
 * timestamp: `lt(ts)` skips every row at that timestamp, even unseen ones.
 *
 * The cursor is an opaque base64url-encoded JSON object that tracks each
 * source's last-seen (timestamp, id) independently:
 *
 *   { v:1, t?: { s: string, i: string }, f?: { s: string, i: string } }
 *
 * Each source is ordered by (timestamp DESC, id DESC) for deterministic
 * ordering, and the resume query uses a composite condition:
 *   (ts < cursor_ts) OR (ts = cursor_ts AND id < cursor_id)
 * so no row at the boundary timestamp is lost.
 */

interface LiveFeedCursorV1 {
  v: 1;
  t?: { s: string; i: string };
  f?: { s: string; i: string };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  // Reject anything Postgres cannot round-trip as a timestamptz.
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function isValidCursorPosition(value: unknown): value is { s: string; i: string } {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.every((k) => k === "s" || k === "i")) return false;
  return isValidIsoTimestamp(value.s) && isValidUuid(value.i);
}

function encodeCursor(c: LiveFeedCursorV1): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

/**
 * Parse a client-supplied live-feed cursor. Because the parsed values are
 * interpolated into a PostgREST `.or()` filter, this validates the *entire*
 * shape and rejects unsupported versions or unexpected keys/types with a 400
 * rather than silently starting from page 1 — a scrolling client that has
 * corrupted its cursor should see the error, not the first page again with
 * duplicate entries.
 */
function parseCursor(raw: string): LiveFeedCursorV1 {
  const reject = (message: string): never => {
    throw new ApiError(400, ERROR_CODE.validationFailed, "The request could not be accepted.", {
      details: [{ field: "cursor", message }],
    });
  };

  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString();
  } catch {
    return reject("Cursor is not valid base64url.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return reject("Cursor is not valid JSON.");
  }

  if (!isPlainObject(parsed)) return reject("Cursor must be an object.");
  if (parsed.v !== 1) return reject("Unsupported cursor version.");

  const allowedKeys = new Set(["v", "t", "f"]);
  for (const key of Object.keys(parsed)) {
    if (!allowedKeys.has(key)) return reject("Cursor has an unexpected field.");
  }

  const cursor: LiveFeedCursorV1 = { v: 1 };
  if (parsed.t !== undefined) {
    if (!isValidCursorPosition(parsed.t)) return reject("Cursor 't' is malformed.");
    cursor.t = { s: parsed.t.s, i: parsed.t.i };
  }
  if (parsed.f !== undefined) {
    if (!isValidCursorPosition(parsed.f)) return reject("Cursor 'f' is malformed.");
    cursor.f = { s: parsed.f.s, i: parsed.f.i };
  }
  return cursor;
}

export async function listLiveFeed(
  context: AuthenticatedContext,
  page: Page,
  requestId: string,
  orgId: string,
) {
  const limit = pageSize(page.limit);
  const fetchSize = limit + 1;
  const cursor = page.cursor ? parseCursor(page.cursor) : null;

  let tapQuery = context.db
    .from("public_review_sessions")
    .select("id, location_id, created_at, locations(name)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(fetchSize);

  let feedbackQuery = context.db
    .from("customer_responses")
    .select("id, location_id, rating, submitted_at, locations(name)")
    .eq("org_id", orgId)
    .order("submitted_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(fetchSize);

  if (cursor?.t) {
    tapQuery = tapQuery.or(`created_at.lt.${cursor.t.s},and(created_at.eq.${cursor.t.s},id.lt.${cursor.t.i})`);
  }
  if (cursor?.f) {
    feedbackQuery = feedbackQuery.or(`submitted_at.lt.${cursor.f.s},and(submitted_at.eq.${cursor.f.s},id.lt.${cursor.f.i})`);
  }

  const [tapResult, feedbackResult] = await Promise.all([tapQuery, feedbackQuery]);

  if (tapResult.error) databaseFailure("live_feed_taps", tapResult.error, requestId);
  if (feedbackResult.error) databaseFailure("live_feed_feedback", feedbackResult.error, requestId);

  interface RawTap {
    id: string;
    location_id: string;
    created_at: string;
    locations: { name: string } | null;
  }
  interface RawFeedback {
    id: string;
    location_id: string;
    rating: number;
    submitted_at: string;
    locations: { name: string } | null;
  }

  const taps = ((tapResult.data ?? []) as unknown as RawTap[]).map((row) => ({
    id: row.id,
    type: "tap" as const,
    locationId: row.location_id,
    locationName: row.locations?.name ?? null,
    rating: null as number | null,
    submittedAt: row.created_at,
  }));

  const feedback = ((feedbackResult.data ?? []) as unknown as RawFeedback[]).map((row) => ({
    id: row.id,
    type: "feedback" as const,
    locationId: row.location_id,
    locationName: row.locations?.name ?? null,
    rating: row.rating as number | null,
    submittedAt: row.submitted_at,
  }));

  const merged = [...taps, ...feedback].sort((a, b) => {
    const timeDiff = new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
  });

  const hasMore = merged.length > limit;
  const visible = merged.slice(0, limit);

  let nextCursor: string | null = null;
  if (hasMore) {
    const lastTap = [...visible].reverse().find((e) => e.type === "tap");
    const lastFeedback = [...visible].reverse().find((e) => e.type === "feedback");
    const next: LiveFeedCursorV1 = { v: 1 };
    if (lastTap) next.t = { s: lastTap.submittedAt, i: lastTap.id };
    else if (cursor?.t) next.t = cursor.t;
    if (lastFeedback) next.f = { s: lastFeedback.submittedAt, i: lastFeedback.id };
    else if (cursor?.f) next.f = cursor.f;
    nextCursor = encodeCursor(next);
  }

  return {
    data: visible,
    meta: { hasMore, nextCursor },
  };
}

/**
 * Team Praise, deliberately rating-blind.
 *
 * The select list is the barrier. There is no rating column on this table and
 * no join to `customer_responses`, so the rating is not available to leak — an
 * owner deciding whether to recognise a colleague does so on what the customer
 * wrote, not on the stars that happened to accompany it.
 *
 * A test asserts the serialised response contains no rating, star, or Google
 * field.
 */
export async function listTeamPraise(context: AuthenticatedContext, page: Page, requestId: string, orgId: string) {
  const limit = pageSize(page.limit);

  let query = context.db
    .from("praise_safe_view")
    .select("id, location_id, first_name_encrypted, praise_note_encrypted, status, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (page.cursor) query = query.lt("created_at", page.cursor);

  const { data, error } = await query;
  if (error) databaseFailure("list_team_praise", error, requestId);

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;

  return {
    data: visible.map((row) => ({
      teamPraiseId: row.id as string,
      locationId: row.location_id as string,
      firstName: tryDecrypt(row.first_name_encrypted as string),
      note: tryDecrypt(row.praise_note_encrypted as string | null),
      status: row.status as string,
      createdAt: row.created_at as string,
    })),
    meta: {
      hasMore,
      nextCursor: hasMore ? (visible[visible.length - 1]?.created_at as string) : null,
    },
  };
}
