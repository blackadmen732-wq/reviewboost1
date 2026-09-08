# Backend deep research — synthesis

Research pass completed 2026-09-08 against `main` at `26320dd`, on branch
`cursor/sms-economics-platform-phase-1-5112`.

This directory holds five independent backend audits. Each was produced by a
separate reviewer working from the repository and from a live local Supabase
Postgres, and each is self-contained with its own method, evidence, and
priority-ordered remediation list. This file is the synthesis: the shared
verdict, the findings that more than one audit reached independently, and the
work in the order it needs doing.

Nothing in this directory is a code change. No source file, migration, or test
was modified by this research.

| # | Report | Scope |
|---|---|---|
| 01 | [`01-sms-backend-correctness.md`](01-sms-backend-correctness.md) | Text Requests pipeline: consent, suppression, state machine, outbox, webhooks, quota, money arithmetic |
| 02 | [`02-api-layer-and-security.md`](02-api-layer-and-security.md) | Every HTTP route, auth, tenancy, service-role containment, rate limiting, OpenAPI drift |
| 03 | [`03-scale-and-capacity.md`](03-scale-and-capacity.md) | Measured benchmarks on a seeded 20,000-organization database |
| 04 | [`04-stands-nfc-and-job-platform.md`](04-stands-nfc-and-job-platform.md) | Stand tokens, NFC provisioning, the public scan path, plus an ADR for the background job platform |
| 05 | [`05-sms-economics-platform-design.md`](05-sms-economics-platform-design.md) | Phased backend design for the cost / routing / margin / credit / reconciliation system |

---

## The answer to the question that was asked

**Can this backend support 15,000 to 20,000 business owners?**

As a tenant directory, yes. 20,000 organizations, their locations, their stands,
and their members are unremarkable for a single Postgres instance, and report 03
measured that directly rather than assuming it.

The architecture is not what breaks. Four specific things break, and none of them
is "we need a bigger database":

1. **The owner dashboard's query shape collapses under Row Level Security long
   before 20,000 tenants matter.** It is a per-tenant problem, not a fleet
   problem: it is already true today for any single business with a few tens of
   thousands of responses. Report 03 measured a **24× penalty** on the inbox list
   for one busy organization (180 ms as `authenticated` versus 7.4 ms as
   `service_role` on identical SQL) because the RLS predicate
   `app.is_org_member(org_id)` is evaluated once per row. The dashboard's exact
   `COUNT(*)` tiles are **50×**. An authenticated count with no `org_id`
   predicate sequentially scanned 4.2 million rows for **24.8 seconds**. This is
   the first thing that will break and it is the cheapest to fix.
2. **Text Requests cannot currently leave the queue at all, at any scale.**
   Report 04 established that nothing in the repository schedules the dispatch
   endpoint: there is no `crons` entry in `frontend/vercel.json`, and
   `rpc_sms_quota_expire` is not registered on `cron.job`. The outbox is a
   genuine transactional queue with leases, backoff, and a dead-letter path — it
   simply has no clock. This is not a scale finding; it is a "the feature does
   not run" finding.
3. **Four real defects in the send/settle path can lose or duplicate money and
   messages.** These are defects in committed code, not unbuilt features. See
   the blocking-defects list below.
4. **The credit pricing as designed does not hold the 70% margin floor at small
   basket sizes.** Report 05 worked the arithmetic against published rates rather
   than assumptions, and a $10 / 250-credit pack realises about **66%** — below
   the stated hard minimum — once Stripe's fixed 30¢ is taken into account.

Everything above is fixable, and the foundation underneath it is better than the
gap list suggests. The stand token scheme, the segment engine, the integer
micro-unit money discipline, the quota ledger's reserve/consume/release
semantics, the `SKIP LOCKED` outbox claim, and the decision to treat Postgres as
the accounting authority all held up under adversarial review.

---

## Findings that two audits reached independently

These deserve more weight than single-report findings, because two reviewers
working separately on different questions arrived at the same defect.

**Additional stands cannot be reprinted.** Reports 02 and 04 both traced
`POST /api/v1/review-stands` to a call on `rpc_set_stand_token_ciphertext`, a
function that has since been dropped from the schema. The error is ignored, so
stand creation appears to succeed while the reprintable token material is never
stored, and QR export then fails for every stand created after onboarding. Two
independent reviewers finding the same broken call, one from the API surface and
one from the physical-product surface, is strong evidence this is real. It is
also the clearest example in this research of a defect that automated tests did
not catch because the test asserted the call was made rather than that the token
was stored.

**The public rate limiter fails open.** Reports 02 and 04 both found that a
limiter store error permits the request, on the highest-volume unauthenticated
surface in the product, and that buckets are allocated per guessed token so a
flood of invented tokens inflates `rate_limit_buckets` itself.

**The dispatch worker is not a send platform.** Reports 01, 03, and 04 converge
here from three directions — a 25-job sequential batch under a 90-second lease
(01), a measured claim ceiling that is *not* the bottleneck because the serial
loop and provider round-trip are (03), and the absence of any scheduler at all
(04). The claim query sustained 1,200 claims/second on one worker and 4,149 with
four concurrent claimers, so the queue is not the constraint. Parallelism needs
to live in processes.

**`provider_unknown` is a state with no exit.** Reports 01 and 04 both found
that the ambiguity state is entered correctly and never resolved: no reconciler
exists, and a timeout stores no provider message id, so a delivery receipt
arriving later cannot be matched to the request. The design decision not to
auto-failover an ambiguous send is right and should be preserved; what is
missing is the reconciliation that makes ambiguity temporary.

---

## Blocking defects — committed code, not unbuilt features

Ordered by how much damage they do if a real carrier send is ever switched on.

1. **A delivery receipt that arrives before the provider message id is persisted
   is marked `processed` and then unrecoverable** (report 01). The authentic
   terminal receipt is acknowledged and discarded. This is the single most
   important fix because it re-opens the only resolution path that already
   exists.
2. **Retryable provider failures are settled as terminal.** Twilio 429 and 5xx
   responses are recorded as `failed` with quota released, so the outbox backoff
   machinery never runs for exactly the class of error it was built for
   (report 01).
3. **A 25-job sequential batch can outlive its own 90-second lease**, parking a
   live send as `provider_unknown` and dropping the provider message id
   (report 01).
4. **Additional stands are created without reprintable token material**
   (reports 02 and 04, above).
5. **Token rotation is a destructive mutation with no idempotency key**, so a
   retried request mints a second token and invalidates the first (report 02).
6. **Missing indexes on the compliance path.** `sms_consent_state` has no
   leading `phone_hash` index, which is the lookup STOP processing depends on,
   and `sms_outbox` has no `request_id` index (reports 01 and 03). A STOP that
   commits slowly is a compliance problem, not a performance problem.

---

## Where the honest labels in the foundation docs need correcting

Report 02's most uncomfortable finding is not a bug. `SYSTEM_CONTEXT.md` §9
lists MFA, account lockout, CSRF, and TOTP among controls implemented in the
repository, and states that MFA is required for billing, member administration,
integration connection, API key creation, PII export, and organisation deletion.
Report 02 found no HTTP route enforcing MFA, TOTP enroll/verify disabled in
`supabase/config.toml`, and member-administration RPCs executable by
`authenticated` over PostgREST with no AAL2 check.

This project's own discipline is that a section without an accurate label is a
defect in the document. Correcting those labels is the highest-value non-code
change available, and it should happen before any of the engineering work below,
because the current text would let a reader conclude that a control exists when
it does not.

That correction is deliberately **not** included in this research commit. It
changes an APPROVED-adjacent document on the basis of one reviewer's reading, and
it deserves its own verified change rather than being folded into a research
drop.

---

## The work, in the order it should happen

Each report carries its own detailed remediation list; this is the cross-cutting
sequence.

**First — make the claims true and the compliance path fast.** Correct the
security labels in `SYSTEM_CONTEXT.md`. Add the `sms_consent_state(phone_hash)`
and `sms_outbox(request_id)` indexes. Fix the receipt-before-SID acknowledgement
and stop settling 429/5xx as terminal. None of this needs a provider account.

**Second — fix the two defects that are visibly broken product.** Persist stand
token ciphertext inside the create RPC and fail the handler if storage fails.
Make token rotation idempotent under a mandatory replay key.

**Third — fix the dashboard before it is anyone's problem.** Add the
`(org_id, submitted_at DESC, id)` family of indexes; report 03 measured the
inbox list dropping from 180 ms to **0.32 ms** under RLS with that index in
place. Replace the per-row `app.is_org_member(org_id)` predicate with a hashed
`org_id IN (SELECT …)` subquery on the large tenant tables only, keeping the
helper where the row count is tens. Retire the exact-count tiles. Add a pgTAP
assertion that the plan does not contain a looping `Filter:
app.is_org_member(org_id)`, so this cannot silently regress.

**Fourth — put a clock on the outbox.** Report 04's ADR recommends keeping
`sms_outbox` as the only job record and driving it with Vercel Cron on a
drain-until-empty pattern, plus `pg_cron` for SQL-only maintenance, explicitly
declining to introduce a second source of truth. Then add org-fair claiming and
the `provider_unknown` reconciler, and move parallelism into multiple worker
processes rather than a larger batch limit.

**Fifth — build the economics engine in phases, starting with the phase that
needs no external account.** Report 05's Phase 1 extends the existing
`sms_quota_ledger` rather than creating a parallel `customer_credit_ledger`,
adds fixture US rate cards, a versioned price book, integer basis-point margin
arithmetic, and a credits-only quote that does not yet reserve. Explicitly
deferred: routing intelligence, automatic price recommendations, five provider
adapters, and the full eight-component landed-cost model, none of which can be
populated before a real provider bill exists.

**Sixth — partitioning and archival, on measured thresholds not dates.** Archive
`done` outbox rows before they exceed roughly 2 million; partition the
append-only event tables monthly before any one reaches ~20 million rows or
~15 GB, starting with `customer_responses` and `public_review_sessions`.

---

## Three decisions this research surfaces that are business decisions, not engineering ones

1. **Credit pack sizing and the margin floor.** Report 05's arithmetic against
   published rates (Twilio US long-code at $0.0083/segment plus T-Mobile's
   $0.0045 pass-through; Telnyx at $0.0040 plus the same pass-through; Stripe at
   2.9% + 30¢) shows the 70% floor is reachable at roughly 4–6¢ per credit *only
   if* 10DLC and number costs are pooled at the platform level and packs are
   large enough to dilute Stripe's fixed fee. A $10 pack does not clear the
   floor; a $20 pack clears it comfortably. Minimum pack size is therefore a
   pricing decision with a hard engineering constraint attached.
2. **Whether "1 segment = 1 credit" is a global identity or a US rule.**
   Report 05 recommends treating it as a US long-code Phase 1 rule that refuses
   unsupported destinations, rather than an invariant that quietly loses money on
   international traffic.
3. **The scan grain.** Report 04 found that a "scan" is recorded when a rating is
   submitted, not when the stand is tapped. Every downstream feature that depends
   on tap counts — per-stand placement learning, and any future detection of a
   tag that has fallen off or been stolen — depends on resolving this. Either
   record taps on interactive load with a proper per-device window, or stop
   calling it a scan.

---

## What this research did not establish

- **Nothing here is live-verified.** No carrier send, no real NFC tap, no cron
  invocation against a hosted Vercel project, and no hosted Supabase instance was
  exercised. Report 03's numbers are real measurements, but they were taken on a
  4-core local container and are stated with that environment attached; they
  indicate ratios and orders of magnitude, not hosted production latencies.
- **The 20,000-organization benchmark used synthetic data** built from stated and
  justified assumptions about tenant size distribution. The assumptions are
  documented in report 03's method section and should be revisited against real
  usage once it exists.
- **Report 05's external rates were fetched on 2026-09-08** and are cited with
  that date. Provider pricing moves; the arithmetic should be re-run, not
  trusted, when the first real contract exists.
- **No remediation was implemented.** Every item above is a recommendation
  supported by evidence in the linked reports, not a change that has been made
  and tested.
