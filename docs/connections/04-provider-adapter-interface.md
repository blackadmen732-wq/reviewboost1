# 4. Provider registry, adapter contract, and the connection record

**Status: PROPOSED.** Code sketches are TypeScript for
`frontend/lib/server/integrations/` and SQL for a migration revising PR #74.
They specify shape and invariants; they are not final code.

## 4.1 Layout

```
frontend/lib/server/integrations/
  registry.ts            provider registry (code, reviewed in diffs)
  types.ts               adapter contract, canonical DTOs, error classes
  connection-service.ts  lifecycle: authorize, callback, configure, test, activate, disconnect
  credentials.ts         encrypt/decrypt/refresh, the only reader of integration_credentials
  ingest.ts              inbox write + inline processing (doc 6)
  sync-runner.ts         backfill, incremental, manual, lease handling
  normalize.ts           shared field validation (phones via sms/phone.ts)
  providers/
    square/
      adapter.ts         implements ProviderAdapter
      oauth.ts           authorize URL, code exchange, refresh, revoke
      webhooks.ts        signature verification (Square SDK WebhooksHelper) and parsing
      mapping.ts         Square objects → canonical DTOs
      client.ts          fetch wrapper: Square-Version pin, timeouts, 429 handling
    fake/
      adapter.ts         deterministic adapter for tests and local dev (like FakeSmsProvider)
```

The customer pipeline from PR #74 (`lib/server/customers/`) stays the single
writer of canonical customers; integrations call it, they do not write
customer tables themselves.

## 4.2 Registry

```ts
export type ProviderId = "square" | "fake";          // grows only with real adapters

export type Capability =
  | "customers.import"          // initial + incremental customer pull
  | "visits.payments"           // completed payment with a customer → visit
  | "visits.appointments"       // booking whose time passed → visit
  | "events.webhook"            // provider pushes events
  | "sync.manual";              // owner can press Sync now

export interface ProviderDefinition {
  id: ProviderId;
  displayName: string;                     // "Square"
  categories: readonly ("pos" | "appointments")[];
  summary: string;                         // owner copy, plain language
  dataRead: readonly string[];             // owner copy: "Customer names and phone numbers", ...
  cannotDo: readonly string[];             // "Never changes anything in Square", ...
  direction: "import" | "import_and_events";
  availability: "available" | "in_setup" | "planned" | "unavailable";
  workflows: readonly WorkflowDefinition[];
  authKind: "oauth2_code" | "oauth2_pkce" | "api_key";
  requiredEnv: readonly string[];          // availability is downgraded if any is missing
  featureFlag?: string;                    // pilot gating
  helpUrl: string;
  privacyNote: string;
}

export interface WorkflowDefinition {
  id: "payments" | "appointments";
  label: string;
  scopes: readonly string[];               // exact provider scope strings
  scopeReasons: Record<string, string>;    // owner copy per scope
  capabilities: readonly Capability[];
  webhookEvents: readonly string[];        // e.g. ["customer.created", "customer.updated", "payment.updated"]
}
```

A provider with `availability: "planned"` has no adapter and no workflows; the
type allows only display fields for it.

## 4.3 Adapter contract

```ts
export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly apiVersion: string;                       // pinned, e.g. Square-Version date

  // Authentication and credential lifecycle
  buildAuthorizeUrl(input: { state: string; scopes: readonly string[]; redirectUri: string;
                             codeChallenge?: string }): URL;
  exchangeCode(input: { code: string; redirectUri: string; codeVerifier?: string }): Promise<TokenSet>;
  refresh(tokens: TokenSet): Promise<TokenSet>;      // must return the new refresh token if rotated
  revoke(tokens: TokenSet): Promise<void>;
  shouldRefresh(tokens: TokenSet, now: Date): boolean;

  // Permission and identity verification
  verifyGrant(tokens: TokenSet, requested: readonly string[]): Promise<GrantCheck>;
  discoverAccount(tokens: TokenSet): Promise<{ externalAccountId: string;
                                               locations: ProviderLocation[] }>;
  healthCheck(tokens: TokenSet): Promise<HealthResult>;

  // Synchronization
  fetchCustomers(ctx: SyncContext, cursor: Cursor | null): Promise<Page<CanonicalCustomerInput>>;
  fetchVisits(ctx: SyncContext, workflow: WorkflowId, cursor: Cursor | null): Promise<Page<CanonicalVisitInput>>;
  fetchCustomerById(ctx: SyncContext, externalId: string): Promise<CanonicalCustomerInput | null>;

  // Webhooks
  verifyWebhook(req: { rawBody: string; headers: Headers; url: string }): WebhookVerification;
  parseWebhook(rawBody: string): ParsedEvent;         // envelope only; no I/O
  resolveEvent(ctx: SyncContext, event: ParsedEvent): Promise<ResolvedEvent>; // may fetch the object

  // Errors
  classifyError(error: unknown): ProviderErrorClass;
}

export type ProviderErrorClass =
  | { kind: "retryable"; reason: "rate_limited" | "server_error" | "timeout" | "network";
      retryAfterMs?: number }
  | { kind: "auth"; reason: "token_expired" | "token_revoked" | "insufficient_scope" }
  | { kind: "permanent"; reason: "not_found" | "invalid_request" | "unsupported" | "location_gone" };

export interface Page<T> { items: T[]; next: Cursor | null; highWater?: string }
export type Cursor = { kind: "provider_token"; value: string } | { kind: "updated_at"; value: string };

export interface ParsedEvent {
  providerEventId: string;          // Square event_id
  externalAccountId: string;        // Square merchant_id
  type: string;                     // "payment.updated"
  objectType: "customer" | "payment" | "booking" | "authorization" | "other";
  objectId: string | null;
  objectVersion: number | null;     // Square object version when present
  occurredAt: Date;                 // event created_at
  payloadVersion: string;           // adapter-assigned, bumps when parsing changes
}
```

Rules every adapter follows:

- **No I/O in parsing.** `parseWebhook` only reads the body; it never decides
  tenancy. Tenancy comes from `externalAccountId` → `integration_connections`.
- **Fetch, don't trust the payload.** For `payment.updated` and
  `booking.updated`, `resolveEvent` re-reads the current object from the API
  with the connection's token. Webhook bodies are hints; the API is the record.
  This also makes out-of-order delivery harmless (doc 6 §6.5).
- **Map only canonical fields.** The mapper produces `CanonicalCustomerInput`
  and `CanonicalVisitInput` (doc 5). Unknown fields are dropped, not stored.
- **Classify every error.** The runner retries only `retryable`; `auth`
  drives `reauth_required`; `permanent` records an issue and moves on.
- **Pin the API version.** `client.ts` sends `Square-Version`. Bumping it is a
  reviewed change with sandbox tests (doc 14).

**Square specifics.** Code flow with `state` (see §4.6 on PKCE); refresh every
7 days or less; `discoverAccount` = `ListLocations` (returns `merchant_id`,
location ids, names, timezones); webhook verification through Square's SDK
helper with the exact configured notification URL and the raw body; 429 →
`retryable/rate_limited`; 401 → `auth`; 404 on a mapped location →
`permanent/location_gone`.

## 4.4 The connection record

One migration adds these tables. RLS on each; no client `INSERT`/`UPDATE`/
`DELETE`; reads restricted to `owner` and `admin` through
`app.has_org_role`. All writes go through `app.integration_*` SECURITY DEFINER
functions called by the service role from route handlers that have already
authenticated the user and resolved the org server-side.

```sql
create type public.integration_state as enum (
  'connecting', 'authorization_required', 'active', 'reauth_required',
  'unavailable', 'error', 'disconnecting', 'disconnected');

create type public.integration_health as enum ('healthy', 'warning');

create table public.integration_connections (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations (id) on delete cascade,
  provider_id           text not null check (provider_id ~ '^[a-z][a-z0-9_]{1,40}$'),
  workflow_id           text not null,
  external_account_id   text not null check (char_length(external_account_id) between 1 and 200),
  state                 public.integration_state not null,
  health                public.integration_health not null default 'healthy',
  granted_scopes        text[] not null default '{}',       -- what the provider actually granted
  permission_summary    text,                                -- owner-facing sentence, computed
  config_version        integer not null default 1,          -- bumps on every configuration change
  last_success_at       timestamptz,
  last_attempt_at       timestamptz,
  next_sync_at          timestamptz,
  last_error_code       text,                                -- from a fixed list, never provider text
  last_error_summary    text check (char_length(last_error_summary) <= 200),  -- safe, owner-readable
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  disconnected_at       timestamptz,
  unique (id, org_id)
);

-- One live connection per provider account across ALL orgs, so one Square
-- merchant cannot feed two businesses. Disconnected rows do not count.
create unique index integration_connections_one_live_account
  on public.integration_connections (provider_id, external_account_id)
  where state <> 'disconnected';

-- One live connection per org and provider in V1.
create unique index integration_connections_one_live_per_org
  on public.integration_connections (org_id, provider_id)
  where state <> 'disconnected';

create table public.integration_location_mappings (
  connection_id         uuid not null,
  org_id                uuid not null,
  external_location_id  text not null,
  location_id           uuid not null,
  external_timezone     text,
  created_at            timestamptz not null default now(),
  primary key (connection_id, external_location_id),
  unique (connection_id, location_id),
  foreign key (connection_id, org_id) references public.integration_connections (id, org_id) on delete cascade,
  foreign key (location_id, org_id) references public.locations (id, org_id) on delete cascade
);

create table public.integration_connection_events (   -- append-only lifecycle history
  id             bigint generated always as identity primary key,
  connection_id  uuid not null,
  org_id         uuid not null,
  from_state     public.integration_state,
  to_state       public.integration_state not null,
  reason_code    text not null,
  actor_user_id  uuid,                                 -- null for system
  config_version integer,
  created_at     timestamptz not null default now(),
  foreign key (connection_id, org_id) references public.integration_connections (id, org_id) on delete cascade
);
```

**Why each field.** `external_account_id` is the tenancy key for webhooks.
`granted_scopes` lets the UI show what was actually granted, not what was
asked for. `config_version` stamps every sync run and visit so a later reader
knows which mapping produced it. `last_error_code` comes from a fixed list so
the UI can translate it and nothing provider-supplied reaches an owner screen
or a log unfiltered. `location_id` is not on the connection because one Square
account can map to several ReviewBoost locations; the mapping table carries
that. Nothing about credentials is on this table.

## 4.5 Credentials

```sql
create table public.integration_credentials (
  connection_id        uuid primary key references public.integration_connections (id) on delete cascade,
  org_id               uuid not null,
  key_version          smallint not null,
  access_token_enc     text not null,      -- AES-256-GCM envelope
  refresh_token_enc    text,
  access_expires_at    timestamptz,
  refresh_expires_at   timestamptz,        -- null for Square code flow (non-expiring)
  token_obtained_at    timestamptz not null,
  last_refreshed_at    timestamptz,
  refresh_lock_until   timestamptz         -- single-flight refresh
);
alter table public.integration_credentials enable row level security;
revoke all on public.integration_credentials from public, anon, authenticated;
-- No policies at all. Only service_role (via credentials.ts) and definer functions touch it.
```

- **Key.** A new `INTEGRATION_CREDENTIAL_KEY` (32 bytes, base64), separate
  from `CUSTOMER_NOTE_ENCRYPTION_KEY`, so a leak of one does not expose the
  other, plus `INTEGRATION_CREDENTIAL_KEY_PREVIOUS` for rotation. The existing
  `crypto.ts` envelope is reused with the key version in the envelope.
- **Binding.** The GCM additional authenticated data is
  `connection_id || provider_id`, so a ciphertext copied onto another row fails
  to decrypt.
- **Rotation.** A maintenance task re-encrypts rows whose `key_version` is
  older, using the previous key to read. Rotation of the provider tokens
  themselves is Square's refresh.
- **Refresh.** `credentials.ts` takes `refresh_lock_until` with an atomic
  update (`where refresh_lock_until is null or < now()`), refreshes, writes the
  new pair in one statement, clears the lock. Two workers cannot both refresh,
  which matters for providers with single-use refresh tokens.
- **Never leaves the server.** Not in any API response, URL, log line,
  analytics event, error message, or browser storage. `logger.ts` redaction
  gains `access_token`, `refresh_token`, `code`, `client_secret` keys.

**Why not Supabase Vault.** The repository uses application-held keys and no
Vault today (`crypto.ts`, `ENVIRONMENT.md`). Introducing Vault for one table
would add a second secrets mechanism and a database-side decryption path
that RLS mistakes could expose. Revisit if the project adopts Vault generally.

## 4.6 OAuth state and PKCE

```sql
create table public.integration_oauth_states (
  state_digest       text primary key,          -- keyed HMAC of the random state
  org_id             uuid not null,
  user_id            uuid not null,
  provider_id        text not null,
  workflow_id        text not null,
  requested_scopes   text[] not null,
  code_verifier_enc  text,                       -- only for PKCE providers
  reconnect_connection_id uuid,
  expires_at         timestamptz not null,       -- now() + 10 minutes
  used_at            timestamptz
);
```

Square's code flow is for confidential clients: the code exchange requires the
client secret, which only the server holds, and its refresh tokens are
multi-use and non-expiring. Square's PKCE flow is designed for clients that
cannot keep a secret, and its refresh tokens are single-use and expire in 90
days, which adds a rotation failure mode without adding protection for a
server-side exchange. **Recommendation: Square code flow with `state`, exact
redirect URI, server-side exchange.** The table and adapter contract support
PKCE so a provider that requires it (or a public client such as the mobile app,
if it ever starts a connection) uses it. The mobile app does not start
connections in V1; it links to the web Settings page.

## 4.7 Tenant isolation guarantees

1. The org id on every write comes from `requireOwner()` (session), never the
   request body.
2. Every API route that takes a `connectionId` loads it through the user's RLS
   client first; a connection in another org returns 404, indistinguishable
   from "does not exist".
3. Webhooks find the connection by `(provider_id, external_account_id)`; the
   partial unique index guarantees at most one live match.
4. Every definer function re-checks `org_id` matches the connection's org,
   and composite foreign keys refuse cross-org links at the database level.
5. pgTAP proves each of these by attacking as the `authenticated` role with
   another org's JWT claims (doc 14).
