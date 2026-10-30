# ReviewBoost Foundation Status

Last updated: 2026-09-05 (main `7c3473f`)

> **Scope, and what this is not.** This describes the *foundation* as it stood
> on `main` at `7c3473f`. It is not the current state of the product and has
> not been updated since. The current head is 85 commits beyond `7c3473f`,
> and 54 of those are ahead of what is on `main` today.
>
> For what exists now, read **`docs/V1_COMPLETION_REPORT.md`**, which is kept
> current and uses the fuller status vocabulary (IMPLEMENTED, CI-TESTED,
> HOSTED-VERIFIED, LIVE-VERIFIED, DEVICE-VERIFIED, TESTFLIGHT-VERIFIED,
> PLAY-VERIFIED, EXTERNAL-BLOCKED).
>
> Two documents answering "what is done" with different answers is how a status
> file becomes something nobody trusts. This one is kept as the record of the
> foundation rather than being edited into a second, competing present tense —
> so where it disagrees with the completion report, the completion report is
> right and this is history.
>
> Known to be out of date below, among other things: it says "stands" where the
> product now says "Tags"; it lists Praise screens that are no longer primary
> navigation; and it describes an NFC flow with visible technical stages that
> has since been collapsed to one operation.

State labels used here:

| Label | Means |
|---|---|
| **implemented** | Code exists in the repository |
| **CI-tested** | Automated tests have run successfully in CI |
| **live-verified** | Exercised against real production or provider infrastructure and observed |
| **not built** | Does not exist |

CI-tested is not live-verified. Implemented is not a release.

## What is done

### Database security (Supabase migrations) — implemented, CI-tested

- [x] Core tenancy: organizations, members, locations, stands
- [x] Customer flow: responses, praise, sessions, clicks
- [x] RLS policies on all tenant tables
- [x] Column-level security: UPDATE revoked on all tables, writes through RPCs only
- [x] Organization member RPCs: change_role, suspend, remove (SECURITY DEFINER, last-owner protection, self-promotion prevention)
- [x] Response RPCs: mark_read, resolve, reopen, add_note (SECURITY DEFINER, FOR UPDATE, idempotent, audited)
- [x] Stand token rotation: atomic hash+ciphertext update, audit event, admin-only
- [x] Praise view: security_invoker=true + security_barrier=true, no response_id
- [x] Praise state machine RPCs: match, unmatch, mark_shared, unmark_shared, archive, restore (FOR UPDATE, idempotent, audited)
- [x] Staff creation via RPC only (direct INSERT blocked)
- [x] Audit events: append-only, no authenticated INSERT/UPDATE/DELETE
- [x] Hard delete prevention on locations, stands, members
- [x] Stand token column protection (no direct UPDATE on hash/prefix)
- [x] Obsolete function overloads dropped (set_stand_token_ciphertext, old create_organization)
- [x] All security-critical params required (no unsafe defaults)
- [x] NFC provision RPC (`rpc_record_nfc_provision`): owner/admin only; default PUBLIC/anon execute revoked
- [x] Text Requests schema: consent ledger, phone-level opt-out, suppression, state machine, outbox, webhook inbox, quota ledger (RLS, service-role writes)

The migrations, including a second clean reset and schema-drift check, and all
**326** planned pgTAP assertions have run successfully in CI. This verifies the
database build and tested authorization behaviour in CI; it does not verify a
production Supabase project.

### Next.js web application and API — implemented, CI-tested, not live-verified

- [x] Public customer rating flow and equal Google review opportunity
- [x] Owner sign-in, onboarding, organization selection, dashboard, feedback, praise, stands, and settings pages
- [x] Next.js route handlers for the public flow and owner operations
- [x] Team praise route uses RPCs for all operations (no direct UPDATE)
- [x] Praise-to-rating correlation removed (rpc_response_has_praise dropped, praisedSomeone removed)
- [x] Error handling on all database queries (503 on failure, never silent empty)
- [x] Cursor validation (UUID + timestamp checked before interpolation)
- [x] QR export for stands (SVG / PNG / JSON) and Copy NFC Link
- [x] Android Web NFC writer on the owner stand page (feature-detected)
- [x] Text Requests API: schedule, list, preview, cancel, signed webhook sink, internal dispatch trigger
- [x] TypeScript strict, ESLint clean

### Expo mobile application — implemented, CI-tested, not live-verified

- [x] Expo Router application under `apps/mobile/` (Expo SDK 57 / RN 0.86)
- [x] Supabase OTP authentication (`signInWithOtp` / `verifyOtp`) and organization loading
- [x] Protected routes for Live Feed, Feedback, and Stands
- [x] Live Feed, Feedback list/detail, and Stands call the authenticated APIs (`/api/v1/live-feed`, customer-responses, `/api/v1/review-stands`). Mock data (`data/mock.ts`) has been removed
- [x] Native NFC write path (`react-native-nfc-manager`): NDEF HTTPS URI, read-back verification, role-gated UI
- [x] NFC Tools fallback copy on stand detail

Those API hooks are unit-tested in CI against mocked `apiFetch`. They have not
been live-verified on a real device against production.

### Stands / NFC provisioning — implemented, CI-tested, not live-verified

Software for writing one ReviewBoost HTTPS URL (`/q/[token]`) to a tag exists:

- Native write in the iOS/Android app (requires a dev/preview build, not Expo Go)
- Web NFC on supported Android Chrome
- Copy NFC Link + NFC Tools manual-write instructions
- QR as the universal fallback (same stand URL)
- Provisioning recorded via `POST /api/v1/review-stands/[standId]/nfc-provision`

CI (`.github/workflows/mobile-release-validation.yml`) evaluates `expo config`,
the NFC usage string, the `react-native-nfc-manager` plugin name, identifiers,
`eas.json`, env-var names, native-dep ranges, `tsc`, and unit tests. It does
**not** run `expo prebuild` or inspect generated iOS entitlements (that is a
manual `prebuild:check`). Frontend `stands-system` tests and mobile
`use-stands` tests also run in CI. There is **no dedicated NFC pgTAP suite**.
Real-device write/read-back is **not live-verified**. Issue #31 remains the
canonical NFC spec and stays open until that live-device gate is done. Hardware
catalogue, ordering, fulfilment, and shipping are **not built**.

### Text Requests / SMS backend — implemented, CI-tested, not live-verified

Owner language is Text Requests, not campaigns. PostgreSQL is the source of
truth. See `docs/backend/TEXT_REQUESTS.md`.

- [x] Consent ledger + projection; unknown numbers are never consent
- [x] Phone-level STOP/START/HELP; suppression gate re-checked at dispatch
- [x] Request state machine, delivery attempts, transactional outbox
- [x] Durable webhook inbox (signature verified before dedupe write)
- [x] GSM-7 / UCS-2 segment engine and integer micro-unit cost preview
- [x] Quota ledger (reserve/consume/release/refund/expiry); purchase/plan integration is **not built**
- [x] Twilio adapter in code; no credentials committed. Production
  `getSmsProvider` fails closed (`ConfigError`) if the provider is missing or
  invalid. `SMS_PROVIDER=fake` can record simulated submissions. Neither is a
  real carrier send

CI-tested: 78 vitest cases (`frontend/tests/unit/sms-*.test.ts`) and 59 pgTAP
assertions (`supabase/tests/text_requests_test.sql`).

**Not built / not live-verified:** owner UI, a configured Twilio account, real
per-segment pricing, a live carrier send/receive, A2P 10DLC / legal SMS
certification.

### Native release infrastructure — implemented, CI-tested, not live-released

`apps/mobile/eas.json` is modernized (EAS CLI `>= 16.0.0`, remote app versions,
per-profile environments, submit profiles). `expo-dev-client` is installed.
`.github/workflows/mobile-release-validation.yml` validates Expo/EAS config,
identifiers, NFC usage string, env var names, native deps, `tsc`, tests, and
server-secret scanning.

**Not done:** EAS project link (`app.json` has no `extra.eas.projectId`), any
EAS build, TestFlight, or Google Play submission. Those require an Expo account
and store credentials. See `docs/mobile/MOBILE_RELEASE.md`.

### Tests (pgTAP) — CI-tested

- [x] column_security_test.sql (36 tests)
- [x] customer_flow_test.sql (88 tests)
- [x] onboarding_security_test.sql (14 tests)
- [x] praise_isolation_test.sql (26 tests)
- [x] security_hardening_test.sql (85 tests)
- [x] text_requests_test.sql (59 tests)
- [x] token_rotation_test.sql (18 tests)

326 planned pgTAP assertions. Frontend Vitest/Playwright and mobile Vitest also
run in CI. See `TESTING.md`.

## Built but not live-verified

- The Next.js web application and its route handlers exist and have automated
  type, lint, unit/component, contract, build, accessibility, end-to-end, and
  visual-test coverage in the repository. They have not been exercised against
  real production infrastructure as part of this status review.
- The Expo mobile app uses live authenticated APIs for Feed, Feedback, and
  Stands. Hook tests mock those APIs. OTP sign-in, native NFC write, and the
  full device flow have not been live-verified.
- NFC provisioning software exists (native, Web NFC, NFC Tools fallback, QR).
  No real tag has been recorded here as written and second-phone verified.
- Text Requests backend exists and is CI-tested. No live SMS has been sent.
- EAS release config exists and is CI-validated. No TestFlight or Play build
  has been produced from this repository evidence.
- Database migrations and pgTAP tests are CI-verified, but production
  deployment, operations, backup, and recovery readiness are not established
  here.

## What is not built

### Not built

- Stripe billing, subscription plans, trial, and cancellation
- SMS quota purchase / plan enforcement tied to billing
- Text Requests owner UI
- Live Twilio (or other) provider account, credentials, and carrier send
- Google Business Profile integration
- POS integrations (Square, Toast, Clover)
- AI reply drafting
- Campaign scheduling (marketing campaigns; Text Requests are a different path)
- Hardware catalogue, ordering, fulfilment, and shipping
- Admin portal
- Monitoring and alerting
- Backups and restore drill
- Load testing
- EAS project link, TestFlight, and Google Play submission
- Contacts as first-class entities
- Print templates (QR SVG/PNG export exists; a template product does not)

### Known issues

- Deployments succeed through external Vercel configuration, but the complete
  live product flow remains unverified.
- Production infrastructure and provider integrations have not been live-tested
  by the evidence recorded here.
- GitHub issue #31 (NFC provisioning spec) stays open; software landed in #32,
  live-device verification has not.
