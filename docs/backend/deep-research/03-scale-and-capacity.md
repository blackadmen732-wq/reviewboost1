# Scale and capacity — 15,000 to 20,000 businesses

**Verdict.** A single Supabase Postgres can carry 15,000–20,000 ReviewBoost business owners as a tenant directory. It cannot carry them with the **current owner-dashboard query shape** once even one tenant accumulates a few tens of thousands of responses. On this machine, listing 26 inbox rows for a hot org of 28,800 responses took **180 ms p50 as `authenticated` (RLS on) versus 7.4 ms as `service_role` (RLS bypassed)** — a **24×** tax — because `Filter: app.is_org_member(org_id)` ran once per row and touched 88,656 buffers instead of 1,933. An exact `COUNT(*)` on that org was **50×** slower (172 ms vs 3.4 ms). An authenticated `COUNT(*)` with **no** `org_id` predicate seq-scanned the whole 4.2 million-row table for **24.8 seconds**. Those are today’s queries in `frontend/lib/server/owner-data.ts`, not a 36-month fantasy. The Text Requests claim path (`FOR UPDATE SKIP LOCKED`) is **not** the first thing to break: it held an index scan at a 500,000-row pending backlog and delivered **1,200 claims/s** on one worker and **4,149 claims/s** with four concurrent claimers. What must change first is RLS evaluation plus tenant-scoped time-order indexes and the dashboard’s exact-count habit; then partitioning/archiving of append-only event tables; then an actual multi-worker dispatch farm in front of Twilio, not a faster `sms_outbox` claim query.

Every timing, plan, and byte count below is labelled **measured** (taken on `scale_bench` on 2026-09-08) or **estimated** (demand model × measured bytes/row, or vendor documentation). This host is not a hosted Supabase XL: PostgreSQL 17.6, 4 vCPUs, 15 GiB RAM, `shared_buffers` 128 MB, `work_mem` 4 MB, `max_connections` 100. Hosted numbers will be better on cache and worse on network. They will not change the per-row RLS shape.

## Method

### Environment (measured)

| Item | Value |
|---|---|
| Postgres | 17.6 (`supabase/postgres:17.6.1.167` container `supabase_db_reviewboost`) |
| Host | 4 vCPU (`nproc`), 15 GiB RAM, 254 GiB disk (~13 GiB used by `scale_bench`) |
| `shared_buffers` | 128 MB |
| `effective_cache_size` | 128 MB |
| `work_mem` | 4 MB |
| `maintenance_work_mem` | 64 MB default; 2 GB during load |
| `max_connections` | 100 |
| `jit` | on globally; off in measurement sessions |
| `autovacuum` | on, `vacuum_scale_factor` 0.2, 3 workers |
| Other agents | the `postgres` database on this instance was left untouched |

Application reads that matter live in `frontend/lib/server/owner-data.ts`, `frontend/lib/server/owner-service.ts`, `frontend/lib/server/auth.ts`, and `frontend/lib/server/sms/dispatch.ts`. Owner pages and `/api/v1/*` owner routes use the caller’s JWT (`authenticated`, RLS on). The public tap flow and SMS worker use `service_role`. Neither uses a direct `pg` pool from Node; they speak HTTP to PostgREST.

### Benchmark database

Created `scale_bench` on the same instance (`postgresql://postgres:postgres@127.0.0.1:54322/scale_bench`). The `postgres` database was not written.

`CREATE DATABASE scale_bench` produced a database whose `public`/`app` schema already matched the migrated `postgres` database: 51 `app.*` functions, 53 `public.rpc_*` functions, the same RLS policies, and the same indexes as the 43 files in `supabase/migrations/`. Tenant row counts were zero (`postgres` had two seed organisations and zero `auth.users`). Cluster-wide roles (`anon`, `authenticated`, `service_role`, `supabase_auth_admin`, …), the `auth` schema, `auth.uid()` / `auth.role()` / `auth.jwt()`, and extensions `pgcrypto`, `uuid-ossp`, `pg_stat_statements` were already present. The 43 migration files were therefore **not re-applied** (they would have failed on existing types/tables). Schema equality was checked by `\d` on `review_stands` / `customer_responses` / SMS tables and by function counts, not by a `pg_dump` diff.

`service_role` table grants that exist on hosted/local `postgres` (`GRANT ALL` on `public` tables) were missing on `scale_bench` and were added so “RLS bypassed” measurements could actually `SELECT`. That matches hosted Supabase, where `service_role` is `BYPASSRLS` **and** has table privileges.

Scripts (not in the repo): `/tmp/scale_bench_01_tenants.sql`, `_02_events.sql`, `_03_sms.sql`, `_04_indexes.sql`, `_05a`–`_05e` measurement SQL, `/tmp/scale_bench_06_concurrent.sh`. Load used `generate_series` only; `synchronous_commit = off` during load; secondary (non-unique) indexes dropped then recreated.

### Data-model assumptions (justified)

The physical product is a stand that a fraction of departing customers tap. Volume is heavy-tailed: a dinner-rush restaurant is not a dental office.

**Tenant graph (loaded in full, measured):** 20,000 organisations, 26,000 locations (1.3 per org: 14,000 with one location, 6,000 with two), 65,000 stands (2.5 per location), 20,000 owner users, 20,000 memberships, 60,000 staff (three per org).

**Event rates used for the loaded sample** (not the same as the 36-month *model* in the next section — the sample is compressed so the 4.2 million-row tables still fit this disk):

| Tier | Orgs | History loaded | Responses/month | SMS/month |
|---|---|---|---|---|
| hot | 40 | 36 months | 800 | 250 |
| busy | 160 | 36 months | 250 | 100 |
| modest | 800 | 12 months | 80 | 40 |
| quiet | 19,000 | 3 months | 15 | 8 |

That yields **4,215,000** responses and **1,776,000** text requests **measured**. Ratings are 40% five-star, 30% four, then 3/2/1; ~30% of responses carry a 163-byte dummy ciphertext (AES-GCM lookalike `v1:iv:tag:…`); 10% unread; ~14% unresolved; 40% have a Google-click row; ~8% have praise. SMS: most rows `delivered`, 5% suppressed, ~6% failed; one consent event + projection row per request; quota ledger ≈ allocation + reservation + consumption.

The **36-month fleet model** used for capacity (estimated row counts) is more aggressive on the head, as the user asked — modest tenants at a few hundred responses/month, busy at a few thousand — and gives the quiet 70% a thin 40/month rather than a uniform average (Postgres pain is hot tenants **and** total table size):

| Tier | Orgs | Responses/month | SMS/month |
|---|---|---|---|
| hot | 100 | 2,500 | 250 |
| busy | 900 | 600 | 100 |
| modest | 5,000 | 200 | 40 |
| quiet | 14,000 | 40 | 8 |

Sessions are modelled 1:1 with responses (every stored rating has a session). Real scan-to-rate conversion below 100% would make `public_review_sessions` **larger** than `customer_responses`; treat session counts as a lower bound.

Dummy ciphertext is compressible. Real AES-256-GCM is not. TOAST conclusions are therefore estimated for long notes; typical notes at 163 bytes were **measured** inline.

## Data-volume model

### Loaded sample — measured sizes

`pg_database_size('scale_bench')` = **13 GB** (13,554,445,459 bytes) after load and index rebuild. Toast relations on the large tables were 8 kB empty shells: typical `note_encrypted` **measured** `pg_column_size` = 163 bytes (inline). An 8 kB run of the letter `B` still compressed inline — it is **not** a measurement of GCM ciphertext.

| Table | Rows (measured) | Heap | Indexes | Total | Bytes/row total (measured) |
|---|---|---|---|---|---|
| `customer_responses` | 4,215,000 | 1,156 MB | 1,351 MB | 2,508 MB | 624 |
| `public_review_sessions` | 4,215,000 | 998 MB | 1,350 MB | 2,348 MB | 584 |
| `text_requests` | 1,776,000 | 1,156 MB | 723 MB | 1,879 MB | 1,110 |
| `sms_quota_ledger` | 3,309,000 | 527 MB | 706 MB | 1,232 MB | 390 |
| `sms_consent_events` | 1,776,000 | 631 MB | 349 MB | 980 MB | 578 |
| `sms_webhook_inbox` | 1,598,000 | 595 MB | 219 MB | 813 MB | 534 |
| `sms_consent_state` | 1,776,000 | 555 MB | 208 MB | 763 MB | 451 |
| `sms_delivery_attempts` | 1,691,000 | 307 MB | 389 MB | 696 MB | 432 |
| `sms_outbox` | 2,276,000 (500,000 pending) | 394 MB | 274 MB | 668 MB | 308 |
| `google_review_clicks` | 1,686,000 | 176 MB | 231 MB | 406 MB | 253 |
| `team_praise_records` | 337,000 | 155 MB | 61 MB | 216 MB | 673 |
| `review_stands` | 65,000 | 23 MB | 16 MB | 39 MB | 636 |
| `staff_members` | 60,000 | 15 MB | 8 MB | 23 MB | 396 |
| `locations` | 26,000 | 4 MB | 4 MB | 8 MB | 316 |
| `organization_members` | 20,000 | 2 MB | 3 MB | 6 MB | 285 |
| `organizations` | 20,000 | 2.4 MB | 1.8 MB | 4.3 MB | 222 |

Indexes already exceed heap on `customer_responses`, `public_review_sessions`, and `sms_quota_ledger`. That ratio will follow the fleet up.

Time windows **inside the loaded sample** (measured counts, not the 20k×36-month model):

| | Last 1 month | Last 12 months | Last 36 months / all loaded |
|---|---|---|---|
| `customer_responses` | 443,920 | 2,489,320 | 4,215,000 |
| `text_requests` | 210,000 | 1,152,000 | 1,776,000 |

### Full-fleet model — estimated row counts and disk

Row counts below are **estimated** from the rate table. Disk is **estimated** as `modelled_rows × measured_bytes_per_row` from the loaded sample (heap + indexes **before** the extra `(org_id, submitted_at, id)` index, which added ~237 MB on this sample and would add on the order of **4–5 GB estimated** at 85M rows).

**Month 1** responses = 100×2,500 + 900×600 + 5,000×200 + 14,000×40 = **2,350,000**. SMS = 100×250 + 900×100 + 5,000×40 + 14,000×8 = **427,000**.

**Month 12** = 12× those flows (append-only). **Month 36** = 36×.

| Table | M1 rows (est.) | M12 rows (est.) | M36 rows (est.) | M36 disk (est.) |
|---|---|---|---|---|
| `organizations` / members / profiles | 20,000 | 20,000 | 20,000 | ~6 MB |
| `locations` | 26,000 | 26,000 | 26,000 | ~8 MB |
| `review_stands` | 65,000 | 65,000 | 65,000 | ~39 MB |
| `customer_responses` | 2.35M | 28.2M | 84.6M | ~53 GB |
| `public_review_sessions` | 2.35M | 28.2M | 84.6M | ~49 GB |
| `google_review_clicks` | 0.94M | 11.3M | 33.8M | ~8 GB |
| `team_praise_records` | 0.19M | 2.3M | 6.8M | ~4.6 GB |
| `text_requests` | 0.43M | 5.1M | 15.4M | ~17 GB |
| `sms_outbox` (1 per request, mostly `done`) | 0.43M | 5.1M | 15.4M | ~5 GB |
| `sms_delivery_attempts` | ~0.41M | 4.9M | 14.6M | ~6 GB |
| `sms_consent_events` + `sms_consent_state` | ~0.43M each | 5.1M | 15.4M | ~16 GB together |
| `sms_quota_ledger` | ~0.9M | 10.7M | 32.3M | ~13 GB |
| `sms_webhook_inbox` | ~0.4M | 4.9M | 14.6M | ~8 GB |

**Estimated database size at 36 months:** on the order of **180–220 GB** for these tables plus WAL, `auth.users`, bloat, and the extra indexes this study says to add. Round to **~200 GB** for restore/PITR discussion. That is **estimated**, not measured. The loaded 13 GB is the only measured size.

A uniform “average 200 responses/month × 20,000 × 36” (= 144M responses) would be ~90 GB for `customer_responses` alone. The long-tail model is smaller; a more successful product is larger. Plan disks for **200–400 GB** at this tenant count.

## Measured results

Hot org used for owner queries: tenant `n=1`, **28,800** responses over 36 months (800/month). Quiet org `n=15000`: 45 responses. Timings are **p50 of 5 repeats** unless noted, `SET jit = off`.

### 1. Hot owner-dashboard reads

Queries are those in `frontend/lib/server/owner-data.ts` (`listReviews`, `getOwnerCounts`, `getRatingBreakdown`, `listVisits`, `getVisitSummary`, `listPraise`, `listStands`, `listLiveFeed` in `owner-service.ts`).

| Query | Role | p50 (measured) | Plan shape (measured) |
|---|---|---|---|
| Inbox list 26 (`ORDER BY submitted_at DESC, id DESC`) | `authenticated` | **180 ms** | Index scan `customer_responses_org_location_time_idx` on `org_id`, **Filter `app.is_org_member(org_id)`**, sort, 28,800 rows, **88,656** buffers |
| same | `service_role` | **7.4 ms** | same index, **no** RLS filter, 1,933 buffers |
| same | table owner bypass | 7.4 ms | identical to `service_role` |
| Quiet org list 26 | `authenticated` | 0.45 ms | same plan, tiny `n` |
| Quiet org list 26 | `service_role` | 0.09 ms | |
| Exact `COUNT(*)` all responses | `authenticated` | **172 ms** | index-only scan + per-row RLS, 87,387 buffers |
| same | `service_role` | **3.4 ms** | 987 buffers |
| Unread `COUNT(*)` (partial index) | `authenticated` | 17.2 ms | `customer_responses_unread_idx`, 2,880 rows, still per-row RLS |
| same | `service_role` | 0.41 ms | |
| “Today” count | `authenticated` | 173 ms | same tax as full count (function still applied to every org row the date filter does not exclude first — planner used the location/time index) |
| Rating = 5 `COUNT(*)` | `authenticated` | 72 ms | org index + `rating` filter |
| Live-feed taps 26 | `authenticated` | 175 ms | `public_review_sessions_org_location_time_idx` + per-row RLS + sort |
| same | `service_role` | 6.1 ms | |
| Praise list 26 via `praise_safe_view` | `authenticated` | 15.3 ms | view `security_invoker` + RLS |
| Unmatched praise count | `authenticated` | 15.1 ms | |
| Text request list 26 | `authenticated` | 0.32 ms | `text_requests_org_created_idx` — already `(org_id, created_at DESC)`, LIMIT stops after 26 RLS calls |
| Memberships for one user | `authenticated` | 0.13 ms | `organization_members_user_active_idx` |
| Cross-tenant: quiet user `COUNT(*)` of hot org | `authenticated` | **162 ms**, count **0** | still visited 28,800 rows; `Rows Removed by Filter: 28800` |

Quoted plan, inbox list as `authenticated` (measured):

```
Limit  (actual time=179.834..179.837 rows=26)
  Buffers: shared hit=88656 read=7
  ->  Sort  (top-N heapsort)
        ->  Index Scan using customer_responses_org_location_time_idx
              Index Cond: (org_id = '00000001-0000-4000-8000-000000000001')
              Filter: app.is_org_member(org_id)
              (actual rows=28800)
Execution Time: 180.077 ms
```

`service_role` on the same SQL: **7.281 ms**, 1,933 hits, no filter.

`owner-data.ts` claims `submitted_at` is “indexed alongside `org_id`”. The actual index is `(org_id, location_id, submitted_at DESC)`. PostgreSQL 17 has **no** skip-scan, so `WHERE org_id = $1 ORDER BY submitted_at DESC` cannot walk that index in time order: it must read **every** location slice and sort. That is why even `service_role` spends 4–7 ms reading 28,800 rows to return 26.

After adding (bench-only, not a repo migration)

```sql
CREATE INDEX bench_cr_org_submitted_idx
  ON public.customer_responses (org_id, submitted_at DESC, id);
```

the same list became **0.32 ms p50 authenticated** and **0.06 ms `service_role`**, stopping after 26 index rows. Exact `COUNT(*)` stayed **164 ms authenticated** — the new index does not remove per-row RLS on a full-org aggregate.

`getOwnerCounts` issues five counts plus a 50-row list in parallel. Under RLS, the slowest of those is ~170 ms, so Home is ~180 ms of database time plus PostgREST before React. `getRatingBreakdown` is five more exact counts (one per star). `getVisitSummary` is three more plus `rpc_praise_count`. That is the owner homepage.

Unauthenticated **full table** `COUNT(*)` as a signed-in owner with no `org_id` (measured): **Seq Scan** on `customer_responses`, `Filter: app.is_org_member(org_id)`, 4,186,200 rows removed, 28,810 kept, **24,802 ms**, 8.46 million hits + 147k reads. Any forgotten `.eq("org_id", …)` is a fleet-wide sequential filter. RLS is not a performance bound.

No sequential scan on a table above ~100k rows appeared on the **correctly org-scoped** dashboard queries. The seq scan appears when the org predicate is missing.

### 2. Index coverage

**Usable today**

- Membership RLS lookup: `organization_members_user_active_idx (user_id, org_id) WHERE status = 'active'` — **1.57 million `idx_scan` during this study**, almost entirely from per-row `app.is_org_member`.
- Stand token: `review_stands_public_token_hash_key` (unique) — public resolve path.
- Text request list: `text_requests_org_created_idx (org_id, created_at DESC)` — correct pattern; LIMIT 26 is cheap.
- Unread/unresolved partial indexes on `customer_responses`.
- Outbox claim: `sms_outbox_claimable_idx (available_at) WHERE status IN ('pending','leased')` — used 1,452 times; claim `FOR UPDATE SKIP LOCKED LIMIT 50` stayed an **index scan**, not a seq scan, with 492k estimated pending.

**Missing (measured)**

- `customer_responses (org_id, submitted_at DESC, id)` — without it, every inbox/live-feed/recent-50 query sorts the tenant’s full history. Adding it dropped the list from 180 ms to 0.3 ms under RLS.
- `public_review_sessions (org_id, created_at DESC, id)` — live-feed taps have the same `(org_id, location_id, created_at)` leftover sort (175 ms authenticated).
- `customer_responses (org_id, rating)` — rating breakdown still walks every org row (72 ms authenticated / 12 ms `service_role` even with the time index, `Rows Removed by Filter: 17280` of 28,810).

**Duplicate / low-value (inferred from this workload, not “never used in production”)**

- Unique keys with `idx_scan = 0` here are still required for FKs and idempotency (`text_requests_dedupe_key`, `sms_outbox_idempotency_key_key`, token hashes). Do not drop them.
- `rate_limit_buckets_expiry_idx` and `rate_limit_buckets_expires_idx` both exist; the table was empty in this database. Worth a human look for a true duplicate on `expires_at`.
- `customer_responses_org_location_time_idx` overlaps the recommended `(org_id, submitted_at, id)` for org-wide lists but remains the right index for **location-scoped** history. Keep both if the product lists per location; otherwise the location-middle index is the wrong left-prefix for Home.

**Bloat risk (measured dead tuples after claim/quota churn)**

`sms_outbox` 26,000 dead / 2.08M live (1.25%) after claiming tens of thousands of rows. `sms_quota_balance` 8% dead on 20,000 rows (hot row updates). Append-only ledgers showed 0% dead. Default `autovacuum_vacuum_scale_factor = 0.2` means `customer_responses` at 84M rows would wait for **~17M** dead tuples before vacuum — irrelevant if the table is insert-only, lethal if `read_at` / `resolved_at` updates touch a large fraction. Triage updates are the update-heavy path on an otherwise append-heavy table.

### 3. Text Requests dispatch path

Claim function: `app.sms_outbox_claim` in `supabase/migrations/20260902000400_text_requests_outbox.sql`, wrapped by `rpc_sms_claim_outbox`. Node loop in `frontend/lib/server/sms/dispatch.ts` claims (default `p_limit` 10) then **serially** `rpc_sms_begin_dispatch` → provider `send` → `rpc_sms_settle_attempt` → complete/fail.

**Measured claim select** (500k pending remaining after some claims), `ORDER BY available_at LIMIT 10`, bypass RLS: p50 **0.10 ms**, index scan on `sms_outbox_claimable_idx`.

**Measured `FOR UPDATE SKIP LOCKED LIMIT 50`:**

```
Limit  (actual time=0.943..0.988 rows=50)
  ->  LockRows
        ->  Index Scan using sms_outbox_claimable_idx
              Index Cond: (available_at <= now())
              Filter: (status = 'pending')
              Rows Removed by Filter: 11
Execution Time: 1.032 ms
```

Not index-only (the `UPDATE` needs heap). It **does** stay an index scan as the backlog sits at ~0.5M pending. `Rows Removed by Filter: 11` are `leased` rows sharing the partial index.

**Throughput (measured)**

| Setup | Claimed | Wall time | Claims/s |
|---|---|---|---|
| 1 worker × 200 batches × 50 | 10,000 | 8,336 ms | **1,200** |
| 1 worker × 40 × 50 | 2,000 | 1,677 ms | **1,193** |
| 4 workers × 40 × 50 | 8,000 | 1,928 ms | **4,149** |
| 8 workers × 40 × 50 | 16,000 | 4,219 ms | **3,792** |

Four workers on four CPUs almost linear; eight slightly slower — lock/IO contention on this box, not a collapse. SKIP LOCKED did its job (zero failures, disjoint claims).

**Burst of 20,000 businesses × 250 messages = 5,000,000 jobs**

- Claim-only, **estimated** from 4,149/s: 5e6 / 4,149 ≈ **20 minutes**.
- `dispatchOnce` then does per-job RPCs. A public tap of session+response+click was **5.3 ms each** measured (10 repeats, same machine, no Twilio). If a fake/local send is in that 5 ms class, one worker at 10 jobs/batch is ~200 messages/s; eight workers ~1,600/s; 5e6 ≈ **50 minutes**.
- **Estimated** real Twilio at 80–150 ms/send, eight concurrent workers: ~50–100 messages/s, **14–28 hours** to drain the evening burst. The claim query is not what fails; the serial provider loop and carrier RTT are.

Sustainable SQL claim rate on this host: **~4,000 claims/s** (four workers). Treat **~1,000–4,000/s** as the measured Postgres number; hosted XL with more cores and better disks should match or exceed the four-worker figure. It will not make Twilio faster.

### 4. Quota-ledger concurrency

`app.sms_quota_reserve` locks `sms_quota_balance` **FOR UPDATE** for that `org_id` (`sms_quota_lock_balance`). That is a deliberate single-row serialisation point.

**Measured** against one hot org (correlation keys unique per call):

| Writers | Each | Reserved | Wall | Reserves/s (wall) |
|---|---|---|---|---|
| 1 | 200 | 200 | 119 ms | **1,681** |
| 4 | 200 | 800 | 281 ms | **2,847** |
| 8 | 200 | 1,600 | 570 ms | **2,807** |

Throughput plateaus ~2,800 reserves/s on one organisation. `sms_quota_balance_pkey` showed 35,609 scans. A 250-message send for one org is **well under one second** of lock time. Twenty thousand orgs sending at once contend on **different** rows; the limit becomes WAL/CPU, not one tuple — **estimated**, not measured at 20k concurrent orgs. The first quota problem is a **single org** blasting a huge import through many parallel HTTP handlers, all stacking on one `FOR UPDATE`.

### 5. Write amplification on the public tap flow

`rpc_public_create_session` → insert idempotency + insert session + optional `UPDATE review_stands.last_opened_at` + complete idempotency. **Measured** 20 calls: **1.87 ms each**. `EXPLAIN ANALYZE` of one call: Function Scan **1.84 ms**, 127 hits, 9 reads, 4 dirtied.

Full scan → response → Google click (`rpc_public_create_session` + `rpc_public_submit_response` + `rpc_public_record_google_click`), 10 triples: **5.29 ms each**. That is three SECURITY DEFINER functions, three idempotency claims, two inserts, one click insert, stand touch. At 5 ms SQL, **200 taps/s** is easy on this host; the Vercel/PostgREST hop is not included. **Estimated** 10–30 ms end-to-end per tap on hosted. Not the 20k-org bottleneck unless a viral stand is hammered; then `idempotency_records` uniqueness and `review_stands` row updates (one stand’s `last_opened_at`) become the hot row.

### 6. Connections and pooling

**Measured here:** `max_connections = 100`; ~9 sessions idle during tests; 80 serial connects succeeded; 40 parallel `pg_sleep(2)` sessions succeeded (2.7 s wall). Headroom on this instance is tens of connections, not hundreds.

This codebase does **not** open Postgres from Vercel. `supabaseServer()` / `requireUser` / `serviceRoleClient()` are PostgREST. Session-level Postgres features in **application** TypeScript: none (`SET LOCAL`, `SET ROLE`, prepared statements, advisory locks — grep of `frontend/` is empty).

In SQL: `pg_advisory_xact_lock` in `app.sms_record_consent` (transaction-scoped, transaction-mode pooler-safe). `SET search_path` is a function attribute. `set role = p_new_role` in membership RPCs is a **column** assignment, not `SET ROLE`. Migration-only `SET LOCAL check_function_bodies = off` is not runtime.

**Implication:** Supavisor **transaction mode** is compatible with this repo’s SQL. PostgREST on hosted Supabase already sits on the pooler. The serverless “one connection per invocation” scare applies if someone later adds a `pg` worker; today the risk is **pooler client limits** on the Data API, documented per compute size (vendor, retrieved 2026-09-08 from [Compute and Disk](https://supabase.com/docs/guides/platform/compute-and-disk)): Micro 60 direct / 200 pooler; Large 160 / 800; XL 240 / 1,000; 4XL 480 / 3,000. A 20k-owner evening of dashboards is many short PostgREST transactions, not 20,000 held sessions. **Inference:** XL or 2XL pooler limits (1,000–1,500) are the first hosted connection story, not `max_connections` 100 on this laptop.

Prepared statements: PostgREST uses them internally. That is a vendor path; this app does not add a second client with session-mode prepared statements.

### 7. Vacuum, TOAST, partitioning

**Append-heavy (measured 0% dead after load):** `customer_responses` (except triage columns), sessions, clicks, praise, consent events, quota ledger, webhook inbox, text_requests once terminal.

**Update-heavy:** `sms_outbox` (pending → leased → done), `sms_quota_balance` (one row per org), `review_stands.last_opened_at`, `customer_responses.read_at`/`resolved_at`, `sms_consent_state`.

**Autovacuum at 36 months (estimated):** scale factor 0.2 on an 80M-row append-only table almost never fires on inserts (no dead tuples). Freeze age / `relfrozenxid` wraparound becomes the real vacuum, not bloat. The danger is **outbox** and **triage updates** on huge heaps: updating `read_at` on 1% of 80M rows is 800k dead tuples — below 0.2×80M, so autovacuum **will not run** until more accumulate. Set **per-table** `autovacuum_vacuum_scale_factor = 0.01` (or a threshold of ~100k) on `customer_responses`, `sms_outbox`, `sms_quota_balance` before the fleet is large. That is a recommendation, not a measurement of wraparound.

**TOAST (measured + estimated):** 163-byte notes inline. Real GCM of a 2 kB customer essay **estimated** to TOAST (incompressible). Toast table size was not stressed. Encrypted phone columns on SMS are similarly small.

**Partitioning — concrete thresholds**

| Table | Partition by | Trigger (whichever first) | Why |
|---|---|---|---|
| `customer_responses` | `RANGE (submitted_at)` monthly | **20 million rows or ~15 GB** | dashboard time-order; drop old months if product allows; 36-month model is 85M |
| `public_review_sessions` | `RANGE (created_at)` monthly | same | live-feed twin |
| `sms_outbox` | **don’t partition pending**; **archive `done`** | **2 million `done` rows** or when claim latency leaves index scan | partial index already isolates pending; archive is simpler than partitioning a queue |
| `sms_quota_ledger` | `RANGE (effective_at)` monthly | 20M rows / ~10 GB | append-only, never updated |
| `sms_webhook_inbox` | `RANGE (received_at)` monthly | 20M | append-only |
| `sms_consent_events` | `RANGE (occurred_at)` | 20M | append-only ledger |
| `google_review_clicks` | `RANGE (clicked_at)` | 20M | optional; 34M at 36 months |
| `organizations` / members / stands | never | — | 20k–65k stays tiny |

Do not hash-partition by `org_id` until a single tenant’s month is itself huge; the dashboard always queries one `org_id` and needs a time-order local index.

### 8. Backup / restore / PITR

Loaded DB **measured** 13 GB. 36-month fleet **estimated** ~200 GB.

Vendor (retrieved 2026-09-08):

- PITR is a paid add-on, **$100 / month per 7 days** retention ([Pricing](https://supabase.com/pricing)).
- Restore downloads a physical backup then replays WAL; downtime **grows with size** ([Backups](https://supabase.com/docs/guides/platform/backups)).
- Dump/restore **estimates** in [Migrate to Supabase](https://supabase.com/docs/guides/platform/migrating-to-supabase/postgres): 100 GB ~45 min restore; 500 GB ~3 h; 1 TB ~6 h. Those are vendor ballparks, not our measurement.

**Inference:** a 200 GB PITR restore is **on the order of 1–3 hours** of downtime depending on WAL since the last physical base backup. Encryption keys (`CUSTOMER_NOTE_ENCRYPTION_KEY`) are outside the database (`CHANGE_SAFETY_ARCHITECTURE.md`); a restore without the key is ciphertext. No restore drill exists in this repo (`STATUS.md`: backups and restore drill **not built**).

## RLS overhead

This is the number the study was for.

**On the current schema, hot org (28,800 rows), org-scoped inbox list:**

| | p50 | Buffers |
|---|---|---|
| `service_role` (BYPASSRLS) | 7.4 ms | 1,933 |
| `authenticated` + `USING (app.is_org_member(org_id))` | **180 ms** | 88,656 |
| Ratio | **24×** | **46×** |

**Exact `COUNT(*)` for that org:** 3.4 ms vs **172 ms** = **50×**.

`app.is_org_member` is already `STABLE SECURITY DEFINER` and already wraps `auth.uid()` as `(select auth.uid())`. That InitPlan is **inside** the function. The planner still emits `Filter: app.is_org_member(org_id)` and, because the argument is a column, **calls it once per row** (28,800 loops). Removing the inner `(select …)` made list **195 ms** (no help). Wrapping the policy as `USING ((SELECT app.is_org_member(org_id)))` emitted `SubPlan 1 ... loops=28800` at **191 ms** — worse, not an InitPlan, because `org_id` is row-dependent.

**What did help (measured):**

```sql
USING (
  org_id IN (
    SELECT m.org_id FROM public.organization_members m
     WHERE m.user_id = (SELECT auth.uid()) AND m.status = 'active'
  )
);
```

Inbox list **8.5 ms** (hashed SubPlan, membership index, InitPlan on `auth.uid()`). That is **21×** faster than the helper-as-filter on the **same** missing time-order index. Plan excerpt: `Filter: (ANY (org_id = (hashed SubPlan 2).col1))` with one `organization_members_user_active_idx` hit.

A `STABLE` `app.current_org_ids() → uuid[]` with `org_id = ANY (app.current_org_ids())` planned as `One-Time Filter: false` and returned **0 rows** in `EXPLAIN ANALYZE` despite a valid JWT — **incorrect**. Do not ship that pattern without proving the GUC is visible at plan time (likely needs `VOLATILE` or a different API).

**Recommended mitigation, in order:**

1. Add `(org_id, submitted_at DESC, id)` (and the sessions equivalent). List+LIMIT becomes 26 RLS calls instead of 28,800 (**measured** 0.32 ms vs 180 ms).
2. Replace per-row `app.is_org_member(org_id)` policies on **large** tables with the hashed `IN (SELECT org_id FROM organization_members …)` semi-join (or a `SECURITY DEFINER` function returning `SETOF uuid` used as `org_id IN (SELECT app.current_org_id_set())` after it is proven not to fold to empty).
3. Stop using PostgREST `count: exact` for org-wide totals. Maintain a small projection (`org_id`, `response_count`, `unread_count`, …) updated in the same RPCs that write responses, or show “25+” from the page query. Exact counts will stay O(tenant size) even with a perfect index **if** RLS remains a per-row filter.
4. Keep `eq("org_id", orgId)` in `owner-data.ts`. RLS without that predicate is a 25 s seq scan at 4M rows (**measured**) and a production incident at 80M.

## Bottlenecks in the order they will break

1. **Owner dashboard under RLS, especially exact counts and time-unordered indexes.** Breaks at **one** busy tenant (~10k–30k responses), long before 20,000 organisations. Home/Reviews/Live Feed become 150–400 ms of serialised PostgREST counts. A missing `.eq("org_id")` seq-scans the shared heap.

2. **Append-only event tables + default autovacuum / backup size.** At tens of millions of rows (estimated year 1–2 of this model) index builds, freeze vacuum, and PITR restore windows become the operational failure. `sms_outbox` `done` rows and `sms_quota_ledger` should be archived before they match `customer_responses`.

3. **End-to-end Text Requests dispatch (provider + serial worker), not SKIP LOCKED.** SQL claim is ~4k/s. A 5M evening burst is a Twilio/worker problem (estimated many hours) unless many workers and a high provider concurrency cap exist. The 20k×250 burst **does not** require partitioning `sms_outbox` first; it requires draining `pending` faster than the carrier and not leaving 15M `done` rows in the claim index’s table forever (the partial index already excludes `done`, but the heap still sits there for vacuum).

4. **Single-org quota `FOR UPDATE`** only if one tenant’s API fans out hundreds of concurrent reserves (measured cap ~2.8k/s on that row). Normal 250-message evenings are fine.

5. **Hosted connection/IOPS**, not this laptop’s 100 connections, once PostgREST+workers sit on a Micro/Small compute. Vendor pooler caps (200 on Micro) are the relevant documented limit.

6. **A single stand’s `last_opened_at`** under a flash crowd — not measured at that intensity; inferred from the tap RPC updating one row.

## Required changes

Thresholds are “do this before the condition”, not calendar dates.

### Indexes — before any org exceeds ~10k responses (already true for a busy restaurant)

```sql
CREATE INDEX CONCURRENTLY customer_responses_org_submitted_id_idx
  ON public.customer_responses (org_id, submitted_at DESC, id);

CREATE INDEX CONCURRENTLY public_review_sessions_org_created_id_idx
  ON public.public_review_sessions (org_id, created_at DESC, id);

CREATE INDEX CONCURRENTLY customer_responses_org_rating_idx
  ON public.customer_responses (org_id, rating);
```

Keep `customer_responses_org_location_time_idx` if location-scoped lists exist. Same `(org_id, created_at DESC, id)` pattern for `google_review_clicks` and `team_praise_records` if those lists grow.

### RLS — same horizon as the indexes

On every **large** tenant table (`customer_responses`, `public_review_sessions`, `google_review_clicks`, `team_praise_records`, `text_requests`, `sms_*` that owners select):

```sql
-- replace USING (app.is_org_member(org_id)) with:
USING (
  org_id IN (
    SELECT m.org_id
      FROM public.organization_members m
     WHERE m.user_id = (SELECT auth.uid())
       AND m.status = 'active'
  )
);
```

Retain `app.is_org_member` for small tables (`locations`, `review_stands`, `staff_members`) where `n` is tens. Add pgTAP that `EXPLAIN` on a seeded 10k-row org does **not** contain `Filter: app.is_org_member(org_id)` looping `rows=10000`.

### Counts — before marketing “20k businesses”

Replace `select("id", { count: "exact", head: true })` in `getOwnerCounts`, `getRatingBreakdown`, and `getVisitSummary` with a projection table or with `limit(50)` plus “50+”. Exact count under RLS is **50×** a bypassed count today.

### Outbox — before `done` rows exceed ~2M (estimated ~year 1 of SMS at this model)

```sql
-- periodic archive, not a live partition of the queue
INSERT INTO sms_outbox_archive SELECT * FROM sms_outbox WHERE status = 'done' AND updated_at < now() - interval '14 days';
DELETE FROM sms_outbox WHERE status = 'done' AND updated_at < now() - interval '14 days';
```

Optional: `CREATE INDEX … ON sms_outbox (available_at) WHERE status = 'pending'` if `leased` noise in the current partial index grows (we saw 11 filtered rows per 50).

Dispatch: run **many** `dispatchOnce` workers (4–16) with `p_limit` 50–100; do not raise `p_limit` to 10,000 (long transactions, provider timeouts). Parallelism belongs in processes, not one giant `SKIP LOCKED`.

### Partitioning — before 20M rows / ~15 GB on each append-only table

Monthly `RANGE` on `submitted_at` / `created_at` / `effective_at` as in the table above. First candidate: `customer_responses` and `public_review_sessions` together.

### Autovacuum — when triage updates or outbox leases run on >1M-row tables

```sql
ALTER TABLE public.customer_responses SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 5000);
ALTER TABLE public.sms_outbox SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_vacuum_threshold = 2000);
ALTER TABLE public.sms_quota_balance SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 50);
```

### Pooling — when moving off PostgREST or adding a `pg` worker

Use the **transaction** pooler. Do not hold sessions. Do not use session `SET` / prepared statements on that worker without session mode. Current code is fine.

### Hosted compute — inference from vendor docs + this working set

Do not run 20k tenants on Micro (1 GB RAM, 60 connections, 500 IOPS baseline). **Estimated** fit: **XL or 2XL** (16–32 GB RAM, 240–380 direct connections, 1,000–1,500 pooler clients, 6,000–12,000 IOPS baseline) once the database is tens of GB; **4XL** if PITR restore time and IOPS during autovacuum dominate. Read replicas ([docs](https://supabase.com/docs/guides/platform/read-replicas), Small+ compute, replica billed as another instance): useful for owner-dashboard **reads** after RLS/index fixes, useless for outbox claims and quota locks.

## Open questions and what could not be measured

- **PostgREST + network latency** to a real Supabase region. All timings are in-process SQL on localhost. Add ~2–20 ms **estimated** per HTTP round trip; Home fires many in parallel.
- **Twilio RTT, 10DLC throughput caps, and Twilio concurrent send limits.** Dispatch drain time for the 5M burst is estimated from RPC cost + assumed 80–150 ms sends.
- **`ANY(current_org_ids())` correctness** under PostgREST (our SQL session returned 0 rows). Needs a dedicated test with the Data API, not only `SET ROLE`.
- **TOAST for real GCM.** Dummy plaintext was compressible; do not size disks from that.
- **`pg_dump` restore of a 200 GB project** — not performed. Vendor table used.
- **Read-replica lag** with this write mix (outbox updates + appends) — not run; replicas are vendor-configured.
- **FORCE RLS / `service_role` grant drift** on a freshly migrated DB vs this cloned schema. We granted `service_role` ALL to match hosted `postgres`; a `supabase db reset` might already do that.
- **Multi-org users** (`owned_organization_limit` = 10). RLS `IN (SELECT org_id …)` still InitPlans; not measured with 10 memberships.
- **Concurrent public taps on one stand** (hot `last_opened_at` + idempotency unique). Not loaded as a stampede.
- **JIT on** (production default). Sessions used `jit = off`; a 180 ms RLS scan might get worse with JIT setup time on first call.
- **Supabase gp3 vs io2 IOPS** under this workload — this disk is local container storage, not gp3 3,000 IOPS.
- **Vendor doc conflicts (retrieved 2026-09-08):** [Pricing](https://supabase.com/pricing) lists General Purpose max **16 TB** and extra throughput **$0.095/MB/s**; [Compute and Disk](https://supabase.com/docs/guides/platform/compute-and-disk) lists gp3 max **64 TB** and extra throughput **$0.95/MB/s**. Treat pricing-page figures as billing; treat compute-and-disk for IOPS/connection caps.

### Cost sanity (estimated, assumptions shown)

Not a quote. Retrieved 2026-09-08 from [supabase.com/pricing](https://supabase.com/pricing) and [Compute and Disk](https://supabase.com/docs/guides/platform/compute-and-disk).

Assume production at 20k owners, ~200 GB disk, Team plan if SOC2 is required, 2XL compute, gp3 disk, 7-day PITR, Pro Vercel.

| Line | Assumption | Monthly |
|---|---|---|
| Supabase Team (if SOC2) | listed | $599 |
| or Pro | listed | $25 |
| Compute 2XL | listed ~$410 (8 core / 32 GB); XL ~$210 if smaller | $210–410 |
| Disk 200 GB gp3 | 8 GB included, then $0.125/GB → 192×0.125 | ~$24 |
| Extra IOPS (e.g. 9,000 above 3,000) | $0.024 per IOPS | ~$216 |
| PITR 7 days | $100 / 7 days | $100 |
| Auth MAU | 20k owners + staff ≪ 100k included | $0 |
| **DB platform subtotal** | | **~$550–1,350** |
| Vercel Pro / resources | not measured | tens to low hundreds |
| Twilio at 427k SMS/month (month-1 model) | **estimated** $0.0083/SMS US | ~$3.5k |
| Twilio at 15M SMS / 36 months averaged (~430k/mo) | same | similar until usage grows |
| Evening burst 5M in one month | 5e6 × ~$0.008 | **~$40k that month** |

The database bill is not what 20,000 businesses cost. **SMS is.** The architectural risk this study measured is the **owner dashboard + RLS**, then **operational size** of Postgres, then **dispatch workers**, at a platform cost of roughly **$0.5k–1.5k/month** for a 2XL-class primary plus disk/PITR — **estimated** — which is cheap compared with being unable to render Home in 180 ms per query.

## Appendix — how to reproduce

```bash
# on this instance only; scripts live in /tmp
docker exec supabase_db_reviewboost psql -U postgres -d postgres -c "CREATE DATABASE scale_bench;"
# schema was already present here; otherwise apply supabase/migrations in filename order
# after creating auth.uid / auth.users / extensions as in /tmp/scale_bench_bootstrap.sql
psql -U supabase_admin -d scale_bench -f /tmp/scale_bench_01_tenants.sql
psql -U supabase_admin -d scale_bench -f /tmp/scale_bench_02_events.sql
psql -U supabase_admin -d scale_bench -f /tmp/scale_bench_03_sms.sql
psql -U supabase_admin -d scale_bench -f /tmp/scale_bench_04_indexes.sql
```

Metrics CSV from this run: captured in the cloud-agent artifacts directory as `scale_bench_metrics.csv`.
