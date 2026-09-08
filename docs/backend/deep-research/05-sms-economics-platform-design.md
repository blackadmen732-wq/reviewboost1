# Text Requests economics platform — backend design and phased plan

**Verdict.** The agreed architecture is directionally right: two payment systems, credits as the only owner-facing unit, integer micro-unit money, Postgres as the accounting system, append-only ledgers, quote-then-reserve, `provider_unknown` never auto-retried, and a hard margin floor that may refuse rather than silently lose money. It is not buildable as drawn. It over-specifies routing intelligence, price-recommendation automation, five provider adapters, and an eight-line itemised landed-cost model before any live provider bill exists; it under-specifies the credit unit once destinations differ, whether Stripe fees and 10DLC monthly fees sit inside the 70% floor, and how reserve/consume/release stay balanced when the quoted segment count is not the billed one. The 70% hard floor is achievable on typical US A2P SMS **if** (a) the floor is applied to purchased usage after processor fees, (b) 10DLC brand/campaign/number costs are platform-pooled rather than allocated onto a 50-message month, and (c) the owner-facing credit price is set from a versioned price book around 4–6 ¢ per US segment, not from a 1 ¢ “near cost” instinct. It is **not** achievable as a universal invariant on small credit baskets, per-tenant 10DLC, or “1 segment = 1 credit at one global price” once traffic leaves US long codes. Phase 1 should extend the existing quota ledger, segment engine, and dispatch recheck — not invent a parallel `customer_credit_ledger` — and must be valuable with fixture rate cards and no Stripe account.

State labels in this document follow `SYSTEM_CONTEXT.md`: **APPROVED** / **PROPOSED** / **IMPLEMENTED** / **CI-TESTED** / **LIVE-VERIFIED** / **NOT BUILT**. Nothing below is LIVE-VERIFIED. External prices are snapshots fetched on 2026-09-08 and must be re-read before a price book is published.

---

## Method

Read, in this order: `SYSTEM_CONTEXT.md`, `STATUS.md`, `TESTING.md`, `LESSONS.md`, `docs/backend/TEXT_REQUESTS.md`, `docs/backend/ARCHITECTURE.md`, `docs/backend/CHANGE_SAFETY_ARCHITECTURE.md`, `docs/backend/ENVIRONMENT.md`. Then the TypeScript engines under `frontend/lib/server/sms/` (`cost.ts`, `segments.ts`, `quiet-hours.ts`, `dedupe.ts`, `keywords.ts`, `phone.ts`, `dispatch.ts`, `text-request-service.ts`, `webhook-service.ts`, `provider/types.ts`, `provider/index.ts`, `provider/twilio.ts`, `provider/fake-provider.ts`), the API routes under `frontend/app/api/v1/text-requests/`, `frontend/app/api/v1/internal/sms/dispatch/`, `frontend/app/api/v1/webhooks/sms/`, the unit tests `frontend/tests/unit/sms-*.test.ts`, and migrations `supabase/migrations/20260902000100_text_requests_consent.sql` through `20260902000700_text_requests_service_rpcs.sql` plus the quota and pipeline tests in `supabase/tests/text_requests_test.sql`.

Inspected the running local Supabase Postgres (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`, container `supabase_db_reviewboost`) **read-only** on 2026-09-08: table list, column types, check/unique/foreign-key constraints, indexes, RLS flags and policies, grants to `anon` / `authenticated` / `service_role`, enum labels, and `pg_get_functiondef` for `app.sms_request_transition_allowed`. Did not run migrations or `supabase db reset`.

Web sources (all retrieved 2026-09-08 unless a page carries its own `dateModified`):

| Fact | Source | Date on page / fetch |
| --- | --- | --- |
| Twilio US SMS/MMS list rates; long-code / toll-free / short-code; carrier pass-through table; failed-message fee $0.001; number rental | [Twilio SMS pricing (United States)](https://www.twilio.com/en-us/sms/pricing/us) | fetched 2026-09-08 |
| Twilio messaging pricing summary (SMS starts at $0.0083 plus carrier fees; numbers from $1.15/month) | [Twilio Messaging pricing](https://www.twilio.com/en-us/pricing/messaging) | fetched 2026-09-08 |
| Twilio A2P 10DLC brand/campaign onboarding fees (marketing page) | [Twilio 10DLC product page](https://www.twilio.com/en-us/phone-numbers/a2p-10dlc) | fetched 2026-09-08 |
| Twilio A2P Brand fees (TCR $4.50; Standard vetting $41.50) | [Twilio A2P 10DLC Brand Registration](https://www.twilio.com/docs/trust-hub/registrations/a2p-10dlc-brand) | fetched 2026-09-08 |
| Twilio Message resource: `NumSegments`, `Status`, `price` / `price_unit` (decimal string, often null until priced) | [Twilio Messages resource](https://www.twilio.com/docs/messaging/api/message-resource) | fetched 2026-09-08 |
| Twilio UsageRecords `Price` / `PriceUnit` for billed usage | [Twilio UsageRecords](https://www.twilio.com/docs/usage/api/usage-record) | fetched 2026-09-08 |
| Twilio webhook retries and `I-Twilio-Idempotency-Token` as a **webhook** retry distinguisher; default retry count 1 on connect timeout | [Twilio webhook connection overrides](https://www.twilio.com/docs/usage/webhooks/webhooks-connection-overrides) | fetched 2026-09-08 |
| Telnyx US SMS from $0.004 per part + published carrier passthrough; `dateModified` 2026-08-10 | [Telnyx SMS API pricing](https://telnyx.com/pricing/messaging) | page `dateModified` 2026-08-10; fetched 2026-09-08 |
| Telnyx 10DLC registration and carrier fees (no Telnyx markup claimed) | [Telnyx 10DLC Fees and Charges](https://support.telnyx.com/en/articles/5634625-10dlc-fees-and-charges) | page “Written … July 22, 2026”; TCR fee table “as of 7/22/2025” |
| Stripe Standard US domestic cards 2.9% + 30¢; international +1.5%; FX +1%; disputes $15 | [Stripe Pricing](https://stripe.com/pricing) | fetched 2026-09-08 |
| Stripe Billing pay-as-you-go 0.7% of Billing volume (on top of Payments) | [Stripe Pricing](https://stripe.com/pricing) Billing section | fetched 2026-09-08 |
| Stripe webhooks: retries up to three days in live mode; no ordering guarantee; duplicate `event.id`; refetch objects | [Stripe Webhooks](https://docs.stripe.com/webhooks) | fetched 2026-09-08 |
| Stripe API idempotency keys, 24-hour retention, POST only | [Stripe Idempotent requests](https://docs.stripe.com/api/idempotent_requests) | fetched 2026-09-08 |
| Stripe subscription statuses and failed-payment behaviour | [Stripe How subscriptions work](https://docs.stripe.com/billing/subscriptions/overview) | fetched 2026-09-08 |

Where a third-party blog disagrees with a vendor’s own page, this plan uses the vendor page.

---

## What already exists

Honest inventory of the Text Requests backend. Status: **IMPLEMENTED, CI-TESTED, not LIVE-VERIFIED.** CI evidence as of `STATUS.md` (2026-09-05): 78 vitest cases in `frontend/tests/unit/sms-*.test.ts` and 59 pgTAP assertions in `supabase/tests/text_requests_test.sql`. No configured provider account, no real carrier send, no Stripe, no owner UI, no quota purchase.

### Segment engine — IMPLEMENTED, CI-TESTED

`frontend/lib/server/sms/segments.ts` (`computeSegments`) distinguishes GSM-7, GSM-7 extension characters (two units), and UCS-2; uses 160/153 and 70/67 limits; does not split a multi-unit character across a segment boundary. The financial system must keep calling this (or an identical SQL twin) and must never assume 1 recipient = 1 charge. Covered by `frontend/tests/unit/sms-segments.test.ts`.

### Integer micro-unit cost preview — IMPLEMENTED, CI-TESTED; production rate NOT BUILT

`frontend/lib/server/sms/cost.ts` (`estimateMessageCost`, `previewCost`) multiplies segments by a caller-supplied `perSegmentMicros` using only `Number.isSafeInteger` arithmetic and throws rather than overflowing `Number.MAX_SAFE_INTEGER`. Currency is an uppercase ISO-4217 code. `getProviderRate()` in `frontend/lib/server/sms/provider/index.ts` reads `SMS_RATE_PER_SEGMENT_MICROS` / `SMS_RATE_CURRENCY`; production throws if the rate is unset; development falls back to 0. That is a **single flat per-segment figure**, not a landed-cost engine. Tests: `frontend/tests/unit/sms-cost.test.ts`.

The preview API `POST /api/v1/text-requests/preview` (`frontend/app/api/v1/text-requests/preview/route.ts` via `previewTextRequest` in `frontend/lib/server/sms/text-request-service.ts`) returns `perSegmentMicros` and `totalMicros` to the authenticated owner. If the env rate is the true provider COGS, that **leaks commercially sensitive cost** and contradicts the rule that the owner sees credits, never rates. Treat this as a defect the economics work must close, not as a feature to extend.

### Quota ledger and reservation — IMPLEMENTED, CI-TESTED; purchase NOT BUILT

Live tables (inspected 2026-09-08):

| Table | Role |
| --- | --- |
| `sms_quota_ledger` | Append-only movements. Columns: `id uuid PK`, `org_id uuid NOT NULL FK organizations`, `kind sms_quota_entry_kind NOT NULL`, `amount bigint NOT NULL CHECK (amount >= 0)`, `correlation_key text NOT NULL` length 8–200, `request_id uuid`, `note text`, `effective_at timestamptz`, `expires_at timestamptz`, `created_at timestamptz`. Unique `(org_id, kind, correlation_key)`. Indexes: `(org_id, effective_at desc)`, partial `(request_id)`. |
| `sms_quota_balance` | Projection. PK `org_id`. `allocated`, `reserved`, `consumed` all `bigint >= 0`. Available conceptually `allocated - reserved - consumed`, with unswept expirations subtracted in `app.sms_quota_available`. |

Enum `sms_quota_entry_kind` (live): `allocation`, `reservation`, `consumption`, `release`, `refund`, `expiration`, `adjustment`. There is **no** `app.sms_quota_adjust` function in the live database. The `adjustment` kind is unused.

RPCs (live; `app.*` granted to `service_role` only; public wrappers only for allocate / available / expire):

- `app.sms_quota_lock_balance(uuid)` — insert-if-missing, `SELECT … FOR UPDATE`.
- `app.sms_quota_allocate(org, amount, correlation_key, expires_at, note)` — idempotent insert; bumps `allocated`.
- `app.sms_quota_reserve(org, amount, correlation_key, request_id)` — sweeps expirations under the lock; idempotent success if the reservation key exists; refuses if `available < amount`.
- `app.sms_quota_consume` / `app.sms_quota_release` / `app.sms_quota_refund` — idempotent on `(org, kind, correlation_key)`; mutate the projection.
- `app.sms_quota_apply_expirations` / `app.sms_quota_expire` / `app.sms_quota_available`.
- Public: `rpc_sms_quota_allocate`, `rpc_sms_quota_available`, `rpc_sms_quota_expire` (service-role only).

RLS: ENABLE, not FORCE. Owners/admins may **SELECT** their org’s ledger and balance. No authenticated INSERT/UPDATE/DELETE. `service_role` still has UPDATE and DELETE on the ledger — append-only is by grant convention, not by trigger. That is weaker than the economics platform needs.

**Semantic fact the new work must not ignore:** `amount` is “whole message-send units” (the migration comment), and `app.sms_schedule_request` reserves `p_segments` (one quota unit per segment). The ledger is a **credit-count** ledger, not a money ledger. `text_requests.estimated_cost_micros` is a parallel cache of the env rate × segments; it is not what is reserved.

**Hole the new settle path must close:** consume, release, and refund do not look up the matching reservation or enforce mutual exclusion. They accept any `p_amount`. Pipeline code always passes `text_requests.reserved_quota` and uses correlation key `'req:' || request_id` for every kind. Because uniqueness is `(org, kind, key)`, reserve/consume/release can share the same string. If both consume and release run for one request, `reserved` is decremented twice (`greatest(0, …)` hides the second). There is no “consume 243 of 250, release 7” primitive.

### Request state machine, `provider_unknown`, duplicate-send guard — IMPLEMENTED, CI-TESTED

`text_requests.status` (live enum): `scheduled`, `queued`, `suppressed`, `sending`, `submitted`, `delivered`, `failed`, `provider_unknown`, `cancelled`. Money-relevant columns on `text_requests` (live): `encoding text CHECK (gsm7|ucs2)`, `unit_count integer >= 0`, `segments integer >= 1`, `estimated_cost_micros bigint >= 0`, `cost_currency char(3)`, `reserved_quota integer >= 0` (note: **integer**, not bigint — inconsistent with the ledger). Unique `(org_id, dedupe_key)`. Members may SELECT; no client writes.

`sms_delivery_attempts`: per-provider attempt; unique `(org_id, request_id, attempt_number)`; partial unique index `sms_delivery_attempts_one_inflight_idx` on `request_id` where status in (`created`, `dispatched`) — the duplicate-send guard. `reconciliation_state` in (`pending`, `reconciled`, `unresolved`). Owner/admin SELECT only.

`app.sms_settle_attempt` (migration `20260902000600_text_requests_pipeline.sql`): `submitted` consumes quota; `failed` releases; `provider_unknown` **neither consumes nor releases** and marks `reconciliation_state = 'unresolved'`. `app.sms_apply_delivery_status` later consumes if unknown resolved to delivered, or refunds/releases on failed.

`app.sms_request_transition_allowed` (live body) **allows** `provider_unknown → queued` and `failed → queued`. Dispatch does not use those edges today (`frontend/lib/server/sms/dispatch.ts` parks `provider_unknown` and never retries it). The SQL edge is a duplicate-send footgun the economics work must close: an automated failover worker that “re-queues unknowns” would be legal according to the database.

### Provider adapter boundary — IMPLEMENTED (Twilio + fake); other providers NOT BUILT

`SmsProvider` in `frontend/lib/server/sms/provider/types.ts`: `send`, `classifyError`, `verifySignature`, `parseWebhook`. Outcomes: `submitted` | `failed` | `provider_unknown`. Known webhook providers: `twilio`, `fake` (`frontend/lib/server/sms/webhook-service.ts`). Production `getSmsProvider()` fails closed (`ConfigError`) if the selected provider is missing. Twilio adapter (`frontend/lib/server/sms/provider/twilio.ts`) POSTs `Messages.json`, maps error codes, verifies `X-Twilio-Signature`, classifies inbound vs status by presence of `Body`, and on fetch timeout/abort returns `provider_unknown`. It also sends header `I-Twilio-Idempotency-Token`. Twilio’s **current** Messages resource documentation (fetched 2026-09-08) does not document that header as a create-message request field; Twilio’s webhook docs document it as a distinguisher Twilio **sends to you** on retried callbacks. Do not treat the outbound header as a documented accounting control. The durable duplicate-send control is the in-flight unique index plus `idempotency_key` on `sms_outbox`.

Telnyx, Plivo, Vonage, Sinch adapters: **NOT BUILT**.

### Dispatch-time recheck — IMPLEMENTED, CI-TESTED

`app.sms_begin_dispatch` (same pipeline migration), called from `dispatchOnce`: recovers a stranded `sending` row to `provider_unknown` (does not re-send); re-runs `app.sms_can_send` (phone-level opt-out, consent, suppression); re-checks quiet hours [09:00, 20:00) in `recipient_timezone`; otherwise opens one attempt. Quiet-hours defer uses `app.sms_outbox_defer`. Consent/STOP/HELP live in `sms_consent_events` / `sms_consent_state` / `sms_phone_optout` / `sms_suppressions`. `sms_phone_optout` is org-agnostic, RLS enabled, **no policy**, no authenticated grant — platform-internal. That is the posture commercially sensitive rate tables must copy.

What dispatch does **not** recheck today: price-book validity, margin floor, provider eligibility beyond “whatever `getSmsProvider()` returns”, rate freshness, or that reserved credits still match the body about to be sent. The body is decrypted and sent as stored at schedule time; segments are not recomputed at send.

### Outbox, webhook inbox, scheduling API — IMPLEMENTED, CI-TESTED

`sms_outbox`: unique `idempotency_key`; claim via `FOR UPDATE SKIP LOCKED` + lease; lease-owner guards on complete/fail/defer. RLS enabled, no client policies. `sms_webhook_inbox`: unique `(provider, dedupe_key)`; signature verified **before** occupying the real dedupe namespace; unverified events stored under `unverified:`.

Schedule path: `POST /api/v1/text-requests` authenticates owner/admin, rate-limits via `rpc_consume_rate_limit`, server-computes segments, calls service-role-only `rpc_schedule_text_request` which re-checks membership/role/stand ownership and delegates to `app.sms_schedule_request`. That function inserts the request (dedupe `ON CONFLICT DO NOTHING`), reserves `p_segments`, inserts the outbox row, writes `audit_events` (`text_request.scheduled`) in **one transaction**. Cancel: authenticated `rpc_cancel_text_request` → release + mark outbox done, only from `scheduled`/`queued`.

### What does not exist (economics-specific)

No `messaging_providers`, rate cards, health metrics, routing decisions, quotes, price books, credit packages, payment tables, margin policies, or actual-cost rows. No Stripe types, env vars, or routes (`STATUS.md`, `SYSTEM_CONTEXT.md` §5.1). MFA for billing is **APPROVED** as a product rule (`SYSTEM_CONTEXT.md` §9) but **NOT BUILT**: `supabase/config.toml` has `[auth.mfa.totp] enroll_enabled = false` / `verify_enabled = false`, and there is no TOTP/MFA application code under `frontend/`. `CHANGE_SAFETY_ARCHITECTURE.md` still lists **messaging** and **billing** as future modules; Text Requests already is the messaging module. Economics attaches to messaging; Stripe subscription is billing. They must not share tables.

---

## Design critique

### What is sound

Separating software subscription from Text Request credits is correct and already implied by the repo: `rpc_sms_quota_allocate` is the only mint, and nothing in the send path talks to Stripe. Credits as the owner-facing unit, with money remaining internal, matches the existing ledger (counts) plus `estimated_cost_micros` (money, currently misused as a preview leak). `provider_unknown` semantics, dispatch-time consent/quiet-hours, integer micros, append-only ledger, and “Postgres is the accounting system” are already house law. Deterministic routing before any model is the right default. Versioned price books (customer price sticky, provider cost not) are the only way a 15-minute quote is honest. Failover only on a clear not-accepted is already how `SmsErrorClass` and settle are shaped.

### Over-engineered for the current stage

**Five provider adapters and a routing market.** The live boundary is one configured provider. Building Telnyx/Plivo/Vonage/Sinch now is speculative API work with no accounts, no webhooks, and no bills. Phase 1 needs a **rate-card row format** and a `provider` text check that already exists on `sms_delivery_attempts`, plus the `SmsProvider` interface. A second adapter is justified only when a second live account exists.

**Eight-component landed cost before the first invoice.** Provider message charge and carrier surcharge can be populated from **published** rate cards (Twilio and Telnyx both publish them). Sender/number allocation, A2P monthly fees, provider minimums, messaging-service fees, expected retry cost, and “direct messaging-infrastructure allocation” cannot be populated honestly until there is a bill and a chosen 10DLC topology (platform campaign vs per-tenant brand). Inventing them as zeros with a confidence flag is ceremony. Phase 1 should store **itemised JSON** with two required components (`provider_message`, `carrier_surcharge`) and optional later keys, not eight NOT NULL columns.

**Routing intelligence and a pricing recommendation engine.** Both require a history of actuals vs estimates. There is no live send. Shipping “intelligence” against fixture data teaches the wrong lessons and creates an automation path that can rewrite prices. They belong after reconciliation has run against real invoices (Phase 5+), and even then they **propose drafts**; they never publish.

**`margin_snapshots` as a first-class write table, `provider_health_metrics` / `provider_delivery_metrics` as streaming products, smart timing / message intelligence.** These are analytics and engagement layers. Compliance (STOP, quiet hours, dedupe, equal Google opportunity) already outranks them and is implemented. Do not couple them to money movement.

**A new `customer_credit_ledger`.** That name duplicates `sms_quota_ledger`. Creating it would fork the source of truth, break the existing schedule/dispatch RPCs, and violate expand–migrate–contract (`docs/backend/CHANGE_SAFETY_ARCHITECTURE.md`). Extend the existing ledger.

**Quote locking as a 15-minute reserved price in the request path for 5,000 recipients.** The current API schedules **one** recipient. A 5,000-row quote that encrypts bodies, inserts requests, and reserves credits inside one HTTP handler will time out and hold `sms_quota_balance` too long. Quotes should be computed asynchronously (or in chunked transactions); **confirm** is what reserves.

### Missing

**A settle primitive** that consumes `actual` and releases `reserved - actual` atomically, and refuses `actual > reserved` unless a second explicit top-up reserve succeeds.

**Ledger source metadata.** Allocations from a plan grant, a Stripe pack, a promo, and a manual adjustment are indistinguishable. Correlation keys are free-form text. Economics needs `source_kind`, `source_id`, and a money snapshot (`unit_price_micros`, `currency`, `price_book_version_id`) on allocation rows without making the count ledger into a money ledger.

**Append-only enforcement** on financial tables (trigger blocking UPDATE/DELETE), matching the spirit of `audit_events` but stronger than grants, because `service_role` can currently UPDATE `sms_quota_ledger`.

**MFA for billing-class operations.** Approved, not built. Stripe must not ship before an AAL2 (or equivalent) gate exists for purchase, refund, and privileged adjustment.

**Send-time recompute of segments** from the decrypted body, compared to `text_requests.segments` / `reserved_quota`. Templates should be immutable after confirm; if they are not, the reserved amount is a lie.

**Closing the `provider_unknown → queued` edge** (and documenting when `failed → queued` is allowed: only after release, new quote, new reservation, and a provider outcome of `failed` not `provider_unknown`).

**Tax, disputes, and promo-abuse policy.** Not engineering, but the schema must not assume $1 of Stripe charge = $1 of spendable credits after tax.

### Internally inconsistent

**“1 SMS segment = 1 credit” vs “each credit has a real monetary value” vs multi-country / multi-provider.** If a credit is a count that always costs the owner one unit regardless of destination, the **platform** eats destination variance and the 70% floor cannot be guaranteed per send. If a credit’s money value is global (say 5 ¢) but a UK segment costs 8 ¢ COGS, one credit cannot cover it. If credits_required = f(destination, encoding, provider), the owner no longer sees a stable “1 segment = 1 credit” rule. These three statements cannot all be true. Phase 1 should make the US long-code rule explicit and **refuse to quote** unsupported destinations rather than pretend the identity holds.

**70% hard floor vs Stripe’s 30 ¢ and vs 10DLC monthly fees.** See the arithmetic below. A floor that includes processor fees on a $5 basket, or that allocates a $10/month campaign onto 50 messages, is a different product from a floor on variable SMS COGS only. The discussion conflates them.

**Quote lock vs “provider cost must not move the customer price every thirty minutes.”** If the price book is already sticky (hours to weeks), a 15-minute quote lock is not about rate-card churn; it is about **not changing the credit count after the owner hits Send** (template edits, newly suppressed recipients, rounding). Using it as a hedge against provider-cost spikes is the wrong control — the price book is that control. During the lock, ReviewBoost absorbs COGS movement **up to the floor**; if the floor would break, it does not send, and it does not silently reprice.

**Rate-uncertainty reserve populated before any account exists.** A reserve with no empirical error distribution is a made-up margin pad. Phase 1 may store `confidence` (`published_list` | `account_contract` | `invoiced`) and refuse to send when `published_list` rates are older than a policy TTL. It should not invent a bps pad that pretends to be statistics.

**Gross margin = (revenue − COGS) / revenue with `price = COGS / (1 − target)`** is consistent only if revenue is the **net amount that pays for that message**. Mixing subscription MRR, Stripe fees, and SMS COGS into one ratio makes the 78% target meaningless. Split the ratios: SMS variable margin on purchased credits; contribution after processor fees on packs; included allotment as a subscription cost, not SMS revenue.

### Margin-feasibility arithmetic (published rates, 2026-09-08)

All money below is converted to integer micro-units in the contract section; here dollars are used only to show the published figures.

**Twilio US long-code A2P SMS** ([Twilio US SMS pricing](https://www.twilio.com/en-us/sms/pricing/us), 2026-09-08): outbound SMS **$0.0083 per segment**, inbound $0.0083. MMS outbound $0.022. Failed-message processing **$0.001** on Failed. Long-code rental **$1.15/month**.

**Twilio long-code carrier pass-through, outbound SMS, per segment** (same page): AT&T $0.0035; T-Mobile $0.0045; Verizon $0.0045; US Cellular $0.0050; all other $0.0040.

Variable COGS per **successful** outbound US long-code SMS segment, Twilio, T-Mobile destination:

`0.0083 + 0.0045 = 0.0128 USD` = **12_800 micros**.

AT&T: `0.0083 + 0.0035 = 0.0118` = 11_800 micros. US Cellular: 13_300 micros.

**Telnyx US local SMS** ([Telnyx messaging pricing](https://telnyx.com/pricing/messaging), `dateModified` 2026-08-10): **$0.004 per part** plus carrier passthrough. T-Mobile USA outbound SMS **$0.0045** per part on that same page (AT&T $0.0035, Verizon $0.0045, US Cellular $0.005). Telnyx’s older help article (July 22, 2026) still lists T-Mobile registered SMS at $0.003; the **pricing page** is the one to quote from.

Variable COGS, Telnyx, T-Mobile:

`0.004 + 0.0045 = 0.0085 USD` = **8_500 micros**.

**10DLC registration** (Twilio 10DLC page, 2026-09-08): Low-volume standard **$4** one-time brand + **$15** one-time campaign vetting + **$1.50–$10 per campaign per month**. Standard brand **$44** one-time + $15 + $1.50–$10/month. Sole proprietor $4 + $15 + **$2/month**. Twilio Brand docs: TCR brand **$4.50**; Standard vetting **$41.50**. Telnyx help: brand **$4.50**, campaign review **$15**, monthly **$1.50** (low-volume mixed) to **$10** (standard use cases); Telnyx claims pass-through at cost.

**Stripe Payments** ([stripe.com/pricing](https://stripe.com/pricing), 2026-09-08): US domestic cards **2.9% + 30¢** per successful charge; +1.5% international; +1% currency conversion; dispute received **$15**. **Stripe Billing** pay-as-you-go **0.7% of Billing volume** on top of Payments if subscriptions go through Billing. Credit **packs** should use Payments (Checkout / PaymentIntents), not Billing, unless the pack is an invoice line on a subscription.

Integer customer price from variable COGS at the discussed floors (`price = ceil(cogs / (1 − m))`):

| Route (1 SMS segment) | COGS micros | Price @ 70% (7000 bps) | Price @ 78% (7800 bps) | Price @ 85% (8500 bps) |
| --- | --- | --- | --- | --- |
| Twilio + T-Mobile | 12_800 | 42_667 ($0.0427) | 58_182 ($0.0582) | 85_334 ($0.0853) |
| Twilio + AT&T | 11_800 | 39_334 ($0.0393) | 53_637 ($0.0536) | 78_667 ($0.0787) |
| Telnyx + T-Mobile | 8_500 | 28_334 ($0.0283) | 38_637 ($0.0386) | 56_667 ($0.0567) |

A US owner-facing credit of **about 4–6 ¢** is in the 70–78% band on **Telnyx-class** variable COGS and in the 70% band on Twilio+AT&T; Twilio+T-Mobile at 4 ¢ is **below** 70% (`(40000 − 12800) / 40000 = 68%`). The 78% “normal target” on Twilio+T-Mobile needs **~5.8 ¢**, not 4 ¢.

**Stripe on small baskets** (Payments only, 2.9% + 30¢; integer cents: `fee_cents = ceil(gross_cents * 29 / 1000) + 30`):

| Pack | Gross | Stripe fee | Net | Credits | Net per credit | Twilio+T-Mobile 12_800: margin on **net** |
| --- | --- | --- | --- | --- | --- | --- |
| $5 / 100 credits (5.0 ¢ list) | $5.00 | $0.45 | $4.55 | 100 | 45_500 micros | (45500−12800)/45500 = **71.9%** |
| $10 / 250 credits (4.0 ¢ list) | $10.00 | $0.59 | $9.41 | 250 | 37_640 micros | (37640−12800)/37640 = **66.0% — below 70%** |
| $20 / 250 credits (8.0 ¢ list) | $20.00 | $0.88 | $19.12 | 250 | 76_480 micros | **83.3%** |
| $10 / 50 credits (20 ¢ list) | $10.00 | $0.59 | $9.41 | 50 | 188_200 micros | **93.2%** (the 30¢ is diluted; credits are expensive) |

Conclusion: the 70% floor **can** be held on variable US A2P COGS at commercially normal credit prices **if Stripe’s 30¢ is diluted across a large enough pack and/or the list price is ≥ ~4.3 ¢ on Twilio T-Mobile**. It **cannot** be a hard invariant on a cheap small pack, and it **cannot** survive allocating a $10/month 10DLC campaign onto a 50-message month (`10000000/50 = 200_000 micros` extra COGS → 70% price **~$0.71 per text**). 10DLC monthly and number rental must be **platform-pooled** (one ISV/low-volume campaign, shared numbers) or treated as subscription COGS, not per-message SMS COGS, until volume justifies per-tenant brands.

**UCS-2 / two-segment messages.** A single emoji doubles segments. Owner-facing “243 customers, 261 credits” is exactly this (some UCS-2 or concatenated bodies). The floor still holds **per segment** if credits scale with `computeSegments`. It fails if the UI sells “per recipient” credits.

**MMS** (Twilio $0.022 + ~$0.01 carrier) is a different product. Do not put MMS on the SMS credit identity.

### Quote-lock exploit

A 15-minute lock is not a useful hedge against Twilio changing list rates (those move on commercial timescales, not intra-hour). The real abuse cases are: (1) locking a quote then adding recipients or switching to a UCS-2 template so the reserved credits underpay; (2) locking many quotes across orgs if quotes reserved inventory (they must not); (3) confirming after STOP/quiet-hours would have reduced the batch, then arguing the locked credit count is still owed. Mitigations: quotes do not reserve; confirm recomputes eligibility and **may only decrease** billable recipients; body/template hash is part of the quote; send-time recheck; if COGS moved above the floor, **hold and notify**, do not reprice silently and do not send.

### Can the itemised model be populated without a live account?

Partially. `provider_message` and `carrier_surcharge` can be filled from published pages with `source = published_list` and a `fetched_at`. Account discounts, minimums, messaging-service fees, and allocated 10DLC cannot. Phase 1 should refuse to pretend otherwise.

---

## Numeric and arithmetic contract

**PROPOSED** (binding on implementation; not implemented).

### Units

- **Money:** integer **micro-units**, `bigint`, 1 USD = 1_000_000 micros. Column names end in `_micros`. Every money row carries `currency char(3)` uppercase ISO-4217. Phase 1 is USD-only (`CHECK (currency = 'USD')` on price books). Never `numeric`/`float`/`money`.
- **Credits:** integer counts, `bigint`, same as today’s `sms_quota_ledger.amount`. One credit is **not** a dollar. The monetary value of a credit is a property of a **price-book version** (and, for purchased packs, of the pack’s net proceeds), snapshotted onto the allocation row.
- **Margin:** integer **basis points**, `integer`, 1% = 100 bps. Floor 7000, target 7800, cap 8500.
- **Rates:** integer micros per **segment** (or per message for MMS, which is out of scope). Carrier fees are per segment on both Twilio and Telnyx published tables.

### Forbidden

IEEE-754 in any stored amount, any RPC argument, or any “display dollars” that are later written back. Twilio `Message.price` is a **decimal string** (example `"-0.00750"` with `price_unit: "USD"` on the Messages resource, often `null` until Twilio prices the message). Parse to micros with the rounding rule below; never `parseFloat` into a ledger.

### Rounding (direction is part of the contract)

Every conversion from a non-integer source **rounds so the platform does not understate COGS or overstate margin**.

| Step | Input | Output | Rule |
| --- | --- | --- | --- |
| Published rate $0.0083 → micros | decimal dollars | micros | `ceil(dollars × 1_000_000)` → 8_300 exactly here; $0.00835 → 8_350 |
| Per-segment COGS | provider micros + carrier micros [+ optional pad] | micros | Sum of already-integer micros; pad if any is `ceil` |
| Per-message COGS | per-segment × segments | micros | Integer multiply; overflow → error |
| Per-quote COGS | sum of per-message | micros | Integer sum |
| Customer price from target margin | COGS micros, margin bps | price micros | Ceil division (below) |
| Credits from a pack | net micros, list credit price | credit count | `floor(net / list_price)` would **short** the customer; packs sell a **stated integer credit count** for a **stated gross**; do not derive count from money. Implied value is diagnostic only. |
| Credits for a send | segments, destination multiplier | credits | `segments × multiplier`, multiplier ∈ {1} in Phase 1 US; always integer; **round up** if a future multiplier is rational |
| Stripe fee estimate | gross cents | fee cents | `ceil(gross_cents × 29 / 1000) + 30` for US domestic cards; store as micros (`fee_cents × 10_000`) |
| Stripe fee actual | Balance Transaction `fee` (cents) | micros | `fee_cents × 10_000` (exact) |
| Provider `price` string | e.g. `"-0.00750"` | micros | Absolute value, `ceil` to micros (cost is 7_500 here); sign is direction of the provider ledger, not ours |
| Display to owner | credits, maybe pack dollars | — | Dollars only for **their** purchases (major units from integer cents). Never display COGS or margin. |

Who absorbs residual rounding: **the platform**, inside the margin. The owner’s credit count is integer and sticky after confirm. Never “take one more credit” after send because ceil(COGS) ticked.

### Integer margin formulas

Let `cogs` and `price` be micros (`bigint > 0`), `m` margin bps, `0 < m < 10000`.

Gross margin bps, floored (do not claim a tenth of a basis point we did not earn):

```
margin_bps = floor( (price - cogs) * 10000 / price )
```

Customer price at a target margin, ceiled (never miss the target by rounding down):

```
price = ceil( cogs * 10000 / (10000 - m) )
      = (cogs * 10000 + (10000 - m) - 1) / (10000 - m)
```

in integer division. Worked example: `cogs = 12800`, `m = 7800`:

```
denom = 2200
price = (12800 * 10000 + 2199) / 2200 = 128002199 / 2200 = 58182
```

Check: `(58182 - 12800) * 10000 / 58182 = 45382 * 10000 / 58182 = 78000.17…` → `floor` = 7800.

If `price` is **fixed** by the price book (sticky credit price × credits):

```
if price <= 0: refuse
if (price - cogs) * 10000 < 7000 * price: refuse_or_reroute  -- integer form of margin < 70%
```

which rearranges without division to `(price - cogs) * 10000 < 7000 * price` i.e. `price * 3000 < cogs * 10000` i.e. `price * 3 < cogs * 10`. Use the multiplication form to avoid division. Overflow: `cogs * 10000` must be checked against `bigint` max before multiply; Phase 1 message COGS cannot approach that.

### Clamp policy (integer)

Inputs `risk_adjustment_bps`, `volume_discount_bps`, `contract_adjustment_bps` are signed integers with CHECKs (Phase 1: all zero; later, each bounded e.g. ±500).

```
raw = 7800 + risk_adjustment_bps - volume_discount_bps + contract_adjustment_bps
target = GREATEST(7000, LEAST(8500, raw))
```

Clamping **up** to 7000 is allowed. Clamping **down** to 8500 is allowed. There is no legal target below 7000. If a contract asks for 60%, refuse the contract row, do not clamp. If at `target` the sticky price-book price fails the floor inequality, do not send and do not auto-discount further.

### JS `Number` vs `bigint` vs 20_000 businesses

`frontend/lib/server/sms/cost.ts` correctly refuses unsafe integers. `Number.MAX_SAFE_INTEGER` = 9_007_199_254_740_991 micros ≈ **$9.007 billion**.

Scale sketch (not a forecast): 20_000 orgs, 8_000 sending in a month, 80 messages/org average ≈ 640_000 messages/month; 2_000_000 as a busy month. Per-message COGS ~ 1e4–2e4 micros. Platform-month COGS ~ 2e6 × 2e4 = 4e10 micros ≈ $40k — still far below the JS ceiling. A 5_000-recipient quote at 6 ¢ is 300_000_000 micros — trivial.

Still: **new money arithmetic belongs in Postgres `bigint` or TypeScript `bigint`**, not `number`. The existing `cost.ts` `number` path may remain for single-message preview **after** it stops being the owner-visible price and is used only server-side against a rate card. Any sum across a batch, a pack, or a day is `bigint`. Node `pg` returns `bigint` as string by default — keep it that way; do not `Number()` a ledger column.

`text_requests.reserved_quota` is `integer` (32-bit). A 5_000-recipient × 3-segment batch reserved on **one** request row would still fit; a future “batch request” that stores the whole quote’s credits on one integer is the risk. Promote `reserved_quota` to `bigint` in the Phase 1 expand migration.

### Two revenues, two margins (do not conflate)

1. **Purchased-credit SMS margin** (the 7000/7800/8500 controller): `revenue` = snapshotted net micros attributed to the credits consumed (pack net × credits_used / credits_issued, integer floor, remainder to platform). `cogs` = variable message COGS (provider + carrier [+ uncertainty pad once empirical]). Processor fees are **already removed** from revenue, not added to COGS.
2. **Pack contribution:** `gross − stripe_fee − attributed_sms_cogs` after the credits are used or expire. This can go below 70% on a tiny pack; that is a **catalogue** problem (minimum pack size / list price), not a send-time mute.

**Included subscription credits** are not SMS revenue. Track their COGS against the software plan. Do not run them through the 70% SMS floor or the send path will refuse “free” allotment that the plan advertised.

---

## Target architecture

Five engines, each attached to code that already exists. All are **PROPOSED** except where noted.

### 1. Cost — what does this message cost us?

**Attaches to:** `computeSegments` → replace `getProviderRate()` / `estimateMessageCost`’s single env figure with a rate-card lookup `(provider, country, sender_type, destination_type, effective_at)` returning integer component micros. Keep `cost.ts` safe-integer helpers or move the multiply into SQL.

**Does not attach to:** Stripe. Cost is independent of how the owner paid.

**Phase 1 behaviour:** one logical provider (`twilio` or `fake`), US, long code, SMS. Components: `provider_message`, `carrier_surcharge` (carrier unknown at quote time: use a **configured blend** or the **max** published carrier fee — max is the honest floor-preserving choice; blend is prettier and can break the floor. Use **max** for quoting COGS until the destination carrier is known; at reconcile, actual carrier). Optional `uncertainty_pad` = 0 until empirical.

### 2. Routing — who should send it?

**Attaches to:** `SmsProvider` interface and `app.sms_begin_dispatch`’s `p_provider` argument (already stored on `sms_delivery_attempts.provider`). Persist a `message_routing_decisions` row (or columns on the attempt) with the reason.

**Phase 1:** degenerate router: the configured provider if `eligible` and rates fresh; else refuse. Kill switch is a row flag, not a new service. Failover to a second provider is **NOT BUILT** until a second adapter is live. The existing rule stands: `provider_unknown` is not a failover trigger. Clear `failed` with `errorClass` in (`invalid_number`, `unsubscribed`, `carrier_rejected`, `insufficient_funds`, `rate_limited`, `provider_error`) may later justify another provider **only** when the first provider’s HTTP response said not accepted — never on timeout.

### 3. Pricing / margin — what should we charge?

**Attaches to:** schedule/preview. Today preview returns COGS-shaped micros; it must return **credits_required**, `encoding`, `segments`, and a quote id. Margin math is internal. Sticky **price_book_versions** supply `credit_price_micros` and `credits_per_segment` (Phase 1: 1).

**Does not** continuously move owner prices. Publishing a version is an explicit, audited, MFA-gated admin action (admin portal is NOT BUILT; until it exists, publish is a service-role RPC that still writes `audit_events` and requires a human `approved_by`).

### 4. Ledger / payment — what did they buy, reserve, consume?

**Attaches to:** `sms_quota_*` RPCs and `app.sms_schedule_request` / `sms_settle_attempt` / `sms_cancel_request` / `sms_begin_dispatch` suppression release. Purchase (when built) calls `app.sms_quota_allocate` with a Stripe-backed correlation key; it does not insert into the ledger from Node without the RPC.

**Does not** use Stripe as a balance. Stripe is a processor record.

### 5. Reconciliation / intelligence — what actually happened, and what should change?

**Attaches to:** `sms_webhook_inbox` + `sms_apply_delivery_status` + a **new** poller that GETs Twilio Message resources / UsageRecords (Twilio `price` is often null at submit). Compare estimate vs actual. Intelligence (recommendation, routing stats) is a **reader** of those tables and a **writer of drafts**.

**Does not** claim SMS open rates or Google-review posting (`SYSTEM_CONTEXT.md` review-integrity rules unchanged). Outcomes remain: provider accepted, delivery receipt, link opened (`google_review_clicks` already exists for tap-flow), flow started, rating submitted, STOP/HELP, provider error.

---

## Schema by phase

Conventions copied from Text Requests migrations: `uuid` PKs; composite `(id, org_id)` on tenant parents; `ENABLE ROW LEVEL SECURITY` not FORCE (`LESSONS.md`); revoke direct writes; `SECURITY DEFINER` `app.*` with `set search_path = ''`; thin `public.rpc_*` wrappers; `service_role` only for mint/settle; `audit_events` in the same transaction; correlation keys 8–200 chars; no `anon` access. Do **not** write these migrations in this change; specify them.

**RLS posture classes:**

- **Tenant-readable:** `authenticated` SELECT via `app.has_org_role(..., {owner,admin})` (or member where noted). No writes.
- **Tenant-readable, column-restricted:** SELECT granted only on non-sensitive columns (house pattern from `team_praise_records`). Use this so a tenant cannot infer COGS/margin/provider rates from PostgREST.
- **Platform-internal:** RLS enabled, **zero policies**, **zero grants** to `anon`/`authenticated` (copy `sms_outbox` / `sms_webhook_inbox` / `sms_phone_optout`). Service-role / definer only.

**Append-only:** `BEFORE UPDATE OR DELETE` trigger raising an exception on `sms_quota_ledger`, `sms_consent_events`, `audit_events` (if not already immutable), and new financial event tables. Projections (`sms_quota_balance`, quote status, request status) remain mutable through RPCs only.

Proposed migration filenames (timestamp assigned at implementation, after `20260902000700`):

- `…_sms_econ_ledger_harden.sql`
- `…_sms_econ_rate_cards.sql`
- `…_sms_econ_price_books.sql`
- `…_sms_econ_quotes.sql`
- `…_sms_econ_packages.sql` (catalogue only in Phase 1)
- later phases as listed.

### Phase 1 — fixture economics (no live provider, no Stripe)

Valuable alone: an owner-admin can preview a batch as **credits**, a price book exists, a quote can be locked, credits can be allocated by a **fixture** `rpc_sms_quota_allocate`, reserved/consumed/released with remainder, and tests prove the integer floor.

#### Hardening of existing objects

- Trigger `sms_quota_ledger_immutable` preventing UPDATE/DELETE.
- `text_requests.reserved_quota` → `bigint` (expand: add `reserved_quota_bigint`, backfill, switch RPCs, drop old — or `ALTER … TYPE bigint`, which is compatible for integer data).
- New enum values via `ALTER TYPE … ADD VALUE` (cannot run in a transaction in older Postgres; PG 17 allows it — this project is PostgreSQL 17 per `ARCHITECTURE.md`): consider **new enum** `sms_quota_source_kind` rather than overloading `kind`.
- `app.sms_quota_settle_reservation(p_org_id, p_correlation_key, p_consume_amount)` — see concurrency section.
- Drop or restrict SQL edges: remove `('provider_unknown','queued')` from `sms_request_transition_allowed` unless a named reconciliation RPC sets it after human/provider confirmation that **nothing was accepted**. Keep `failed → queued` only behind a new `app.sms_requeue_failed_request` that requires prior release and a new reservation.
- `POST …/preview` response: stop returning `perSegmentMicros` / `totalMicros` to the client. Return `segments`, `encoding`, `credits_required`, `quote_id` (nullable until quote table exists).

#### Tables — platform-internal unless noted

**`messaging_providers`** (platform-internal)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `code` | text UNIQUE | `twilio`, `fake`, later `telnyx` |
| `display_name` | text | never shown to tenants |
| `eligible` | boolean NOT NULL DEFAULT true | kill switch |
| `supports_sender_types` | text[] | e.g. `{long_code,toll_free}` |
| `created_at` | timestamptz | |

Check: `code` length 1–40 matching `sms_delivery_attempts.provider`.

**`provider_accounts`** (platform-internal)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `provider_id` | uuid FK | |
| `label` | text | `prod`, `fixture` |
| `status` | text CHECK (`active`,`disabled`,`pending`) | |
| `credentials_ref` | text | name of env/secret — **not the secret** |
| `default_sender_type` | text | |
| `created_at` | timestamptz | |

No credential material in Postgres.

**`provider_rate_cards`** (platform-internal, append-only versions)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `provider_id` | uuid FK | |
| `country_code` | char(2) | `US` Phase 1 |
| `sender_type` | text | `long_code` |
| `destination_type` | text | `mobile`, `landline`, `unknown` |
| `message_kind` | text CHECK (`sms`,`mms`) | Phase 1 `sms` only |
| `carrier` | text | nullable = “unknown / max” |
| `component` | text | `provider_message`, `carrier_surcharge` |
| `rate_micros` | bigint CHECK ≥ 0 | |
| `currency` | char(3) | |
| `effective_from` | timestamptz NOT NULL | |
| `effective_to` | timestamptz | null = open |
| `source` | text CHECK (`published_list`,`contract`,`invoice`,`manual`) | |
| `confidence` | text CHECK (`list`,`account`,`invoiced`) | |
| `fetched_at` | timestamptz | |
| `row_hash` | text | idempotency of ingest |

Unique: `(provider_id, country_code, sender_type, destination_type, message_kind, coalesce(carrier,''), component, effective_from, source)`. Exclusion or CHECK `effective_to IS NULL OR effective_to > effective_from`. Index for lookup: `(provider_id, country_code, sender_type, message_kind, effective_from DESC)`.

**`provider_rate_sync_runs`** (platform-internal)

`id`, `provider_id`, `started_at`, `finished_at`, `status` (`ok`,`failed`,`partial`), `rows_upserted integer`, `error_class text`, `source text`. Phase 1 rows are **manual fixture inserts**, not a Twilio Pricing API crawler.

**`margin_policies`** (platform-internal, versioned, append-only)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `version` | integer NOT NULL | |
| `floor_bps` | integer NOT NULL CHECK = 7000 | Phase 1 freeze; changing floor is a new version |
| `target_bps` | integer NOT NULL CHECK = 7800 | |
| `cap_bps` | integer NOT NULL CHECK = 8500 | |
| `risk_adjustment_bps` | integer NOT NULL DEFAULT 0 | |
| `volume_discount_bps` | integer NOT NULL DEFAULT 0 | |
| `contract_adjustment_bps` | integer NOT NULL DEFAULT 0 | |
| `stale_rate_max_age` | interval NOT NULL | e.g. 14 days for `published_list` |
| `effective_from` | timestamptz NOT NULL | |
| `approved_by` | uuid | auth.users; null in fixture tests |
| `created_at` | timestamptz | |

Unique `(version)`. CHECK `floor_bps <= target_bps <= cap_bps`. Automation cannot UPDATE; insert only via `app.econ_publish_margin_policy`.

**`price_books`** (platform-internal metadata) + **`price_book_versions`** (append-only, tenant-readable **restricted**)

`price_books`: `id`, `code` unique (`us_sms_standard`), `status` (`active`,`retired`).

`price_book_versions`:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `price_book_id` | uuid FK | |
| `version` | integer | |
| `effective_from` | timestamptz | |
| `customer_tier` | text | `standard`,`enterprise`; Phase 1 `standard` |
| `country_code` | char(2) | |
| `credits_per_segment` | integer NOT NULL CHECK = 1 | Phase 1 |
| `credit_price_micros` | bigint NOT NULL CHECK > 0 | owner-facing implied value |
| `currency` | char(3) | |
| `status` | text CHECK (`draft`,`published`,`superseded`) | |
| `reason` | text | required on publish |
| `approved_by` | uuid | |
| `created_at` | timestamptz | |

Unique `(price_book_id, version)`. Published rows immutable (trigger). Tenants must **not** SELECT `credit_price_micros` if that reveals margin vs cost; they may see credits they will be charged. Prefer **not** exposing this table at all; expose quotes only.

**`pricing_quotes`** (tenant-scoped, column-restricted SELECT)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `org_id` | uuid NOT NULL | composite unique `(id, org_id)` |
| `price_book_version_id` | uuid NOT NULL | |
| `margin_policy_id` | uuid NOT NULL | |
| `status` | text | `open`,`confirmed`,`expired`,`cancelled` |
| `expires_at` | timestamptz NOT NULL | confirm window, default 15 minutes |
| `recipient_count` | integer | |
| `eligible_count` | integer | after consent/STOP/dedupe/quiet hours **as of quote time** |
| `total_segments` | integer | |
| `credits_required` | bigint | |
| `cogs_micros` | bigint | **not granted** to authenticated |
| `revenue_micros` | bigint | credits × book price; not granted |
| `currency` | char(3) | |
| `template_hash` | text | keyed digest of template |
| `idempotency_key` | text UNIQUE per org | |
| `created_by` | uuid | |
| `created_at` | timestamptz | |

Child **`pricing_quote_lines`** (optional in Phase 1 if batches stay small): per recipient phone_hash, segments, credits, suppress_reason nullable. Platform-sensitive columns remain ungranted.

**`credit_packages`** (catalogue; tenant-readable on safe columns)

`id`, `code` unique, `credits bigint`, `gross_price_micros bigint`, `currency`, `active boolean`, `price_book_version_id` (the book the pack is meant to align with). No Stripe ids yet. Changing a package is a new row (`code` + `version integer`), not an UPDATE of credits/price.

#### Ledger expand (same table, new columns — expand–migrate–contract)

Add to `sms_quota_ledger` (nullable first):

- `source_kind text` CHECK (`plan_grant`,`pack_purchase`,`promo`,`manual`,`unknown`)
- `source_id uuid` (pack/purchase/policy id)
- `unit_price_micros bigint` (snapshot; null for reserve/consume/release)
- `currency char(3)`

Backfill `source_kind = 'unknown'`. Reserve/consume/release leave money columns null — they move **counts**. Allocation rows carry the snapshot.

#### Phase 1 RPCs (`app.*` + `public.rpc_*` service-role unless noted)

| RPC | Purpose |
| --- | --- |
| `app.econ_quote_create(...)` | Server-side only: hashes, eligibility, segments, COGS, credits, insert quote. |
| `app.econ_quote_confirm(quote_id, org, actor)` | If unexpired: for each eligible recipient, `sms_schedule_request` **or** a batched equivalent; bind `quote_id`; reserve **quote.credits_required** in one lock (see concurrency). Authenticated wrapper re-checks owner/admin. |
| `app.sms_quota_settle_reservation` | Consume actual, release remainder. |
| `app.econ_rate_card_insert` | Fixture/admin ingest; idempotent on `row_hash`. |
| `app.econ_price_book_publish` | draft → published; audit; no tenant execute. |
| `rpc_sms_quota_allocate` | unchanged mint; callers pass new optional columns when wrapped. |

Grant execute: quote_create/confirm to service_role only (Node computes segments, same reason as `rpc_schedule_text_request`). A future authenticated wrapper must not accept client-supplied segment counts.

### Phase 2 — attach to dispatch (still no Stripe)

Add **`message_cost_estimates`** (platform-internal; FK to `sms_delivery_attempts` or `text_requests`): `estimate_id`, `org_id`, `request_id`, `attempt_id`, `quote_id`, `provider`, `components jsonb NOT NULL` (object of component → micros), `cogs_micros`, `credits`, `revenue_micros`, `margin_bps_expected`, `rate_card_ids uuid[]`, `created_at`. Unique `(attempt_id)`.

Add nullable FKs on `text_requests`: `quote_id`, `price_book_version_id`.

**Send-time RPC** (extend `sms_begin_dispatch` or call immediately before it): re-validate quote not expired **or** already confirmed; consent/STOP/quiet hours (already); provider `eligible`; rate cards not stale vs policy; floor inequality still holds on **locked** revenue vs **fresh** COGS. If floor fails: do not send; leave reserved; status `queued` or a new `held_economics` (prefer **not** exploding the enum in Phase 2 — use `suppressed` with reason `margin_floor` **or** keep queued and `sms_outbox_defer` + alert). Do not consume.

Recompute segments from decrypted body; if `segments > reserved_quota`, **do not send** (template was mutated). If `segments < reserved`, send and settle remainder on success.

### Phase 3 — payments (Stripe processor records; still not subscription)

Tables (tenant-readable restricted / platform-internal as noted):

**`payment_processors`** (platform-internal): `code` `stripe`, `status`.

**`payment_fee_profiles`** (platform-internal): `processor_id`, `scheme` (`us_card_standard`), `percent_bps` (290), `fixed_micros` (300_000), `effective_from`. Used for **estimates** only.

**`payment_transactions`** (tenant-restricted SELECT: amount they paid, status, not Stripe fee breakdown if that is considered internal — actually owners may need fee-less receipts; **do not** expose our margin). Columns: `id`, `org_id`, `processor`, `processor_ref` unique (Stripe PaymentIntent/Checkout id), `gross_micros`, `currency`, `status` (`requires_payment`,`succeeded`,`failed`,`refunded`,`disputed`), `idempotency_key` unique, `created_at`.

**`payment_processor_fees`** (platform-internal): `transaction_id`, `fee_micros`, `fee_currency`, `processor_fee_ref` (Balance Transaction id), unique `(processor_fee_ref)`.

**`credit_purchases`** (tenant-readable): `id`, `org_id`, `package_id`, `transaction_id`, `credits_issued`, `price_book_version_id`, `correlation_key` (the allocation key), unique `(org_id, correlation_key)`.

Webhook inbox: either reuse `sms_webhook_inbox` with `provider = 'stripe'` **or** a sibling `billing_webhook_inbox` with the same shape. Prefer a **sibling** — Stripe payloads are a different secret and different PII. Dedupe on Stripe `event.id`. Signature verify **before** insert. Out-of-order: treat webhook as a prompt to **retrieve** the PaymentIntent; do not apply `event.data.object` blindly ([Stripe webhooks](https://docs.stripe.com/webhooks), 2026-09-08).

Mint credits only after `status = succeeded` **and** the allocate RPC runs in the same DB transaction as the purchase row. Stripe idempotency key on PaymentIntent create: `org:{org_id}:pack:{package_id}:{client_key}`, retained 24h by Stripe ([Idempotent requests](https://docs.stripe.com/api/idempotent_requests)).

MFA: this phase **blocks** on an AAL2 check in the Next.js route. If MFA is still disabled in GoTrue, Phase 3 does not ship.

### Phase 4 — actuals

**`message_actual_costs`** (platform-internal): `attempt_id` unique, `provider_price_micros`, `provider_price_raw text` (the string, for forensics), `num_segments_billed integer`, `carrier_surcharge_micros`, `allocated_fixed_micros` (0 until topology exists), `customer_revenue_micros`, `processor_fee_allocated_micros`, `cogs_micros`, `contribution_micros`, `margin_bps_realised`, `source` (`message_fetch`,`usage_record`,`invoice`), `reconciled_at`.

Twilio: poll Message resource until `price` is non-null; also UsageRecords for daily catch-up ([UsageRecords](https://www.twilio.com/docs/usage/api/usage-record)). `NumSegments` vs our `segments` is a first-class variance.

If realised margin < 7000: **do not claw back credits**. Write variance; feed a **draft** price-book suggestion (Phase 6).

**`provider_fixed_costs`** (platform-internal): monthly 10DLC, number rental, minimums. Allocation algorithm is an open decision; default Phase 4: **do not allocate onto messages**; report as platform overhead.

### Phase 5 — subscription boundary (billing module)

Lives beside, not inside, messaging. Tables for plans/subscriptions are **NOT** specified here beyond the interface:

- On `invoice.paid` for a plan: `app.sms_quota_allocate(org, included_credits, 'plan:' || org || ':' || period_start, period_end, note)` with `source_kind = plan_grant`.
- Access enforcement (can they use the product at all) is billing; send-path only checks **credit availability** and consent.
- See Subscription boundary section.

### Phase 6 — second provider, health, failover

`provider_health_metrics` / `provider_delivery_metrics`: time-bucketed counters, platform-internal, written by a worker aggregating attempts — **not** per-message rows. Routing uses effective cost per **delivered** message = `sum(cogs) / nullif(delivered_count,0)` over a window, plus `eligible` kill switch. Still deterministic rules.

### Phase 7 — recommendation (draft only)

A worker inserts `price_book_versions` with `status = draft` and `reason`. Publish remains human. **NOT** in the send path.

**Tables from the discussion inventory that should not be built as named:** `customer_credit_ledger` (use `sms_quota_ledger`); `messaging_cost_components` as a table (use `jsonb` on estimates); `margin_snapshots` as a per-message fact table (use a daily aggregate or a view in Phase 4–6).

---

## Concurrency, idempotency, and failure semantics

### Shared rules

- One **Postgres transaction** per money-moving business action (allocate, reserve, settle, confirm-batch chunk, purchase-mint).
- Idempotency is a **unique constraint**, not an application `SELECT` then `INSERT`.
- Retries return the original outcome without a second projection update (`ON CONFLICT DO NOTHING` + “already applied” boolean), matching today’s quota RPCs.
- `FOR UPDATE` the balance row before availability checks (`app.sms_quota_lock_balance`).
- Never hold the balance lock across a provider HTTP call.

### Allocate (purchase or plan grant)

- **Key:** `(org_id, 'allocation', correlation_key)` e.g. `stripe:pi_…` or `plan:{org}:{period}`.
- **Txn:** insert purchase/subscription_period row + ledger allocation + bump `allocated` + `audit_events`.
- **Retry:** same key → `false` / already applied; no double mint.
- **Partial:** if Stripe succeeded and DB failed, webhook/retrieve retries the same key. Do not mint from the Checkout success redirect alone.
- **Stripe:** `Idempotency-Key` header on POST; Stripe stores 24h ([docs](https://docs.stripe.com/api/idempotent_requests), 2026-09-08). Our key must be stable beyond 24h (DB unique is forever).

### Quote create

- **Key:** `(org_id, idempotency_key)` on `pricing_quotes`.
- **Does not** reserve. Retry returns the same quote if still `open`.
- Expiry: sweeper sets `expired` if `now() > expires_at` and not confirmed.

### Quote confirm / schedule

Today one recipient: `app.sms_schedule_request` already txns insert + reserve + outbox. Batch confirm:

- Lock quote `FOR UPDATE`; require `open` and `expires_at > now()`.
- Recompute eligibility (STOP may have arrived). `credits_required` may **fall** not rise. If it would rise (template change), abort.
- Lock balance once; reserve **total remaining credits** under `quote:{quote_id}` **or** per-request `req:{request_id}` as today. Prefer **keeping per-request keys** so cancel/suppress of one recipient does not require splitting a lump reservation. Then confirm is a loop of existing `sms_schedule_request` inside **one** transaction for small N, or chunks of ≤ 100 with the quote remaining `open` until the last chunk (quote status `confirming` with a progress counter). Chunked confirm needs its own idempotency per chunk: `quote:{id}:chunk:{n}`.
- Two concurrent confirms: quote row lock serialises; the second sees `confirmed`.

### Reserve vs consume vs release (the invariant)

Introduce `app.sms_quota_settle_reservation(p_org_id, p_request_id, p_consume_amount)`:

1. Lock balance.
2. Read reservation row `kind = reservation`, key `req:{id}`. If missing → error.
3. Let `R = reservation.amount`. Require `0 <= p_consume_amount <= R`.
4. If consumption key exists, return already settled (do not inspect amount mismatch — first writer wins; tests must prove amounts are passed identically on retry).
5. Insert consumption `p_consume_amount` key `req:{id}`.
6. If `R - p_consume_amount > 0`, insert release that remainder, key `req:{id}` (kinds differ, unique allows it).
7. Update projection: `reserved -= R`, `consumed += p_consume_amount`.

Replace today’s separate consume **or** release in `sms_settle_attempt` / cancel / suppress with this primitive. `provider_unknown`: **do not settle**; reservation remains (today’s behaviour). Refund of a prior consumption stays a separate `refund` kind, still idempotent.

**Mismatch quoted vs billed segments:** if Twilio `NumSegments` > our segments after send, do **not** consume extra owner credits (the quote was the contract). Record actual COGS variance. If our segments > billed, still consume quoted credits (owner was quoted that); optionally later policy to refund the difference — **open decision**, default **no automatic refund** (too gameable).

### Dispatch / provider call

- Txn 1: `begin_dispatch` (gate + attempt row).
- Network: `provider.send`.
- Txn 2: `settle_attempt`. If txn 2 fails, job is not `complete`d (`dispatch.ts` already does this); retry of the **outbox job** must not call send again if attempt is already `submitted`/`failed`/`provider_unknown`. Today `begin_dispatch` on `sending` recovers to unknown — correct. After a successful settle, `begin_dispatch` hits `already_*` and skips.

Twilio webhooks: at-least-once; default **one** retry on connect timeout, configurable up to 5 ([connection overrides](https://www.twilio.com/docs/usage/webhooks/webhooks-connection-overrides), 2026-09-08). Inbox unique `(provider, dedupe_key)` already; delivery status key is `MessageSid:status` in the Twilio adapter — **out-of-order** `sent` after `delivered` must be ignored by the state machine (transition guard). Do not use webhook `I-Twilio-Idempotency-Token` as the only key.

### Purchase refund / dispute

- Stripe `charge.refunded` / `charge.dispute.created`: retrieve; insert `payment_transactions` status; **do not** DELETE ledger rows. `expiration` or a new `clawback` via `adjustment` debit of **remaining** credits, not consumed ones. In-flight reservations: cancel queued requests, settle-release. Already-sent messages stay sent. Freeze new sends if dispute (`org` flag) — **PROPOSED**.

### Actual COGS breaks the floor after send

No owner clawback. Platform loss. Draft price-book. If this is send-time (before provider call), **do not send**.

---

## Behaviour at 15,000–20,000 businesses

Assumptions for capacity (not a business forecast): 20_000 orgs; 8_000 send in a given month; mean 80 messages/org/month ≈ **640k messages/month**; busy month **~2M**. Previews maybe 2× sends; persist **only confirmed quotes**, not every keystroke preview.

| Table | Rows / busy month | Notes |
| --- | --- | --- |
| `text_requests` / attempts / outbox | ~2M | already in the foundation |
| `sms_quota_ledger` | ~6–8M | reserve+consume+occasional release |
| `pricing_quotes` | ~2M if one quote per send; far fewer if batch quotes | |
| `message_cost_estimates` / `message_actual_costs` | ~2M each | partition by `created_at` month when > ~20M |
| `provider_rate_cards` | hundreds | hot, cached in process with TTL |
| `margin_snapshots` | do **not** materialise per message | daily rollup ~ 20k orgs × 30 days × dimensions, or a view + nightly insert of aggregates |
| `payment_transactions` | thousands | packs, not per SMS |

**`margin_snapshots`:** compute **on read** for Phase 4 (SQL aggregate from `message_actual_costs`). When dashboards exist, **incremental daily** table keyed by `(day, provider, country, price_book_version, …)`. Not a trigger on every send.

**Partitioning:** not in Phase 1. Plan `PARTITION BY RANGE (created_at)` on estimates/actuals/ledger when a month exceeds ~5M rows. `sms_quota_ledger` unique `(org_id, kind, correlation_key)` must include the partition key or move to a global unique index — design the key so it stays globally unique (correlation keys are globally unique per org anyway; use a non-partitioned unique index on `(org_id, kind, correlation_key)`).

**5_000-recipient quote:** segment math is cheap. Eligibility is 5_000 hash lookups — one SQL `WHERE phone_hash = ANY($1)` against `sms_consent_state` / `sms_suppressions`, not 5_000 RPCs. Encrypting 5_000 bodies and inserting 5_000 `text_requests` in one request is the failure mode. **Quote compute** belongs in the request path only up to eligibility + credits (hashes, no persist of messages). **Confirm** is a worker draining the quote in chunks (outbox topic `sms.quote_confirm`). The current `POST /text-requests` one-recipient path stays for compatibility.

**Ledger contention:** one `sms_quota_balance` row per org, `FOR UPDATE` on every reserve. A restaurant bursting 200 schedules in 1s serialises ~200 lock waits of sub-millisecond work — acceptable. 5_000 individual reserves in one confirm transaction is one lock held for the whole insert batch — keep batches ≤ 100 or reserve a lump then attach. Do not shard the balance row. Do not use Redis for available credits (`SYSTEM_CONTEXT.md`: Redis never sole record of money).

**Hot indexes:** `(org_id, created_at desc)` already on requests; add `(org_id, status)` on quotes; estimates by `(created_at)` for partition swaps.

---

## Security posture

### Secrets

| Secret | Lives | Never |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | server env (`frontend/.env.example` already forbids `NEXT_PUBLIC_`) | browser, mobile, logs, Postgres |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / From | server env | rate-card tables, client |
| `SMS_WORKER_SECRET` | server env; dispatch route 404s if unset | |
| `SMS_FAKE_WEBHOOK_SECRET` | production fake only | |
| Stripe secret key / webhook secret | server env, Phase 3+ | |
| `CUSTOMER_NOTE_ENCRYPTION_KEY` / `TOKEN_DIGEST_KEY` | already specified in `docs/backend/ENVIRONMENT.md` | payment keys (LESSONS: a payment key was once pasted into the note key) |

All SMS and billing modules are `import "server-only"` like `frontend/lib/server/sms/cost.ts`. Mobile (`apps/mobile`) must keep calling authenticated Next routes, never providers.

### What a tenant must never read or infer

Provider contract rates, component COGS, margin bps, routing reason, which provider actually sent, other orgs’ anything, phone plaintext, webhook raw bodies. Implementation: platform-internal tables with no policies; column-level grants on quotes; preview API without micros; `estimated_cost_micros` should **leave** the owner SELECT list (expand: stop selecting it in `listTextRequests`; optionally move column to estimates table).

`sms_delivery_attempts` is already owner/admin SELECT and includes `provider` and `provider_response`. That **leaks provider identity**. Phase 2 should stop granting SELECT on that table to authenticated, or grant a view without `provider` / `provider_response`.

### Privileged mutations

Allocate adjustments, refunds, price-book publish, margin-policy publish, kill switches, rate-card ingest: `audit_events` in-txn (`action` like `econ.price_book.published`, `econ.credits.adjusted`) with actor, target, metadata **without secrets**. MFA required (`SYSTEM_CONTEXT.md` §9) — **NOT BUILT**, must be a Phase 3 gate. Manual credit mint: `source_kind = manual`, correlation_key `manual:{uuid}`, two-person approval **PROPOSED** for later; Phase 1 tests mint via service role like today’s allocate.

### Structural limits on automated agents in this repo

Price books and margin policies have **no UPDATE** on published rows (trigger). No RPC that sets `target_bps < 7000`. No RPC that marks `provider_unknown` requests `queued`. Rate ingest cannot set `source = invoiced` without a document id. Feature flags (`ECON_SEND_ENABLED`) default off in production until live-verified. Agents can add **draft** versions; publish requires `approved_by` not equal to a service account.

### Webhooks

Copy SMS: verify signature before dedupe namespace; 403 unverified; 200 duplicates. Stripe: same, plus retrieve-on-event. CSRF: webhook routes already sit outside cookie CSRF patterns used for owner APIs; keep them secret-header authenticated.

---

## Subscription boundary

**NOT BUILT.** Billing is a separate module (`CHANGE_SAFETY_ARCHITECTURE.md`). Stripe Billing (0.7% of Billing volume on [stripe.com/pricing](https://stripe.com/pricing), 2026-09-08) is the processor for **recurring software access**, not for per-message COGS.

```
Software subscription (billing)              Text Request credits (messaging)
--------------------------------             --------------------------------
trial → paid → change → fail → cancel        allocate → reserve → consume
answers: may they use ReviewBoost,           answers: how many sends remain
         plan limits, included credits
Stripe Subscription + Invoice                sms_quota_ledger + packages
```

**Interface (the only legal bridge):** billing, after `invoice.paid` (and after retrieving the invoice, because webhooks are unordered), calls `app.sms_quota_allocate` with `source_kind = plan_grant`, `expires_at = period_end` (or later if rollover is approved), `correlation_key = plan:{org_id}:{billing_period_start}`. Included credit **counts** are a business decision (open).

**Plan change / downgrade:** access and **future** included grants follow Stripe subscription status (`active`, `past_due`, `unpaid`, `canceled`, `trialing` — [Stripe subscriptions](https://docs.stripe.com/billing/subscriptions/overview)). Do not rewrite historical allocations. A downgrade that reduces included credits mid-period: either wait until period end (recommended) or expire the unused **grant** portion with `expiration` rows keyed `expire:{allocation_id}` (already how expiry works). **Purchased** pack credits are unaffected.

**Failed payment:** Stripe retries; subscription may become `past_due` then `unpaid` or `canceled` depending on dashboard settings. Messaging: **PROPOSED** default — stop **new** confirms when billing says not entitled; finish in-flight reserved sends (already paid in credits). Do not vacuum the ledger.

**Cancellation:** self-service, no retention trap (`SYSTEM_CONTEXT.md`). Entitlement ends per Stripe cancel (immediate vs period-end — **open**). Reserved queued texts: cancel and release. `provider_unknown`: still reserved until reconcile. Unused purchased credits: **open** (forfeit vs remain spendable vs cash refund).

**Refund of a pack:** processor refund + debit remaining credits only. **Dispute:** $15 Stripe dispute fee ([stripe.com/pricing](https://stripe.com/pricing)); freeze org; do not auto-send.

**Subscription does not compute landed cost.** Included credits still consume the same segment ledger; COGS of those sends is platform/subscription cost.

---

## Delivery phases

Each phase is independently shippable and testable. Exit criteria are CI + (where noted) a fixture scenario, not live-verified SMS.

### Phase 1 — Fixture economics on the existing ledger

**Deliverable:** rate-card + margin-policy + price-book tables; integer price formula; quote that returns credits; preview no longer leaks COGS; `sms_quota_settle_reservation`; ledger source columns; append-only trigger; US-only 1 segment = 1 credit; fixture allocate still via `rpc_sms_quota_allocate`. No Twilio account, no Stripe.

**Tests:** vitest for ceil-division, floor inequality, clamp, $0.0083 → 8300 micros, T-Mobile 12800 → 58182 at 7800 bps, overflow, JS bigint; pgTAP for settle remainder, double-settle, over-consume refuse, tenant cannot SELECT rate cards, cannot UPDATE ledger, quote expire, confirm idempotency.

**Exit:** a pgTAP scenario “allocate 300, quote 3 recipients / 5 segments, confirm, suppress one, consume 4, release 1, `sms_quota_available` matches replay of the ledger.”

### Phase 2 — Dispatch attachment

**Deliverable:** estimates persisted; send-time floor + stale-rate + segment recompute; `provider` hidden from tenant views; kill switch on `messaging_providers.eligible`.

**Tests:** begin_dispatch holds when floor fails; unknown still does not settle; body mutation with higher segments does not send.

**Exit:** fake provider path through dispatch with a quote id; vitest + pgTAP. Still not live-verified.

### Phase 3 — Credit packs via Stripe Payments

**Deliverable:** packages, payment_* tables, Checkout or PaymentIntent, webhook inbox, MFA gate, allocate on succeeded retrieve. Not Billing/subscriptions.

**Tests:** duplicate `event.id`; out-of-order `payment_intent.succeeded` after retrieve; idempotent allocate; tenant cannot read fee rows; 2.9%+30¢ estimate vs recorded fee.

**Exit:** CI against Stripe test fixtures (recorded payloads). Live-verified later.

### Phase 4 — Actual cost reconciliation

**Deliverable:** `message_actual_costs`; Twilio fetch/UsageRecord worker; variance; no clawback.

**Tests:** parse `price` string; null price stays pending; NumSegments mismatch.

**Exit:** fixture payloads; live-verified only once a real account exists.

### Phase 5 — Software subscription bridge

**Deliverable:** plan grant allocations; entitlement flag; downgrade/cancel rules as coded policy.

**Depends on** billing design (separate). Do not smuggle a full subscription system into messaging migrations.

### Phase 6 — Second provider and deterministic routing

**Deliverable:** one additional `SmsProvider`; health aggregates; failover only on not-accepted; persist routing reason.

### Phase 7 — Recommendation drafts

**Deliverable:** draft price books from realised margin; human publish.

### Not yet — and why

- Telnyx/Plivo/Vonage/Sinch adapters as a set — no accounts, no webhooks, no bills.
- Auto-publishing prices or auto-lowering the floor — violates “automation must not silently rewrite pricing.”
- Smart timing / template intelligence — compliance already implemented; engagement layer has no money dependency.
- Per-message `margin_snapshots` — wrong grain.
- `customer_credit_ledger` — duplicate of `sms_quota_ledger`.
- Itemised eight-line COGS as required columns — cannot populate.
- MMS / RCS / international price books — different products; US SMS first.
- 5_000-recipient synchronous confirm — will not fit the current request/quota locking model.
- Live 10DLC certification — technical controls ≠ legal certification (`TEXT_REQUESTS.md`).
- Owner UI — out of scope for this backend plan (still NOT BUILT).
- Admin portal — NOT BUILT; publish RPCs must still be safe without it.
- Partitioning, Redis credit cache, ML routing — not earned.

---

## Open decisions

These are business (or legal) choices. Engineering must not pick silently.

1. **Included credits per plan and period**, and whether unused included credits roll over.
2. **Whether purchased credits survive subscription cancellation**, and for how long.
3. **List price and pack sizes** (the arithmetic says a 4 ¢ / 250-for-$10 pack fails a 70% floor on Twilio+T-Mobile after Stripe; 6–8 ¢ or a higher minimum pack does not).
4. **Whether the 70% floor includes only variable SMS COGS** (recommended) or also Stripe fees and 10DLC monthly (not recommended as a send-time invariant).
5. **10DLC topology:** one platform/ISV campaign vs per-tenant brands (dominates unit economics at low volume).
6. **When destination carrier is unknown, quote COGS at max published carrier fee vs a blend.**
7. **Refund of unused purchased credits** (cash vs credit vs never).
8. **Whether billed `NumSegments` < quoted segments refunds credits.**
9. **Enterprise volume discounts** (the clamp policy’s `volume_discount_bps`) and who may approve a contract that still cannot go below 7000 bps.
10. **USD-only vs multi-currency credits.**
11. **Sales tax** on credit packs.
12. **Promo credits:** expiry, whether they consume before purchased credits, abuse caps.
13. **Quiet-hours / consent failures after quote:** always reduce the charge (recommended) vs charge the quoted credits.
14. **Owner-visible dollar amounts** at all, or credits-only until a pack receipt.
15. **MMS / RCS** as the same credit pool or a different product.
16. **Who is `approved_by` for price books** while there is no admin portal.
17. **Background job platform** for quote-confirm workers and Twilio price polling (already an open ADR in `SYSTEM_CONTEXT.md` §8).

---

## Appendix — formula card (copy into implementation tests)

```
MICROS_PER_UNIT = 1_000_000
BPS_DENOM = 10_000
FLOOR_BPS = 7000
TARGET_BPS = 7800
CAP_BPS = 8500

ceil_div(a, b) = (a + b - 1) / b          -- a >= 0, b > 0, integer

price_from_cogs(cogs, m) = ceil_div(cogs * BPS_DENOM, BPS_DENOM - m)

floor_holds(price, cogs) = (price * 3 >= cogs * 10)   -- 70% : price - cogs >= 0.7 * price
                                                        -- <=> 0.3 * price >= cogs
                                                        -- <=> price * 3 >= cogs * 10

target_bps = clamp(7800 + risk - volume + contract, 7000, 8500)

twilio_us_sms_tmo_cogs = 8300 + 4500 = 12800
price_from_cogs(12800, 7800) = 58182
```

Fixture rate cards for Phase 1 tests should embed these published 2026-09-08 figures **and** the fetch date, so a later rate change is a deliberate card update, not a silent test drift.
