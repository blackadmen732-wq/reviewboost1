# 10. Credit ledger and billing integration

**Status: PROPOSED** for the changes. The ledger itself is **IMPLEMENTED,
CI-TESTED**, not live-verified.

## 10.1 Reuse, unchanged

Connections adds no balance, no ledger, and no grant path. Every credit
movement goes through what exists:

| Movement | Existing mechanism |
|---|---|
| Monthly allowance | `rpc_billing_apply_invoice_paid` on `invoice.paid`, amount > 0, origin key = invoice id |
| Pack purchase | `rpc_billing_apply_credit_purchase`, origin key = payment id |
| Reservation at schedule | `app.sms_quota_reserve` with per-grant slices, monthly first, under a row lock |
| Consumption at settle | `app.sms_settle_attempt` consumes the same slices |
| Release (dead letter, cancel) | Returns to the same grants |
| Refund (provider failure) | `app.sms_quota_refund`, to the same grants; expired monthly restores nothing spendable |
| Ambiguous outcome | Settled as spent after 15 min (`app.sms_reconcile_aged_unknowns`) |
| Expiry | `app.sms_quota_apply_expirations` at the period boundary |

A connection, a sync, a webhook, or a visit never touches credits.

## 10.2 The intended model against the code

| Rule (brief) | Code on `main` | Match |
|---|---|---|
| Starter $49/mo, 1 location, 3 Tags, 150 segments | `entitlements.sql`: starter 1 / 3 / 150 | Yes (price lives in Stripe, mapped by price id) |
| Starter trial 7 days, card required, 1 location, 1 Tag, 0 SMS | Trial: 1 / 1 / 0; `TRIAL_DAYS = 7`; checkout uses `payment_method_collection: "always"` | Yes |
| Growth $79, 2 / 8 / 500, no trial | 2 / 8 / 500 | Limits match. **Discrepancy F-8:** `billing-service.ts` passes `trial_period_days: TRIAL_DAYS` for every plan, so Growth checkouts also start a 7-day trial |
| Pro $129, 5 / 25 / 1,500, no trial | 5 / 25 / 1,500 | Limits match. Same F-8 trial discrepancy |
| Packs 50 / $4, 200 / $16, 500 / $40 | No pack catalog, no checkout, no webhook handler | **Discrepancy F-4** |
| Monthly expires at period end, no rollover | Grant `expires_at = period_end`; expiry sweep | Yes |
| Purchased never expires, survives cancellation | `expires_at is null` enforced by check constraint | Yes |
| Monthly spent before purchased | Slice allocation order | Yes, with an 8-way race test |
| Failed first Starter payment grants no allowance | Only `invoice.paid` with amount > 0 mints | Yes |
| Owner UI shows real allowance | `main` reads the ledger. PR #67 hard-codes `smsIncluded: 0` | **Discrepancy F-3** |

These are reported, not changed. Fixing F-8 (trial only when `planId === "starter"`) is a one-line change with a test, proposed for Phase 3 if the owner confirms the brief is the intended rule.

## 10.3 What one message costs

One credit = one SMS segment of the **final** body (prefix + template + link +
footer). The preview and the reservation both call the same server-side
`computeSegments`, so the number the owner confirms is the number reserved.

## 10.4 Pack purchase (closing F-4)

- **Catalog in code and in the database**, like plans: `credit_packs` rows
  (`pack_50`, `pack_200`, `pack_500`) mapped to Stripe Price ids in a
  `billing_pack_prices` table, following PR #67's price-authority pattern (the
  Stripe Price decides, never metadata).
- **Checkout**: `POST /api/v1/billing/credit-packs/{packId}/checkout` creates a
  Stripe Checkout Session in `payment` mode for the org's Stripe customer, with
  `client_reference_id = org_id` and an idempotency key per click.
- **Grant**: on `checkout.session.completed` with `payment_status = paid` (and
  `checkout.session.async_payment_succeeded` for delayed methods), look up the
  pack by the line item's price id, call `rpc_billing_apply_credit_purchase`
  with `origin_id = payment_intent id`. Stripe retries and duplicate events
  produce one grant because the origin key is unique.
- **Never automatic.** No saved-card one-click, no reload threshold.

## 10.5 Reconciliation cases

| Case | Handling |
|---|---|
| Duplicate `invoice.paid` / `checkout.session.completed` | Origin key uniqueness → one grant (existing) |
| Out-of-order Stripe events | Existing event inbox with retry (`20260915001100_stripe_event_retry.sql`) |
| Pack refunded (`charge.refunded`) | **New.** Append an `adjustment` removing the *unspent* remainder of that grant only (never below what was already consumed). Credits already spent on sent messages are not clawed back as negative balance. Owner sees "Refunded pack: 140 unused credits removed" |
| Chargeback (`charge.dispute.created`) | **New.** Same as refund for the unspent remainder, plus `messaging_paused` for the org until reviewed (D-10.1), because disputes are an abuse signal |
| Subscription invoice refunded | Monthly grant for that period: remove unspent remainder. Entitlement follows Stripe subscription state (existing) |
| Failed send | Refund to the same grants (existing) |
| Provider unknown | Settled as spent after the window; a later failure callback refunds (existing) |
| Provider billing vs ledger | Monthly report comparing segments the provider billed with segments consumed; differences investigated by an operator. PR #73's reconciliation code is a candidate once rebased |
| Cancellation | Monthly grants expire at period end; purchased remain stored and usable if the org resubscribes (`entitlement_allows_use` governs sending) |

## 10.6 Atomicity and idempotency, restated

- Reservation, request row and outbox job commit together or not at all.
- Every ledger entry has a unique correlation key; every grant a unique origin
  key.
- Queue retries re-enter the same keys. A webhook retry cannot grant twice; a
  worker retry cannot charge twice; a double tap cannot reserve twice (the
  request's dedupe key collides first).

## 10.7 Live billing

No live Stripe product, price, or webhook is created or changed by this work.
Creating pack prices in Stripe is an operator step after approval.
