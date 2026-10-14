# Owner app walkthrough and improvement plan — 14 October 2026

Baseline: PR67 `038f6b6`, main `0155948`; separate Connections branch `a61e97f`. Working only in PR67, preserving contracts and current navigation. User authorized the complete app walkthrough and necessary repairs. Fresh local browser evidence, not reused screenshots or a hosted-production certification.

## Page inventory and journey

There are **30 Next.js page components / route patterns** on this branch: 27 maintained pages and three legacy redirects (`/reviews`, `/customers`, `/praise`). Dynamic Tag/customer/Feedback paths count once; settings subsections count separately. This is the web count, not the number of native screens. No separate profile page exists: identity, appearance and account controls are in Settings.

Visitor: homepage → Product / How / Pricing → selected-plan sign-in → emailed code → business name → Google review link (or defer) → first Tag → billing choice. Checkout and trial activation remain Stripe-authoritative.

Owner: Home → Feedback inbox/detail/Insights, Text Requests, Tags/detail/QR/NFC. Settings → business and place details, Customer Page, billing, appearance, identity, help and deletion. Customer: Tag → shared rating page → selected rating saved → same Google destination for every score.

## Already good; preserve

Four daily tabs, secondary Settings, readable Geist typography, meaningful empty states, guarded real-data Insights, separate server consent and credit gates, equal Google opportunity, shared live/preview renderer, existing upload/NFC/backend infrastructure. The 30 fresh mobile/desktop baseline captures had no detected horizontal overflow or mobile axe violations. Existing-user setup/business selection correctly redirect to Home; fresh-user setup was separately exercised with a real local emailed code and preserved Growth choice. No checkout submitted.

## Route-by-route plan before implementation

| Route / family | Observed issue / decision | Exact files and smallest change |
|---|---|---|
| Login / onboarding / org selection | Fresh activation works; expired-session redirects discard selected-plan query; org-selection rejection has no complete recovery | `frontend/proxy.ts`; `features/auth/org-picker.tsx`: preserve internal route query and report selection failure |
| Shared owner chrome / Home | Preserve hierarchy; desktop active destination is easy to miss; completed setup text is struck out | `styles/globals.css`, `features/dashboard/{owner-shell,desktop-sidebar,bottom-nav,owner-home}.tsx`: forest action tokens, quiet active marker, skip link, readable completion labels; no new navigation |
| Feedback / detail / Insights | Detail lacks a page heading; rating-only copy implies a missing writing option; a thrown note request leaves Saving stuck (reproduced); empty Insights has no setup path | `app/(owner)/feedback/[responseId]/page.tsx`, `features/dashboard/{action-thread,resolve-button,mark-read-button}.tsx`, `insights/insights-view.tsx`: truthful rating-only copy, task heading, bounded state recovery and useful empty-state link |
| Text Requests | Server balance is zero but the next useful step is buried below the form | `features/dashboard/text-request-composer.tsx`: existing Billing destination beside zero balance; retain preview, templates, consent and send gates |
| Tags / detail / NFC | Mobile PageHeader squeezes description into half-width; QR card/actions are oversized on desktop; NFC focus/Escape fail (reproduced); thrown create request can stick | `components/ui/page-header.tsx`, `features/dashboard/add-stand-button.tsx`, `features/tags/{tag-detail,nfc-sheet-view}.tsx`: responsive header/action, constrain detail width, existing Radix modal semantics, truthful create recovery |
| Customer Page | Upload → refresh reverts to old image (reproduced), no Remove photo; explicit null may show published image; uncertain publish cannot be distinguished | `features/customer-page/customer-page-editor.tsx`, `lib/images/normalize-photo.ts`, existing editor tests: auto-save confirmed photo through current draft PUT, remove via nullable field, distinguish null, retry saved-draft intent and reconcile ambiguous publish with GET. White transparency fill. Shared customer renderer and fixed panel stay untouched |
| Settings / profile | Repetitive uppercase sections and unclear account grouping; several Change controls have identical names; business switch not exposed here | `app/(owner)/settings/page.tsx`, `features/dashboard/settings-form.tsx`: sentence-case group headings, explicit business deletion label, labelled edit controls, existing business-picker link only when real memberships warrant it |
| Billing | Real stored subscription/limits and handoff already exist | Preserve runtime/financial behavior; verify portal error recovery and selected-plan behavior without live Stripe |
| Deletion / sign-out | Connection errors claim nothing was deleted; auth retrieval/sign-out exceptions can leave busy state | `features/settings/delete-account-flow.tsx`, `features/dashboard/sign-out-button.tsx`: complete try/finally and truthful uncertain-outcome text; retain typed-name confirmation and server contract. Personal/no-org deletion remains a separately reviewed contract gap |
| Offline / errors / redirects | Offline promises every change saved and gives no return action | `app/offline/page.tsx`: distinguish saved data from pending changes and link back to Home; retain existing boundaries and redirects |
| Public site / live customer | Accepted visual language and approved rating composition | Fresh route checks; preserve composition and save → Google handoff |
| Native iOS app | Existing screens and calculations share server APIs; hardware/lifecycle cannot be established in Chromium | Inspect code, run mobile checks; report physical-device and live-provider limits without claiming native visual verification |

## Research limits

The supplied Veyra/Midday images remain the visual authority for public pages; the owner app uses the existing calm product system. Read Impeccable Operate guidance: familiar controls, restrained accent, consistent state vocabulary and task-first typography. Attempts to fetch Pinterest, Midday, GOV.UK validation, W3C status messages and Nielsen Norman system-status guidance returned proxy 403; no new live-research claim is made. Product Design context preflight found no saved context. The package's linked critical-overrides resource was unavailable; its accessible router/audit/framework were read. Capture tool: local Playwright/Chromium; screenshots show isolated local fixtures.

## Verification plan

Meaningful regressions for draft persistence/removal, explicit-null preview, committed-but-response-lost publish, failed notes/create/sign-out, modal keyboard focus/Escape and plan-preserving session redirects. Fresh browser walkthrough at 320/390/768/1280, relevant themes/reduced motion, real local upload/publish, owner mutations and ordinary failure states. Bounded visual inspection plus one confirmation after corrections; run TypeScript/lint/relevant suites, mobile checks, production build and fixture exclusion. Capture each important step or name its blocker. No production migrations, provider sends, merge, deployment or new PR.

## Additional verified connection during implementation

Feedback's MarkReadButton and `/read` API already existed, but no page imported the control and `getReview` does not mark a response read. The unread badge could keep growing even after viewing detail. Reconnect the existing explicit read action in Feedback detail, preserving its distinction from Sorted and the database's tenant checks. Native recovery work uses the existing API: bounded reads, caught restoration/business lookup failures with retry, and correct handling of the existing `signInRemoved` field. No new backend contracts or migrations.

## Completed pass and evidence

Retained the existing Geist owner UI, daily navigation, real-data Insights, billing/consent gates, shared rating renderer and public editorial direction. Improved forest action colors on owner light/native, active navigation, responsive page headings, Feedback read/sort clarity, Settings identity/account grouping and actual business switching. Fixed verified failure paths: photo drafts now persist and support removal; uncertain publishing and appended notes reconcile server state; loading states recover; NFC focus is trapped and Escape dismisses; expired sign-in preserves chosen-plan query. Read deadlines are 20 seconds and write deadlines 30 seconds; no automatic replay. Timeouts bound the shared web request through response headers, not every arbitrary caller's subsequent body decoding.

Two-membership testing found an additional QR failure: SVG requests intentionally omit cookies and therefore lacked business selection. The hook now passes the server-verified `X-Organization-Id` with Bearer authorization, retaining `credentials: omit` and existing backend tenant checks. Actual local creation, SVG download, print invocation (stub), customer popup, rotation warning/cancel, unsupported NFC recovery and two-way business switching passed. Feedback's existing unread action is connected; Read and Sorted remain separate.

[Before/after and route gallery](owner-app/review.html) · [Figma import board](owner-app/reviewboost-figma-board.svg) · [Import notes](owner-app/README.md). Direct Figma tools were unavailable; no Figma file was edited and import compatibility was not verified. The board contains actual browser screenshots with vector flow/captions/swatches. It is not a second frontend or invented mock dashboard.

75 capture checks: owner families at 320/390/768/1280px, plus dark 390px; public/customer screens at 390px in this pass. No detected horizontal overflow or page exceptions. 39 axe scans found no violations, with two additional successful QR scans after final scoping. NFC keyboard focus/trap/Escape was separately exercised. Selected key screenshots were visually inspected; this is not a claim of exhaustive screen-reader or native-device coverage. Full-page PNGs retain fixed bars at the original viewport position. The gallery includes baseline activation captures, explicitly labelled as preceding the forest-token change.

Fixtures changed deliberately during testing: baseline had one membership and empty ratings; final has two real local memberships, ten local rating responses and a second Tag. These are real local server/API values, never injected UI metrics. Local stored subscription records exercise rendering only; no claim of verified live Stripe activation. The recorded lost-response publish and note checks made one POST each and then read server state. No live messages, checkout, code rotation or account deletion was activated.

Validation: frontend full suite 1,110 tests / 107 files passed, plus three subsequently added runtime QR tests / one file passed (1,113 distinct tests). Web TypeScript and zero-warning lint passed. Native TypeScript and 109 tests / 14 files passed. Production Webpack build passed; production client fixture-exclusion check passed. Production-build browser preview uses local development-tier services and a configured HTTPS canonical origin; it does not prove hosted deployment. The existing HTTPS-origin guard first rejected a local HTTP canonical QR origin, then the preview was configured correctly without changing that guard.

Final upstream check: PR67 stayed at `038f6b6`; main stayed `0155948`. The separate Connections branch advanced to `45d311d` by merging PR67's existing public-page commit; inspected its delta, no additional product import needed. Its existing Square/Customers work remains outside this frontend scope.

## Remaining launch and external checks

- Personal account deletion for users without an organization and non-owner paths still needs a reviewed backend contract; business deletion already exists and its `signInRemoved` response is respected on web/native.
- Real iPhone startup/background/offline/NFC programming, TestFlight, reviewer access and Apple submission are unverified. Chromium and unit tests are not hardware evidence.
- Hosted configuration, Stripe checkout/webhooks/live entitlements, consented SMS delivery and production service recovery need external verification. No financial or consent grants were fabricated to bypass those checks.
- Pinterest/live competitor research was blocked by proxy responses. Design choices use supplied references and tested owner tasks, not claimed competitor benchmarking.
- No production migrations, live messaging, merge or deployment. No new branch or PR.

Honest assessment: this is a materially more coherent and recoverable owner app, especially around saved drafts, ambiguous writes and business context. It is still a launch candidate requiring the external checks above. A percentage or paid-customer satisfaction score would be invented without user testing.
