# ReviewBoost — System Context

> **How to read this.** Every section is tagged:
>
> - **✅ BUILT** — exists in this repo, has tests, file path given
> - **🆕 PROPOSED** — designed here from the product brief; not built, not agreed
>
> Treat 🆕 sections as a starting draft to argue with, not settled decisions.

---

## 1. The product in one paragraph

Local businesses live and die by their Google rating. Most have great customers
who never leave a review, and the occasional angry one who leaves a one-star
review that sits at the top of their profile for years.

ReviewBoost does two things about that: it makes leaving a good review take one
tap, and it catches the bad experience *before* it becomes a public review.

Two ways in: a **physical stand** on the counter that a customer taps or scans,
and **SMS campaigns** to customers who already visited.

---

## 2. The physical layer — stands and the tap flow

### What exists today ✅

A **QR stand** is a database row with an unguessable public ID:

```
qr_stands
  public_id          16 bytes of entropy, e.g. "k3Jx9_pQvNm2"
  label              "Front Desk", "Table 4", "Reception"
  review_threshold   default 4  ← the Amplifier/Shield split point
  primary_color      brand colour for the QR itself
  background_color
  is_active
  scans_count
```

The URL is `https://api.reviewboost.app/q/k3Jx9_pQvNm2`. Downloadable as PNG or
SVG with the business's colours baked in, at high error correction so it still
scans after being scuffed, laminated, or half-covered by a card reader.

**Why `public_id` is separate from the primary key:** the internal UUID never
leaves the server. Someone who photographs a competitor's stand learns nothing
they can use, and stands cannot be enumerated by counting upward.

> `backend/src/services/qrService.js`, `migrations/001_core_schema.sql`

### NFC 🆕

NFC is the upgrade that makes this feel like magic rather than software. Nobody
opens a camera app; they touch their phone to a card and the page is open.

An NFC tag holds a URL, exactly like a QR code. So **the backend needs no
changes at all** — the same `/q/:publicId` URL is written to the tag. What's
missing is everything around it:

| Piece | Status |
|---|---|
| The URL an NFC tag points to | ✅ exists |
| The gate page that opens | ✅ exists |
| Writing tags (NDEF encoding) | 🆕 not built |
| Ordering physical stands | 🆕 not built |
| Fulfilment, shipping, tracking | 🆕 not built |

**Proposed hardware line:**

| Item | Use | Suggested price |
|---|---|---|
| Counter stand (NFC + QR) | Reception, POS | $29 |
| Table tent, 4-pack | Restaurant tables | $39 |
| Window sticker | Door, on the way out | $12 |
| Wallet card, 10-pack | Handed over with the bill | $19 |

Every unit carries **both** NFC and a printed QR. NFC for the ~85% of phones
that read it from the lock screen; QR as the fallback that always works. One
`public_id` per physical unit, so the dashboard can say *"Table 4 gets triple
the scans of Table 9"* — which is a genuinely useful thing to learn.

### The tap flow ✅

```
Customer taps the stand
        ↓
Phone opens /q/k3Jx9_pQvNm2  — no app, no install, no typing
        ↓
Scan recorded (deduplicated: same device within 30s counts once)
        ↓
Gate page: "How did we do?"  ★ ★ ★ ★ ★
        ↓
    ┌───┴────────────────────┐
  4–5 ★                    1–3 ★
  AMPLIFIER                SHIELD
```

The gate page is **served by the backend itself**, not a separate frontend.
That was deliberate: a QR code printed on a table tent cannot be recalled if the
frontend deploy is late. The page has to work the day the stands arrive.

> `backend/src/http/routes/public.routes.js`

---

## 3. Amplifier and Shield

The naming is new, but **the mechanism is built and working**. The split point
is `review_threshold`, per stand, default 4.

### Amplifier — 4 or 5 stars ✅

Immediate `302` redirect to the business's Google review URL. No thank-you
screen, no "would you mind also…", no second tap.

**Why immediate:** the customer has just performed a small positive act. That is
the highest-intent moment that will ever exist, and it decays in seconds. Every
screen between the tap and the Google review box loses people. The redirect is
the entire feature.

By the time they land on Google they have already decided it was good — they
just told you. Writing the review is now consistent with what they just did.

### Shield — 1, 2, or 3 stars ✅

The customer is **not** sent to Google. They get:

> *"Sorry to hear that. What went wrong?"*

Free-text box, optional contact details. Submitting stores it encrypted, visible
only to the owner, and shows:

> *"Thank you — your feedback has been sent to the owner."*

**What this is and is not.** Nobody is prevented from leaving a public review;
Google is one search away. What changes is the *path of least resistance*. An
annoyed customer usually wants to be heard more than they want to be public — so
offer being heard first, immediately, with less effort than finding the Google
page.

The owner then gets a chance to fix it. A complaint resolved privately is a
customer retained; a one-star review is a permanent public artefact plus a lost
customer.

### The threshold is configurable, and that matters ✅

A fine-dining restaurant might set it to 5 — anything below perfect deserves a
conversation. A busy garage might set it to 4. It is per stand, so a business can
run different thresholds at the counter and at the door.

---

## 4. The UX psychology 🆕

The mechanisms below are built. The framing is new — but naming *why* something
works is what stops it being optimised away later by someone who doesn't know.

### Zero friction

Every step removed is customers gained. The count of required actions from
"finished my meal" to "review posted" is **two**: tap, then tap a star.

No app. No account. No typing. No email. No "rate us on a scale of 1–10 and then
tell us why."

**Guarded by:** no login on the public path, the gate page is self-contained and
loads in one request, and the redirect is immediate.

### The consistency principle

People act consistently with what they have just done. Tapping five stars is a
small public-to-themselves commitment; writing the review is now the consistent
next act.

This is exactly why the Amplifier redirect must be **instant**. A "thanks!
now would you also…" screen breaks the chain and reframes it as a new, separate
request they can decline.

### Catharsis (the Shield)

An unhappy customer has emotional energy that will be spent somewhere. Given a
box that says *"what went wrong?"*, most people spend it there — it is closer,
easier, and feels more likely to be read by someone who can act.

The confirmation matters: *"your feedback has been sent to the owner"*, not
"thank you for your feedback". The first says a person will read this. The
second says it went into a form.

### Dopamine on the owner side

The person paying needs to feel it working. Design targets:

- New review count animates upward on the dashboard, doesn't just appear
- Rating change is shown as **"4.2 → 4.6"**, movement, not a static number
- Intercepted feedback is framed as **"3 one-star reviews prevented this month"** — the value made countable
- Weekly email: *"You gained 14 reviews this week. Your rating went from 4.3 to 4.5."*

### Loss aversion, used honestly

"3 bad reviews prevented" is more motivating than "12 good reviews gained",
because avoiding loss motivates more strongly than equivalent gain. Both numbers
are real. Lead with the one that lands.

### Zeigarnik effect (unresolved items nag)

Unresolved private feedback shows a badge and stays visible until actioned.
`private_feedback.resolved_at` already exists ✅ — the badge is the UI half.

### Peak–end rule

A customer's memory of a visit is shaped by its peak and its end. The stand *is*
the end. A smooth, fast, respectful interaction at the door is the last thing
they experience — which is worth getting right for its own sake, before any
review is written.

---

## 5. The three currencies

This is the part with the most real money attached, so it is worth being precise.

### Currency 1 — SaaS subscription ✅

| Plan | SMS included | Price |
|---|---|---|
| Starter | 500/month | **$49.00** (`4900`) |
| Growth | 2,500/month | **$149.00** (`14900`) |
| Scale | 10,000/month | **$399.00** (`39900`) |

14-day trial, no card required to start.

Stored as integer cents — `4900`, never `49.00`. See §9.

> `backend/src/services/billingService.js`

#### The kill switch ✅

Enforced in **three independent places**, because one check is a single point of
failure for revenue:

1. **Route middleware** — re-reads billing state fresh, never trusts the token
2. **Campaign worker** — a card can fail between creating a campaign and sending it
3. **SMS worker, before *each* message** — a 5,000-person campaign takes time

Plus a nightly job that expires elapsed trials, because Stripe sends *no event*
for "a trial nobody attached a card to just ended."

#### Smart lockout UX 🆕 (partly ✅)

The instinct is to lock a non-payer out entirely. That is the wrong move: a
customer who cannot see their own data has no reason to come back and pay.

**What is already true ✅** — read paths stay open, and the QR gate keeps working
in degraded mode (straight to Google, no Shield). A customer scanning a stand
never sees a broken experience because the business missed a payment.

**Proposed graduated ladder 🆕:**

| Day | State | What the owner sees |
|---|---|---|
| 0 | Payment fails | Email. Everything still works. |
| 1–3 | Grace | Soft banner: *"Update your card to keep sending."* Full function. |
| 4–7 | Soft lock | SMS sending paused. Dashboard, history, QR analytics all readable. Shield still catches bad reviews. |
| 8–30 | Hard lock | Sending off, Shield off, QR redirects straight to Google. Data intact and visible. |
| 30+ | Dormant | Read-only. Data retained 12 months. One-click reactivate. |

The Shield staying on through soft lock is the deliberate part: it keeps
protecting the business while it is deciding whether to pay, which is the
strongest possible argument for paying.

**Never do:** delete data, hide their own numbers, or show a wall with no way
back. The reactivate button is on every locked screen.

### Currency 2 — hardware, one click 🆕

Not built. Design:

The dashboard knows the business's colours and `public_id`s already. Ordering
should be **one button**, with the artwork generated server-side from data it
already holds. No design step, no upload, no proof approval.

```
[ Order 4 more table tents — $39 ]
  Ships to: 44 High Street  (change)
  Charged to card ending 4242
```

Stripe already has their card from the subscription, so this is a single
`payment_intent` against the saved payment method. No new checkout flow.

Proposed tables: `hardware_orders`, `hardware_order_items`, plus a `sku` catalogue
in code (same reasoning as `PLANS` — pricing belongs in a diff).

**Why this matters commercially:** hardware is a second revenue line, but more
importantly a business with stands physically on its counter does not churn.
The stand is a daily reminder the product exists.

### Currency 3 — SMS, with live cost preview ✅

This is the currency that quietly loses money if the maths is wrong.

Carriers bill per **segment**, not per message, and segment size depends on the
alphabet:

| | First segment | Each segment once split |
|---|---|---|
| **GSM-7** (plain text) | 160 chars | **153** |
| **UCS-2** (any emoji) | 70 chars | **67** |

Two non-obvious consequences:

**The limit drops when a message splits.** 161 characters is not "160 plus a
bit" — it is two segments of 153, because each part carries a reassembly header.

**One emoji more than halves capacity.** A single 🙏 forces the entire message to
UCS-2: 160 characters per segment becomes 70.

Worked example — a 201-character message ending in an emoji:

| Method | Segments | Cost at 2¢ |
|---|---|---|
| Naive `length ÷ 160` | 2 | 4¢ |
| **Correct** (`201 ÷ 67`) | **3** | **6¢** |

A 50% undercharge, on every emoji message, forever.

> `backend/src/domain/sms.js` — 15 tests on the boundaries alone

**Live preview ✅** — `POST /api/campaigns/preview` returns, as the owner types:

```json
{
  "body": "Hi Alex, thanks for visiting Joe's Pizza! …",
  "characters": 142,
  "encoding": "GSM-7",
  "segments": 1,
  "costPerRecipientCents": 2
}
```

`POST /api/campaigns/estimate` does the same for a whole recipient list.

**The UX intent 🆕:** the owner should *see* the moment an emoji doubles their
cost, while they can still delete it. A yellow line reading *"the 🙏 makes this
2 segments — removing it halves the cost"* is worth more than any billing FAQ.

#### Quota reservation is atomic ✅

Two campaigns of 80 created simultaneously against a 100 allowance would both
pass a naive check-then-act. So the check and the reservation are one locking
database operation.

Tested: 10 concurrent requests for 20 each against an allowance of 100 → exactly
5 succeed.

---

## 6. Customer journey, end to end

### The person who taps the stand ✅

```
1. Finishes their coffee
2. Taps the stand on the counter          (~1 second)
3. Page opens: "How did we do?"           (no app, no typing)
4. Taps ★★★★★                              (~1 second)
5a. AMPLIFIER → Google review box, already open
5b. SHIELD    → "What went wrong?" → owner is told privately
```

Total interaction: **under five seconds.**

### The person who gets the text ✅

```
1. Visited yesterday; owner uploads the day's customers
2. Receives one SMS, in their own local daytime — never 3am
   "Hi Alex, thanks for visiting Joe's Pizza! Would you leave us a
    quick review? https://g.page/… Reply STOP to opt out."
3. Taps → same gate → Amplifier or Shield
```

Compliance is not optional and is enforced in code ✅:

- **Consent required** — no recorded consent, no send
- **STOP honoured** — instantly, permanently, and re-checked immediately before each individual send
- **Quiet hours** — evaluated in the *recipient's* timezone, not the server's
- **Never twice** — deduplication window, 30 days by default
- **Opt-out notice** appended automatically if the author forgot

> A regression test exists here for a bug I introduced and caught: `\bstop\b`
> treats a hyphen as a word boundary, so "one-stop shop" was read as already
> containing an opt-out instruction and shipped without one. That is a per-message
> statutory violation at $500–$1,500 each.

---

## 7. The owner dashboard

### Data available today ✅

`GET /api/dashboard` returns, in one round trip:

```
metrics    messagesSent, delivered, deliveryRatePercent,
           contacts, suppressed,
           scans, feedbackIntercepted, averagePrivateRating,
           interceptRatePercent, spendInCents
usage      messagesThisMonth, allowance, remaining, percentUsed, cost
subscription  status, plan, active, trialEndsAt, currentPeriodEnd
charts     dailyUsage[], scans[], devices[]
stands     each stand with scanUrl, scansTotal, scansLast30Days
```

### Proposed layout 🆕

```
┌──────────────────────────────────────────────────────┐
│  Joe's Pizza                        4.2 → 4.6  ↑     │  ← movement, not a number
├──────────────────────────────────────────────────────┤
│   47          12              3            $4.82     │
│  reviews   intercepted     stands        this month  │
│  gained    before Google   active                    │
├──────────────────────────────────────────────────────┤
│  ⚠  3 pieces of feedback need your attention    →    │  ← Zeigarnik
├──────────────────────────────────────────────────────┤
│  Scans, last 30 days                                 │
│  ▁▂▃▅▇▆▅▃▂▁▂▄▆▇▇▆▄▂                                  │
├──────────────────────────────────────────────────────┤
│  Your stands                                         │
│   Front Desk    284 scans   ●    [ QR ] [ Order ]    │
│   Table 4       198 scans   ●    [ QR ] [ Order ]    │
│   Window         41 scans   ●    [ QR ] [ Order ]    │
│                                                      │
│   [ + Order more stands ]                            │
└──────────────────────────────────────────────────────┘
```

Design rules:

- **The headline is movement.** "4.2 → 4.6" beats "4.6".
- **Intercepted feedback is a hero number**, not buried. It is the thing they are actually paying for.
- **Money is always visible** — spend this month, allowance remaining. No surprise bills.
- **Per-stand scan counts** turn placement into something learnable.
- **Ordering is one tap from the analytics** that justify it.

---

## 8. Backend architecture ✅

```
http/          routing, validation, auth, error shaping
   ↓
services/      business rules. no SQL, no req/res
   ↓
repositories/  all SQL. tenant-scoped
   ↓
db/            pool, transactions, RLS context, migrations
   ↓
domain/        pure functions. no I/O. depends on nothing
```

`domain/` holds everything that must never be wrong — SMS segments, money, phone
normalisation, TCPA rules, crypto. Zero dependencies, so it is fully tested
without any infrastructure.

**Stack:** Node 22 · Express 4 · PostgreSQL 16 · Redis 7 + BullMQ · JWT ·
Stripe · Twilio · Resend · Zod.

**Current state:** 4 commits, 74 files, **209 tests passing**, 59 routes.

### Sending is queued, not inline ✅

Creating a campaign costs a **fixed** number of database round trips regardless
of size: two bulk lookups, one atomic quota reservation, one bulk insert, one
enqueue. Returns `202` in milliseconds.

The original implementation did several reads and writes *per recipient* inside
the HTTP request. That is quadratic — 500 recipients took **11 seconds** with no
network I/O at all, and a real send would have blown a proxy timeout mid-campaign
with no record of who had already been texted.

**Duplicate sends blocked three ways**, because texting someone twice costs money
*and* is a compliance problem: BullMQ job ID, a status guard in the worker, and a
Twilio idempotency key.

---

## 9. Security ✅

### Tenant isolation

Every table holding customer data is protected by PostgreSQL Row Level Security:

```js
await client.query('SELECT set_config($1, $2, true)',
                   ['app.current_account_id', accountId]);
```

Three load-bearing details:

1. **Bound parameter, never interpolated** — this is the one value that decides
   isolation.
2. **`true` = transaction-local** — a session-level setting would survive the
   connection returning to the pool and leak into the next request.
3. **`FORCE ROW LEVEL SECURITY`** — PostgreSQL *exempts the table owner* from row
   security by default, and managed Postgres hands you an owner role. Without
   `FORCE` every policy is silently inert: the schema looks perfect and isolates
   nothing. A test asserts `relforcerowsecurity` on all nine tables.

### Authentication

- Access token: JWT, 15 min, carries `token_version` for instant bulk revocation
- Refresh token: opaque, stored only as an HMAC, **rotates on every use**
- **Reuse detection** — presenting a revoked token proves a leak, so the whole family is revoked and the user emailed
- **Lockout counts the target email**, not the IP — IP limiting is defeated by a botnet
- **Failed MFA counts toward the same lockout** — a stolen password must not buy unlimited second-factor attempts
- MFA challenge token uses a **distinct JWT audience**, so it cannot be swapped for an access token
- **Breached-password checking** via HIBP k-anonymity — only a 5-character hash prefix ever leaves the process

### Rate limiting

Two Redis connections with **opposite** settings, which matters: the queue must
never abandon a command (a job would be lost); the limiter must fail fast (or
every request hangs when Redis is down).

**Auth limiters fail closed.** A memory fallback on login hands an attacker
`instances ×` the brute-force budget. A briefly unavailable sign-in page is the
smaller problem.

The scan limiter is keyed **per stand, not per IP** — every customer in a
restaurant shares one NAT address.

### PII

AES-256-GCM at rest. Equality lookups use a **keyed HMAC**: there are only ~10¹⁰
NANP phone numbers, so an unsalted digest is reversible by exhaustive search in
seconds.

Logs redact recursively — the realistic leak is a nested provider error echoing a
recipient back, not someone logging a password.

---

## 10. Money handling ✅

**Every monetary value is an integer count of cents.** `$12.50` is `1250`.

Not style — correctness. `Number('0.29') * 100` is `28.999999999999996` in IEEE
754. Convert naively and you silently lose a cent per transaction until your
books stop matching Twilio's invoice and nobody can explain why.

The code refuses a float rather than rounding it:

```js
priceMessage('hello', 1.5)  →  throws MoneyError
```

Stored per message: `segment_count`, `cost_in_cents`, `encoding`. Rolled up daily
per account. Actual provider price is preferred over the estimate when Twilio
reports one.

### The Stripe bug worth knowing about ✅

For `invoice.*` events, `event.data.object` is an **Invoice**, not a Subscription
— so its `.id` is `in_…`, and matching it against `stripe_subscription_id` finds
**zero rows**. Nothing errors. Payment failures simply stop locking anyone out,
and you find out weeks later when revenue looks wrong.

Handled explicitly: subscription id → `invoice.subscription` → customer →
metadata. Exactly-once via a claim table. Failures return **500 so Stripe
retries** — returning 200 on failure strands the account permanently.

---

## 11. Database ✅

22 tables. The ones that matter:

```
accounts               tenant. business_name, slug, google_review_url, timezone
users                  citext email, password_hash, token_version, lockout
account_members        owner / admin / member / viewer
billing_subscriptions  stripe ids, status, monthly_sms_allowance, trial_ends_at

contacts               phone_encrypted, phone_lookup (HMAC), consent + timestamp
suppressions           STOP list, per account
campaigns              template, review_link, status, counters, estimated_cost_cents
messages               provider_sid, status, segment_count, cost_in_cents

qr_stands              public_id, label, colors, review_threshold, scans_count
qr_scans               ip_hash, device_type, converted
private_feedback       rating, feedback_encrypted, resolved_at    ← the Shield

usage_daily            messages_sent, segments_sent, cost_in_cents
audit_events           who did what
security_events        who signed in, from where
```

Ten `SECURITY DEFINER` functions for the paths that arrive with no tenant
context — provider callbacks and the public scan — each touching exactly one row
rather than loosening any policy.

---

## 12. Built vs. not built

### ✅ Working and tested

Multi-tenancy with RLS · registration, login, MFA, sessions, password reset ·
Stripe subscriptions + 3-layer kill switch · QR stands, gate page, Amplifier and
Shield · scan analytics with race-free dedupe · SMS campaigns with correct
segment maths · TCPA compliance · PII encryption · queue + workers · 59 routes ·
209 tests · Docker + CI

### 🆕 Designed here, not built

NFC tag writing · hardware catalogue and ordering · graduated lockout ladder ·
print templates (table tents, stickers, cards) · the dashboard UI itself ·
per-stand placement insights · weekly digest email · Google Business Profile
integration (rating is currently self-reported, not fetched) · AI reply drafts

### ⚠ The single most important gap

**None of the SQL has ever executed.** No Docker, Postgres, or Redis in my
environment. 22 tables and 10 functions are written carefully and are entirely
unproven.

```bash
docker compose up
curl http://localhost:4000/api/ready      # want {"ready":true,...}
```

That command is worth more than any feature below it.

---

## 13. Suggested order

| # | Work | Why now |
|---|---|---|
| 1 | `docker compose up` | Everything else is speculation until this passes |
| 2 | Push to GitHub | 4 commits sitting locally. This has already been lost once. |
| 3 | Owner dashboard UI | An API nobody can use is not a product |
| 4 | Stand ordering + fulfilment | Second revenue line; and stands on counters do not churn |
| 5 | NFC tag writing | Turns the QR into the tap experience |
| 6 | Graduated lockout ladder | Recovers revenue that a hard lock loses |
| 7 | Google Business Profile | Makes "4.2 → 4.6" a real measured number |
| 8 | Weekly digest email | Recurring dopamine; the retention lever |

---

## 14. Things worth adding 🆕

**Placement intelligence.** You will have scan counts per stand across thousands
of businesses. *"Counter stands get 3× the scans of window stickers"* is real
advice nobody else can give.

**Time-to-review.** Measure tap → Google review posted. It is the number that
proves the Amplifier works, and it is the number a competitor cannot fake.

**Shield resolution loop.** Owner marks feedback resolved → optional follow-up
SMS: *"Thanks for telling us — we've fixed it. We'd love another chance."* Turns
the Shield from a filter into a recovery channel.

**Benchmarks.** *"Your intercept rate is 8%. Similar restaurants average 12% —
try moving a stand to the exit."*

**Staff attribution.** A stand per server. Handled carefully it is a coaching
tool; handled badly it is surveillance. Worth doing, worth doing thoughtfully.

---

*Sections marked 🆕 are proposals, not decisions. Correct them and I will fold
your version in.*
