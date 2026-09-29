# ReviewBoost money constitution

This is the binding description of how ReviewBoost charges, what each charge
buys, and what happens when money goes backwards. It describes the approved
V1 model — the one enforced by the code and SQL on `main` — and every rule
below names where it is enforced and what proves it.

If a mock, a comment or another document disagrees with this file, this file
wins until it is changed in a PR that changes it on purpose. A price or a
limit changes here, in the SQL that enforces it, and in the TypeScript mirror,
in the same diff; tests assert the three agree.

Owner language for SMS is **Text Requests**. There is no marketing or
promotion send path.

## What this replaces

An earlier draft (PR #65, branch `cursor/docs-money-constitution-ef6c`) was
never merged and is **superseded, not merged**. It described a model that was
not the one approved:

| Earlier draft said | Approved V1 model |
|---|---|
| Plans include no SMS; "plan minting credits" rejected | Each plan includes a monthly SMS allowance, minted by the paid invoice |
| Trial without a card | Seven-day trial, card and plan required before it starts |
| No pack sold before a Pricing API job and a nightly margin governor exist | Three fixed packs at $0.08 a segment; the provider rate is configuration. The Pricing API and governor are post-V1 (§11) |
| Packs are the only SMS | Monthly included first, purchased second |

What it got right and is kept: integer money only, segments as the unit, no
mixed Stripe lines, no MMS, no A2P Marketing traffic, Text Requests never on
Home.

---

## 1. Principles

1. **Stripe is the payment authority; the database is the entitlement
   authority.** A redirect to a success page proves nothing. A signed webhook,
   applied by a database function, is the only thing that changes a plan or
   mints credit.
2. **Integer money, always.** Prices in integer cents; provider cost in
   integer micro-units (1 USD = 1,000,000). No floats, anywhere.
3. **Fail closed.** An unknown plan, an unknown pack, a price that does not
   match, a missing entitlement, a status Stripe invents later — each grants
   nothing and is made visible.
4. **Idempotent under Stripe's delivery.** Webhooks arrive more than once and
   out of order. Every grant is unique on the Stripe object that paid for it;
   every state write is ordered by Stripe's own event time.
5. **No credit from nowhere, no balance below zero.** Every spendable segment
   traces to a paid invoice or a paid pack. A refund takes back only what is
   unspent; what was spent becomes an accounting item, never a negative
   balance.

## 2. Plans — software, monthly

| Plan | Price | Locations | Tags | Included SMS / month |
|---|---|---|---|---|
| Starter | **$49** | 1 | 3 | **150 segments** |
| Growth | **$79** | 2 | 8 | **500 segments** |
| Pro | **$129** | 5 | 25 | **1,500 segments** |

There is no free plan and no unlimited SMS. A business that has never
subscribed can *set up* — one location, one Tag, destination, QR — but its Tag
serves no customer until billing opens the door.

`past_due` keeps the door open (a failed card must not cost a business a day
of reviews before anyone can fix it). `suspended` and `cancelled` close it.
Nothing is deleted; paying again reopens the same physical Tag.

Enforced by: `app.entitlement_tag_limit`, `app.entitlement_location_limit`,
`app.entitlement_monthly_sms`, `app.entitlement_allows_service`; mirrored in
`frontend/lib/server/entitlements.ts`.

## 3. The trial

- **Seven days, free, card required, paid plan chosen first.** Checkout
  creates the subscription with `trial_period_days: 7` and
  `payment_method_collection: "always"`.
- **A trial is something Stripe starts.** Signing up grants `suspended` with no
  plan; `trialing` exists only once Stripe says the subscription is trialing.
- **A trial has an end.** One that ended more than a day ago reads as
  `suspended` whatever the stored row says; the day of grace covers webhook
  latency on conversion.
- **A trial includes zero SMS.** Its own invoice is for $0, and a $0 invoice
  mints nothing. Packs cannot be bought during a trial.
- **A failed first payment after the trial mints zero monthly SMS.** The
  subscription goes `past_due`; there is no `invoice.paid`, so there is nothing
  to mint from. Proved end to end in `supabase/tests/sms_pack_money_test.sql`
  §10 and `frontend/tests/unit/sms-pack-billing.test.ts` ("a failed first
  payment after the seven-day Starter trial").

## 4. SMS credit — two sources, never pooled

### 4.1 Monthly included

- Minted **only** by `invoice.paid` with `amount_paid > 0` and a
  `billing_reason` of `subscription_create` or `subscription_cycle`. Not by
  checkout, not by subscription creation, not by a proration invoice from a
  mid-period plan change (that would mint a second month inside one period).
- Exactly the plan's allowance, once per invoice (unique on the invoice id),
  **expiring at the end of the period it paid for**. No rollover.
- Always spent first.

### 4.2 Purchased packs

| Pack | Segments | Price | Per segment |
|---|---|---|---|
| `pack_50` | 50 | **$4** | $0.08 |
| `pack_200` | 200 | **$16** | $0.08 |
| `pack_500` | 500 | **$40** | $0.08 |

- A one-time Stripe payment (Checkout `mode: "payment"`), never a subscription
  line. Only a business whose plan is **active** may buy one.
- Granted by the `checkout.session.completed` /
  `checkout.session.async_payment_succeeded` webhook, from the **database's**
  catalog (`app.sms_pack_catalog`), and only if Stripe collected exactly the
  catalog price in USD. Anything else is recorded as *paid without credit* and
  alerted on (§9) — never granted at the wrong price, never silently kept.
- Never expires. Survives cancellation in storage. Spent after monthly.
- A pack grants no software access.

Enforced by: `sms_credit_grants`, `sms_reservation_slices`,
`app.sms_quota_reserve` (monthly first, soonest expiry first),
`rpc_billing_apply_invoice_paid`, `rpc_billing_apply_pack_payment`; mirrored in
`frontend/lib/server/sms-packs.ts`.

## 5. Refunds and chargebacks on packs

Every pack payment has one row in `sms_pack_purchases`, keyed by its
PaymentIntent, created by whichever event arrives first — a refund can be
recorded before the payment it refunds and applies the moment the grant does.

**The clawback target** — how many of the pack's segments should come back:

| Situation | Target |
|---|---|
| Nothing refunded, no dispute | 0 |
| Partially refunded | `ceil(segments × refunded / paid)` — rounded **up**, so no fraction of a segment is left free |
| Fully refunded | all |
| Dispute open (`needs_response`, `under_review`, `warning_*`, or any status not listed below) | all — the money has been pulled |
| Dispute `lost` | all |
| Dispute `won`, `warning_closed`, `prevented` | back to the refund-based target; frozen credit returns |

**The rules that apply the target:**

1. Only **unspent** credit is revoked. `consumed + reserved + revoked ≤
   segments` is a table constraint: a balance cannot go negative.
2. Credit **in flight** (reserved by an unsent message) is revoked the moment
   it comes back — a trigger on the grant does this in the same statement as
   the release. A refund while a send is pending cannot turn into free credit
   when that send fails.
3. Credit **already spent** cannot come back from the ledger. It becomes an
   explicit accounting state — `needs_review`, with the exact number of
   segments — visible in `public.sms_pack_accounting`, listed by
   reconciliation, counted by health, and written to `audit_events` as
   `sms_pack.clawback_shortfall`. It is not a debt on the business's balance
   and it is not silently forgiven. An operator resolves it with
   `rpc_billing_resolve_pack_review` (`written_off` or `recovered_externally`).
4. A pack refund never reaches into **monthly** credit to make up a shortfall.
5. Stripe's cumulative refunded amount only ever rises here; an older event
   with a smaller number changes nothing. Dispute events are ordered by
   Stripe's event time, and a late non-final status never reopens a closed
   dispute.

Proved in `supabase/tests/sms_pack_money_test.sql` §§3–8.

**Refunds of subscription invoices** do not claw back monthly credit in V1.
That credit expires at its period end regardless, and a refunded subscription
is an operator action taken in Stripe. Revisit if refunds become routine.

## 6. Cost and the exact message

- The unit is the **segment** (GSM-7: 160, then 153 per part; UCS-2: 70, then
  67). One emoji or curly quote moves the whole message to UCS-2.
- The final body is built once, server-side:
  `<Business>: <owner's message with the Tag link> <opt-out>`. The preview
  counts segments on that string; scheduling reserves on it and stores it;
  dispatch sends it unchanged. What the owner is shown is what is billed is
  what Twilio receives.
- Provider cost is `SMS_RATE_PER_SEGMENT_MICROS` (integer micros, required in
  production). No production rate is invented.

## 7. Stripe rules

- Plans are recurring prices; packs are one-time prices. **No Stripe product,
  price or invoice line ever mixes software and SMS.**
- Amounts to and from Stripe are integer minor units.
- Cancellation is self-service (Billing Portal), confiscates no purchased
  credit, and purchased credit never extends a cancelled plan.
- The webhook must be subscribed to: `customer.subscription.created|updated|
  deleted`, `invoice.paid`, `invoice.payment_failed`,
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `charge.refunded`, `charge.dispute.created|updated|closed|funds_withdrawn|
  funds_reinstated`.

## 8. Reconciliation

Daily, in maintenance (`reconcileSmsPacks`): every paid pack Checkout Session
from the last seven days is applied again through the same idempotent path the
webhook uses — a missed webhook is **healed**, not just reported — and any
refund or dispute on its charge is carried across. Then
`rpc_billing_pack_reconciliation_findings` lists what still does not add up:

| Finding | Means |
|---|---|
| `paid_without_credit` | Stripe took money; no grant (wrong amount, unknown pack) |
| `grant_mismatch` | The grant does not match what was sold |
| `grant_without_purchase` | Purchased credit with no purchase record behind it |
| `refund_without_payment` | A refund or dispute for a payment never seen paid (after a day) |
| `clawback_unapplied` | Owed credit sitting unspent — should be impossible |
| `needs_review` | Refunded credit that was already spent |

Each run is recorded in `billing_reconciliation_runs`. A run with a heal or a
finding is not ok.

## 9. Alerts

`rpc_ops_health` → `frontend/lib/server/ops-health.ts`. Served by
`/api/v1/internal/health` (503 when unhealthy, so an uptime monitor is an
alert), and raised by every maintenance run as an `ops.alert` error log and, if
configured, a POST to `OPS_ALERT_WEBHOOK_URL`. Money signals: packs paid
without credit, refunded-and-spent segments awaiting review, refunds without a
payment, stale or failing reconciliation, unprocessed Stripe events. Delivery
signals are listed in `docs/backend/TEXT_REQUESTS.md` §22.

## 10. REJECT checklist

A PR, mock or "just this once" that does any of these is rejected.

| # | Reject | Why |
|---|---|---|
| 1 | **A price or allowance that is not in this file** | Plans, allowances and packs change here first, with the SQL and TS mirrors |
| 2 | **Unlimited SMS**, or an allowance that rolls over | Monthly credit is a fixed number of segments that expires at its period |
| 3 | **Minting from anything but a paid invoice or a paid pack** | Checkout, subscription creation, a $0 invoice, a proration invoice, a success-page redirect, a client call — none of these is money |
| 4 | **SMS in a trial** | A trial includes zero segments and cannot buy packs |
| 5 | **Granting a pack whose payment did not match its catalog price** | Record it and alert; a human decides |
| 6 | **A refund that leaves unspent credit spendable** | Clawback is applied to unspent and in-flight credit, always |
| 7 | **A negative balance**, or a refund taken out of monthly credit | Spent-and-refunded credit is an accounting state, not a debt on the ledger |
| 8 | **Floats** for money | Integer cents and integer micros only |
| 9 | **A mixed Stripe line** | Software and SMS never share a product, price or line |
| 10 | **A body the provider receives that the preview did not count** | Name, link and opt-out are composed once, server-side |
| 11 | **MMS, or A2P Marketing traffic** | Review requests are one customer-care message, SMS only |
| 12 | **SMS on Home** | Home is the Tag loop and unread feedback |

## 11. Not in V1

Named so nobody assumes they exist:

- **Pricing API job and margin governor.** Pulling blended per-segment cost
  from the provider and refusing sends below a margin floor. V1 uses the
  configured rate and fixed pack prices; revisit before changing pack prices
  or adding destinations with materially different carrier fees.
- **Analytics attribution.** Tying a Text Request, a Tag scan or a pack to a
  review actually posted or a rating movement. Post-V1; nothing in V1 claims
  it.
- **Clawback of monthly credit on a refunded subscription invoice** (§5).
- **Automatic invoicing of refunded-and-spent segments.** V1 records them for
  review; it does not bill them.
- **Whether a cancelled or suspended business may spend purchased credit.**
  Scheduling a Text Request is not gated by entitlement today. Purchased
  credit "survives cancellation in storage"; whether it should remain
  *spendable* while the plan is not active is an open product decision.
