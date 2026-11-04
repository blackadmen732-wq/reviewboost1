# ReviewBoost V1 — completion report

Living document. Updated at every stage, not written at the end.

**Last updated:** 2026-09-17
**Integration branch:** `cursor/sprint-forge-owner-systems-v15-7042`
**Canonical pull request:** [#67](https://github.com/blackadmen732-wq/reviewboost1/pull/67)
**Head:** `38829bb` — 53 commits ahead of `main` (`0155948`)
**Merged to `main`:** nothing. None of this has shipped.

> The earlier half of this program ran on PR #71, from the branch
> `claude/reviewboost-v1-recovery-cokccs`. Those are the header values this
> file carried until now, and they are wrong for the current work — recorded
> here rather than quietly replaced,
> because a status document that rewrites its own history is not one you can
> check.

## How to read the statuses

The vocabulary below is the one the brief specified, and it is deliberately
narrow. "Works" is not a status. Each row says what was actually done to it.

| Status | Means |
|---|---|
| **IMPLEMENTED** | The code exists and is complete. Nothing has run it but a developer |
| **CI-TESTED** | A test that would fail if it broke runs on every push. Names the suite |
| **HOSTED-VERIFIED** | Exercised against the deployed Preview or production build, in a browser |
| **LIVE-VERIFIED** | Exercised end to end against the real third party — a real charge, a real message |
| **DEVICE-VERIFIED** | Exercised on physical hardware — a phone, a printed code, an NFC chip |
| **TESTFLIGHT-VERIFIED** | Installed from TestFlight and used |
| **PLAY-VERIFIED** | Installed from a Play track and used |
| **EXTERNAL-BLOCKED** | The code is finished; the remaining step needs a credential, an account, hardware or a hosted environment this session does not have |

A row can hold more than one. IMPLEMENTED + CI-TESTED is the ceiling anything
reaches without credentials or hardware, and saying so is the point of the
list.

## What this environment can and cannot verify

| Gate | Available | Notes |
|---|---|---|
| TypeScript, ESLint, Vitest | yes | run per commit |
| Next production build | yes | run per commit |
| Playwright (e2e, Axe) | yes | Chromium preinstalled |
| Playwright `@visual` snapshots | **no** | the container's Chromium build differs from the one the baselines were taken on; CI does not run them either |
| Migrations + pgTAP | yes, after one install | `scripts/backend/local-postgres.sh` does the whole bootstrap, but the container ships without the extension — `apt-get install -y postgresql-16-pgtap` first, or all 13 suites fail on `extension "pgtap" is not available` |
| Mobile tsc / tests | yes | |
| `supabase start` / `db reset` locally | **no** | the egress policy returns 403 for the container registry |
| GitHub Actions | yes | CI **and** Backend database — a real `supabase db reset` + `supabase test db` |
| The deployed Preview URL | **no** | `*.vercel.app` returns 403 CONNECT under the egress policy |
| Real Stripe, Twilio, device, Supabase project | **no** | no credentials, no hardware |

Two consequences worth stating plainly, because they bound everything below:
**no row in this document can reach HOSTED-VERIFIED from inside this
environment**, and the same is true of every LIVE, DEVICE, TESTFLIGHT and PLAY
status.

## Stage status

One row per area the brief named. The status column uses only the vocabulary
above.

### The product

| Area | Status | Evidence, or what is missing |
|---|---|---|
| Public website | IMPLEMENTED, CI-TESTED | 10 pages. `public-copy.test.ts`, `copy-truthfulness.test.ts`, `faq.test.ts`, `seo.test.ts`. Not HOSTED-VERIFIED: `*.vercel.app` is unreachable from here |
| Customer experience (`/q/{token}`) | IMPLEMENTED, CI-TESTED | One tap, one destination for every rating. 36 Playwright cases across both colour schemes, mobile and desktop, with Axe. Not DEVICE-VERIFIED |
| Customer Page customization | IMPLEMENTED, CI-TESTED | Photo upload → the real `CustomerVisitView` preview → Publish. One `object-fit: cover` crop and no editor, per the freeze. `customer_page_test.sql` (29). Live upload is EXTERNAL-BLOCKED on a Supabase project |
| Owner web app | IMPLEMENTED, CI-TESTED | Home, Feedback, Text Requests, Tags; Settings separate. `owner-shell-nav.test.ts`, `owner-api.test.ts`, `multi-org-isolation.test.ts` |
| Tags / QR | IMPLEMENTED, CI-TESTED | Token, rotation, reprint ciphertext, caps under a lock. `token_rotation_test.sql` (18), `entitlements_test.sql` (51). A printed code is DEVICE-VERIFIED only, and is not |
| NFC | IMPLEMENTED, CI-TESTED | One visible operation — Program NFC → Hold Near Reader → green check → Done. Read-before-write, same-URL detection, overwrite protection, write verification and server confirmation all still underneath. `nfc-presentation.test.ts`, `nfc-read.test.ts`, `nfc-scenes.test.ts`. **EXTERNAL-BLOCKED** on a phone and a chip |
| Text Requests | IMPLEMENTED, CI-TESTED | Consent, suppression, quiet hours, two-source ledger, server-side segment counting; no GSM-7/UCS-2 shown to an owner. `text_requests_test.sql` (59) plus six unit suites. **EXTERNAL-BLOCKED** on Twilio for a real send |
| Billing / Stripe | IMPLEMENTED, CI-TESTED | Signed webhooks, durable inbox keyed by event id, out-of-order protection, entitlement written in the same transaction, trial with a card required. `billing_sms_credit_test.sql` (59), `billing.test.ts`. **EXTERNAL-BLOCKED** on live keys |
| Apple Pay / Google Pay / Link | IMPLEMENTED (by omission), EXTERNAL-BLOCKED | Checkout does not restrict `payment_method_types`, so wallets appear when the Stripe Dashboard enables them. Enabling them, and Apple Pay domain verification, are Dashboard tasks against the live domain — not code, and not doable from here |
| Login / OTP | IMPLEMENTED, CI-TESTED | `auth-activation.test.ts`, `auth-unavailable.test.ts`, `safe-redirect.test.ts`. The Supabase Site URL and redirect allowlist are EXTERNAL-BLOCKED |
| Onboarding | IMPLEMENTED, CI-TESTED | `onboarding-model.test.ts`, `onboarding_security_test.sql` (14) |
| Settings | IMPLEMENTED, CI-TESTED | Editable business, place and Google link, with the destination validated server-side against the same allowlist as the database |
| Account deletion | IMPLEMENTED, CI-TESTED | In-app on web and native, one endpoint, owner only, Stripe cancelled first and nothing deleted if that fails. `account_deletion_test.sql` (18), `account-deletion-route.test.ts` (13), `account-deletion-parity.test.ts` (7). Not LIVE-VERIFIED — that needs a throwaway account on a real project |
| Mobile owner app | IMPLEMENTED, CI-TESTED | Live Feed, Feedback, Text Requests, Tags, Account, deletion. 79 cases. **EXTERNAL-BLOCKED**: never installed from TestFlight or Play, never run on a device |
| Support | IMPLEMENTED, CI-TESTED | `/support`, consistent with the FAQ on cancellation — they contradicted each other and no longer do |
| Legal | IMPLEMENTED, CI-TESTED | Privacy, Terms, Security, Delete your account. `copy-truthfulness.test.ts` holds them to what the code does |
| SEO | IMPLEMENTED, CI-TESTED | One route list feeding robots and the sitemap; `noindex` pages must declare it. `seo.test.ts` |
| Brand | IMPLEMENTED, CI-TESTED | The owner-approved R mark wired through header, footer, login, onboarding, dashboard, customer page, NFC screens, favicon, PWA, iOS and Android icons. `brand-assets.test.ts`, `color-contrast.test.ts`. A dark-background variant is EXTERNAL-BLOCKED on the owner |
| App Store prep | IMPLEMENTED | `docs/app-store/SUBMISSION.md`, corrected against the code. **EXTERNAL-BLOCKED**: demo account, screenshots, submission |
| Google Play prep | IMPLEMENTED | `docs/google-play/SUBMISSION.md`. **EXTERNAL-BLOCKED**: Play Console, feature graphic, screenshots, closed testing |
| Production / Preview config | **EXTERNAL-BLOCKED** | The proxy fix for the Preview 500 is IMPLEMENTED and CI-TESTED (`proxy-public-routes.test.ts`). The environment variables themselves — Supabase Preview URL and anon key, `PUBLIC_FRONTEND_URL`, and the Supabase Site URL and redirect allowlist — can only be set in the Vercel and Supabase dashboards |
| Final hosted visual QA | **EXTERNAL-BLOCKED** | Requires opening the deployed URL, which the egress policy refuses |

### The platform

| Layer | Status | Evidence |
|---|---|---|
| Security / tenancy | IMPLEMENTED, CI-TESTED | Cross-tenant isolation attacked from three directions; RLS on every tenant table; public writes fail closed; no secret carries a `NEXT_PUBLIC_` prefix. `cross_org_isolation_test.sql` (30), `security_hardening_test.sql` (85), `column_security_test.sql` (36) |
| SMS money ledger | IMPLEMENTED, CI-TESTED | Two sources, monthly first, no rollover, purchased survives cancellation |
| Workers / schedulers | IMPLEMENTED | Reconciliation, dead-letter release, health endpoint. Deployed cadence is once daily on Vercel Hobby; production cadence is in `docs/SCHEDULING.md` and needs Pro |
| Observability | IMPLEMENTED (partial) | Health endpoint over outbox age, unresolved sends, dead letters, unprocessed webhooks. No external alerting is wired |
| Backups / restore drill | **NOT DONE** | Needs a production database. Not started |

## Verification on the current head

Measured on `38829bb`, not carried forward from an earlier stage.

| Gate | Result |
|---|---|
| Migrations from empty | **59 applied** |
| pgTAP | **13 suites, 550 assertions**, with the real `pgtap` extension |
| Vitest (web) | **760 cases, 77 files** |
| Vitest (mobile) | **79 cases, 9 files** |
| Playwright | **36 passing** (40 defined; the 4 `@visual` snapshots need the baseline Chromium) |
| tsc / eslint / production build | clean, web and mobile |
| GitHub Actions | CI and Backend database green on `b425501` |

> Correction: the commit message on `7b7d3aa` says "all 41 migrations". There
> are 59. The verification happened — every migration applied from empty and
> the new pgTAP suite passed — but the count was written without being
> counted, which is the kind of unchecked specific this document exists to
> catch. The
> commit is on a branch under review and has not been rewritten to hide it.

> Second correction: `scripts/backend/local-postgres.sh` already existed and
> already did the Supabase bootstrap I hand-rolled a second copy of before
> finding it. The results agree, and the pgTAP shim I wrote was still needed
> because the extension was not installed — but the bootstrap was duplicated
> work that reading this file would have avoided.

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
12. `proxy.ts` built the Supabase auth client before deciding whether the path
    needed one, so every public page 500'd on a Preview with no Supabase
    credentials — with CI green, because no test ever ran the proxy without
    them. `/text-requests` and `/customer-page` were also missing from
    `OWNER_PREFIXES`: two of the four nav destinations were unprotected.
13. The App Store submission package pointed its privacy-policy, marketing and
    support URLs at `reviewboost.app`, a domain the business does not serve —
    six 404s in the field App Review opens. It also advertised "written
    feedback from customers", which V1 does not collect, and declared analytics
    that no SDK in this repository performs.
14. Account deletion was a `mailto:` on both web and native, which Apple
    5.1.1(v) rejects outright.
15. The Security page claimed "Customer notes ... are encrypted", naming a
    field the customer flow never fills. Written by me, two commits before it
    was caught.
16. Two strings told someone to do something the app cannot do — "Buy more" on
    mobile Text Requests, with no purchase surface and none permitted by
    3.1.3(b), and a "cancel your plan" instruction with nowhere to cancel.

## Open pull requests

Three, as of 2026-09-17. The list this section used to carry — 33 open, with
dispositions for each — described the repository at an earlier stage and had
become actively wrong: it filed **#67 under "Customer Page reference, the
landed version is built fresh"**, while the header of this same document names
#67 as the canonical PR. Replaced with what `list_pull_requests` actually
returns.

| PR | Branch | Disposition |
|---|---|---|
| [#67](https://github.com/blackadmen732-wq/reviewboost1/pull/67) | `cursor/sprint-forge-owner-systems-v15-7042` | **Canonical.** Everything in this document. Green, unmerged, and stays unmerged until the hosted product is visually correct |
| [#73](https://github.com/blackadmen732-wq/reviewboost1/pull/73) | `claude/sms-pricing-engine` | SMS pricing and routing engine. **Do not merge** — outside the frozen V1 scope |
| [#74](https://github.com/blackadmen732-wq/reviewboost1/pull/74) | `claude/customer-import-foundation` | Canonical customer model and import. **Do not merge** — CRM-shaped, and the frozen scope excludes it |

Everything else that was open has since been closed or merged upstream of this
branch. #71, the previous stage's canonical PR, is no longer open.

## Final matrix

| Gate | Status |
|---|---|
| IMPLEMENTED | **YES** — every area the brief named exists in code |
| CI-TESTED | **YES** — 760 web cases, 79 mobile cases, 550 pgTAP assertions, 36 Playwright cases, green in GitHub Actions |
| HOSTED-VERIFIED | **NO** — EXTERNAL-BLOCKED. `*.vercel.app` returns 403 CONNECT under this environment's egress policy |
| LIVE-VERIFIED | **NO** — EXTERNAL-BLOCKED. No Stripe keys, no Twilio account, no Supabase project |
| DEVICE-VERIFIED | **NO** — EXTERNAL-BLOCKED. No phone, no printed code, no NFC chip |
| TESTFLIGHT-VERIFIED | **NO** — EXTERNAL-BLOCKED. Never submitted |
| PLAY-VERIFIED | **NO** — EXTERNAL-BLOCKED. Never submitted |

**REVIEWBOOST V1: implemented and CI-tested throughout; verified nowhere that
a customer or a business would actually touch it.** Every NO above is one
external dependency away, and none of them is a code change.

There is no percentage here on purpose. A figure would have to average
"the SQL is proved correct by 550 assertions" against "nobody has ever tapped a
physical Tag", and the second fact is the one that decides whether this
launches.

## What would change each NO

| Gate | What it needs | From whom |
|---|---|---|
| HOSTED-VERIFIED | The Vercel Preview environment variables set — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `PUBLIC_FRONTEND_URL` — and the Supabase Site URL and redirect allowlist. Then open the Preview and walk the site | Owner, in the Vercel and Supabase dashboards |
| LIVE-VERIFIED (Stripe) | Live keys, a webhook endpoint, and one real subscribe → charge → cancel. Wallets also need Apple Pay domain verification | Owner, in the Stripe Dashboard |
| LIVE-VERIFIED (Twilio) | An account, a number, and one real send → delivery receipt → STOP → START | Owner |
| DEVICE-VERIFIED | A printed QR on a counter and a blank NTAG213/215, following `docs/testing/NFC_DEVICE_TEST_CHECKLIST.md` | Anyone with a phone and a chip |
| TESTFLIGHT-VERIFIED | The demo account and screenshots in `docs/app-store/SUBMISSION.md`, then `eas submit` | Owner, for the Apple account |
| PLAY-VERIFIED | The feature graphic and screenshots in `docs/google-play/SUBMISSION.md`, then the closed-testing period Play requires | Owner, for the Play account |

## Remaining blockers

1. **Vercel Preview and Supabase configuration.** This is the first one, because
   it is what stands between everything else and a HOSTED-VERIFIED row. The
   `/` 500 was a code defect and is fixed; the `/login` 500 is missing
   configuration and is not fixable from here. `docs/backend/ENVIRONMENT.md`
   is the complete list.
2. **Stripe credentials** — for a real card, charge, failed payment and
   recovery, and for enabling wallets.
3. **A Twilio account and a real phone.**
4. **A Supabase project** — for a real Customer Page upload, a real deletion,
   and the backup and restore drill, which has not been started.
5. **Physical Tags** — a printed QR and a programmed NFC chip.
6. **Two owner decisions**, both small and both blocking a visual: a business
   photo for the homepage Customer Page preview, and an approved
   dark-background variant of the logo.
7. **Review of #67.** It is green and unmerged, which is where the brief says
   it stays until the hosted product is visually correct.

## Next dependency

The Preview environment variables. Nothing after them is sequenced behind code:
every other blocker is an account, a credential or a piece of hardware, and
several can proceed in parallel once someone with access starts.
