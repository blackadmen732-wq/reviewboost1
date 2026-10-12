# 8. System architecture

**Status: PROPOSED.** The smallest architecture that fits the repository:
Next.js 16 route handlers and server components, Supabase Postgres with RLS
and SECURITY DEFINER RPCs, the Postgres outbox pattern already used for SMS,
and worker endpoints under `/api/v1/internal/*` triggered by a scheduler.
One new external dependency is proposed: an email provider.

## 8.1 Component view

```
                 ┌──────────────── Next.js (Vercel) ────────────────┐
 Customer ──────►│ /q/[token], /r/[ref]  (same locked customer UI)    │
                 │                                                   │
 Owner ─────────►│ Home · Feedback(+Insights) · Text Requests · Tags │
 (web, Expo)     │ · Settings   ← server components via owner-data   │
                 │ /api/v1/*    ← mobile + mutations (RPC calls)      │
                 │                                                   │
 Scheduler ─────►│ /api/v1/internal/sms/dispatch        (exists)     │
 (pg_cron or     │ /api/v1/internal/maintenance         (exists)     │
  Vercel cron)   │ /api/v1/internal/notifications/run   (new)        │
                 │ /api/v1/internal/reports/run         (new)        │
                 │ /api/v1/internal/retention/evaluate  (new)        │
                 │ /api/v1/internal/automation/run      (later, R5)  │
                 └───────┬───────────────────────────┬───────────────┘
                         │                           │
                 ┌───────▼────────┐        ┌─────────▼─────────┐
                 │ Postgres       │        │ Providers         │
                 │ (Supabase)     │        │ Twilio  (exists)  │
                 │ RLS, RPCs,     │        │ Stripe  (exists)  │
                 │ outboxes,      │        │ Resend  (new)     │
                 │ ledgers        │        │ Square  (PR #76)  │
                 └────────────────┘        └───────────────────┘
```

## 8.2 Reuse map

| Concern | Existing component | How it is used |
|---|---|---|
| Ownership, tenancy | `organizations`, `locations`, `organization_members`, `app.has_org_role`, `requireOwner()` | Every new table and RPC |
| Tags and visits | `review_stands`, `public_review_sessions`; visits from PR #76 | Opens, attribution, automation trigger |
| Feedback | `customer_responses`, `response_notes`, feedback RPCs | Extended in place (doc 7 §7.2) |
| Insights aggregation | `rpc_feedback_insights` + `lib/owner/insights.ts` (PR #67) | Ported; report job reuses the same rules |
| Customer contacts, consent | PR #76 doc 5 and doc 7; existing consent ledger | No change here |
| Eligibility | `app.messaging_eligibility` (PR #76) | Used by Class A and B |
| Messaging | `text_requests`, `sms_outbox`, dispatch, Twilio adapter, webhook inbox | Class A and B |
| Credits | `sms_credit_grants`, slices, `sms_quota_ledger`, reconciliation | Reports read; automation reserves |
| Billing | `billing-service.ts`, Stripe inbox | Plan state for reports and churn rules |
| Audit | `audit_events` inside the transaction | Every owner action |
| Crypto | `crypto.ts` envelope + HMAC | Email hash for suppressions; encrypted cancellation comment |
| Worker auth | `workerAuthorized` | New internal endpoints |
| Heartbeats, scheduler | PR #67 `worker_heartbeats`, `production_scheduler.sql` | Every new worker writes a heartbeat |
| Health | `/api/v1/internal/health` | Adds notification and report backlogs |
| UI | `AppShell`, `components/ui/*`, `StatusBanner`, `StatTile`, `EmptyState`, tokens | All screens |

## 8.3 New components and why existing ones are insufficient

| New | Why needed | Smallest form |
|---|---|---|
| **Email provider (Resend)** | No channel reaches an owner outside the app (R-5); reports and reminders need it | `lib/server/email/` with a provider interface mirroring `sms/provider` (`fake` in tests, fails closed in production when unset), React Email templates rendered server-side. ADR required (`SYSTEM_CONTEXT.md` §8 names Resend as PROPOSED) |
| **Notifications worker** | Email must be durable, idempotent, capped | `owner_notifications` outbox + `/internal/notifications/run`, same lease pattern as `sms_outbox` |
| **Report job** | Snapshots must exist even if no one opens the app | `/internal/reports/run`: for each org whose local time passed 08:00 on day 1 (or Monday), compute and insert; idempotent on period key |
| **Retention evaluator** | Rules must run without an owner visit | `/internal/retention/evaluate` daily; pure rule functions in `lib/server/retention/rules.ts` over SQL aggregates |
| **Activity recorder** | WAB and churn rules need owner activity (R-6) | One `rpc_record_owner_activity(surface)` called from `AppShell` server render and email click redirect; one upsert per member per day |
| **Feature flags** | Staged rollout and holdouts (R-11) | `feature_flags` table + `lib/server/flags.ts`; no vendor SDK |
| **Automation runner (later)** | Turn eligible visits into requests | `/internal/automation/run` over `automation_events`; schedules via existing `rpc_schedule_text_request` |

Not introduced: a queue service, Redis, an event bus, a separate analytics
warehouse, a workflow engine, a second job platform. The background-job
platform remains the open ADR named in `SYSTEM_CONTEXT.md` §8; everything here
runs on whatever scheduler that ADR picks, and on PR #67's pg_cron scheduler
until then.

## 8.4 Scheduler cadence required

| Job | Cadence needed | Today |
|---|---|---|
| SMS dispatch | every minute | daily 19:00 UTC (R-7) |
| Maintenance / reconciliation | every 15 min | daily 08:00 UTC |
| Notifications run | every 5 min | — |
| Reports run | hourly (each org's local 08:00 falls in some hour) | — |
| Retention evaluate | daily | — |
| Automation run (later) | every minute | — |

Weekly and monthly emails work at hourly cadence; reminders at 5-minute
cadence. **Nothing in Phases R1–R4 that sends anything is enabled before the
cadence fix** (README decision 7).

## 8.5 Request paths

**Owner opens Home.** Server component → `requireOwner` → `getOwnerCounts`
(extended with this-week/last-week counts and `needs_attention` count, one
round of parallel queries) → `rpc_record_owner_activity('home')` fire-and-forget
→ render.

**Rating via a text.** `/r/{ref}` → server resolves the request and its Tag →
same customer flow → session RPC digests the ref, matches the request → session
row with `text_request_id` → rating RPC
inserts response and, in the same transaction, sets `text_requests.response_id`
and calls `app.sms_mark_flow_completed`. The customer sees nothing different.

**Monthly report.** Reports job → for each due org: one SQL function
`app.report_metrics(org, start, end, tz)` returns the doc 6 metrics as jsonb →
TypeScript applies sample rules and the observation catalogue (pure, tested)
→ insert snapshot → insert one `owner_notifications` row per opted-in member
→ notifications worker renders and sends.

**Reminder.** Retention evaluator / reminder rules → insert notification with
rule idempotency key → worker applies preference, quiet period and daily cap
at lease time → send or mark suppressed with reason.

## 8.6 Access control

| Surface | owner | admin | member | viewer |
|---|---|---|---|---|
| Home, Feedback lists, Insights, monthly report view | ✓ | ✓ | ✓ | ✓ |
| Flag, note, mark done | ✓ | ✓ | ✓ (unassigned or own) | — |
| Assign | ✓ | ✓ | — | — |
| Text Requests send | ✓ | ✓ | ✓ (existing rule) | — |
| Credits, billing, cancellation | ✓ | ✓ (no cancel) | — | — |
| Notification prefs | own | own | own | own |
| Quiet period | ✓ | ✓ | — | — |
| Automation create/enable (later) | ✓ (+MFA) | ✓ (+MFA) | — | — |
| Retention signals evidence | internal staff; owner/admin see the prompt's own evidence | | | |

Enforced in RPCs with `app.has_org_role`, and in RLS for reads. Location-scoped
admins are a future role extension (doc 12 §12.2), not V1.

## 8.7 Failure handling and recovery

- **Retries:** exponential backoff (1, 5, 15, 60 min, then hourly) for
  notifications; reports retried hourly for 24 h.
- **Dead letter:** after 24 h, `dead_letter` with last error; health endpoint
  counts them; alert (doc 15).
- **Operational alerts:** outbox age, dead letters, heartbeat gaps, report
  job not completed by 12:00 UTC on day 1, email bounce rate > 5%.
- **Recovery:** every job is idempotent on its key, so recovery is "run it
  again". Snapshot corrections go through an operator RPC that writes a
  superseding row.
- **Kill switches:** global `feature_flags` rows per capability; turning one
  off stops new work and lets the worker drain or suppress pending rows with
  reason `flag_off`.
