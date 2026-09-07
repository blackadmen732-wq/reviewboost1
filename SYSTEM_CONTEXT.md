# ReviewBoost — System Context

Source of truth for what ReviewBoost is, what is approved, what is proposed, and
what actually exists.

State labels describe repository implementation and verification evidence; they
do not claim production readiness.

---

## How to read the state labels

| Label | Means |
|---|---|
| **APPROVED** | Agreed product behaviour. Binding. |
| **PROPOSED** | Design intent. Not agreed, not built. |
| **IMPLEMENTED** | Code exists in the repository. |
| **CI-TESTED** | Automated tests for this surface have run successfully in CI. |
| **LIVE-VERIFIED** | Exercised against real production or provider infrastructure and observed. |
| **IMPLEMENTED — UNVERIFIED** | Code exists (and may be CI-tested); not live-verified. |
| **REJECTED** | Explicitly prohibited. Present in the repository only as work to remove. |
| **NOT BUILT** | Does not exist |

**CI-tested is not live-verified.** A passing GitHub Actions job is not a
production send, a real NFC tap, or a store release.

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

### Prohibited language

Not permitted in product copy, dashboards, marketing, or internal documents:
"reviews prevented", "reviews intercepted", "negative reviews stopped", "only 4-
and 5-star customers reach Google", "intercept rate" as a headline metric, or any
threshold-based routing of the public review opportunity.

---

## 3. The physical layer

### Stands — IMPLEMENTED, CI-TESTED — not live-verified

A stand is a row with an unguessable public identifier used in a short URL. It
carries a label, brand colours, and an active flag, and renders as PNG or SVG at
high error correction so it survives being scuffed or partially covered.

The internal identifier never leaves the server, so stands cannot be enumerated.

Capability split (do not collapse these):

- **Web owner dashboard:** create and manage stands, export QR (SVG / PNG /
  JSON), Copy NFC Link, NFC Tools instructions, and Web NFC write on supported
  Android Chrome.
- **Mobile Stands tab:** list existing stands by location, open stand detail,
  share or open the stand URL, and native NFC provisioning (owner/admin). Mobile
  does **not** create stands or export QR SVG/PNG; the empty state tells the
  owner to create a stand from the web dashboard.

Those surfaces have unit-test coverage in CI. They have not been live-verified
on printed hardware in the field.

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

### NFC provisioning — IMPLEMENTED, CI-TESTED — not live-verified

An NFC tag holds one ReviewBoost HTTPS URL (`{PUBLIC_FRONTEND_URL}/q/{token}`).
The guest never needs the ReviewBoost app. QR and NFC for the same stand resolve
to the same token.

Software that exists:

- Native NDEF URI write in the Expo app (`apps/mobile/lib/nfc.ts`), with
  read-back verification and role-gated UI (owner/admin). Requires a
  development/preview build — not Expo Go.
- Web NFC writer on the owner stand page, feature-detected (Android Chrome).
- Copy NFC Link and NFC Tools fallback instructions.
- `rpc_record_nfc_provision` plus `POST /api/v1/review-stands/[standId]/nfc-provision`.
- Token-rotation awareness: a stand whose token moved after the last write
  should be treated as needing a rewrite.

CI (`.github/workflows/mobile-release-validation.yml`) evaluates
`expo config --type public` and asserts `NFCReaderUsageDescription`, the
`react-native-nfc-manager` plugin name, identifiers, `eas.json`, env-var names,
native-dep ranges, `tsc`, and unit tests. It does **not** run `expo prebuild`
and does **not** inspect generated iOS entitlements. `npm run prebuild:check`
exists for local/manual native-config inspection and is not invoked by CI.
Frontend `stands-system` unit tests and mobile `use-stands` tests also run in
CI. There is no dedicated NFC pgTAP suite. The real-device checklist in
`docs/testing/NFC_DEVICE_TEST_CHECKLIST.md` is **unchecked**.
GitHub issue #31 is the canonical NFC spec and remains open.

### Customer Page V2 — IMPLEMENTED, CI-TESTED — not live-verified

The branded customer page replaces the default rating screen with a
business-customised landing page. The customer experience is:

```
NFC/QR/Text Request → branded customer page → tap 1-5 stars
    → ReviewBoost rating saved → immediate Google handoff
```

No note field, no Continue button, no Google-choice screen, no Team Praise
screen, no Finished screen in the V2 public flow. Every rating 1–5 follows the
exact same Google path — no review gating under any circumstances.

**Data model:** draft/publish. The owner edits a draft; publishing atomically
snapshots it. The public flow only reads the published snapshot. Six templates:
signature, modern, bold, editorial, classic, minimal. Location overrides
cascade: location published → org published → built-in Minimal.

**Feature flags:** `CUSTOMER_PAGE_EDITOR_ENABLED` gates owner API;
`CUSTOMER_FLOW_V2_ENABLED` gates the public `customerPage` field in
`/api/v1/public/q/{token}`. Both default off. Rollback is turning a flag off.

**Assets:** image binaries live in object storage, never Postgres. Upload flow:
reserve (returns opaque path) → client PUTs → finalize validates + promotes to
`ready`. Public URLs are content-hashed; no org names, tokens, or bucket
credentials appear in them.

**Security:** all mutations are SECURITY DEFINER RPCs. RLS isolates tenants.
Authenticated INSERT/UPDATE/DELETE revoked on both tables. Draft data never
leaks to the public resolver. Resolver failure degrades to built-in Minimal
(not a 500). The `customerPage` field in the public context contains no org,
location, stand, or profile IDs.

**Not built:** pixel-perfect frontend editor, storage bucket wiring, image
processing pipeline, CDN configuration.

**Downstream cleanup queue (V2 activation, does not block foundation PR):**
- Remove Continue button, note field, Google-choice screen, Team Praise screen,
  and Finished screen from V2 public flow frontend
- Audit owner mobile app for customer page settings surface
- Wire `CUSTOMER_PAGE_PUBLIC_ASSET_BASE` to a real CDN

**CI-tested:** 42 pgTAP assertions (`customer_page_test.sql`) and 45 vitest
assertions (`customer-page-v2.test.ts`).

### Hardware ordering — PROPOSED / NOT BUILT

Not built, not costed, not agreed. Missing: tag catalogue, purchasing, ordering,
fulfilment, and shipping. A second revenue line, and a retention lever: a
business with stands physically present does not quietly churn.

Every physical unit should carry **both** NFC and a printed QR — NFC for phones
that read from the lock screen, QR as the universal fallback.

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

### 5.1 Subscription — NOT BUILT

No subscription plans, billing enforcement, trial flow, cancellation flow, or
Stripe integration exists in the current repository.

#### Subscription requirements — PROPOSED

- Define plans in code so pricing changes appear in a diff.
- Offer a trial without a card.
- Store amounts in **integer minor currency units**, with the currency recorded
  on every entry. Never use floating point.
- Enforce plans at campaign creation, quota reservation, immediately before each
  send, during long campaigns, and during reconciliation.
- Make cancellation self-service, without retention traps.

Any future Stripe behavior must be designed and verified when the integration is
built.

### 5.2 Hardware — NOT BUILT

See §3.

### 5.3 SMS / Text Requests — IMPLEMENTED, CI-TESTED (backend) — not live-verified

Owner language is **Text Requests**, never "campaigns". There is no marketing
path. Detail: `docs/backend/TEXT_REQUESTS.md`.

**Implemented and CI-tested:**

- Consent ledger + projection. An unknown number is never consent.
- Phone-level STOP/START/HELP and durable suppression; the pre-send gate runs
  again at dispatch.
- Request state machine, delivery attempts, transactional outbox, webhook inbox.
- GSM-7 / UCS-2 segment calculator (not `length / 160`) and integer micro-unit
  cost preview.
- Quota ledger (allocation / reservation / consumption / release / refund /
  expiration / adjustment) with a projection. **Purchase of quota is not built.**
- Authenticated APIs: schedule, list, preview, cancel; signed provider webhook;
  worker-secret dispatch trigger.
- Twilio adapter in code. No credentials are committed. In production,
  `getSmsProvider` **fails closed**: a missing or invalid provider
  configuration (`SMS_PROVIDER` unset/unknown, or `SMS_PROVIDER=twilio`
  without credentials) throws `ConfigError` rather than sending or silently
  skipping. An explicitly configured `SMS_PROVIDER=fake` returns simulated
  `submitted` / `failed` / `provider_unknown` outcomes and can advance request
  and outbox state for testing. Neither path is a real carrier send.

**78** vitest cases and **59** pgTAP assertions cover this surface in CI.

**Not built / not live-verified:**

- Owner UI for Text Requests
- A configured SMS provider account, From number, and live carrier send/receive
- Real per-segment production pricing
- Quota purchase / Stripe billing integration
- Legal SMS certification (A2P 10DLC, Advanced Opt-Out as a live provider
  feature). Technical controls exist; that is not certification.

#### SMS usage requirements — PROPOSED where still open

Carriers bill per **segment**, and segment size depends on the alphabet: GSM-7
gives 160 characters, dropping to 153 once a message splits; UCS-2 gives 70,
dropping to 67. A single non-GSM character — one emoji, one curly quote — moves
the entire message to UCS-2 and more than halves capacity.

The segment engine and cost preview **exist and are CI-tested**. Remaining
requirements:

- Plans should be denominated in **segments**, not vaguely in "texts".
- Provider cost can fall below one cent, so accounting stores it in integer
  micro-units, not cents — **implemented** in the preview/ledger, **not
  live-verified** with a real rate.
- A future owner UI should show when a character such as an emoji changes the
  segment count and cost while they can still edit the message.

### Quota ledger — IMPLEMENTED, CI-TESTED (SMS) — purchase NOT BUILT

Append-only: allocation, reservation, consumption, release, refund, expiration,
adjustment. Every entry carries a unique correlation key. The mutable balance
table is a projection, never the source of truth. Over-budget reservation is
refused; expired allocations are not spendable. There is no billing product that
creates allocations yet.

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

Compliance obligations — **technical controls IMPLEMENTED and CI-TESTED; not
live-verified and not a legal certification**: consent recorded with purpose and
source; STOP/START/HELP honoured (including STOP before any org consent); the
suppression gate checked immediately before every send; quiet hours in the
recipient's time zone, re-checked at dispatch; deduplication window; opt-out
notice still needs owner-facing copy. Live provider behaviour (Twilio Advanced
Opt-Out, 10DLC, inbound reliability) is **not live-verified**.

---

## 7. Owner dashboard — IMPLEMENTED — UNVERIFIED

The Next.js application contains owner pages for sign-in, onboarding,
organization selection, home, feedback, praise, reviews, stands, customers, and
settings. Stands include QR export, Copy NFC Link, NFC Tools instructions, and
(on supported Android Chrome) Web NFC write. There is **no Text Requests owner
UI**. The interface and server-side data assembly exist, but have not been
live-tested against production infrastructure.

Design rules:

- **Headline is movement** — a rating trend, not a static number
- **Recovery is the hero metric** — "12 recovery conversations opened", "9 resolved". Never "reviews prevented"
- **Money always visible** — spend to date and remaining allowance. No surprise bills
- **Per-stand scan counts**, so placement becomes learnable
- **Open recovery tasks** persist until actioned

---

## 8. Architecture

### Current repository — IMPLEMENTED — PARTIALLY VERIFIED

Next.js 16, App Router, TypeScript strict. PostgreSQL via Supabase with Row
Level Security and Supabase Auth (GoTrue). An Expo 57 / React Native mobile
application uses Expo Router, OTP sign-in, and the authenticated APIs for Live
Feed, Feedback, and Stands (mock data has been removed). Native NFC writing and
EAS release config exist; neither is live-verified / live-released.

Database migrations and **368** planned pgTAP assertions have run successfully
in CI, including tenant-isolation, privilege checks, onboarding-security,
Text Requests, and Customer Page V2. Deployments succeed through external Vercel configuration, but
the complete live product flow, including the Next.js and Expo applications
against production infrastructure, remains unverified.

### Intended platform — PROPOSED

Not agreed. Each item requires an architecture decision record before adoption.

- Next.js 16, App Router, TypeScript strict (implemented)
- Supabase — PostgreSQL, Auth, Storage, Row Level Security (implemented)
- Vercel for web deployment (deployments succeed through external configuration)
- Durable background execution via an **explicitly selected** job platform
  (Text Requests currently use a Postgres transactional outbox plus an internal
  dispatch trigger; that is not a settled job platform)
- Twilio for SMS (adapter implemented; live account **not** configured)
- Stripe for billing (**not built**)
- Resend for transactional email
- Google Business Profile integration
- Square first; Toast and Clover later
- PostgreSQL as the source of truth
- Transactional outbox and durable webhook inbox (implemented for SMS)
- Redis only where it earns its place operationally — **never as the sole record of money, consent, billing, or message state**

> **The background-job platform is an open decision.** It must not be settled
> without an ADR comparing realistic options against durability, operational
> burden, cost, and failure modes.

### Reliability pattern — PROPOSED as the general rule; SMS follows it in-repo

One transaction changes domain state, reserves quota, and writes an outbox event.
A relay publishes to the queue. A worker records an attempt before contacting any
provider. Provider webhooks land in a durable inbox and are applied idempotently.
Reconciliation repairs ambiguous outcomes.

The Text Requests backend implements this pattern in PostgreSQL and is
CI-tested. It has not been live-verified with a real provider.

The database is the authority. Queues are transport. Stripe is the payment
authority. Twilio is a delivery provider. **Neither provider is the accounting
system.**

---

## 9. Security

### Implemented in the current repository — PARTIALLY VERIFIED

Tenant isolation via row security; short-lived access tokens with rotating
refresh tokens and reuse detection; account lockout; TOTP; AES-256-GCM for PII
(including phone numbers on Text Requests) with keyed HMAC lookups; CSRF;
layered rate limiting; recursive log redaction.

Migrations and pgTAP security tests, including tenant-isolation and privilege
attacks, have run successfully against CI databases. This is not evidence of a
production security review or a live production deployment. Application-level
security controls have automated test coverage but have not been live-tested
against production infrastructure.

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

Hardware catalogue, ordering, fulfilment · Google Business Profile integration ·
POS integrations · AI reply drafting · admin portal · monitoring and alerting ·
backups and restore drill · load testing · contacts as first-class entities ·
campaign scheduling · print templates · Stripe billing / subscription · Text
Requests owner UI · EAS project link, TestFlight, and Play submission

### Exists, CI-tested, not live-verified

NFC provisioning software (native write, Web NFC, NFC Tools fallback, QR). Text
Requests backend (consent, suppression, outbox, quota, Twilio adapter). Mobile
Live Feed / Feedback / Stands live-API hooks. EAS release configuration. The
full live Next.js owner and customer flow against production. External provider
accounts have not been contacted.

Database migrations and pgTAP tests are excluded from this category: they have
run successfully in CI.

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
