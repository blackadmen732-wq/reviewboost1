# PR #67 launch-gap report

12 October 2026. Source baseline: PR67 `1036e2e1`, main `0155948c`, PR75 `10655e4a`, PR76 `1246a281`. This report includes the authorized repair working tree. It does not certify the deployed website or a TestFlight build. The user's latest execution order is audit → identify blockers → propose small fixes → approve the next workflow → implement → verify. Newly identified gaps below remain proposals.

## What exists and what was verified

“IMPLEMENTED AND VERIFIED” is scoped to the stated local automated/browser evidence. It never means a live provider or iPhone result.

| Requirement | Classification | Existing implementation and evidence | Remaining limit |
|---|---|---|---|
| Web email-code sign-in and setup | IMPLEMENTED AND VERIFIED | `features/auth/sign-in-flow.tsx`, `features/onboarding/onboarding-flow.tsx`; real local Auth/Mailpit code → business/Google/Tag → remembered Growth plan; recovery component tests | Hosted mail delivery and production auth configuration unverified |
| Native email-code login and reviewer fallback | IMPLEMENTED BUT UNVERIFIED | `apps/mobile/app/login.tsx`, `data/review-sign-in.ts`, server `review-sign-in.ts`; unit checks pass; PR75's reviewer-attempt limiter reconciled | No iPhone/TestFlight sign-in; reviewer credentials/configuration not activated |
| Home, Feedback and Insights | IMPLEMENTED AND VERIFIED | Existing server models, real rating summaries and guarded charts; unit/component tests; empty local screens inspected | Populated Feedback detail was not reached in the local empty fixture; no production data used |
| Text Requests consent and credit gates | IMPLEMENTED AND VERIFIED | PR76 Phase 0 approved templates, exact preview, separate consent endpoint/evidence; service/component/pgTAP tests; local preview + explicit attestation, zero-credit send disabled | No live SMS, carrier delivery or production credits exercised |
| Tags / rotation / preview | IMPLEMENTED AND VERIFIED | Shared `tag-readiness.ts`, Tag detail recovery, prefetched native preview link; local browser and tests | Physical NFC write/readback and printed QR checks external |
| Shared customer rating flow | IMPLEMENTED AND VERIFIED | `CustomerVisitView`, `customer-flow.tsx`; all 1–5 scores, keyboard, 320px, offline/retry, handoff and reduced-motion browser tests | Google handoff intercepted in tests; no posted-review completion claim |
| Photo upload/publish and recovery | PARTIAL | Existing signed upload/confirmation, save-before-publish, shared live preview; real local Storage publish checked; failed load/save tests | Draft refresh/removal and uncertain-publish gaps below |
| Backend subscription/credits/statistics authority | IMPLEMENTED AND VERIFIED | Existing billing service, catalog, entitlement/ledger RPCs, SMS segmentation and response summaries; web/mobile models plus pgTAP/unit tests | No complete same-snapshot web+iPhone comparison or live Stripe round trip |
| Owner business deletion | PARTIAL | Existing web/native screens and API; PR75 confirmation-before-cancellation, public billing RPC and terminal webhook fixes ported; unit + pgTAP pass | No live paid deletion; personal/non-owner path absent; ambiguous network outcomes below |
| App Store metadata/privacy/icon/NFC strings | PARTIAL | Existing `apps/mobile/app.json`, release configuration, `docs/mobile/APPLE_APP_STORE_AUDIT.md`, `APP_STORE_METADATA.md` | Stale notes copy; actual archive/privacy report, entitlements and Connect metadata unverified |
| Personal account deletion for non-owner/no-business user | MISSING | Existing endpoint requires organization context and owner role; native screen refers members to an owner | Submission blocker identified in existing audit, still unresolved |
| Native resilience, billing providers and store submission | EXTERNAL BLOCKER | Existing code/tests do not establish device/provider behavior | EXTERNAL VERIFICATION REQUIRED: iPhone, TestFlight/Xcode, Stripe sandbox, SMS provider, hosted backend and App Store Connect |

## Blocking or high-priority findings and smallest next fixes

### L1 — Business deletion is not personal account deletion

- **Files:** `frontend/app/api/v1/account/deletion/route.ts:84`, `apps/mobile/app/delete-account.tsx:87`, `apps/mobile/app/select-org.tsx`, `docs/mobile/APPLE_APP_STORE_AUDIT.md` §6; `response_notes.author_id` currently restricts Auth-user deletion.
- **Existing tests:** owner confirmation, role rejection, billing failures, last-membership behavior and database privileges are tested. A working non-owner/no-org deletion journey is absent.
- **Impact/reproduction:** sign in as a team member or an account without a business; the owner-only endpoint rejects the action and the native UI provides no self-service personal deletion. Removing access through another owner is not the same as deleting the person's account.
- **Proposed minimal change:** retain the existing business-deletion operation; add a separate session-bound personal-account deletion path with an explicit policy for internal note attribution, memberships and sole-owned businesses. Proposed policy: preserve business notes as “Former team member” and prevent accidental deletion of a business owned by someone else. This needs a reviewed migration/API contract, not a visual-only change.
- **Regression:** member/no-org/sole-owner/multiple-business cases; retained business data and anonymized attribution; wrong-session/RLS denial; partial auth-removal failure recovery.
- **Launch gate:** blocks a claim of complete in-app account deletion and App Store readiness. The existing audit cites Apple 5.1.1(v); current official policy could not be independently fetched here.

### L2 — A confirmed upload is not yet a saved draft; deliberate removal cannot be represented in the editor

- **Files:** `frontend/features/customer-page/customer-page-editor.tsx:92,216,250`, `frontend/lib/server/customer-page-service.ts:39,131`, `frontend/lib/images/normalize-photo.ts:60`, `frontend/styles/customer-page.css`.
- **Existing tests:** failed initial read, preserved draft fields, failed save blocking publish, upload/publish lifecycle and shared rendering. No refresh-after-upload/removal test establishes the latest brief's guarantees.
- **Impact/reproduction:** upload successfully, leave before Publish, reopen: only the old server draft returns. There is no Remove photo control. A server draft with `heroAssetId: null` can still show the previous published image because of `draftHeroUrl ?? published.heroUrl`. Large transparent images converted to JPEG receive `#1A1A1A` fill; transparent pixels can appear dark.
- **Proposed minimal change:** save the confirmed asset through the existing draft PUT before announcing a saved draft; add explicit Remove photo using nullable `heroAssetId`; distinguish absent legacy data from intentional null; serialize/version upload results; use white transparency normalization. Keep publishing a separate explicit action, with the same renderer and deterministic crop. Review the requested lower-panel pure white separately from its current `#F9F9F9`.
- **Regression:** upload → refresh restores; remove → refresh remains white; old published image never masks an explicit null; failed draft save retains retryable intent; rapid replace/unmount; transparent/EXIF/large/HEIC failures; no-photo preview/live parity.
- **Launch gate:** high priority before promising a reliable editor; not by itself proof of an App Store rule violation.

### L3 — Uncertain writes need reconciliation, not a generic retry or a claim that nothing happened

- **Files:** editor publish at `customer-page-editor.tsx:250`; native deletion `apps/mobile/app/delete-account.tsx:48`; web `frontend/features/settings/delete-account-flow.tsx`; shared API clients.
- **Existing tests:** ordinary rejected/thrown requests and busy-state recovery; server SMS idempotency and ledger constraints. No end-to-end test proves a committed publish/deletion followed by a lost response is reconciled.
- **Impact/reproduction:** let the server commit, drop the response, then observe the client error. The editor cannot distinguish live-new-content from an uncommitted publish. Native deletion can say “nothing has been deleted” after a lost response. Its success path also ignores `signInRemoved` and always logs out, even when another membership remains; a thrown logout occurs outside its recovery block.
- **Proposed minimal change:** read authoritative published version/content before offering republish after ambiguity. For deletion, reconcile session/memberships and distinguish business deletion from login deletion; do not promise rollback across Stripe/Auth/database. Preserve idempotency for Text Requests and never blindly replay financial or message writes.
- **Regression:** committed-but-response-lost publish; deleted business with surviving membership; Auth removal failure; logout rejection; interrupted Stripe cancellation and repeat request using authoritative state.
- **Launch gate:** high priority for production recovery and truthful destructive-action feedback.

### L4 — Shared network clients and native session restoration have no bounded recovery

- **Files:** `frontend/lib/api/owner-fetch.ts`, `apps/mobile/data/api.ts`, `apps/mobile/data/auth-context.tsx:48,76`.
- **Existing tests:** API error decoding, expired-session behavior, auth generation guards and screen-level rejected-request recovery. Native login already has try/catch/finally; it is not missing wholesale.
- **Impact/reproduction:** hold a request indefinitely instead of rejecting it; loading can remain pending. Reject native `getSession()` or throw during organization lookup; those effects do not have a complete catch/finally recovery path.
- **Proposed minimal change:** explicit cancellable request deadlines and readable retry for reads; catch restoration failures and expose recovery; retain generation guards. A write timeout is an uncertain outcome and must use L3 reconciliation rather than automatic retry.
- **Regression:** never-resolving read, aborted/unmounted screen, rejected session restoration, stale organization result after sign-out, slow success, write timeout without duplicate send/charge.
- **Launch gate:** native reliability release criterion, especially offline cold start; physical-device lifecycle remains external even after unit tests.

### L5 — Store metadata still promises customer notes that the approved flow does not collect

- **Files:** `docs/mobile/APP_STORE_METADATA.md:39,57,101,194,216`; `docs/mobile/APPLE_APP_STORE_AUDIT.md`; `frontend/tests/unit/store-docs-truthfulness.test.ts` currently checks other submission documents and omits this metadata file.
- **Existing tests:** other listing copy/trial truthfulness tests pass. This mismatch is not covered.
- **Impact/reproduction:** compare metadata's “customer's note” and reviewer instructions to the current star-only public flow. Internal owner notes and historical data do exist; that does not make new public notes an available feature.
- **Proposed minimal change:** remove new-customer-note promises and impossible reviewer setup steps, preserve accurate internal-note/history statements, include metadata in scope-aware truthfulness checks, then verify age rating/privacy statements against the actual archive and current official guidance.
- **Regression:** listing/reviewer copy matches current customer and native capabilities; no reintroduced public note step or fabricated reviewer entitlements.
- **Launch gate:** correct before App Store submission. Do not use documentation as permission to create fake subscription states.

## PR reconciliation completed in this repair

- PR76 Phase 0 `ef9f011`: approved templates; separate evidence-backed consent; strict schemas reject legacy consent/free-form payloads; eligibility checked before credit reservation; migration revokes evidence-free owner-import opt-ins. Connections and retention work were not imported.
- PR75 `c63e33b`, `21184f2`, `aa4a5b3`: verify deletion confirmation before touching Stripe, use public guarded billing RPC, handle late terminal events after deletion, and prevent unrelated email typos from exhausting reviewer-specific attempts. Corresponding unit/pgTAP tests pass.
- PR75 customer renderer/phone hardware reused. White empty hero and gray bolt preserved, including white under rounded empty-hero edges. No additional customer step.
- Migrations are committed for review and tested locally only. Production application/order/backfill review remains a release task; no production migrations ran.

## External launch checklist

- [ ] Fetch current [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) and review 5.1.1(v), 4.8 and the applicable 3.1 payment/companion provisions for the actual business model. Existing email OTP does not by itself justify adding social sign-in. Current network attempts returned proxy 403.
- [ ] Configure reviewer access securely, verify enabled/disabled/rate-limited behavior on a real build and supply valid App Store Connect review details. No production bypass or secrets were created.
- [ ] Verify production backend readiness, migration manifest, signing/public origins, support/privacy links, monitoring and actual mail delivery. A September audit's production observations are not evidence of October production state.
- [ ] Stripe test-mode checkout/portal/webhook retries and deletion cancellation; compare web/native values against the same authoritative entitlement/ledger snapshot.
- [ ] Provider sandbox SMS: consent eligibility, suppression/STOP, credits/segments, duplicate prevention, provider timeout and delivery status. Do not activate live messaging for this verification.
- [ ] iPhone/TestFlight: cold/warm/offline launch, background/foreground, termination mid-request, expired auth, slow API, NFC unsupported/permission/write/readback/retry, photo failure, account deletion recovery.
- [ ] Inspect signed archive: NFC entitlement/purpose string, privacy manifest/report, icons, age-rating answers, screenshots, EAS/Apple signing and reviewer reachability. Unit tests and Chromium do not prove these results.

Full local test totals and screenshots are recorded in [repair review](FRONTEND_REPAIR_REVIEW.md). The next recommended implementation pass is **L2 editor draft recovery**, followed by bounded reads/uncertain writes and the reviewed personal-deletion contract. The separate [header/hero proposal](PR67_VISUAL_SYSTEM_AUDIT.md) remains awaiting the user's requested visual review.
