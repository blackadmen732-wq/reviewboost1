# 7. Data and event model

**Status: PROPOSED.** Extends the existing schema; adds no second customer,
consent, credit, or message model. Customer, visit, consent-evidence and
eligibility-log entities are owned by PR #76 (docs 5 and 7) and are referenced,
not redefined.

Conventions carried from the repository: every tenant table has `org_id`,
composite `(id, org_id)` keys and composite foreign keys, RLS on, no direct
writes from `authenticated` (writes through SECURITY DEFINER RPCs that audit
inside the same transaction), free text and phone numbers encrypted with the
`crypto.ts` envelope, `timestamptz` everywhere.

## 7.1 Entity map

```
organizations ─┬─ locations ─┬─ review_stands (Tags)
               │             │      └─ public_review_sessions ──┐ (+ text_request_id)
               │             │              └─ customer_responses ─┬─ response_notes
               │             │                     │               └─ destination_selections
               │             └─ text_requests ─────┘ (+ response_id, origin, link_ref_digest)
               │                    └─ sms_* (attempts, outbox, ledger, grants)  [existing]
               ├─ organization_members ─┬─ notification_preferences
               │                        └─ owner_activity_days
               ├─ owner_notifications (outbox: classes C and E)
               ├─ report_snapshots
               ├─ retention_signals ─ retention_prompts
               ├─ org_quiet_periods
               ├─ feature_flags (org-scoped rows + global defaults)
               ├─ cancellation_feedback
               └─ automations ─ automation_versions ─ automation_events   [later, R5]
                                     (customers, visits: PR #76 doc 5)
```

## 7.2 Changes to existing tables

### `customer_responses` (feedback actions)

| Column | Type | Purpose |
|---|---|---|
| `follow_up_at`, `follow_up_by` | timestamptz, uuid → auth.users | Flagged for follow-up; both null or both set |
| `assigned_to`, `assigned_at`, `assigned_by` | uuid → auth.users (must be an active member), timestamptz, uuid | Assignment |
| `resolution_category` | `response_category` enum: `wait_time`, `staff`, `quality`, `cleanliness`, `price`, `order_accuracy`, `other` | Owner's label at done; null allowed |
| `needs_attention` | generated: `resolved_at is null and (rating <= 3 or follow_up_at is not null)` stored | Index target for Needs you |

Existing `read_at`, `resolved_at`, `resolved_by` keep their meaning. Reopen
clears `resolved_*` and `resolution_category`. New RPCs:
`rpc_response_flag_follow_up`, `rpc_response_unflag`, `rpc_response_assign`,
`rpc_response_resolve` gains `p_category` (new overload is not possible with
`create or replace` if the signature changes; add a new function name and drop
the old one in the same migration, per `LESSONS.md`). Every RPC writes an
`audit_events` row (`response.flagged`, `response.assigned`, …) in the same
transaction. Index: `(org_id, submitted_at desc) where needs_attention`.

### `public_review_sessions`

`text_request_id uuid null`, composite FK to `text_requests (id, org_id)`.
Set only by the session RPC when a valid `r` reference matches a request of
the same org and Tag.

### `text_requests`

| Column | Purpose |
|---|---|
| `origin` enum `manual`, `automation` default `manual` | Class A vs B |
| `automation_version_id` null | Required when `origin = automation` (check constraint) |
| `link_ref_digest` text unique null | Keyed digest of the link reference (never the raw value) |
| `response_id` null, composite FK | The rating this request produced |
| `visit_id` null | From PR #76 doc 5 |

## 7.3 New tables (V1)

### `notification_preferences`
- **Purpose:** what each member wants by email. **Key:** `(org_id, user_id, category)`.
- **Fields:** `category` enum (`weekly_summary`, `monthly_report`,
  `low_rating_now`, `open_item_reminders`, `tips`), `enabled`, `updated_at`.
  `account_billing` and `security` are not rows: always on.
- **Ownership:** the member edits their own; owner can see, not change, others'.
- **Lifecycle:** defaults inserted on membership creation; deleted with membership.

### `owner_notifications` (one outbox for classes C and E)
- **Purpose:** every message to a member, durable, idempotent, auditable.
- **Fields:** `id`, `org_id`, `user_id`, `category`, `rule_id` (e.g. `C-1`),
  `idempotency_key` unique per org, `channel` (`email`, `in_app`),
  `subject_ref` (e.g. response id, report id), `payload` jsonb (aggregates
  and ids only, no customer identifiers), `status` (`pending`, `leased`,
  `sent`, `failed`, `suppressed`, `dead_letter`), `suppressed_reason`
  (`preference_off`, `daily_cap`, `quiet_period`, `unsubscribed`,
  `bounced`), `provider_message_id`, `attempts`, `next_attempt_at`,
  `lease_owner`, `lease_expires_at`, `sent_at`, `created_at`.
- **Lifecycle:** created by rule evaluation; leased by the notifications
  worker with `FOR UPDATE SKIP LOCKED` (same pattern as `sms_outbox`); body
  rendered at send time from current data plus payload; retained 180 days.

### `email_suppressions`
`(email_hash)` bounced or complained addresses; checked before every send.
Keyed HMAC of the lowercased address, as phones are.

### `report_snapshots`
- **Purpose:** immutable monthly (and weekly) report.
- **Fields:** `id`, `org_id`, `kind` (`weekly`, `monthly`), `period_start`,
  `period_end` (local dates), `timezone`, `metrics` jsonb (doc 6 IDs → values,
  per location and per Tag), `observations` jsonb (rule id, values),
  `next_step` jsonb, `caveats` text[], `definitions_version` int,
  `generated_at`, `supersedes_id` null.
- **Key:** unique `(org_id, kind, period_start, definitions_version)` where
  `supersedes_id is null`.
- **Lifecycle:** written once by the report job; never updated; operator
  correction writes a new row. Deleted with the org. Contains aggregates only.

### `owner_activity_days`
- **Purpose:** minimal activity record for WAB and churn rules (R-6).
- **Fields:** `org_id`, `user_id`, `day` (UTC date), `surfaces` smallint bit
  set (home, feedback, insights, text_requests, tags, settings, report_view,
  email_click), `first_seen_at`.
- **Key:** `(org_id, user_id, day)`; upsert with bitwise OR, one row per member
  per day. No URLs, no IP, no user agent.
- **Lifecycle:** retained 400 days, then aggregated into monthly counts.

### `retention_signals`
- **Purpose:** each evaluation that fires a churn rule (doc 10).
- **Fields:** `id`, `org_id`, `rule_id`, `rules_version`, `level`
  (`watch`, `at_risk`), `evidence` jsonb (the numbers that satisfied the rule),
  `evaluated_at`, `cleared_at`, `cleared_reason` (`condition_gone`,
  `owner_dismissed`, `quiet_period`, `staff_resolved`).
- **Key:** at most one open row per `(org_id, rule_id)` (partial unique).
- **Access:** internal (service role) and owner/admin of the org may read the
  rows behind any prompt they were shown; level labels are never shown to owners.

### `retention_prompts`
- **Purpose:** the owner-visible help prompt for a signal and what happened.
- **Fields:** `signal_id`, `org_id`, `surface` (`home_banner`, `email`),
  `shown_at`, `acted_at`, `dismissed_at`, `dismiss_reason`
  (`not_relevant`, `closed_for_season`, `already_handled`), `snooze_until`.

### `org_quiet_periods`
`org_id`, `starts_on`, `ends_on` (≤ 120 days), `reason` (`seasonal`,
`renovation`, `other`), `created_by`. Suppresses activity prompts, churn
rules A-*, and reminder emails except billing/security.

### `feature_flags`
`key`, `org_id` null (global default when null), `enabled`, `updated_by`,
`updated_at`. Read server-side only, cached per request. Written by operators
via a service RPC with audit. Used for: `retention_weekly_email`,
`retention_monthly_report`, `retention_needs_you_v2`, `text_request_attribution`,
`automation_post_visit`, and PR #76's `connections_square`.

### `cancellation_feedback`
`org_id`, `subscription_id`, `reason` enum (`not_enough_value`, `too_expensive`,
`closing_business`, `switching_tool`, `seasonal`, `missing_feature`,
`other`, `skipped`), `stripe_reason` (from `cancellation_details`), `comment_encrypted`
null, `created_at`. Readable by internal staff only.

## 7.4 Later tables (R5, automation)

`automations`, `automation_versions` (immutable: template id, delay minutes,
daily cap, approved_by, approved_at, created_at), `automation_events` (event
name, `visit_id`, `idempotency_key` unique, `status` `pending|scheduled|skipped|cancelled`,
`skip_reasons text[]`, `text_request_id` null, `received_at`, `occurred_at`).
Shapes follow PR #76 doc 9 §9.3.

## 7.5 Event taxonomy

Events are rows in existing tables or in `audit_events`; this design adds no
event bus. Each event below names where it lives and its idempotency key.
Every event carries `org_id`, `location_id` where one applies, `occurred_at`
(when it happened in the world), and `recorded_at` (when we stored it).

| Event | Stored as | Required fields | Idempotency key | Late / duplicate rule |
|---|---|---|---|---|
| `tag.opened` | `public_review_sessions` insert | stand_id, location_id, locale, text_request_id? | session token hash | Duplicate token rejected by unique key |
| `rating.submitted` | `customer_responses` insert | session_id, rating | response token hash; one per session | Retries replay stored result (`idempotency_records`) |
| `handoff.selected` | `destination_selections` insert | response_id, provider | unique response_id | Second click ignored |
| `feedback.read` | `read_at` set | actor | first write wins (coalesce) | — |
| `feedback.flagged` / `unflagged` | audit + columns | actor | state check under `FOR UPDATE` | No-op if already in state |
| `feedback.assigned` | audit + columns | actor, assignee | same | — |
| `feedback.note_added` | `response_notes` | author, body (encrypted) | request idempotency key | — |
| `feedback.resolved` / `reopened` | audit + columns | actor, category? | state check | — |
| `text_request.scheduled` … `delivered` / `failed` / `provider_unknown` / `cancelled` | existing state machine + `sms_delivery_attempts` | existing | `(org_id, dedupe_key)`; provider event id in webhook inbox | Out-of-order callbacks applied only if they move state forward; `delivered` after `failed` is accepted (definitive beats inferred) |
| `text_request.rated` | `text_requests.response_id` | response_id | first write wins | — |
| `credit.*` (reserve, consume, release, refund, expire, grant) | `sms_quota_ledger` | existing | correlation key unique | Existing |
| `notification.queued` / `sent` / `failed` / `suppressed` | `owner_notifications` | rule_id, category | `idempotency_key` per rule (below) | Duplicate insert is a no-op |
| `report.generated` | `report_snapshots` | period, definitions_version | unique period key | Re-run is a no-op |
| `owner.active` | `owner_activity_days` upsert | user_id, surface | `(org, user, day)` | Idempotent OR |
| `retention.signal_raised` / `cleared` | `retention_signals` | rule_id, evidence | partial unique open row | Re-evaluation updates `evidence` only |
| `retention.prompt_shown` / `acted` / `dismissed` | `retention_prompts` | surface | `(signal_id, surface)` | — |
| `subscription.*` | `billing_subscriptions` via Stripe inbox | existing | Stripe event id | Existing out-of-order protection |
| `visit.became_eligible` (later) | `automation_events` | visit_id, visit_version | `'visit:'||id||':v'||version` | > 48 h old → `stale_event` |

Notification idempotency keys: C-1 `c1:{response_id}:{yyyy-ww}`, C-2
`c2:{org}:{yyyy-ww}`, C-3 `c3:{response_id}`, C-4 `c4:{stand_id}:{yyyy-mm}`,
C-5 `c5:{org}:{72h bucket}`, C-6/C-7 `c6|c7:{org}:{grant period}`, weekly
`weekly:{org}:{iso week}`, monthly `report:{org}:{yyyy-mm}`. A daily cap is
enforced at lease time (count `sent` for the member today), so a retried
worker cannot exceed it.

## 7.6 Duplicate-safety guarantees

| Hazard | Guard |
|---|---|
| Worker retries a Text Request job | Outbox lease owner check; attempt row inserted before provider call; one in-flight attempt per request (partial unique index, existing) |
| Worker restarts mid-send | Lease expiry → retry sees the attempt row; if provider id missing, status `provider_unknown`, never resent |
| Duplicate SMS webhook | `sms_webhook_inbox` unique provider event id, signature checked first (existing) |
| Uncertain provider response | `provider_unknown`, reservation settled as spent after 15 min, refunded if a later callback says failed (existing) |
| Duplicate Stripe event | `stripe_webhook_events` unique id; grant origin key unique (existing) |
| Double tap on Send | `dedupe_key` collision (existing) |
| Report job runs twice | Unique period key |
| Reminder rule fires twice | Notification idempotency key |
| Two workers send the same email | Lease + status transition `leased → sent` guarded by lease owner |
| Email provider times out after accepting | Resend idempotency header = notification id; on retry the provider deduplicates |

## 7.7 Retention and deletion

| Data | Retention | On org deletion |
|---|---|---|
| Ratings, notes | Existing policy (account deletion in PR #67) | Deleted |
| `owner_notifications` | 180 days | Deleted |
| `report_snapshots` | Life of org | Deleted |
| `owner_activity_days` | 400 days, then monthly counts | Deleted |
| `retention_signals`, `prompts` | 2 years | Deleted |
| `cancellation_feedback` | 3 years, comment purged at 1 year | Deleted. Keeping an anonymised reason count after deletion is decision D-7.1 |
| Consent and opt-out | PR #76: kept as the legal record | Per PR #76 policy |
