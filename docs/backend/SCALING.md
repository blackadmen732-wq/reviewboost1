# Performance and scale

**Status: no load test has been run.** Nothing below is a measured number.
The architecture (Vercel functions + Supabase Postgres, database-owned queues)
is not to be changed until measurements show it missing an SLO.

## What to measure (staging, production-sized data)

| Path | Target to hold | Tool |
|---|---|---|
| Public Tag context GET | p95 < 300 ms, p99 < 800 ms | k6, 50→500 rps ramp |
| The tap: `POST /ratings` (session + rating + destination event in one request; the customer no longer waits on it) | p95 < 400 ms per step | k6 |
| Owner dashboard | p95 < 800 ms | k6 with 50 signed-in owners |
| SMS enqueue | p95 < 500 ms | k6 |
| Dispatch throughput | ≥ 500 messages/min per invocation (20 × 25 batches) | seed 10k outbox rows, run dispatch, time to empty |
| Backlog recovery | 1 h of backlog drained in < 10 min | stop scheduler 1 h under load, restart |
| Stripe / Twilio webhook handling | p95 < 500 ms at 50 rps | replay recorded payloads |

Watch during each: Supabase CPU, IO, connections (pooler), `rate_limit_buckets`
write rate, lock waits (`pg_stat_activity`), slow queries (`pg_stat_statements`).

## Indexes

The performance advisor lists 30 foreign keys without covering indexes. They
are **not** to be added wholesale. For each, the rule is: add one when a real
query filters or joins on that column (seen in `pg_stat_statements` or an
`EXPLAIN` of an application query), or when deletes on the parent would
otherwise scan the child. The ones most likely to matter as tables grow:

* `audit_events.actor_user_id` — account deletion scans it.
* `customer_page_assets.uploaded_by`, `customer_page_profiles.*_by` — same.
* child rows of `text_requests` / `sms_delivery_attempts` — cascade paths.

## Large tables and retention (proposed, not implemented)

| Table | Growth driver | Proposed retention |
|---|---|---|
| `public_review_sessions` | every Tag scan | delete expired sessions older than 30 days |
| `rate_limit_buckets` | every public request | delete expired buckets daily (index exists) |
| `idempotency_records` | every idempotent write | delete expired daily (index exists) |
| `stripe_webhook_events`, `sms_webhook_inbox` | provider traffic | keep processed rows 90 days |
| `sms_outbox` | every send | delete completed jobs after 30 days |
| `audit_events` | every owner action | keep 2 years; partition by month past ~10M rows |
| `customer_responses`, `destination_selections` | product data | keep; the business's own history |

Each belongs in the maintenance worker as an idempotent, batched delete, added
only with a test and after the owner agrees the retention period.
