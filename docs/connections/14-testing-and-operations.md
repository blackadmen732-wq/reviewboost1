# 14. Testing and operational plan

**Status: PROPOSED.** Uses the existing suites and harnesses (`TESTING.md`):
pgTAP via `scripts/backend/local-postgres.sh` and CI's `supabase test db`,
Vitest, Playwright with Axe and visual baselines, the populated-upgrade proof,
and `scripts/backend/concurrency-proof.sh`.

**Ground rules.** Automated tests use the `fake` provider adapter and recorded
Square sandbox fixtures. No test reaches production credentials, a real
seller account, or sends a real SMS (`SMS_PROVIDER=fake`). Sandbox calls run
only in a separate, manually triggered job with sandbox credentials.

## 14.1 Test matrix

| Area | Case | Layer |
|---|---|---|
| Connection | Successful connect: state, credentials stored encrypted, identity recorded, `connecting → active` after test + activate | Vitest (fake adapter) + pgTAP |
| | Owner denies at provider; `error` param surfaced; nothing stored | Vitest |
| | State missing, expired, reused, from another user | Vitest + pgTAP (single-use) |
| | Code exchange fails / expired code | Vitest |
| | Permission mismatch → `authorization_required` | Vitest |
| | Reconnect returns a different merchant → refused | Vitest |
| | Same merchant into a second org → refused by unique index | pgTAP |
| | Illegal state transitions refused; idempotent repeat is a no-op with one audit row | pgTAP |
| Tenancy | Read, configure, sync, disconnect another org's connection as `authenticated` with a foreign JWT → no rows / refused | pgTAP (attack as the real role, per `LESSONS.md`) |
| | `member`/`viewer` cannot authorize, configure, disconnect, read customers | pgTAP + route tests |
| | `integration_credentials` and `integration_inbox` unreadable by `authenticated` and `anon` | pgTAP grant tests |
| | Recipient search never returns another org's contacts | pgTAP + route |
| Webhooks | Valid signature accepted; wrong key, modified URL, modified body, re-serialized JSON rejected | Vitest with Square's documented vectors |
| | Duplicate delivery → one inbox row, one visit | Vitest + pgTAP |
| | Out-of-order: `updated` before `created`; older version after newer → newest state wins, stale counted | Vitest + pgTAP |
| | Event for an unknown/disconnected merchant → 200, skipped | Vitest |
| | Database down → 503, nothing acknowledged | Vitest |
| Sync | Backfill pages applied with checkpoints; crash mid-page, lease expiry, resume from cursor, no duplicates | Vitest + concurrency proof |
| | Expired provider cursor → restart from high water, idempotent | Vitest |
| | 429 with and without `Retry-After` → backoff, run stays alive | Vitest |
| | 5xx streak → `unavailable`; recovery → `active` | Vitest |
| | 401 → one refresh → `reauth_required`; events held, processed after reauth | Vitest |
| | Two workers refresh the same token → one refresh | Concurrency proof |
| | Exhausted retries → dead letter; operator retry → processed | pgTAP + Vitest |
| Data | Invalid phone, missing phone, no customer on payment, unmapped location → issue rows with redacted hints | Vitest |
| | Same phone two sources → one contact, two profiles, `names_differ` | pgTAP |
| | Same name different phones → two contacts | pgTAP |
| | Phone changed at source → profile moves; old contact's consent untouched | pgTAP |
| | Retention purges; disconnect grace and purge; consent and opt-out survive | pgTAP |
| Consent and eligibility | Synced contact is `unknown` and blocked with `consent_missing` | pgTAP |
| | Composer no longer mints consent (F-1 regression test) | Vitest |
| | Attestation requires `confirmed: true`, method, wording version; records actor | Vitest + pgTAP |
| | STOP before and after scheduling → suppressed at dispatch | pgTAP (existing + connected recipient) |
| | Quiet hours → scheduled for next window; DST cases | Existing Vitest |
| | Frequency cap and `already_rated` | pgTAP |
| | `messaging_paused`, `provider_not_ready`, `org_inactive` block | pgTAP + Vitest |
| | All reasons returned, not just the first | pgTAP |
| | Eligibility never reads ratings | pgTAP static check on function body and dependencies |
| Messaging | Final body includes prefix and footer; segments computed on it; emoji switches encoding and cost | Vitest |
| | Double tap with one idempotency key → one request, one reservation | Vitest + concurrency proof |
| | Same visit twice → `duplicate_event` | pgTAP |
| | Provider timeout → `provider_unknown`, no auto-retry, settled as spent after window | Existing pgTAP |
| | Late delivery callback reconciles `provider_unknown` → `delivered` / `failed` + refund | pgTAP |
| | "Delivered" shown only with a delivery receipt | Component test |
| Credits | Insufficient credits → blocked before send, no reservation | pgTAP |
| | Pack checkout completed delivered twice → one grant | pgTAP + Vitest (signed Stripe fixtures) |
| | Pack refund removes only unspent remainder | pgTAP |
| | Chargeback pauses messaging | pgTAP |
| Disconnect | Revoke called; credentials deleted; webhooks dropped; revoke failure recorded | Vitest |
| Reporting | Connection runs, issues, eligibility logs scoped to the org | pgTAP |
| UI | Every state in doc 12 rendered: loading, empty, success, warning, error, permission denied, offline | Component tests |
| | Setup, connected detail, composer at 320 px and desktop, light and dark | Playwright visual + Axe |
| Upgrade | Migrations apply to a populated baseline (with #74 data if it landed) | `populated_upgrade_test.sql` extension |

## 14.2 Sandbox verification (manual job, Phase 2)

Against the Square sandbox with a test seller: full OAuth, `ListLocations`,
create test customers, payments and bookings, receive real webhooks through a
preview deployment, verify signatures, revoke from the sandbox dashboard,
confirm the revocation event name, confirm booking-read plan requirements, and
measure how often sandbox payments carry `customer_id`. Results recorded in
this folder as `SANDBOX_VERIFICATION.md` with dates and evidence, following the
V1 report's evidence style.

## 14.3 Monitoring

Extend `/api/v1/internal/health` (counts and ages only, no identifiers):

| Metric | Meaning |
|---|---|
| `integration_inbox_pending`, `oldest_pending_age_s` | Ingestion backlog |
| `integration_dead_letters` | Events needing a human |
| `connections_by_state` | Count per lifecycle state |
| `connections_stalled` | Active, nothing in 24 h |
| `webhook_signature_failures_1h` | Possible attack or key misconfiguration |
| `token_refresh_failures_24h` | Auth trouble ahead |
| `sync_runs_failed_24h` | |
| `eligibility_blocks_24h_by_reason` | Product signal and anomaly detection |
| Existing SMS metrics | Unchanged |

## 14.4 Alerting

There is no alert delivery today (V1 report). Proposed: an external uptime
monitor calls `/internal/health` every 5 minutes with the worker secret and
alerts on thresholds. Choice of tool is an operations decision (D-14.1).

| Alert | Threshold |
|---|---|
| Ingestion stalled | `oldest_pending_age_s > 1800` |
| Dead letters | any new in 1 h |
| Signature failures | > 20 in 1 h |
| Repeated auth failures | > 3 connections to `reauth_required` in 1 h (provider-side problem or a key issue) |
| Stalled connection | any active connection stalled 24 h |
| Messaging anomaly | Text Requests per org per hour > 3× its 30-day p95, or blocks for `opted_out` spike, or delivery failure rate > 20% |
| Worker not running | No heartbeat in 2× cadence (PR #67 heartbeats) |

## 14.5 Runbooks (written in Phase 4)

- Square outage: confirm on Square's status page, expect `unavailable`, no
  action; after recovery, reconcile runs catch up.
- Webhook key rotation: set `_PREVIOUS`, rotate in Square, deploy, remove
  `_PREVIOUS` after 24 h.
- Credential key rotation: add new key version, run re-encryption task, retire
  old key.
- Dead letters: inspect outcome codes, fix cause, `rpc_integration_retry_dead_letters`.
- Owner reports missing visits: check run history, issues, mapping; manual
  reconcile.
- Suspected abuse: set `messaging_paused` for the org; review eligibility log.

## 14.6 Release gates

No production migration, deployment, live billing change, or live messaging is
part of this work. Each phase in doc 15 ends at "CI green on a branch, sandbox
verified where stated", and moves further only with the owner's explicit
authorization.
