# PR #67 frontend repair: results and review evidence

Later pass, 13 October: [the homepage header/hero direction](HOMEPAGE_DIRECTION.md) now implements the scoped cream/forest treatment. This report retains the 12 October repair evidence and test totals; the new pass has its own screenshots and validation.

Reviewed 12 October 2026 against PR67 `1036e2e1d4500629d604527673e5636cca7eff51`, on its existing branch `cursor/sprint-forge-owner-systems-v15-7042`. This report covers local implementation and tests, not deployed behavior. The user's latest visual direction is documented separately and has not been applied globally.

## Audience, architecture and page count

ReviewBoost serves local business operators: restaurants, barbers, salons and similar businesses. A Tag connects an after-visit customer rating to private owner Feedback, then gives **every** rating the same Google opportunity. An intermediate ReviewBoost URL lets an owner change the destination without replacing the Tag. A Google handoff is not evidence a review was posted.

There are **30 web route patterns: 27 rendered pages and 3 compatibility redirects**. Dynamic identifiers count once. The 27 comprise 12 public/system pages, 3 auth/setup pages, 11 owner pages and 1 customer page. There are now 38 API route-handler files, plus 11 Expo screen files and 2 native layouts. These are not extra web pages.

[Route-by-route plan and journey](PR67_ROUTE_PLAN.md) · [Architecture and working rules](../../AGENTS.md) · [Existing design system](../../DESIGN.md)

## What was already built and retained

Email-code login, organization setup, four daily owner destinations, server-backed Home/Feedback/Insights, rating charts, Tags/QR/NFC lifecycle, a shared live/editor customer renderer, signed photo uploads, Stripe entitlements and credits, SMS outbox/delivery machinery, account-deletion and App Review access code, native Expo screens, error boundaries and extensive tests. Main is an ancestor of this PR; its contracts were preserved alongside compatible PR67 additions. No separate frontend or Connections platform was created.

## What changed

| Area | Repair and practical result |
|---|---|
| Public homepage/product | Actual Tag and shared customer-page examples, clearly labeled sample businesses, an interactive local-only star example and clearer owner/customer explanation. No fabricated adoption, revenue or testimonials. |
| Signup and billing continuation | Validated plan choice survives pricing → email/code → onboarding → billing. Actual catalog/trial terms and explicit checkout remain authoritative. |
| Mobile owner navigation | Settings is reachable while keeping Home, Feedback, Texts and Tags as the four daily tabs. |
| Customer Page editor | Failed initial read blocks editing and offers retry; draft fields survive edits; save must succeed before publish; busy/success states are truthful; native preview links avoid async popup blocking. Controls sit beside the phone on desktop and Publish remains reachable above mobile tabs. Remaining draft/removal gaps are explicitly recorded below. |
| Customer composition | Reused PR75's renderer, rendered phone hardware and gray lightning footer. No photo gives a white hero in both themes, including rounded-panel edges. All five ratings retain the same direct save/handoff. |
| Tag recovery | Rotation with a null/older programmed date now requires rewrite/reprint; Home and Tag detail share readiness logic. Uncertain rotation refreshes server state. |
| Text Requests | Reconciled PR76 Phase 0: two approved templates, exact server preview, separate genuine-consent attestation, eligibility before reservation, strict rejection of legacy automatic-consent payloads. Zero-credit guidance uses actual Billing. Queue/delivery status stays distinct. |
| PR75 launch fixes | Confirmation is validated before Stripe cancellation; billing references use the guarded public RPC; late terminal subscription events after deletion are handled; unrelated emails cannot exhaust reviewer-specific attempts. Tests were carried over. |
| Recovery/accessibility | Login/settings release busy states on rejected requests; inputs survive errors; contrast uses readable semantic green; page-entry animation no longer traps fixed mobile controls. |
| Proven cleanup | Retired the obsolete free-form SMS helper/test after removing callers. Legacy Customers/Praise routes redirect to Feedback while underlying data/history remain. No speculative dependency purge. |
| Environment/docs | Local OTP template permissions and loopback-only Storage handling repaired; root AGENTS/DESIGN added below 32 KiB; requested design references installed and pinned, without becoming app dependencies. |

PR76's Connections work and PR77 retention proposal were excluded. No real SMS, payment, account deletion or production migration was performed. SQL changes are included for review and tested against a disposable local database.

## Before and after

[Open the current comparison gallery](frontend-repair/current-gallery.html). It has 16 images covering desktop before/after, mobile/tablet, consent states, Tags, Settings, billing, and photo/no-photo customer views. Click images for original size. Local business data is a test fixture. These screenshots show the **verified repair**, not the proposed new cream/forest homepage.

| Screen | Before | Current repair |
|---|---|---|
| Homepage desktop | [Before](frontend-repair/home-before.png) | [After](frontend-repair/current-final-public-home-1280.png) |
| Editor desktop | [Before](frontend-repair/editor-before.png) | [After](frontend-repair/current-final-editor-1280.png) |
| Editor mobile | — | [Current](frontend-repair/current-final-editor-390.png) |
| Text Requests mobile | — | [Current](frontend-repair/current-final-texts-390.png) |
| White customer page | — | [Current fixture](frontend-repair/current-white-customer.png) |

The older [26-step gallery](frontend-repair/gallery.html) records the earlier repair stage and its failure/offline states. Its consent UI and phone hardware are superseded by the current captures. Full-page images retain fixed bars at the captured viewport position; browser checks also verify viewport reachability and reflow.

## Final local validation

| Check | Result |
|---|---|
| Frontend TypeScript and zero-warning lint | Passed |
| Frontend unit/component/accessibility tests | **1,094 passed in 105 files** |
| Customer flow Playwright, mobile and desktop | **38 passed**: all ratings, keyboard, offline recovery, duplicate-safe retry, small screens, language/text expansion and reduced motion |
| Visual regression, light/dark mobile/desktop | **4 passed**; desktop expected images updated only after inspecting the intentional white-hero/PR75 styling differences |
| Isolated fresh database from current migrations | **745 pgTAP assertions in 20 files passed** |
| Mobile unit tests and TypeScript | **102 tests passed**, typecheck passed; no native device execution |
| Production webpack build and fixture exclusion | Passed |
| Browser accessibility | **48** light/dark scans across 24 local routes, then **15** focused final scans at 390/768/1280px: zero axe violations; no overflow on these scans, plus 320px reflow checks |
| Production browser runtime | **22** additional light/dark public/sign-in scans: zero page errors or axe violations; 320/430/1024/1280px reflow passed |
| Real local activation | Email received in Mailpit, verified code, created business/Tag and preserved Growth selection; no Stripe checkout |
| Real local photo path | Storage upload → confirmation → publish → native preview → live uploaded artwork verified; draft-refresh guarantees are not claimed |
| Consent/sample interaction | Exact local preview → explicit attestation → zero-credit send disabled; recipient change invalidates preview; public sample keyboard/click creates no API write |
| Requested design-reference installer | Ran successfully at pinned commits; existing references preserved; no upstream hooks executed by installer |

The populated development database was preserved. One global-count assertion failed when initially run against that populated data; the complete suite passes on the separate freshly seeded validation database. Chromium is not Safari or a physical iPhone. Automated axe results are not a complete accessibility certification. Feedback detail in a populated real account, screen readers and actual NFC remain unverified.

## Remaining launch gaps and proposed next work

[Launch-gap report](PR67_LAUNCH_GAPS.md) gives each finding's files, tests, impact, reproduction, minimal fix, regression coverage and launch relevance. Priority gaps: persistent/removable photo drafts; uncertain publish/deletion recovery; bounded native/read failures; personal account deletion for non-owner/no-business users; stale App Store metadata. The product is **not certified launch-ready**.

[Visual-system audit and exact proposed files](PR67_VISUAL_SYSTEM_AUDIT.md) recommends warm cream, white and deep forest with retained Geist, starting only with header/hero. The latest user request requires review before that new visual editing and approval of the first direction before rollout. No global font/palette change or native redesign has been made.

Current competitor pages, GitHub REST metadata and Apple's official policy could not be fetched through the environment proxy (403); Git refs and source were accessible. No fresh competitor claims or App Store policy certification are inferred. Figma was not available as a callable connector. External verification is required for hosted backend/mail, Stripe/provider behavior, physical NFC, TestFlight/Xcode, App Store Connect and real-device resilience.

The cloud configuration draft is saved with tested setup/startup lessons and the necessary research-domain additions. Review/save and publish it in environment settings to apply it. This publishes the development environment configuration, not the ReviewBoost website.
