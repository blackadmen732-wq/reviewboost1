# ReviewBoost V1 — completion report

Living document. Updated at every stage, not written at the end.

**Last updated:** 2026-09-15
**Integration branch:** `claude/reviewboost-v1-recovery-cokccs`
**Canonical pull request:** [#71](https://github.com/blackadmen732-wq/reviewboost1/pull/71)
**`main` at the start of this program:** `6b8adc5`
**`main` now:** `6b8adc5` — unchanged. Everything below is on the branch, in one
reviewable PR, and nothing has been merged without review.

## How to read the statuses

| Status | Means |
|---|---|
| **DONE** | Implemented, and verified by something that would fail if it broke |
| **BLOCKED — EXTERNAL** | Code is finished; the remaining step needs credentials, hosted access, or hardware this session does not have |
| **PARTIAL** | Some of it is done and the rest is named below |
| **NOT STARTED** | Does not exist |

Implementation existing is not DONE. A passing unit test is not a live
verification. Where this says DONE it names the evidence.

## What this environment can and cannot verify

| Gate | Available | Notes |
|---|---|---|
| TypeScript, ESLint, Vitest | yes | run per commit |
| Next production build | yes | run per commit |
| Playwright (e2e, Axe, visual) | yes | Chromium preinstalled |
| Migrations + pgTAP | yes | `scripts/backend/local-postgres.sh` |
| Populated-upgrade proof | yes | `local-postgres.sh upgrade <baseline>` |
| Concurrency races | yes | `scripts/backend/concurrency-proof.sh` |
| Mobile tsc / tests / `expo config` | yes | |
| `supabase start` / `db reset` locally | **no** | the egress policy returns 403 for `production.cloudfront.docker.com` and `pkg-containers.githubusercontent.com`, so no container image can be pulled |
| GitHub Actions | yes | CI **and** the Backend database workflow — a real `supabase db reset` + `supabase test db` — are green on every stage SHA |
| Real Stripe, Twilio, device, Supabase project | **no** | no credentials, no hardware |

`local-postgres.sh` runs the migrations and pgTAP against a plain PostgreSQL 16
server with a minimal Supabase-shaped bootstrap. It proves the SQL is correct.
CI's `supabase db reset` remains the reference — and has agreed with it at
every stage.

## Stage status

| Layer | Status | Evidence |
|---|---|---|
| Public V1 customer contract | **DONE** | No public note, no active Team Praise, historical data preserved, strict schemas, dashboard indexes |
| One-tap customer flow | **DONE** | Star tap → rating saved → destination. Byte-identical handoff and one identical destination asserted for ratings 1–5, in jsdom and in a real browser |
| Destination / ReviewBoost owns the door | **DONE** | Provider + URL, allowlist, backfill, resolver reshaped by drop/recreate, owner write with explicit org + audit. 37-assertion suite; the "same token, new destination" test |
| Tags + entitlements | **DONE** | Caps counted under a lock inside the create transaction; ciphertext atomic with the Tag; no free plan; missing entitlement fails closed. 44-assertion suite + an 8-way race |
| Customer Page | **DONE** (live upload BLOCKED — EXTERNAL) | Draft/published, location override, uploads confirmed against storage, publish refuses a pending asset. 29-assertion suite |
| Billing / Stripe | **DONE** in code (live BLOCKED — EXTERNAL) | Signed webhooks, durable inbox keyed by Stripe's event id, out-of-order protection, entitlement written in the same transaction, checkout + portal, trial with card required |
| SMS money ledger | **DONE** | Two sources, monthly first, per-source reservation slices, monthly expires with no rollover, purchased survives cancellation. 50-assertion suite + an 8-way race for the last five segments |
| Text Requests | **DONE** in code (live send BLOCKED — EXTERNAL) | Owner screen on real balances, server-side segment counting, Tags addressable by id, suppression and consent already enforced in the database |
| Workers / schedulers | **DONE** | Dispatch every minute, maintenance every 15; reconciliation and dead-letter release, which never existed; health endpoint |
| Unified web frontend | **PARTIAL** | Canonical navigation, Text Requests and Billing built from scratch on real state. Home, Feedback, Tags and onboarding are the pre-existing screens, not rebuilt |
| Mobile | **PARTIAL** (physical NFC BLOCKED — EXTERNAL) | Text Requests, Account, Tags naming, NFC-rewrite defect fixed. Not rebuilt beyond that |
| Security | **DONE** for what was built | Cross-tenant isolation attacked from three directions in pgTAP; public writes fail closed; RLS on all nine new tables; no secret carries a `NEXT_PUBLIC_` prefix |
| Observability | **PARTIAL** | Health endpoint over outbox age, unresolved sends, dead letters, unprocessed webhooks. No external alerting is wired |
| Backups / restore drill | **NOT STARTED** | Needs a production database |
| Live verification | **BLOCKED — EXTERNAL** | Stripe, Twilio, QR, NFC |

## Verification on the current head

| Gate | Result |
|---|---|
| Migrations from empty | 54 applied |
| pgTAP | 12 suites, 516 assertions |
| Populated upgrade | a realistic pre-change database migrated forward, 20 assertions |
| Concurrency | Tag cap: 8 racers, 1 winner, cap held. Last credit: 8 racers, 2 winners, monthly spent first, no grant overspent |
| Vitest (web) | 462 cases |
| Vitest (mobile) | 73 cases |
| Playwright | 26 cases, customer flow and Axe, both colour schemes, mobile and desktop |
| tsc / eslint / production build | clean, web and mobile |
| GitHub Actions | CI and Backend database green on every stage SHA |

## Defects found and fixed during this program

1. The wizard after the star tap — a Continue button, a separate Google screen,
   a finished screen — was still in #70. The contract is one tap.
2. `a`/`button { color: inherit }` sat outside a cascade layer and silently
   defeated `text-on-brand` on every primary button: invisible in light mode,
   a 2.8:1 contrast failure in dark mode on the customer's own screen.
3. The destination branch changed a function's return type with
   `create or replace`, which PostgreSQL refuses. It could not have applied to
   a populated database.
4. A Tag's reprint ciphertext was stored by a second call whose error was
   discarded, so a Tag could be reported as created and be impossible to
   reprint.
5. Plan limits were checked in HTTP handlers, where two concurrent creates both
   pass.
6. The TypeScript destination validators accepted a port where the database
   refuses one — an owner-visible 503 with no explanation.
7. Zod 4's `.uuid()` rejects this repository's own fixture ids.
8. The SMS balance read used the service-role client inside the owner data
   layer, which returns every tenant's rows.
9. The public rate limiter failed open on writes: with it down, anyone holding
   a token could fabricate unlimited feedback.
10. The mobile NFC banner hid "needs rewriting" exactly when it became true.
11. There were no schedulers at all, so the outbox never drained and
    reconciliation never ran.

## Open pull requests

33 were open at the start. **None has been closed.** Nothing is closed until
its replacement has landed on `main`, and #71 has not been merged.

| PR | Disposition once #71 lands |
|---|---|
| #70 | Its commits are in #71, and the wizard it left behind is removed |
| #69 | Source material for entitlements; the landed version adds location caps, atomic ciphertext, and the concurrency proof |
| #68 | Frontend design source. Navigation and two screens taken; the rest not ported |
| `claude/destination-abstraction-j7nhgo` | Superseded — its resolver change could not have applied to a populated database |
| #67, #44, #37 | Customer Page reference. The landed version is built fresh |
| #66 | One-tap handoff — superseded by the landed customer contract |
| #65 | MONEY.md — superseded by the locked plans in code and SQL |
| #64, #59, #53, #51, #47, #41 | SMS correctness, used as read-only reference. The landed ledger is two-source, not FIFO |
| #63, #61 | Scheduler work — superseded by the landed crons |
| #46 | Fail-closed limiter — landed |
| #56 | Fail-closed ciphertext — landed |
| #23 | Dark contrast — landed, with the cascade-layer root cause |
| #58, #55, #52, #50, #49, #48, #45, #42, #40, #21, #9, #4 | Not triaged |

## Final matrix

| Gate | Status |
|---|---|
| CODE-COMPLETE | **NO** — the frontend and mobile are partial as described above |
| CI-TESTED | **YES** — CI and the Backend database workflow green on every stage SHA |
| DATABASE-UPGRADE-VERIFIED | **YES** — fresh from empty, and a realistic populated upgrade |
| HOSTED-VERIFIED | **NO** — Vercel builds the branch; no hosted flow has been exercised |
| STRIPE-LIVE-VERIFIED | **NO** — no credentials |
| TWILIO-LIVE-VERIFIED | **NO** — no account |
| QR-LIVE-VERIFIED | **NO** — no hardware |
| NFC-LIVE-VERIFIED | **NO** — no hardware |
| SECURITY-VERIFIED | **PARTIAL** — isolation, RLS, secrets and fail-closed behaviour proved for everything built here; no external audit |
| SAFE-TO-LAUNCH | **NO** |

**REVIEWBOOST V1 COMPLETION: the backend and the money model are done and
proved; the owner and customer surfaces are built where they were missing and
inherited where they were not; no live provider or hardware path has been
exercised.** Putting a single percentage on that would be a number with no
evidence behind it, which is the thing this document exists to stop.

## Remaining blockers

1. **Stripe credentials** — for a real card, charge, failed payment and
   recovery. The code and its webhook handling are finished and tested against
   signed fixtures.
2. **A Twilio account and a real phone** — for a real send, delivery callback,
   STOP and START. The provider adapter, outbox, suppression and reconciliation
   are finished.
3. **A Supabase project** — for a real Customer Page upload, and for the backup
   and restore drill, which has not been started because it needs a production
   database.
4. **Physical Tags** — a printed QR and a programmed NFC chip.
5. **Review of #71** — it is green and it has not been merged. Closing the
   superseded PRs waits on that.

## Next dependency

Merge #71, then close the superseded PRs against the commits that replaced
them. After that: the remaining frontend screens (Home, Feedback, onboarding
with plan selection), then live verification as credentials arrive.
