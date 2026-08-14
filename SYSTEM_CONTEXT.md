# ReviewBoost — System Context

Source of truth for what ReviewBoost is, what is approved, what is proposed, and
what actually exists.

**This document contains no status claims.**

---

## How to read the state labels

| Label | Means |
|---|---|
| **APPROVED** | Agreed product behaviour. Binding. |
| **PROPOSED** | Design intent. Not agreed, not built. |
| **IMPLEMENTED — UNVERIFIED** | Code exists in the repository; not exercised against real infrastructure |
| **VERIFIED** | Executed against the relevant environment and observed |
| **REJECTED** | Explicitly prohibited. Present in the repository only as work to remove. |
| **NOT BUILT** | Does not exist |

A section without a label is a defect in this document.

---

## 1. Product vision — APPROVED

Local businesses depend on their public rating. Most satisfied customers never
leave a review; the occasional dissatisfied one leaves a public review that
persists for years.

ReviewBoost does two things:

1. **Makes asking for honest feedback effortless and consistent** — a physical
   stand a customer taps or scans, and SMS to customers who already visited.
2. **Surfaces an unhappy experience to the business quickly**, so they can
   attempt service recovery — *in addition to*, never instead of, the customer's
   public review opportunity.

---

## 2. Review integrity — APPROVED, and binding on everything below

> **Every customer receives the same neutral opportunity to leave a public Google
> review, regardless of the rating they select inside ReviewBoost.**

The selected rating may *additionally* trigger private feedback capture, a
service-recovery task, an owner alert, internal sentiment classification, or a
follow-up workflow.

The private path must never **hide, suppress, delay, deprioritise, or replace**
the public review opportunity.

### Amplifier and Shield — APPROVED definitions

| Term | Means | Never means |
|---|---|---|
| **Amplifier** | Helping a business consistently request honest feedback and learn from positive experiences | Routing only satisfied customers to Google |
| **Shield** | Detecting an unhappy experience early so the business can recover the relationship privately | Preventing, intercepting, or filtering negative public reviews |

### Rating-threshold routing — REJECTED

The legacy design routed 4–5 star selections to Google and diverted 1–3 star
selections into private feedback with no public review offered, reporting the
difference to the business as reviews "prevented".

**That is review gating. It is prohibited** by Google's user-contributed content
policy, which forbids discouraging negative reviews and forbids selectively
soliciting positive ones — and it carries platform-enforcement and
consumer-protection risk.

The current Supabase schema has no `review_threshold` column and never will.
A pgTAP test asserts its absence. The old Express backend's gating logic has
been removed entirely.

### Prohibited language

Not permitted in product copy, dashboards, marketing, or internal documents:
"reviews prevented", "reviews intercepted", "negative reviews stopped", "only 4-
and 5-star customers reach Google", "intercept rate" as a headline metric, or any
threshold-based routing of the public review opportunity.

---

## 3. The physical layer

### Stands — IMPLEMENTED — UNVERIFIED

A stand is a row with an unguessable public identifier used in a short URL. It
carries a label, brand colours, and an active flag, and renders as PNG or SVG at
high error correction so it survives being scuffed or partially covered.

The internal identifier never leaves the server, so stands cannot be enumerated.

The `review_threshold` gating field from the old Express backend has been
removed. The current schema has no such column; a pgTAP test asserts this.

### The tap flow — APPROVED

```
Customer taps or scans the stand
        ↓
Page opens — no app, no install, no typing
        ↓
Scan recorded (deduplicated per device over a short window)
        ↓
"How did we do?"   ★ ★ ★ ★ ★
        ↓
Rating recorded
        ↓
Public Google review opportunity presented — IDENTICAL for every rating
        ↓
Low rating ALSO opens private feedback + owner alert + recovery task
```

The distinction from the legacy flow: the public opportunity is presented on
**every** branch, with equal prominence. The private path is additive.

### NFC — NOT BUILT

An NFC tag holds a URL, so the same public URL applies and the backend needs no
change. Missing: tag encoding, a hardware catalogue, ordering, fulfilment, and
shipping.

Every physical unit should carry **both** NFC and a printed QR — NFC for phones
that read from the lock screen, QR as the universal fallback.

One public identifier per physical unit, so placement can be compared.

### Hardware ordering — PROPOSED

Not built, not costed, not agreed. A second revenue line, and a retention lever:
a business with stands physically present does not quietly churn.

---

## 4. UX principles — PROPOSED

Design intent. Naming the reason a thing works is what stops it being optimised
away by someone who does not know.

**Zero friction.** Two actions from "finished" to "review posted": tap, then tap
a star. No app, no account, no typing.

**Consistency.** Someone who has just rated highly is more likely to act
consistently and write the review — which is why the public opportunity must be
immediate and unobstructed for everyone.

**Catharsis.** A dissatisfied customer has energy that will be spent somewhere.
An immediate, easy private channel captures much of it — **while the public
option remains equally available.**

**Owner-side feedback.** The payer needs to see it working: rating movement shown
as movement, review counts that update, recovery tasks that visibly resolve.
Metrics must describe *recovery*, never *prevention*.

**Unresolved items nag.** Open private feedback stays visible until actioned.

**Peak–end.** The stand is the last interaction of a visit. Getting it right is
worth doing for its own sake.

---

## 5. The three revenue lines

### 5.1 Subscription — IMPLEMENTED — UNVERIFIED

Plans defined in code so pricing changes appear in a diff. Trial without a card.

Stored in **integer minor currency units**, with the currency recorded on every
entry. Never floating point.

Enforcement points designed: campaign creation, quota reservation, immediately
before each send, during long campaigns, and during reconciliation.
**No Stripe call has been exercised.**

Cancellation must be self-service. No retention traps.

### 5.2 Hardware — NOT BUILT

See §3.

### 5.3 SMS usage — IMPLEMENTED — UNVERIFIED

Carriers bill per **segment**, and segment size depends on the alphabet: GSM-7
gives 160 characters, dropping to 153 once a message splits; UCS-2 gives 70,
dropping to 67. A single non-GSM character — one emoji, one curly quote — moves
the entire message to UCS-2 and more than halves capacity.

A naive `length / 160` undercharges every Unicode message.

Plans must be denominated in **segments**, not vaguely in "texts".

**Provider cost can fall below one cent and is stored in integer micro-units**,
not cents.

Live cost preview endpoints exist. The intent is that an owner sees the moment an
emoji changes the cost, while they can still remove it.

### Quota ledger — PROPOSED

Append-only: allocation, reservation, consumption, release, refund, expiration,
adjustment. Every entry carries a unique correlation key. Any mutable usage table
is a projection, never the source of truth.

---

## 6. Customer journeys — APPROVED

### Tap or scan

```
1. Finishes their visit
2. Taps the stand
3. "How did we do?"
4. Taps a rating
5. Public Google review opportunity — same for every rating
   Low rating additionally: private feedback → owner alert → recovery task
```

### SMS

```
1. Visited previously; consent on record
2. Receives one message, in their own local daytime
3. Opens the same rating page → same equal public opportunity
```

Compliance obligations — **PROPOSED as requirements, not verified as working**:
consent recorded with purpose and source; STOP/START/HELP honoured; suppression
checked immediately before every send; quiet hours in the recipient's time zone;
deduplication window; opt-out notice present.

---

## 7. Owner dashboard — PROPOSED

Data assembly exists in code; no interface has been built.

Design rules:

- **Headline is movement** — a rating trend, not a static number
- **Recovery is the hero metric** — "12 recovery conversations opened", "9 resolved". Never "reviews prevented"
- **Money always visible** — spend to date and remaining allowance. No surprise bills
- **Per-stand scan counts**, so placement becomes learnable
- **Open recovery tasks** persist until actioned

---

## 8. Architecture

### Current repository — IMPLEMENTED — UNVERIFIED

Next.js 16, App Router, TypeScript strict. PostgreSQL via Supabase with Row
Level Security. Supabase Auth (GoTrue). Vercel for web deployment.

**No component has been exercised against real production infrastructure.**

### Intended platform — PROPOSED

Not agreed. Each item requires an architecture decision record before adoption.

- Next.js 16, App Router, TypeScript strict (implemented)
- Supabase — PostgreSQL, Auth, Storage, Row Level Security (implemented)
- Vercel for web deployment (implemented)
- Durable background execution via an **explicitly selected** job platform
- Twilio for SMS
- Stripe for billing
- Resend for transactional email
- Google Business Profile integration
- Square first; Toast and Clover later
- PostgreSQL as the source of truth
- Transactional outbox and durable webhook inbox
- Redis only where it earns its place operationally — **never as the sole record of money, consent, billing, or message state**

> **The background-job platform is an open decision.** It must not be settled
> without an ADR comparing realistic options against durability, operational
> burden, cost, and failure modes.

### Reliability pattern — PROPOSED

One transaction changes domain state, reserves quota, and writes an outbox event.
A relay publishes to the queue. A worker records an attempt before contacting any
provider. Provider webhooks land in a durable inbox and are applied idempotently.
Reconciliation repairs ambiguous outcomes.

The database is the authority. Queues are transport. Stripe is the payment
authority. Twilio is a delivery provider. **Neither provider is the accounting
system.**

---

## 9. Security

### Implemented in the current repository — UNVERIFIED

Tenant isolation via row security; short-lived access tokens with rotating
refresh tokens and reuse detection; account lockout; TOTP; AES-256-GCM for PII
with keyed HMAC lookups; CSRF; layered rate limiting; recursive log redaction.

**None of this has run against a real database.** Tenant isolation in particular
is designed and untested.

### Non-negotiable — APPROVED

- No secrets in git, chat, logs, screenshots, or client bundles
- Service-role credentials never reach a browser or public build
- Separate development, preview, and production credentials, with rotation
- PII encrypted with a versioned key; equality lookups by keyed HMAC
- Tenant identity derived from authenticated server context only
- Parameterised SQL everywhere
- Every exposed tenant table carries row security
- MFA required for billing, member administration, integration connection, API key creation, PII export, and organisation deletion
- Append-only audit and financial ledgers
- CI runs type checking, tests, secret scanning, and dependency audit

---

## 10. Honest gap list

### Does not exist

Frontend of any kind · NFC encoding · hardware catalogue, ordering, fulfilment ·
Google Business Profile integration · POS integrations · AI reply drafting ·
admin portal · monitoring and alerting · backups and restore drill · load testing ·
contacts as first-class entities · campaign scheduling · print templates

### Exists but unverified

Every line of backend code in this repository. No SQL has been executed. No
provider has been contacted.

### Must be removed

Rating-threshold routing of the public review opportunity, and every metric or
string describing prevented or intercepted reviews.

---

## Appendix — Primary sources

Consult directly; do not rely on paraphrase here.

- Google — user-contributed content policy: prohibited and restricted content, including discouraging reviews and selective solicitation
- Supabase — Row Level Security documentation; API key and service-role security guidance
- Twilio — messaging compliance, Advanced Opt-Out, A2P 10DLC registration, duplicate-message guidance
- Stripe — webhook delivery semantics including duplicate and out-of-order delivery, and idempotency
- NIST — Secure Software Development Framework (SP 800-218)
