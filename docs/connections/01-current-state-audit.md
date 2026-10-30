# 1. Current-state audit

**Audited:** `main` at `0155948` on 2026-10-12, plus the four open pull
requests (#67, #73, #74, #75). Every claim names the file it was checked
against. "Exists" means the code is in the repository; it does not mean it has
run against a real provider. No integration, customer model, or provider below
is treated as functional because a route or interface exists.

## 1.1 Summary

| Area | State on `main` | Evidence |
|---|---|---|
| Integrations / connections of any kind | **NOT BUILT** | No table, route, page, or adapter. `STATUS.md` lists "POS integrations (Square, Toast, Clover)" as not built |
| Canonical customer model | **NOT BUILT on main**; proposed in open PR #74 | `frontend/app/(owner)/customers/page.tsx` is an anonymous *visit* list, explicitly not a contact list |
| Text Requests backend (consent, suppression, outbox, webhook inbox, segments, quiet hours) | **IMPLEMENTED, CI-TESTED**, not live-verified | `supabase/migrations/20260902000100`–`000700`, `frontend/lib/server/sms/*`, `docs/backend/TEXT_REQUESTS.md` |
| Text Requests owner UI | **IMPLEMENTED**, not live-verified | `frontend/app/(owner)/text-requests/page.tsx`, `features/dashboard/text-request-composer.tsx` |
| SMS provider | Twilio adapter **IMPLEMENTED**; no account; fails closed in production | `frontend/lib/server/sms/provider/*` |
| SMS credit ledger (two sources, monthly first) | **IMPLEMENTED, CI-TESTED** | `20260915000800_sms_two_source_ledger.sql`, 50-assertion suite |
| Billing (Stripe subscriptions, invoice-minted allowance) | **IMPLEMENTED in code**, not live-verified | `frontend/lib/server/billing-service.ts`, `20260915000700_billing.sql` |
| Credit pack purchase | **PARTIAL**: grant RPC exists, no checkout and no webhook handler | `rpc_billing_apply_credit_purchase` has no caller in `frontend/` |
| Workers | **IMPLEMENTED**; deployed cadence once daily | `docs/SCHEDULING.md`, `frontend/vercel.json` |
| Health endpoint | **IMPLEMENTED** (SMS only) | `frontend/app/api/v1/internal/health/route.ts` |
| MFA | **NOT BUILT** | PR #67 commit `d3f43fa` "stop claiming MFA"; `docs/backend/MFA_DESIGN.md` exists only on that branch |
| Alerting | **NOT BUILT** | V1 report: "No external alerting is wired" |

## 1.2 Implemented and working (CI evidence, not live)

These are the parts Connections must build on rather than replace.

**Tenancy and authorization.** `organizations`, `organization_members`
(roles `owner`, `admin`, `member`, `viewer`), `locations` (with an IANA
`timezone`, default `UTC`), `review_stands`. RLS on every tenant table, writes
only through SECURITY DEFINER RPCs, `app.is_org_member` and
`app.has_org_role` helpers, composite `(id, org_id)` foreign keys that refuse
cross-org links. `requireOwner()` in `frontend/lib/server/owner-data.ts`
resolves the organization from the session, never from the client.

**Crypto.** `frontend/lib/server/crypto.ts`: AES-256-GCM with a versioned
envelope (`v1`), keyed HMAC digests, `KEY_VERSION = 1`. Keys come from
environment variables (`CUSTOMER_NOTE_ENCRYPTION_KEY`, `TOKEN_DIGEST_KEY`,
with a `_PREVIOUS` digest key for rotation). There is no Supabase Vault or
pgsodium usage. Phones are stored as hash + ciphertext + last four, never in
clear.

**Consent ledger.** `sms_consent_events` (append-only) projected into
`sms_consent_state`; statuses `opted_in`, `opted_out`, `unknown`; sources
`customer_flow`, `owner_import`, `reply_start`, `reply_stop`, `api`, `admin`;
purpose `review_request` only. An unknown number is never consent.

**Suppression and the pre-send gate.** `app.sms_can_send(org, phone_hash,
purpose)` checks the phone-level opt-out (`sms_phone_optout`), then consent,
then active suppressions (`opt_out`, `stop_keyword`, `compliance`,
`hard_bounce`, `recent_send`, `completed_flow`, `manual`). It runs again inside
`app.sms_begin_dispatch`, immediately before the provider call.

**Message state machine.** `text_requests.status`: `scheduled → queued →
sending → submitted → delivered`, with `suppressed`, `failed`,
`provider_unknown`, `cancelled`. `provider_unknown` is never auto-retried.
A partial unique index allows one in-flight attempt per request.

**Outbox and webhook inbox.** `sms_outbox` with `FOR UPDATE SKIP LOCKED`
leases, lease-owner-guarded completion, exponential backoff, `dead_letter`.
`sms_webhook_inbox` verifies the signature before the deduplicated write.

**Segments, cost, quiet hours, dedupe.** GSM-7/UCS-2 segment engine, integer
micro-unit cost, DST-correct 09:00–20:00 window computed from the stand's
location zone and re-checked at dispatch, `(org_id, dedupe_key)` uniqueness
with a 24-hour window.

**Credit ledger.** `sms_credit_grants` (sources `monthly`, `purchased`;
origin key unique per `(org, origin_kind, origin_id)`),
`sms_reservation_slices` (which grant each reservation took from),
`sms_quota_ledger` (append-only audit). Monthly is spent first; monthly expires
at the period end; purchased never expires. Monthly allowance is minted only by
`rpc_billing_apply_invoice_paid` on `invoice.paid` with `amount_paid > 0`, so a
trial and a failed first payment mint nothing. `provider_unknown` reservations
are settled as spent after 15 minutes by `app.sms_reconcile_aged_unknowns`;
dead letters release.

**Entitlements.** `20260915000400_entitlements.sql` encodes trial (1 location,
1 Tag, 0 SMS), Starter (1, 3, 150), Growth (2, 8, 500), Pro (5, 25, 1,500).
Caps are counted under a lock inside the create transaction.

## 1.3 Partially implemented

| Item | What exists | What is missing |
|---|---|---|
| Text Requests composer | Phone entry, Tag picker, preview, balance, recent list | Recipient lookup, eligibility explanation, cost-in-credits confirmation step, opt-out/business-name footer, honest consent capture (see F-1, F-2) |
| Credit packs | Grant RPC, idempotent on payment id | Pack catalog, Stripe Checkout in `payment` mode, `checkout.session.completed` handler, owner purchase screen |
| Refunds and disputes | Nothing | `charge.refunded`, `charge.dispute.*` handling, negative adjustment policy |
| Observability | `/internal/health` counts for SMS | Integration metrics, alert delivery |
| Scheduler | Once-daily Vercel crons | Per-minute cadence needs Vercel Pro or `supabase/ops/production_scheduler.sql` from PR #67 |

## 1.4 Planned only (documents, no code)

- `SYSTEM_CONTEXT.md` §8: "Square first; Toast and Clover later" (PROPOSED).
- `SYSTEM_CONTEXT.md` §8: the background-job platform is an **open decision**
  that requires an ADR.
- PR #74's enum lists `toast`, `clover`, `vagaro`, `housecall_pro`,
  `google_sheets`. None has an adapter. They are names, not integrations.

## 1.5 Missing entirely

Connection records, credential storage for third-party OAuth tokens, OAuth
state/PKCE storage, a provider registry, provider webhooks other than Twilio and
Stripe, sync runs and checkpoints in use, a recipient picker, an eligibility
decision log, MFA, alerting, and any owner-facing Connections screen.

## 1.6 Findings that affect this design

**F-1. The composer mints consent on every send.**
`features/dashboard/text-request-composer.tsx` posts
`consent: { source: "owner_import" }` with every Text Request, and
`text-request-service.ts` turns that into an `opted_in` consent event with an
empty evidence object before scheduling. The owner is never asked, nothing is
shown, and no wording is recorded. The consent gate therefore passes for any
number typed into the box. This contradicts "an unknown number is never
consent" in `TEXT_REQUESTS.md`. It must be fixed before any connected
recipient can reach the composer, otherwise every imported Square phone number
becomes `opted_in` the first time it is used. Proposed fix: doc 7, §7.4.

**F-2. The outbound message carries no business name and no opt-out line.**
`DEFAULT_TEMPLATE` is "How was your visit? Tap here to leave a review:
{{link}}". The owner can replace it with any text containing `{{link}}`.
Carrier and CTIA guidance expect sender identification and opt-out
instructions. Proposed fix: doc 8, §8.5, with the segment count computed on the
final body including the footer.

**F-3. The SMS allowance shown to owners disagrees between `main` and PR #67.**
`main` grants 150/500/1,500 monthly segments (matching the brief). PR #67's
`frontend/lib/owner/entitlements.ts` hard-codes `smsIncluded: 0` with the
comment "Pipe A never includes SMS". If #67 lands as is, the owner UI says
zero while the ledger grants 150. Not changed here; flagged for the owner.

**F-4. Credit packs cannot be bought.** The brief's packs (50 for $4, 200 for
$16, 500 for $40) are not in code. The insufficient-credits path in doc 8 needs
a real purchase route, so this is a Phase 3 dependency, not optional.

**F-5. MFA is required by an APPROVED rule and does not exist.** See README,
decision 3.

**F-6. The scheduler runs once a day in the deployed configuration.** A sync
worker on that cadence would make "last synced" mean "yesterday". Webhook
processing is designed to run inline after the durable write (doc 6), so the
cadence only bounds retries and polling, but the owner should know.

**F-7. Location timezone defaults to UTC.** Quiet hours for a connected visit
are computed in the location's zone. A location still on `UTC` would send at
the wrong local time. The connection setup step that maps a provider location
to a ReviewBoost location also confirms the zone (Square returns one per
location).

**F-8. Every plan gets a 7-day trial at checkout.** `billing-service.ts`
sets `trial_period_days: TRIAL_DAYS` regardless of plan. The brief says only
Starter has a trial. Reported, not changed (doc 10 §10.2).

## 1.7 Reuse map

| Need | Reuse | Do not build |
|---|---|---|
| Tenancy, roles, RLS | `app.has_org_role`, composite FKs, `requireOwner` | Any client-supplied org id |
| Encryption | `crypto.ts` envelope, extended with a separate integration key | A second crypto module |
| Consent and opt-out | `sms_consent_events`, `sms_consent_state`, `sms_phone_optout`, `app.sms_can_send` | A connection-level consent flag |
| Suppression, quiet hours, dedupe | `sms_suppressions`, `quiet-hours.ts`, `dedupe.ts` | New copies inside an eligibility module |
| Messaging | `text_requests`, `sms_outbox`, dispatch, provider boundary | A second SMS path |
| Credits | `sms_credit_grants`, reservations, `sms_quota_ledger` | Any balance column elsewhere |
| Durable inbox pattern | `sms_webhook_inbox` semantics (verify, then dedupe write, reclaim on retry) | An in-memory or Redis queue |
| Worker trigger | `workerAuthorized`, `/internal/*` endpoints, existing crons | A new job platform without an ADR |
| Audit | `audit_events` written inside the state-change transaction | A separate audit store |
| Customers | PR #74 schema and import pipeline, amended (§1.8) | A second customers table |
| Owner UI | `AppShell`, `components/ui/*`, Settings rows, design tokens | A new top-level nav item |

## 1.8 Open pull requests

| PR | Relevance | Recommendation |
|---|---|---|
| **#74** `feat(customers): canonical customer model + import/integration foundation` (base `f49af1c`, 12 files) | **High.** Customers, contact identities, external links, import jobs, visits, sync checkpoints, `customer_source_connections` | Adopt as the canonical model with the amendments in doc 5 §5.9: replace `customer_source_connections` with `integration_connections`; scope external links by connection, not by provider name; add `location_id` and visit status to visits; drop speculative provider enum values; restrict reads by role. It has not been reviewed or merged |
| **#73** `feat(sms): pricing + routing engine` (base `7c3473f`, older than the ledger) | Medium. Provider rate tables, margin math, quotes | Not a dependency. Its base predates the two-source ledger, so it needs a rebase before anything here could rely on it. Credit cost in this design is segments, which the merged ledger already handles |
| **#67** `ReviewBoost V1 Final Integration` (384 files) | Medium. Worker heartbeats, Stripe price authority, account deletion, production scheduler, MFA design | Account deletion must be extended to integration data (doc 11). The scheduler and heartbeats are reused once merged. F-3 conflicts with the ledger |
| **#75** into #67 | Low | No overlap beyond #67 |

## 1.9 Migration risks

- **#74 and this design both add customer tables.** Only one can land. The
  Phase 1 migration is a revision of #74, numbered after whatever is on `main`
  at the time, never a parallel schema.
- **Enum changes need care.** Removing values from `customer_source_kind`
  requires a drop-and-recreate before any row uses them; once #74 lands with
  data, it becomes a populated-upgrade problem (`LESSONS.md`: functions whose
  return type changes cannot use `create or replace`).
- **Consent backfill.** Fixing F-1 does not undo the `opted_in` events already
  recorded with `source = owner_import` and empty evidence. Production has no
  live sends yet, so the safe moment to reclassify those events is before
  launch. The migration appends `unknown` events for them rather than editing
  the ledger.
- **Upgrade proof.** Every migration in this plan must pass
  `supabase/upgrade/populated_upgrade_test.sql` against a populated baseline,
  as the V1 program did.
- **No production migration is run by this work.**
