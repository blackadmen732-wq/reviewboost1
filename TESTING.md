# Testing

Commands and locations for every test suite in the repository.

## Frontend (Next.js)

Test files live under `frontend/tests/`, organised by kind:

| Directory | Kind | Count |
|---|---|---|
| `tests/unit/` | Unit (Vitest) | 16 |
| `tests/component/` | Component (Vitest + Testing Library) | 3 |
| `tests/accessibility/` | Accessibility (Vitest + vitest-axe) | 1 |
| `tests/e2e/` | End-to-end (Playwright) | 3 |

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

Test files live under `apps/mobile/data/__tests__/`.

Configuration: uses Vitest defaults from the mobile `package.json`.

```bash
cd apps/mobile

# All mobile tests (Vitest)
npm test
```

## Supabase (Database)

Test files live under `supabase/tests/`. They are pgTAP tests executed
against the local Supabase database.

| File | Coverage |
|---|---|
| `column_security_test.sql` | Column-level security policies |
| `customer_flow_test.sql` | Customer flow database logic |
| `praise_isolation_test.sql` | Praise data isolation between orgs |
| `security_hardening_test.sql` | Security hardening measures |
| `token_rotation_test.sql` | Token rotation logic |

```bash
# Requires a running local Supabase stack (supabase start)
supabase test db
```
