# Testing

Commands and locations for every test suite in the repository.

File counts below are the inventory on main as of 2026-09-05. Assertion counts
for pgTAP come from each file's `select plan(N)`.

## Frontend (Next.js)

Test files live under `frontend/tests/`, organised by kind:

| Directory | Kind | Count |
|---|---|---|
| `tests/unit/` | Unit (Vitest) | 26 |
| `tests/component/` | Component (Vitest + Testing Library) | 3 |
| `tests/accessibility/` | Accessibility (Vitest + vitest-axe) | 1 |
| `tests/e2e/` | End-to-end (Playwright) | 3 |

Notable unit suites beyond the original customer-flow set: `sms-*.test.ts` (8
files, 78 cases — Text Requests engines and Twilio adapter boundary) and
`stands-system.test.ts` (QR/NFC software logic). These are CI-tested. They are
not live-verified against Twilio or a physical NFC tag.

Configuration: `frontend/vitest.config.mts`, `frontend/playwright.config.ts`

```bash
cd frontend

# Unit + component + accessibility tests (Vitest, jsdom)
npm test

# Watch mode
npm run test:watch

# Accessibility tests only
npm run test:a11y

# End-to-end tests (Playwright — starts dev server on port 3100)
npm run test:e2e

# Visual-regression tests only
npm run test:visual

# Update visual-regression baselines
npm run test:visual:update

# Assert no production fixture data leaked into the build
npm run test:production-fixtures

# Full verification pipeline (codegen → typecheck → lint → test → build → fixture check)
npm run verify
```

## Mobile (Expo / React Native)

Test files live under `apps/mobile/data/__tests__/`. Count: **7**.

| File | Coverage |
|---|---|
| `large-secure-store.test.ts` | SecureStore persistence helper |
| `member-role.test.ts` | Role mapping |
| `select-org-roles.test.ts` | Organization-selection roles |
| `use-feedback-detail.test.ts` | Feedback detail live-API hook (mocked `apiFetch`) |
| `use-feedback.test.ts` | Feedback list live-API hook (mocked `apiFetch`) |
| `use-live-feed.test.ts` | Live Feed API hook (mocked `apiFetch`) |
| `use-stands.test.ts` | Stands list live-API hook (mocked `apiFetch`) |

Configuration: uses Vitest from the mobile `package.json`. Also run by the
`mobile` job in `.github/workflows/ci.yml` and by
`.github/workflows/mobile-release-validation.yml`.

```bash
cd apps/mobile

# All mobile tests (Vitest)
npm test
```

These tests prove the hooks talk to the documented API shapes. They do not
live-verify OTP sign-in, native NFC write, or a production API.

## Supabase (Database)

Test files live under `supabase/tests/`. They are pgTAP tests executed
against the local Supabase database. **326** planned assertions across 7 files.

| File | Plan |
|---|---|
| `column_security_test.sql` | 36 — column-level security policies |
| `customer_flow_test.sql` | 88 — customer flow database logic |
| `onboarding_security_test.sql` | 14 — public onboarding RPC / SECURITY DEFINER |
| `praise_isolation_test.sql` | 26 — praise data isolation between orgs |
| `security_hardening_test.sql` | 85 — security hardening measures |
| `text_requests_test.sql` | 59 — Text Requests consent, suppression, outbox, quota |
| `token_rotation_test.sql` | 18 — token rotation logic |

There is no dedicated NFC pgTAP file. NFC schema is applied by migrations in
the same CI job that runs this suite.

```bash
# Requires a running local Supabase stack (supabase start)
supabase test db
```

## Staging scripts

| File | Kind |
|---|---|
| `scripts/backend/__tests__/seed-stand-remote.test.mjs` | Node test runner (`node --test`) |

Run in CI by the `staging-script-tests` job in `.github/workflows/ci.yml`.
