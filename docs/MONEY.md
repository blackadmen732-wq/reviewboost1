# ReviewBoost money constitution — LOCKED

This document is the binding pricing and billing constitution. Product work,
Stripe work, SMS packs, and send gates follow it. If another doc, mock, or
comment conflicts, this file wins until it is revised in a dedicated PR.

It does not claim that Stripe, packs, the Pricing API job, or live Twilio exist
on `main`. Those are later jobs, in the order in §7.

Owner language for SMS remains **Text Requests**. There is no marketing /
promotion send path.

---

## 1. Two pipes, never one

ReviewBoost takes money on two separate pipes. They do not share a Stripe line,
a credit ledger, or a margin rule.

| Pipe | What the owner buys | COGS shape | Gross target |
|---|---|---|---|
| **A — software** | Monthly plan: dashboard, NFC/QR tag loop, feedback | ~$0 (digital + QR) | **80–90%** |
| **B — SMS** | Prepaid packs, denominated in **segments** | Carrier/provider, via Pricing API, blended | **80%** target, **70%** floor, **90%** cap |

Pipe A never includes SMS. Pipe B never includes software. A plan does not mint
credits. A pack does not unlock the dashboard.

---

## 2. Pipe A — software plans

Locked monthly prices:

| Plan | Price |
|---|---|
| Software plan 1 | **$49 / month** |
| Software plan 2 | **$79 / month** |
| Software plan 3 | **$129 / month** |

What the plan sells: the owner product (Home, Tags, feedback, NFC/QR). NFC/QR
software COGS is treated as **~$0**. Physical tag hardware, if sold later, is a
separate SKU — not folded into these three prices and not used to justify SMS
inside the plan.

**Never unlimited SMS in a plan.** No “texts included,” no soft cap that
refills with the subscription, no overage that looks like a plan feature.

Gross on Pipe A is **80–90%**. Do not discount the list prices in code to chase
volume. Price changes appear in a diff against this file first.

---

## 3. Pipe B — prepaid SMS packs

SMS is prepaid, sold in **segments** (credits), not vaguely in “texts.” Carriers
bill per segment; GSM-7 vs UCS-2 changes the count. The existing segment engine
is the counter; this constitution is the money rule on top of it.

### 3.1 Pricing API + blended cost

- Unit COGS comes from the **provider Pricing API** (Twilio Pricing API or the
  successor we actually call), blended across the destinations we send.
- No invented production rate. No hardcoded sell that is not derived from that
  blended unit.
- Store every money amount in **integer micros** (1 USD = 1_000_000 micros).
  Currency is explicit on every row. **No floats.**
- **Round UP.** COGS rounds up to the next micro so we never understate cost.
  Derived sell rounds up to the next cent (or pack price) so we never
  undercharge. Never round down on money.

### 3.2 Margin band

| Bound | Gross on Pipe B |
|---|---|
| Floor | **70%** — below this, refuse (see §5) |
| Target | **80%** |
| Cap | **90%** — do not gouge; if blended COGS falls, lower sell or hold, do not sit above 90% |

Gross = `(sell − COGS) / sell`.

### 3.3 Locked pack card (when unit COGS ≈ $0.016)

When blended unit COGS is about **$0.016 / segment** (16_000 micros), sell is
**$0.08 / credit** (80_000 micros). That is exactly 80% gross:

`(0.08 − 0.016) / 0.08 = 80%`.

| Pack | Credits (segments) | Sell | COGS @ $0.016 | Gross |
|---|---|---|---|---|
| Small | 50 | **$4** | $0.80 | 80% |
| Medium | 200 | **$16** | $3.20 | 80% |
| Large | 500 | **$40** | $8.00 | 80% |

Pack sell in micros: 4_000_000 / 16_000_000 / 40_000_000.

If blended unit COGS moves, **recompute sell from the band** (target 80%, never
below 70%, never above 90%). Do not keep $4 / $16 / $40 if they would break the
band. Do not ship a new pack card before the Pricing API job exists.

Packs are prepaid. Empty balance means no send. Plans do not top up the SMS
ledger.

---

## 4. Stripe

- Two products (or two prices that never share a line): Pipe A subscription, Pipe
  B one-time pack.
- **No mixed Stripe line.** A $49 invoice line is software. A $4 invoice line is
  a 50-segment pack. Never one line that is “plan + texts.”
- Amounts sent to Stripe are integer minor units derived from integer micros
  (round UP at the cent boundary).
- Cancellation of Pipe A is self-service and does not confiscate unused Pipe B
  credits, and unused credits do not extend a cancelled plan.

---

## 5. Nightly governor

A nightly job recomputes blended unit COGS from the Pricing API and the recent
send mix.

- If implied gross on the current sell would be **under 70%**, **refuse send**.
  No dispatch, no outbox leak, no “just this batch.”
- Refusal is fail-closed. A missing price, a stale quote, or an arithmetic
  overflow is a refuse, not a send at yesterday’s rate.
- The same 70% floor is a pre-send gate, not only a nightly report. Nightly is
  the reprice; the gate is what stops the message.

This is independent of consent, STOP, and quota. Those gates still apply. The
governor is the money gate.

---

## 6. REJECT checklist

A PR, mock, or “just this once” that does any of the following is **rejected**.
Do not implement it. Do not merge it. Do not leave it as a stub that can be
turned on.

| # | Reject | Why |
|---|---|---|
| 1 | **Hardcoded sell** | Pack or plan sell that is not this constitution (Pipe A) or not derived from the Pricing API + band (Pipe B). |
| 2 | **Unlimited SMS in a plan** | Pipe A is software. “Unlimited texts,” included buckets, or fair-use SMS on a plan are forbidden. |
| 3 | **Pack before Pricing API job** | No SMS pack SKU, checkout, or mint until the Pricing API job exists and can quote blended unit COGS. |
| 4 | **SMS on Home** | Owner Home is the tag loop and unread feedback. Text Requests is not a Home module. |
| 5 | **MMS** | Not in product. Segments, cost, and A2P here are SMS only. |
| 6 | **Plan minting credits** | A subscription invoice must not allocate SMS quota. Only a Pipe B pack purchase may. |
| 7 | **Send under 70%** | If blended gross would be below the floor, refuse. No override flag. |
| 8 | **A2P Marketing** | Review-request SMS is not an A2P Marketing/promotional campaign. No Marketing campaign use case, no promo traffic. |
| 9 | **Floats** | No `number` / `float` / `numeric` money that is not an integer micro (or integer minor unit derived from micros). |
| 10 | **Mixed Stripe line** | Do not put software and SMS on the same Stripe product, price, or invoice line. |

If a future idea needs to violate a row, it needs a constitution PR that
rewrites this section — not a product PR that “temporarily” ignores it.

---

## 7. Build order (binding)

Do these in order. Do not skip ahead.

1. **[#57](https://github.com/blackadmen732-wq/reviewboost1/pull/57) tag loop** — owner Home, Tags, NFC/QR, public, activation. Software the owner can put on a counter.
2. **Stripe plans** — Pipe A only: $49 / $79 / $129. No SMS on the subscription.
3. **Pricing API** — job that pulls provider prices, blends, stores integer micros, rounds UP.
4. **One pack** — a single prepaid SKU (start with 50 / $4 *if and only if* unit COGS still ≈ $0.016 and the 80% target holds). Checkout, mint, ledger. Then the other two packs.
5. **Live Twilio / A2P** — real account, From / Messaging Service, A2P 10DLC for this traffic class (not Marketing), live send/receive. Last.

Quota ledger and segment math already exist; they are not a license to sell
packs early.

---

## 8. Friday pilot — tag-only

The Friday pilot is **tag-only**: a working NFC/QR stand loop from the #57
surface. A visitor taps or scans; the owner sees it.

- **No Twilio dependency.** No provider credentials, no live SMS, no pack
  checkout, no A2P registration required to call the pilot done.
- Pipe B work stays behind §7 steps 3–5.
- Do not block the pilot on Stripe. Stripe plans are step 2, after the tag loop
  is real.

---

## 9. How this sits next to existing docs

| Doc | Role vs this file |
|---|---|
| `SYSTEM_CONTEXT.md` §5 | Product context. Subscription still **NOT BUILT**. This file locks *how* it will be built. |
| `docs/backend/TEXT_REQUESTS.md` | Consent, outbox, segments, quota ledger. Technical. Money rules live here. |
| `STATUS.md` | What exists on `main`. Does not sell packs or plans yet. |

Integer micros and fail-closed preview in the Text Requests backend are the
right shape for Pipe B. They are not a Pricing API, not a pack, and not a live
rate.
