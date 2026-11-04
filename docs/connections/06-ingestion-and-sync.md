# 6. Event ingestion and synchronization

**Status: PROPOSED.**

## 6.1 Principles

- **PostgreSQL is the queue.** The integration inbox and sync runs use the same
  lease pattern as `sms_outbox` (`FOR UPDATE SKIP LOCKED`, lease owner, bounded
  attempts, dead letter). No Redis, no new job platform. `SYSTEM_CONTEXT.md`
  §8 says the job platform is an open decision requiring an ADR; this design
  does not settle it, it reuses what already exists and stays portable to
  whatever the ADR picks.
- **Durable before acknowledged.** A webhook gets its 2xx only after the event
  row is committed.
- **Fetch the object, don't trust the event.** Events say *something changed*;
  the adapter re-reads the current object (doc 4 §4.3).
- **Minimal data by construction.** ReviewBoost does not download a seller's
  whole customer directory. It imports customers **referenced by visits** in
  the backfill window and by later visit events, and applies `customer.*`
  updates only to customers it already holds.

## 6.2 Tables

```sql
create table public.integration_inbox (
  id                  uuid primary key default gen_random_uuid(),
  provider_id         text not null,
  provider_event_id   text not null,          -- Square event_id
  external_account_id text not null,          -- Square merchant_id
  connection_id       uuid,                   -- resolved at receipt; null if no live connection
  org_id              uuid,
  event_type          text not null,
  object_type         text,
  object_id           text,
  object_version      bigint,
  occurred_at         timestamptz not null,
  received_at         timestamptz not null default now(),
  payload_version     text not null,
  body_encrypted      text,                   -- raw body, encrypted; kept 7 days for replay, then nulled
  status              text not null default 'pending'
                       check (status in ('pending','processing','processed','skipped','failed','dead_letter')),
  attempts            smallint not null default 0,
  max_attempts        smallint not null default 8,
  lease_owner         uuid,
  lease_expires_at    timestamptz,
  next_attempt_at     timestamptz not null default now(),
  outcome_code        text,                   -- fixed list
  processed_at        timestamptz,
  unique (provider_id, provider_event_id)
);

create table public.integration_sync_runs (
  id               uuid primary key default gen_random_uuid(),
  connection_id    uuid not null, org_id uuid not null,
  kind             text not null check (kind in ('test','backfill','incremental','manual','reconcile')),
  stream           text not null check (stream in ('customers','payments','bookings')),
  status           text not null check (status in ('queued','running','succeeded','partial','failed','cancelled')),
  config_version   integer not null,
  idempotency_key  text not null,             -- e.g. 'backfill:{connection}:{config_version}:{stream}'
  window_start     timestamptz, window_end timestamptz,
  cursor_at_start  text, cursor_at_end text,
  counts           jsonb not null default '{}',  -- fetched, created, updated, unchanged, stale, skipped, invalid
  lease_owner uuid, lease_expires_at timestamptz,
  attempts smallint not null default 0,
  error_code text,
  started_at timestamptz, finished_at timestamptz, created_at timestamptz not null default now(),
  unique (connection_id, idempotency_key)
);

create table public.integration_sync_checkpoints (
  connection_id  uuid not null, org_id uuid not null,
  stream         text not null,
  cursor         text,                        -- provider page token, only mid-run
  high_water     timestamptz,                 -- last fully-applied source updated_at
  updated_at     timestamptz not null default now(),
  primary key (connection_id, stream)
);

create table public.integration_record_issues (  -- the owner's "could not be processed" list
  id             uuid primary key default gen_random_uuid(),
  connection_id  uuid not null, org_id uuid not null,
  run_id         uuid, inbox_id uuid,
  object_type    text not null, external_id text not null,
  issue_code     text not null,               -- no_phone, invalid_phone, no_customer, location_not_mapped, ...
  display_hint   text,                        -- e.g. "Ana R. · •••• 4821", never a full number
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  resolved_at    timestamptz,
  unique (connection_id, object_type, external_id, issue_code)
);
```

RLS: owners and admins read runs, checkpoints (no cursor column exposed) and
issues for their org. `integration_inbox` has no client policy at all.

## 6.3 The webhook path

```
POST /api/v1/webhooks/integrations/square
 1. Read the raw body (size cap 256 KB) before any JSON parsing.
 2. Verify x-square-hmacsha256-signature with the SDK helper, the exact
    configured notification URL, and the raw body. Constant-time compare.
    Failure → 403, logged with a hash of the body, nothing stored under the
    real event id (same rule as the SMS inbox: an unverified request must not
    occupy a real event's dedupe key).
 3. Parse the envelope (event_id, merchant_id, type, created_at, object id/version).
 4. Resolve the live connection by (provider, merchant_id). None → store with
    status 'skipped', outcome 'no_live_connection', return 200.
 5. INSERT … ON CONFLICT (provider_id, provider_event_id) DO NOTHING.
    Duplicate of a processed event → 200, no work.
    Duplicate of an unprocessed one → 200; the existing row will be processed.
 6. COMMIT. Only now return 200.
 7. After the response, process this row inline with a time budget
    (Next.js after()/waitUntil, verified for the deployed runtime in Phase 2).
    Anything not finished is picked up by the worker.
```

If the database is unavailable at step 5, the handler returns 503 and Square
retries. The acknowledgement is never sent for an event that is not durable.

## 6.4 Processing one event

```
claim (lease)                         → status processing
connection not active                 → hold (next_attempt_at = +1h) or skip if disconnected
adapter.resolveEvent (API re-fetch)   → retryable error: backoff; auth error: connection → reauth_required, hold
map → canonical input                 → validation failure: issue row, status processed (outcome 'rejected')
apply through the customer pipeline   → newer-wins guard (doc 5 §5.6), idempotent upserts
update connection health + counters
status processed, outcome code
```

Every write in "apply" is inside one transaction per event: the visit, the
profile, the contact, the issue rows, and the inbox status. A crash mid-way
leaves the lease to expire and the event to be reclaimed; the upserts make the
replay a no-op.

**Backoff.** `next_attempt_at = now() + min(2^attempts × 30 s, 6 h) ± 20%
jitter`; a provider `Retry-After` wins if longer. After `max_attempts` (8,
roughly a day) → `dead_letter`.

**Dead letters are recoverable.** They stay in the table with their encrypted
body for 7 days and their envelope for 90. An operator action
(`rpc_integration_retry_dead_letters(connection_id)`) resets them to pending.
A reconcile run (§6.7) re-reads the affected objects anyway, so a dead letter
delays data, it does not lose it.

## 6.5 Idempotency rules

| What | Key | Guarantees |
|---|---|---|
| Inbox event | `(provider_id, provider_event_id)` | A redelivered webhook is stored once |
| Source profile | `(connection_id, external_id)` | A customer is created once per source |
| Contact | `(org_id, phone_hash)` | One reachable contact per number |
| Visit | `(connection_id, kind, external_id)` | A payment or booking is one visit, ever |
| Sync run | `(connection_id, idempotency_key)` | Pressing Sync twice starts one run |
| Text Request from a visit (V1 manual) | existing `(org_id, dedupe_key)`, key derived from `visit_id` | One review request per visit, even with double clicks |
| Credit grant | existing `(org_id, origin_kind, origin_id)` | Untouched by this design |

Nothing in the ingestion path creates a message, reserves credit, or grants
credit. Those remain exclusively in Text Requests and billing.

**Out of order.** Handled by re-fetch plus the newer-wins guard. A
`booking.updated` that arrives before `booking.created` simply creates the
visit at its current state; the late `created` is stale and does nothing.

**Late updates.** A payment refunded or a booking marked `NO_SHOW` days later
updates the visit's status; an already-sent request is not affected.

## 6.6 Initial sync (backfill)

Started on activation, one run per stream, resumable:

1. **Visits first**, for a window of the last 30 days (D-6.1): payments
   (`ListPayments` with a begin time) or bookings (`ListBookings` in bounded
   date windows, as Square limits the range; *verify in sandbox*). Each page is
   applied and then the checkpoint's `cursor` is saved, in the same
   transaction.
2. **Customers referenced by those visits**, fetched by id in batches
   (`BatchRetrieveCustomers`). Customers never referenced are never fetched.
3. When a stream finishes, its `high_water` becomes the max source
   `updated_at` applied and `cursor` is cleared.

**Interruption.** A run whose lease expires is reclaimed and resumes from the
saved cursor. If the provider rejects an old cursor, the run restarts that
stream's window from `high_water` (or the window start), which is safe because
every upsert is idempotent.

**Large accounts.** Each worker invocation processes pages until a time budget
(for example 45 s on Vercel) and yields; the next tick continues. The owner
sees "Bringing in your last 30 days… 1,240 visits so far".

## 6.7 Incremental sync

- **Webhooks** are the primary path.
- **Reconcile polling** catches what webhooks missed: for each active
  connection, every 6 hours on the production cadence (once a day on the
  current Hobby cadence, F-6), list objects updated since `high_water − 15
  minutes` (overlap absorbs clock skew and in-flight writes). Payments and
  bookings only; customer changes are picked up when a visit references them
  or via `customer.updated` for held customers.
- **Manual sync** (`Sync now`) queues a reconcile run immediately; limited to
  once per 5 minutes per connection.
- **Never a full re-download** while a valid `high_water` exists.

## 6.8 Failure handling

| Condition | Behaviour | Owner sees |
|---|---|---|
| 429 rate limited | Back off per `Retry-After` or exponential; run stays `running` | Nothing unless it lasts > 1 h ("Square is slowing us down; we'll keep going") |
| 5xx / timeouts | Retry with backoff; after 15 min of consecutive failures → `unavailable` | "Square isn't responding. We'll keep trying." |
| 401 / revoked | Try one refresh; if it fails → `reauth_required`, stop polling, hold events | "Sign in to Square again" |
| Mapped location deleted | `permanent/location_gone` → issue + health `warning`, or `error` if no mapped locations remain | "A Square location you connected no longer exists" |
| Invalid record | Issue row, skipped, run continues → `partial` | Listed under "Couldn't bring in" |
| Webhook signature failures spike | Alert (doc 14); no state change (could be an attacker, not Square) | Nothing |

## 6.9 Health

After every run or processed event: `last_attempt_at`, `last_success_at`,
`next_sync_at`, health (doc 3 §3.2). The worker also flags **stalled**
connections: active, webhooks expected, no event and no successful reconcile in
24 hours.

## 6.10 Worker

`POST /api/v1/internal/integrations/process` (worker secret, like the existing
`/internal/*` routes), idempotent, each call bounded by a time budget:

1. Claim and process due inbox rows.
2. Claim and advance due sync runs.
3. Refresh tokens whose `last_refreshed_at` is older than 6 days.
4. Enqueue reconcile runs whose `next_sync_at` has passed.
5. Advance `disconnecting` connections; abandon stale `connecting` ones.
6. Purge per retention (doc 5 §5.8).

It is added to the same cron set as `sms/dispatch` and `maintenance`
(`docs/SCHEDULING.md`) and the PR #67 worker heartbeat, once merged.
