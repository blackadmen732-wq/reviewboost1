# Integration baseline evidence

## Scope and revision

W0 implementation handoff on `devin/1789230975-integration-baseline`, based on
`origin/main` `6b8adc54f2d8d98e970b4037afb9ed1eff6ed0b8`.
This is preparation for the domain engineers and central pilot PR. It does not
close F01–F40 or approve deployment.

The exact PR/base/head inventory, migration blob ledger, dependency conflicts,
local/remote matrix, reserved migration ranges and API handoff are in
`INTEGRATION_MANIFEST.md`. No PR was opened and no upstream PR was merged,
closed or rewritten.

## Implemented

- Composed #66's customer response/session controller with #67's
  `CustomerVisitView` and `VisitStars`, used by both the authenticated editor
  and live customer journey.
- Kept direct rating submission, equal Google opportunity for ratings 1–5,
  single-flight protection and retry keys. Removed the old visible
  note → Continue → Praise sequence from the guest route.
- Retained historical response-note, praise, session, Google-click and printed
  token API/data compatibility. Google handoff attempts do not mean a review
  was posted.
- Selected owner navigation, home, Tags, editor, catalog and entitlement
  foundation without importing the competing `customer_page_profiles` model.
  The single selected migration is #67's unchanged
  `20260909000900_customer_page_and_entitlements.sql`.
- Preserved main's 43 migration files, setup scripts, proxy, CI, secret hook,
  dependencies, mobile app, shared STATUS/TESTING and security controls.
- Excluded #67's Stripe acknowledgement stub. This baseline has no Stripe
  webhook endpoint; billing must supply real verified processing.
- Added six integration regressions in
  `frontend/tests/component/customer-integration-contract.test.tsx`: for each
  rating, a pending response receipt retains the shared card, disables the
  stars and exposes no Google link/tracking; a successful receipt exposes the
  same destination and retains artwork. The sixth case checks preview/live
  crop parity and that owner preview makes no customer API call.

Source recovery was deliberate: the pre-existing branch
`devin/1789189752-integration-baseline` at
`444bd4fb5dfcffb6087efa1d57aaa7d50edb6f19` already contained a selected #66/#67
composition. It was compared with main and the named upstream heads, replayed
as source changes onto a fresh main-based branch, then adjusted as documented
above. Its previous validation claims were not reused.

## Automated results in this session

| Check | Result / boundary |
|---|---|
| Node / install | Node 22.22.2; `npm ci` passed |
| OpenAPI generation | `npm run api:generate` passed; generated client regenerated rather than hand-edited |
| Typecheck | Passed after replacing a test-only `Promise.withResolvers` call unsupported by the configured TypeScript library |
| ESLint | `npm run lint` passed with zero warnings |
| Vitest | 50 files, 499 tests passed, including six new integration cases; mocked APIs/components, not a live browser/backend journey |
| Next production build | Passed on final source, including exclusion of the Stripe stub |
| Production fixtures check | Passed on final build; no development fixture markers |
| Local setup generator tests | 17/17 passed |
| Local environment | `scripts/dev/setup-local-env.sh` succeeded; ignored frontend environment verified mode 600 |
| Supabase start | CLI 2.117.0; existing healthy Docker 27.4.1 reused |
| Local reset | Passed with seed; 44 migrations, min `20260808000100`, max `20260909000900` verified by SQL |
| pgTAP | 7 files, 326 assertions passed on the local reset |
| Canonical model | SQL confirms `public.customer_page_settings` and `app.customer_page_artwork`; `public.customer_page_profiles` absent |
| Migration integrity | Selected SQL blob `ba704e6ae0d86f94295359f3ebdada5df062a486` matches #67; main migrations unchanged |
| Whitespace | `git diff --check` and cached equivalent passed |
| Inventory integrity | All 31 PR base/head rows and migration blob rows checked against fetched data/local files |
| Secret hook / git handoff | Final commit runs the existing hook without bypass; exact pushed SHA reported with delivery |

The first local-env invocation mistakenly used a nonexistent `.mjs` path; the
repository's actual `.sh` generator was then read and run successfully. No setup
code change was needed. The existing Devin blueprint already describes the
verified Node, hook, Supabase and local-env setup; no update was necessary.
Supabase image pulls encountered ECR data-limit
responses; the pinned CLI recovered through GHCR and database tests passed.

`npm audit` reports eight advisories against the unchanged main lockfile:
two moderate, five high and one critical. Affected packages are
`@eslint/eslintrc`, `@redocly/openapi-core`, `@vitest/mocker`, `fast-uri`,
`js-yaml`, `next`, `sharp` and `vitest`. Security/pilot owns remediation and
dependency-age verification; a compiling baseline does not clear this release
concern.

## Test contract changes

The user explicitly replaced the guest note/Continue/Praise journey. Adapted
customer flow, star, accessibility and Playwright source expectations describe
that new journey, retain all-rating parity, single-flight, retry/offline and
heading-focus coverage, and preserve historical praise/API tests. No old
expectation was loosened merely to get a pass.

Inherited owner tests still lock the old fixed 390/844 canvas, absence of
location identity and historical product-design prose. Those assertions record
the imported baseline, not the acceptance target for F03–F05/F14. Pilot should
replace contradicted assertions with actual responsive layout, identity and
scope tests when implementing the user's new specification. Do not restore old
behavior solely to satisfy those tests.

## Remaining findings and owners

Every finding remains assigned; this baseline is not full release closure.

| Finding | Baseline / required follow-up | Owner |
|---|---|---|
| F01 | Integrated source and complete PR/migration manifest delivered; final domain integration/release evidence remains | Pilot |
| F02 | One settings model selected; signed/private asset intake, validation and cleanup remain | Pilot |
| F03 | Shared renderer retained; responsive sizing, scrolling and text scaling remain | Pilot |
| F04 | Light/dark cascade and measured rendered contrast remain | Pilot |
| F05 | No-photo fallback and visible verified business identity remain | Pilot |
| F06 | Direct submission and delayed-receipt/all-rating regressions integrated; explicit keyboard activation, same-tab handoff, response-loss and browser acceptance remain | Pilot |
| F07 | Accurate private-rating/visit/handoff terminology and historical praise isolation remain | Owner |
| F08 | Critical: owner RPCs still choose oldest membership; selected org/location must reach authorized RPC | Pilot |
| F09 | Local preview can outlive failed upload; durable asset states and publish guard remain | Pilot |
| F10 | Reopened draft image lacks Bearer auth; authorized byte fetch or expiring URLs remain | Pilot |
| F11 | Atomic publication, expected draft revision, receipt/conflict states remain | Pilot |
| F12 | Actual byte decoding, metadata stripping, ingress/pixel limits remain | Pilot |
| F13 | Validated immutable delivery, private drafts and deletion/cache evidence remain | Pilot |
| F14 | Selected-location behavior and business-wide aggregate scopes remain | Owner, coordinated with pilot |
| F15 | NFC read-back acceptance remains | NFC |
| F16 | NFC overwrite confirmation remains | NFC |
| F17 | Native write-result type must require verified success | NFC |
| F18 | Generation-bound server receipt/permission validation remains | NFC |
| F19 | Physical QR/NFC and supported-device evidence remains | NFC |
| F20 | Home must distinguish unread ratings from messages | Owner |
| F21 | Historical pagination and aggregate scale evidence remain | Owner |
| F22 | Membership/account lifecycle and support remain | Owner |
| F23 | Fake-acknowledgement stub excluded; verified Stripe processing/durable replay remains | Billing |
| F24 | Missing entitlement still defaults active Starter; explicit unpaid state remains | Billing |
| F25 | Atomic limits/catalog authorization remains; software catalog has zero included SMS | Billing |
| F26 | Checkout, portal and payment recovery remain | Billing |
| F27 | Actual provider-derived SMS prices/quotes remain | SMS |
| F28 | Separate prepaid pack purchase/accounting remains | SMS, coordinated with billing |
| F29 | No daily scheduler imported; frequent due-job dispatch and monitoring remain | SMS |
| F30 | Recipient timezone policy and fail-closed invalid/unknown handling remain | SMS |
| F31 | Candidate dependency/collision map delivered; canonical forward fixes and concurrency tests remain | SMS |
| F32 | Consented owner workflow, provider provisioning and carrier evidence remain | SMS |
| F33 | Main NFC anon revocation preserved; final column/default function privilege pass remains | Security |
| F34 | Main limiter unchanged; fail-closed public writes remain | Security |
| F35 | HTML/binary headers and deployed policy evidence remain | Security |
| F36 | Routed monitoring, restoration/load evidence and incident ownership remain | Security |
| F37 | Local baseline checks are explicit; browser CI and final release claims remain | Pilot |
| F38 | Mobile untouched; nonproduction EAS destinations remain | Mobile/release with NFC and pilot |
| F39 | Native builds/store release evidence remains | Mobile/release with NFC and pilot |
| F40 | Mobile payment/privacy/account deletion/secure session lifecycle remains | Mobile/release with owner and billing |

## External blocked / not tested

Remote development, staging and production migration ledgers are unknown and
were not accessed. No remote migration was applied. Actual deployment/provider
credentials and destinations, physical Tags/devices, and store accounts were
not used. They remain external prerequisites for later release gates.

No real SMS, payment, store submission or production operation was attempted.
No actual browser, Safari, accessibility technology, physical QR/NFC or native
build run was performed. The Playwright files are adapted source only; no
Playwright result is claimed. New owner RPC authorization/asset publication,
populated historical upgrade, load and restore drills are not certified by
the inherited 326 database assertions.

## Pilot handoff

Branch from the pushed baseline. Do not merge #66 or #67 again. Follow the
manifest's exact API collision notes before changing shared customer/editor
types. Keep legacy printed tokens and historical encrypted data intact.
Write forward migrations only: pilot `2026091201xxxx`, owner
`2026091202xxxx`, NFC `2026091203xxxx`, billing `2026091204xxxx`, SMS
`2026091205xxxx`, security `2026091206xxxx`. Apply final privilege hardening
after all domains have introduced their functions and columns.

The pilot owns the common manifest and central PR; each domain writes its own
evidence. Confirm both fresh reset and populated upgrade after combining
domains. Software prices stay $49/$79/$129 with zero included SMS; prepaid SMS
remains a separate accounting/product boundary.
