import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import { secureCompare } from "@/lib/server/crypto";
import { publicFrontendUrl } from "@/lib/server/env";
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
  type VisitKind,
  type WorkflowId,
} from "@/lib/server/integrations/types";

/**
 * A pretend provider, deterministic and offline, the way `FakeSmsProvider`
 * stands in for Twilio. It exercises every path the real adapters will:
 * authorization (through a consent page inside ReviewBoost), account and
 * location discovery, paged visit reads, customers by id, signed webhooks,
 * and the error classes. Nothing it returns is a real person.
 *
 * The account an owner "signs in" as is chosen on the consent page and
 * carried in the code. A few account names misbehave on purpose:
 *
 *   DOWN     — every read fails as a provider outage (retryable)
 *   REVOKED  — every read fails as revoked access (auth)
 *   PARTIAL  — grants one permission fewer than asked
 */

const API_VERSION = "fake-2026-10-01";
const PAYLOAD_VERSION = `${API_VERSION}.v1`;
const PAGE_SIZE = 4;
const ACCOUNT_RE = /^[A-Z0-9_-]{1,40}$/;
const CODE_RE = /^fake_([A-Z0-9_-]{1,40})$/;
const TOKEN_RE = /^fake(?:at|rt)\.([A-Z0-9_-]{1,40})\.[A-Za-z0-9_-]{16,64}$/;

export const FAKE_SIGNATURE_HEADER = "x-fake-signature";

interface FakeCustomer {
  id: string;
  name: string | null;
  phone: string | null;
}

interface FakeVisit {
  id: string;
  customerId: string | null;
  locationId: string;
  /** Hours before the start of today, UTC. */
  hoursAgo: number;
  noShow?: boolean;
}

// Fictional numbers only: 555-0100 to 555-0199 are reserved for fiction.
const CUSTOMERS: readonly FakeCustomer[] = [
  { id: "C1", name: "Ana Ruiz", phone: "+12025550101" },
  { id: "C2", name: "Ben Okafor", phone: "+1 (202) 555-0102" },
  { id: "C3", name: "Cleo Martin", phone: "12345" },
  { id: "C4", name: "Dee Park", phone: null },
  { id: "C5", name: "Eli Stone", phone: "+12025550105" },
  { id: "C6", name: "A. Ruiz", phone: "+12025550101" },
];

const VISITS: readonly FakeVisit[] = [
  { id: "1", customerId: "C1", locationId: "L1", hoursAgo: -2 },
  { id: "2", customerId: "C2", locationId: "L1", hoursAgo: 24 },
  { id: "3", customerId: null, locationId: "L2", hoursAgo: 27 },
  { id: "4", customerId: "C3", locationId: "L2", hoursAgo: 48 },
  { id: "5", customerId: "C4", locationId: "L1", hoursAgo: 72 },
  { id: "6", customerId: "C5", locationId: "L2", hoursAgo: 120, noShow: true },
  { id: "7", customerId: "C6", locationId: "L1", hoursAgo: 144 },
  { id: "8", customerId: "C1", locationId: "L1", hoursAgo: 240 },
  { id: "9", customerId: "C2", locationId: "L2", hoursAgo: 480 },
  { id: "10", customerId: "C5", locationId: "L1", hoursAgo: 960 },
];

function startOfTodayUtc(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function accountFromToken(token: string): string {
  const match = TOKEN_RE.exec(token);
  if (!match?.[1]) throw new ProviderError({ kind: "auth", reason: "token_revoked" });
  return match[1];
}

function misbehave(account: string): void {
  if (account === "DOWN") throw new ProviderError({ kind: "retryable", reason: "server_error" });
  if (account === "REVOKED") throw new ProviderError({ kind: "auth", reason: "token_revoked" });
}

function randomPart(): string {
  return randomBytes(18).toString("base64url");
}

function visitKindFor(workflow: WorkflowId): VisitKind {
  return workflow === "appointments" ? "appointment" : "payment";
}

function toVisit(visit: FakeVisit, kind: VisitKind, now: Date): CanonicalVisitInput {
  const occurredAt = new Date(startOfTodayUtc(now) - visit.hoursAgo * 3_600_000);
  const status =
    kind === "payment"
      ? "completed"
      : visit.noShow
        ? "no_show"
        : occurredAt.getTime() <= now.getTime()
          ? "appointment_time_passed"
          : "pending";
  return {
    externalId: `${kind === "payment" ? "P" : "B"}${visit.id}`,
    kind,
    status,
    customerExternalId: visit.customerId,
    externalLocationId: visit.locationId,
    occurredAt,
    sourceUpdatedAt: new Date(occurredAt.getTime() + 5 * 60_000),
    sourceVersion: 1,
  };
}

function toCustomer(customer: FakeCustomer, now: Date): CanonicalCustomerInput {
  const created = new Date(startOfTodayUtc(now) - 90 * 86_400_000);
  return {
    externalId: customer.id,
    name: customer.name,
    phone: customer.phone,
    sourceCreatedAt: created,
    sourceUpdatedAt: created,
    sourceVersion: 1,
  };
}

function webhookKey(): string | null {
  const raw = process.env.FAKE_PROVIDER_WEBHOOK_KEY?.trim();
  return raw ? raw : null;
}

/** The signature the fake provider puts on a webhook: HMAC over URL and raw body. */
export function signFakeWebhook(url: string, rawBody: string, key: string): string {
  return createHmac("sha256", key).update(url + rawBody).digest("base64");
}

export function createFakeAdapter(clock: () => Date = () => new Date()): ProviderAdapter {
  return {
    id: "fake",
    apiVersion: API_VERSION,

    buildAuthorizeUrl({ state, scopes, redirectUri }) {
      const url = new URL("/settings/connections/fake/consent", publicFrontendUrl());
      url.searchParams.set("state", state);
      url.searchParams.set("scope", scopes.join(" "));
      url.searchParams.set("redirect_uri", redirectUri);
      return url;
    },

    async exchangeCode({ code, requestedScopes }) {
      const match = CODE_RE.exec(code);
      if (!match?.[1]) throw new ProviderError({ kind: "permanent", reason: "invalid_request" }, "Unknown code.");
      const account = match[1];
      const granted = account === "PARTIAL" ? requestedScopes.slice(0, -1) : [...requestedScopes];
      const now = clock();
      return {
        accessToken: `fakeat.${account}.${randomPart()}`,
        refreshToken: `fakert.${account}.${randomPart()}`,
        accessExpiresAt: new Date(now.getTime() + 30 * 86_400_000),
        refreshExpiresAt: null,
        grantedScopes: granted,
      };
    },

    async refresh(tokens) {
      const account = accountFromToken(tokens.refreshToken ?? "");
      if (account === "REVOKED") throw new ProviderError({ kind: "auth", reason: "token_revoked" });
      return {
        ...tokens,
        accessToken: `fakeat.${account}.${randomPart()}`,
        accessExpiresAt: new Date(clock().getTime() + 30 * 86_400_000),
      };
    },

    async revoke(tokens) {
      accountFromToken(tokens.accessToken);
    },

    shouldRefresh(tokens, lastRefreshedAt, now) {
      if (tokens.accessExpiresAt && tokens.accessExpiresAt.getTime() - now.getTime() < 7 * 86_400_000) return true;
      const since = lastRefreshedAt ?? null;
      return since !== null && now.getTime() - since.getTime() > 6 * 86_400_000;
    },

    verifyGrant(tokens, requested): GrantCheck {
      const granted = new Set(tokens.grantedScopes);
      const missing = requested.filter((scope) => !granted.has(scope));
      return { sufficient: missing.length === 0, missing };
    },

    async discoverAccount(tokens): Promise<ProviderAccount> {
      const account = accountFromToken(tokens.accessToken);
      misbehave(account);
      return {
        externalAccountId: account,
        label: `Demo business ${account.toLowerCase()}`,
        locations: [
          { externalLocationId: "L1", name: "Main Street", timezone: "America/Chicago" },
          { externalLocationId: "L2", name: "Riverside", timezone: "America/Chicago" },
        ],
      };
    },

    async fetchVisits(ctx: SyncContext, workflow: WorkflowId, window: SyncWindow, cursor: string | null): Promise<Page<CanonicalVisitInput>> {
      const account = accountFromToken(ctx.tokens.accessToken);
      misbehave(account);
      const now = clock();
      const kind = visitKindFor(workflow);
      const inWindow = VISITS.map((visit) => toVisit(visit, kind, now)).filter(
        (visit) => visit.occurredAt >= window.start && visit.occurredAt <= window.end,
      );
      const offset = cursor ? Number(cursor) : 0;
      if (!Number.isInteger(offset) || offset < 0) {
        throw new ProviderError({ kind: "permanent", reason: "invalid_request" }, "Bad cursor.");
      }
      const items = inWindow.slice(offset, offset + PAGE_SIZE);
      const next = offset + PAGE_SIZE < inWindow.length ? String(offset + PAGE_SIZE) : null;
      return { items, next };
    },

    async fetchCustomersByIds(ctx, externalIds) {
      const account = accountFromToken(ctx.tokens.accessToken);
      misbehave(account);
      const now = clock();
      const wanted = new Set(externalIds);
      return CUSTOMERS.filter((customer) => wanted.has(customer.id)).map((customer) => toCustomer(customer, now));
    },

    verifyWebhook({ rawBody, headers, url }) {
      const key = webhookKey();
      const presented = headers.get(FAKE_SIGNATURE_HEADER);
      if (!key || !presented) return false;
      return secureCompare(presented, signFakeWebhook(url, rawBody, key));
    },

    parseWebhook(rawBody): ParsedEvent {
      const body = JSON.parse(rawBody) as {
        event_id?: unknown;
        merchant_id?: unknown;
        type?: unknown;
        created_at?: unknown;
        data?: { type?: unknown; id?: unknown; version?: unknown };
      };
      if (typeof body.event_id !== "string" || typeof body.merchant_id !== "string" || typeof body.type !== "string") {
        throw new ProviderError({ kind: "permanent", reason: "invalid_request" }, "Malformed event.");
      }
      if (!ACCOUNT_RE.test(body.merchant_id)) {
        throw new ProviderError({ kind: "permanent", reason: "invalid_request" }, "Malformed account.");
      }
      const occurredAt = typeof body.created_at === "string" ? new Date(body.created_at) : new Date(NaN);
      if (Number.isNaN(occurredAt.getTime())) {
        throw new ProviderError({ kind: "permanent", reason: "invalid_request" }, "Malformed time.");
      }
      const dataType = body.data?.type;
      const objectType =
        dataType === "payment" || dataType === "booking" || dataType === "customer"
          ? dataType
          : body.type.startsWith("oauth.")
            ? "authorization"
            : "other";
      return {
        providerEventId: body.event_id.slice(0, 200),
        externalAccountId: body.merchant_id,
        type: body.type.slice(0, 100),
        objectType,
        objectId: typeof body.data?.id === "string" ? body.data.id.slice(0, 200) : null,
        objectVersion: typeof body.data?.version === "number" ? body.data.version : null,
        occurredAt,
        payloadVersion: PAYLOAD_VERSION,
      };
    },

    async resolveEvent(ctx, event): Promise<ResolvedEvent> {
      if (event.objectType === "authorization") return { customers: [], visits: [], revoked: true };

      const account = accountFromToken(ctx.tokens.accessToken);
      misbehave(account);
      const now = clock();

      if (event.objectType === "customer") {
        const customer = CUSTOMERS.find((c) => c.id === event.objectId);
        return { customers: customer ? [toCustomer(customer, now)] : [], visits: [], revoked: false };
      }

      if (event.objectType === "payment" || event.objectType === "booking") {
        const kind: VisitKind = event.objectType === "payment" ? "payment" : "appointment";
        const visit = VISITS.find((v) => `${kind === "payment" ? "P" : "B"}${v.id}` === event.objectId);
        if (!visit) return { customers: [], visits: [], revoked: false };
        const customer = CUSTOMERS.find((c) => c.id === visit.customerId);
        return {
          customers: customer ? [toCustomer(customer, now)] : [],
          visits: [toVisit(visit, kind, now)],
          revoked: false,
        };
      }

      return { customers: [], visits: [], revoked: false };
    },

    classifyError(error: unknown): ProviderErrorClass {
      if (error instanceof ProviderError) return error.classification;
      return { kind: "retryable", reason: "network" };
    },
  };
}
