import "server-only";

import { createHmac } from "node:crypto";

import { secureCompare } from "@/lib/server/crypto";
import type { SquareConfig } from "@/lib/server/integrations/providers/square/config";
import {
  ProviderError,
  type CanonicalCustomerInput,
  type CanonicalVisitInput,
  type GrantCheck,
  type Page,
  type ParsedEvent,
  type ProviderAccount,
  type ProviderAdapter,
  type ProviderErrorClass,
  type ResolvedEvent,
  type SyncContext,
  type SyncWindow,
  type TokenSet,
  type VisitStatus,
  type WorkflowId,
} from "@/lib/server/integrations/types";

/**
 * Square (docs/connections/appendix-a), against Square's own documentation:
 *
 *   Sign-in      OAuth code flow. GET /oauth2/authorize, POST /oauth2/token,
 *                POST /oauth2/token/status for the scopes actually granted,
 *                POST /oauth2/revoke with `Authorization: Client <secret>`.
 *                Access tokens last 30 days; Square asks for a refresh every
 *                7 days or less. Code-flow refresh tokens do not expire.
 *   Account      GET /v2/merchants/me and GET /v2/locations.
 *   Sales        GET /v2/payments, one location at a time (without
 *                `location_id` Square answers for the main location only).
 *                A sale is a visit once its payment is COMPLETED.
 *   Appointments GET /v2/bookings, at most 31 days of start times per call.
 *                Square has no "completed" booking status: an ACCEPTED
 *                booking whose time has passed is "appointment time passed",
 *                which is all ReviewBoost claims about it.
 *   Customers    POST /v2/customers/bulk-retrieve, 100 ids per call.
 *   Webhooks     `x-square-hmacsha256-signature`: base64 HMAC-SHA256, keyed
 *                with the subscription's signature key, over the notification
 *                URL followed by the raw body. Deduplicated by `event_id`.
 *
 * A Square customer has no texting permission of any kind; the profile's
 * `preferences` hold only an email opt-out. Nothing read here is consent, and
 * nothing here can send a message.
 *
 * Error messages carry the HTTP status and Square's error code, never a
 * response body, a token or a customer's details.
 */

/** Square-Version sent with every call; a reviewed change, never "latest". */
export const SQUARE_API_VERSION = "2026-09-16";
const PAYLOAD_VERSION = `square-${SQUARE_API_VERSION}.v1`;
export const SQUARE_SIGNATURE_HEADER = "x-square-hmacsha256-signature";

const TIMEOUT_MS = 10_000;
const DAY_MS = 86_400_000;
/** Square allows 31 days of booking start times per call; stay inside it. */
const BOOKING_CHUNK_MS = 30 * DAY_MS;
/**
 * Appointments are read from a day before the window, so one that was still
 * under way at the last sync is read again once its time has passed.
 */
const BOOKING_LOOKBACK_MS = DAY_MS;
const CUSTOMER_BATCH = 100;
/** Refresh once a 30-day token is a week old (Square: every 7 days or less). */
const REFRESH_WHEN_REMAINING_MS = 23 * DAY_MS;
const REFRESH_EVERY_MS = 6 * DAY_MS;

const ID_RE = /^[A-Za-z0-9_-]{1,191}$/;

// ------------------------------------------------------------ Square shapes ---

interface SquareErrorBody {
  errors?: { code?: unknown; category?: unknown }[];
}

interface SquareTokenResponse {
  access_token?: string;
  expires_at?: string;
  merchant_id?: string;
  refresh_token?: string;
  refresh_token_expires_at?: string;
}

interface SquareTokenStatus {
  scopes?: string[];
  client_id?: string;
  merchant_id?: string;
}

interface SquarePayment {
  id?: string;
  status?: string;
  location_id?: string;
  customer_id?: string;
  created_at?: string;
  updated_at?: string;
}

interface SquareBooking {
  id?: string;
  version?: number;
  status?: string;
  location_id?: string;
  customer_id?: string;
  start_at?: string;
  updated_at?: string;
  appointment_segments?: { duration_minutes?: number }[];
}

interface SquareCustomer {
  id?: string;
  given_name?: string;
  family_name?: string;
  nickname?: string;
  company_name?: string;
  phone_number?: string;
  created_at?: string;
  updated_at?: string;
  version?: number;
}

interface SquareLocation {
  id?: string;
  name?: string;
  timezone?: string;
  status?: string;
}

// ------------------------------------------------------------------ errors ---

function errorCodes(body: unknown): string[] {
  const errors = (body as SquareErrorBody | null)?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.map((error) => (typeof error?.code === "string" ? error.code : "")).filter(Boolean);
}

function retryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 3600) * 1000 : undefined;
}

/** What a Square HTTP failure means for the connection. Exported for tests. */
export function classifySquareResponse(status: number, body: unknown, headers: Headers): ProviderErrorClass {
  const codes = errorCodes(body);
  if (status === 429 || codes.includes("RATE_LIMITED")) {
    const after = retryAfterMs(headers);
    return { kind: "retryable", reason: "rate_limited", ...(after === undefined ? {} : { retryAfterMs: after }) };
  }
  if (status === 401) {
    return codes.includes("ACCESS_TOKEN_EXPIRED")
      ? { kind: "auth", reason: "token_expired" }
      : { kind: "auth", reason: "token_revoked" };
  }
  if (status === 403) return { kind: "auth", reason: "insufficient_scope" };
  if (status === 404) return { kind: "permanent", reason: "not_found" };
  if (status === 408 || status === 504) return { kind: "retryable", reason: "timeout" };
  if (status >= 500) return { kind: "retryable", reason: "server_error" };
  return { kind: "permanent", reason: "invalid_request" };
}

function squareError(status: number, body: unknown, headers: Headers): ProviderError {
  const code = errorCodes(body)[0] ?? "none";
  return new ProviderError(classifySquareResponse(status, body, headers), `square:${status}:${code}`);
}

function malformed(what: string): ProviderError {
  return new ProviderError({ kind: "permanent", reason: "invalid_request" }, `square:malformed:${what}`);
}

// ----------------------------------------------------------------- mapping ---

function date(raw: unknown): Date | null {
  if (typeof raw !== "string") return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function text(raw: unknown, max = 200): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function id(raw: unknown): string | null {
  return typeof raw === "string" && ID_RE.test(raw) ? raw : null;
}

function paymentStatus(raw: unknown): VisitStatus {
  if (raw === "COMPLETED") return "completed";
  if (raw === "CANCELED" || raw === "FAILED") return "cancelled";
  return "pending";
}

/** A payment as a visit; null when Square left out what a visit needs. */
export function paymentToVisit(payment: SquarePayment): CanonicalVisitInput | null {
  const externalId = id(payment.id);
  const locationId = id(payment.location_id);
  const occurredAt = date(payment.created_at);
  if (!externalId || !locationId || !occurredAt) return null;
  return {
    externalId,
    kind: "payment",
    status: paymentStatus(payment.status),
    customerExternalId: id(payment.customer_id),
    externalLocationId: locationId,
    occurredAt,
    sourceUpdatedAt: date(payment.updated_at),
    // Square versions payments with an opaque token, not a number.
    sourceVersion: null,
  };
}

function bookingStatus(booking: SquareBooking, start: Date, now: Date): VisitStatus {
  switch (booking.status) {
    case "ACCEPTED": {
      const minutes = (booking.appointment_segments ?? []).reduce(
        (total, segment) =>
          total + (typeof segment?.duration_minutes === "number" && segment.duration_minutes > 0 ? segment.duration_minutes : 0),
        0,
      );
      const ends = start.getTime() + minutes * 60_000;
      return ends <= now.getTime() ? "appointment_time_passed" : "pending";
    }
    case "NO_SHOW":
      return "no_show";
    case "CANCELLED_BY_CUSTOMER":
    case "CANCELLED_BY_SELLER":
    case "DECLINED":
      return "cancelled";
    default:
      return "pending";
  }
}

/** A booking as a visit; null when Square left out what a visit needs. */
export function bookingToVisit(booking: SquareBooking, now: Date): CanonicalVisitInput | null {
  const externalId = id(booking.id);
  const locationId = id(booking.location_id);
  const start = date(booking.start_at);
  if (!externalId || !locationId || !start) return null;
  return {
    externalId,
    kind: "appointment",
    status: bookingStatus(booking, start, now),
    customerExternalId: id(booking.customer_id),
    externalLocationId: locationId,
    occurredAt: start,
    sourceUpdatedAt: date(booking.updated_at),
    sourceVersion: typeof booking.version === "number" ? booking.version : null,
  };
}

export function squareCustomerToCanonical(customer: SquareCustomer): CanonicalCustomerInput | null {
  const externalId = id(customer.id);
  if (!externalId) return null;
  const fullName = [text(customer.given_name, 100), text(customer.family_name, 100)].filter(Boolean).join(" ");
  return {
    externalId,
    name: fullName || text(customer.nickname) || text(customer.company_name),
    phone: text(customer.phone_number, 40),
    sourceCreatedAt: date(customer.created_at),
    sourceUpdatedAt: date(customer.updated_at),
    sourceVersion: typeof customer.version === "number" ? customer.version : null,
  };
}

// ------------------------------------------------------------------ cursor ---

/** Where a paged read is: which chosen place, which booking chunk, Square's cursor. */
interface VisitCursor {
  l: number;
  s: number | null;
  c: string | null;
}

function encodeCursor(cursor: VisitCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(raw: string | null): VisitCursor {
  if (!raw) return { l: 0, s: null, c: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw malformed("cursor");
  }
  const value = parsed as Partial<VisitCursor> | null;
  if (
    !value ||
    typeof value.l !== "number" ||
    !Number.isInteger(value.l) ||
    value.l < 0 ||
    !(value.s === null || (typeof value.s === "number" && Number.isFinite(value.s))) ||
    !(value.c === null || (typeof value.c === "string" && value.c.length <= 2048))
  ) {
    throw malformed("cursor");
  }
  return { l: value.l, s: value.s, c: value.c };
}

// ----------------------------------------------------------------- adapter ---

export interface SquareAdapterOptions {
  config: SquareConfig;
  fetch?: typeof fetch;
  clock?: () => Date;
}

/** The webhook signature Square sends, for tests and for checking a delivery. */
export function signSquareWebhook(url: string, rawBody: string, key: string): string {
  return createHmac("sha256", key).update(url + rawBody).digest("base64");
}

export function createSquareAdapter(options: SquareAdapterOptions): ProviderAdapter {
  const { config } = options;
  const fetchImpl = options.fetch ?? fetch;
  const clock = options.clock ?? (() => new Date());

  type Auth = { bearer: string } | { client: true } | null;

  async function call<T>(
    method: "GET" | "POST",
    path: string,
    auth: Auth,
    input?: { query?: Record<string, string | null | undefined>; body?: unknown },
  ): Promise<T> {
    const url = new URL(path, config.baseUrl);
    for (const [key, value] of Object.entries(input?.query ?? {})) {
      if (value) url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = {
      "Square-Version": SQUARE_API_VERSION,
      Accept: "application/json",
    };
    if (input?.body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && "bearer" in auth) headers.Authorization = `Bearer ${auth.bearer}`;
    if (auth && "client" in auth) headers.Authorization = `Client ${config.applicationSecret}`;

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: input?.body === undefined ? null : JSON.stringify(input.body),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (caught) {
      const name = (caught as { name?: unknown } | null)?.name;
      throw new ProviderError(
        { kind: "retryable", reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" },
        "square:unreachable",
      );
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) throw squareError(response.status, body, response.headers);
    if (body === null || typeof body !== "object") throw malformed("body");
    return body as T;
  }

  async function grantedScopes(accessToken: string): Promise<string[]> {
    const status = await call<SquareTokenStatus>("POST", "/oauth2/token/status", { bearer: accessToken }, { body: {} });
    if (status.client_id && status.client_id !== config.applicationId) {
      // A token minted for another application is not one we asked for.
      throw new ProviderError({ kind: "auth", reason: "token_revoked" }, "square:token_status:client_mismatch");
    }
    return Array.isArray(status.scopes) ? status.scopes.filter((scope) => typeof scope === "string") : [];
  }

  async function customer(ctx: SyncContext, customerId: string): Promise<CanonicalCustomerInput | null> {
    try {
      const body = await call<{ customer?: SquareCustomer }>(
        "GET",
        `/v2/customers/${encodeURIComponent(customerId)}`,
        { bearer: ctx.tokens.accessToken },
      );
      return body.customer ? squareCustomerToCanonical(body.customer) : null;
    } catch (caught) {
      // Deleted or merged away in Square: nothing to bring in.
      if (caught instanceof ProviderError && caught.classification.reason === "not_found") return null;
      throw caught;
    }
  }

  return {
    id: "square",
    apiVersion: SQUARE_API_VERSION,

    buildAuthorizeUrl({ state, scopes, redirectUri }) {
      const url = new URL("/oauth2/authorize", config.baseUrl);
      url.searchParams.set("client_id", config.applicationId);
      url.searchParams.set("scope", scopes.join(" "));
      url.searchParams.set("state", state);
      url.searchParams.set("redirect_uri", redirectUri);
      // Square asks production apps to make the seller sign in, so someone with
      // two Square accounts picks the right one. The sandbox does not support it.
      if (config.environment === "production") url.searchParams.set("session", "false");
      return url;
    },

    async exchangeCode({ code, redirectUri }) {
      if (!/^[A-Za-z0-9_.-]{1,512}$/.test(code)) throw malformed("code");
      const body = await call<SquareTokenResponse>("POST", "/oauth2/token", null, {
        body: {
          client_id: config.applicationId,
          client_secret: config.applicationSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        },
      });
      if (!body.access_token) throw malformed("token");
      return {
        accessToken: body.access_token,
        refreshToken: body.refresh_token ?? null,
        accessExpiresAt: date(body.expires_at),
        refreshExpiresAt: date(body.refresh_token_expires_at),
        // The token response does not list scopes; ask Square what was granted.
        grantedScopes: await grantedScopes(body.access_token),
      };
    },

    async refresh(tokens) {
      if (!tokens.refreshToken) throw new ProviderError({ kind: "auth", reason: "token_revoked" }, "square:no_refresh_token");
      const body = await call<SquareTokenResponse>("POST", "/oauth2/token", null, {
        body: {
          client_id: config.applicationId,
          client_secret: config.applicationSecret,
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
        },
      });
      if (!body.access_token) throw malformed("token");
      return {
        accessToken: body.access_token,
        refreshToken: body.refresh_token ?? tokens.refreshToken,
        accessExpiresAt: date(body.expires_at),
        refreshExpiresAt: date(body.refresh_token_expires_at) ?? tokens.refreshExpiresAt,
        grantedScopes: tokens.grantedScopes,
      };
    },

    async revoke(tokens) {
      try {
        // Revoking by access token ends the whole authorization, refresh token included.
        await call<{ success?: boolean }>("POST", "/oauth2/revoke", { client: true }, {
          body: { client_id: config.applicationId, access_token: tokens.accessToken },
        });
      } catch (caught) {
        // Already revoked or expired on Square's side is the outcome we wanted.
        if (caught instanceof ProviderError && caught.classification.kind === "auth") return;
        throw caught;
      }
    },

    shouldRefresh(tokens: TokenSet, lastRefreshedAt: Date | null, now: Date) {
      if (tokens.accessExpiresAt && tokens.accessExpiresAt.getTime() - now.getTime() < REFRESH_WHEN_REMAINING_MS) {
        return true;
      }
      return lastRefreshedAt !== null && now.getTime() - lastRefreshedAt.getTime() > REFRESH_EVERY_MS;
    },

    verifyGrant(tokens, requested): GrantCheck {
      const granted = new Set(tokens.grantedScopes);
      const missing = requested.filter((scope) => !granted.has(scope));
      return { sufficient: missing.length === 0, missing };
    },

    async discoverAccount(tokens): Promise<ProviderAccount> {
      const auth = { bearer: tokens.accessToken };
      const merchant = await call<{ merchant?: { id?: string; business_name?: string } }>("GET", "/v2/merchants/me", auth);
      const merchantId = id(merchant.merchant?.id);
      if (!merchantId) throw malformed("merchant");
      const listed = await call<{ locations?: SquareLocation[] }>("GET", "/v2/locations", auth);
      const locations = (listed.locations ?? [])
        .filter((location) => location.status === undefined || location.status === "ACTIVE")
        .flatMap((location) => {
          const locationId = id(location.id);
          if (!locationId) return [];
          return [{ externalLocationId: locationId, name: text(location.name) ?? "Square location", timezone: text(location.timezone, 64) }];
        });
      return { externalAccountId: merchantId, label: text(merchant.merchant?.business_name), locations };
    },

    async fetchVisits(ctx, workflow: WorkflowId, window: SyncWindow, rawCursor): Promise<Page<CanonicalVisitInput>> {
      const locations = ctx.locationIds ?? [];
      const cursor = decodeCursor(rawCursor);
      const locationId = locations[cursor.l];
      if (!locationId) return { items: [], next: null };
      const auth = { bearer: ctx.tokens.accessToken };
      const nextLocation = cursor.l + 1 < locations.length ? encodeCursor({ l: cursor.l + 1, s: null, c: null }) : null;

      if (workflow === "payments") {
        // By last change, oldest first, so a payment completed after it was
        // started is read again and the sync's high-water mark only moves forward.
        const body = await call<{ payments?: SquarePayment[]; cursor?: string }>("GET", "/v2/payments", auth, {
          query: {
            location_id: locationId,
            updated_at_begin_time: window.start.toISOString(),
            updated_at_end_time: window.end.toISOString(),
            sort_field: "UPDATED_AT",
            sort_order: "ASC",
            limit: "100",
            cursor: cursor.c,
          },
        });
        const items = (body.payments ?? []).map(paymentToVisit).filter((visit): visit is CanonicalVisitInput => visit !== null);
        const next = body.cursor ? encodeCursor({ l: cursor.l, s: null, c: body.cursor }) : nextLocation;
        return { items, next };
      }

      const start = cursor.s ?? window.start.getTime() - BOOKING_LOOKBACK_MS;
      const end = Math.min(start + BOOKING_CHUNK_MS, window.end.getTime());
      if (end <= start) return { items: [], next: nextLocation };
      const body = await call<{ bookings?: SquareBooking[]; cursor?: string }>("GET", "/v2/bookings", auth, {
        query: {
          location_id: locationId,
          start_at_min: new Date(start).toISOString(),
          start_at_max: new Date(end).toISOString(),
          cursor: cursor.c,
        },
      });
      const now = clock();
      const items = (body.bookings ?? [])
        .map((booking) => bookingToVisit(booking, now))
        .filter((visit): visit is CanonicalVisitInput => visit !== null);
      const next = body.cursor
        ? encodeCursor({ l: cursor.l, s: start, c: body.cursor })
        : end < window.end.getTime()
          ? encodeCursor({ l: cursor.l, s: end, c: null })
          : nextLocation;
      return { items, next };
    },

    async fetchCustomersByIds(ctx, externalIds) {
      const ids = [...new Set(externalIds)].filter((value) => ID_RE.test(value));
      const found: CanonicalCustomerInput[] = [];
      for (let offset = 0; offset < ids.length; offset += CUSTOMER_BATCH) {
        const body = await call<{ responses?: Record<string, { customer?: SquareCustomer }> }>(
          "POST",
          "/v2/customers/bulk-retrieve",
          { bearer: ctx.tokens.accessToken },
          { body: { customer_ids: ids.slice(offset, offset + CUSTOMER_BATCH) } },
        );
        // An id Square no longer knows comes back with errors and no customer.
        for (const entry of Object.values(body.responses ?? {})) {
          const mapped = entry?.customer ? squareCustomerToCanonical(entry.customer) : null;
          if (mapped) found.push(mapped);
        }
      }
      return found;
    },

    verifyWebhook({ rawBody, headers, url }) {
      const key = config.webhookSignatureKey;
      const presented = headers.get(SQUARE_SIGNATURE_HEADER);
      if (!key || !presented) return false;
      return secureCompare(presented, signSquareWebhook(url, rawBody, key));
    },

    parseWebhook(rawBody): ParsedEvent {
      const body = JSON.parse(rawBody) as {
        event_id?: unknown;
        merchant_id?: unknown;
        type?: unknown;
        created_at?: unknown;
        data?: { type?: unknown; id?: unknown; object?: Record<string, { version?: unknown } | undefined> };
      };
      if (typeof body.event_id !== "string" || !body.event_id || typeof body.type !== "string") {
        throw malformed("event");
      }
      const merchantId = id(body.merchant_id);
      if (!merchantId) throw malformed("merchant");
      const occurredAt = date(body.created_at);
      if (!occurredAt) throw malformed("time");

      const dataType = body.data?.type;
      const objectType =
        dataType === "payment" || dataType === "booking" || dataType === "customer"
          ? dataType
          : body.type.startsWith("oauth.authorization.")
            ? "authorization"
            : "other";
      const version =
        typeof dataType === "string" ? body.data?.object?.[dataType]?.version : undefined;
      return {
        providerEventId: body.event_id.slice(0, 200),
        externalAccountId: merchantId,
        type: body.type.slice(0, 100),
        objectType,
        objectId: id(body.data?.id),
        objectVersion: typeof version === "number" ? version : null,
        occurredAt,
        payloadVersion: PAYLOAD_VERSION,
      };
    },

    async resolveEvent(ctx, event): Promise<ResolvedEvent> {
      const none: ResolvedEvent = { customers: [], visits: [], revoked: false };
      if (event.objectType === "authorization") {
        return { ...none, revoked: event.type === "oauth.authorization.revoked" };
      }
      if (!event.objectId) return none;
      const auth = { bearer: ctx.tokens.accessToken };

      // The event only says what changed; the current object is read again so
      // a late or repeated delivery cannot write something stale.
      try {
        if (event.objectType === "customer") {
          const current = await customer(ctx, event.objectId);
          return { ...none, customers: current ? [current] : [] };
        }
        if (event.objectType === "payment") {
          const body = await call<{ payment?: SquarePayment }>("GET", `/v2/payments/${encodeURIComponent(event.objectId)}`, auth);
          const visit = body.payment ? paymentToVisit(body.payment) : null;
          if (!visit) return none;
          const owner = visit.customerExternalId ? await customer(ctx, visit.customerExternalId) : null;
          return { ...none, visits: [visit], customers: owner ? [owner] : [] };
        }
        if (event.objectType === "booking") {
          const body = await call<{ booking?: SquareBooking }>("GET", `/v2/bookings/${encodeURIComponent(event.objectId)}`, auth);
          const visit = body.booking ? bookingToVisit(body.booking, clock()) : null;
          if (!visit) return none;
          const owner = visit.customerExternalId ? await customer(ctx, visit.customerExternalId) : null;
          return { ...none, visits: [visit], customers: owner ? [owner] : [] };
        }
      } catch (caught) {
        if (caught instanceof ProviderError && caught.classification.reason === "not_found") return none;
        throw caught;
      }
      return none;
    },

    classifyError(error: unknown): ProviderErrorClass {
      if (error instanceof ProviderError) return error.classification;
      return { kind: "retryable", reason: "network" };
    },
  };
}
