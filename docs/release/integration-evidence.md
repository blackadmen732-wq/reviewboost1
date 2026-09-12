# Integration baseline evidence

Date: 2026-09-12. Branch: `devin/1789189752-integration-baseline`.
Starting revision: `6b8adc54f2d8d98e970b4037afb9ed1eff6ed0b8`.
Source heads: #66 `77934da9f43f85d0ac40de070360d82145e4222e`; #67 `6a4b30e165aacce66d70d4f5b49d9813e94701f6`.

This report describes the W0 baseline, not completion of the product gap register. See [INTEGRATION_MANIFEST.md](INTEGRATION_MANIFEST.md) for all 31 open PRs, SHAs, dependencies, migration ledger, domain ownership and exact unresolved API collisions.

## Implemented

- Combined #66's one-tap controller with #67's owner pages and the shared `CustomerVisitView` / `VisitStars`. Rating 1–5 goes through response persistence before the identical Google opportunity. No visible note, Continue or Praise sequence.
- Kept #66 EN/ES/HT journey messages, added #67's localized shared footer, and adapted legacy prop tests to the explicitly requested one-tap contract. Axe coverage now exercises the actual shared rating renderer. Duplicate attempts, recoverable error keys, offline recovery, uniform invalid links and historical Praise accessibility coverage remain.
- Selected only #67's `customer_page_settings`/artwork foundation; no alternate profiles backend. Added its SQL file unchanged. All 43 existing migrations, setup scripts, CI/hook controls, proxy and token-digest implementation remain unchanged.
- Regenerated the OpenAPI client for additive presentation fields. Historical public session/response/click/praise endpoints and data remain.
- Preserved upstream owner functionality and tests rather than treating inherited F08–F40 defects as fixed. Historical product-design docs remain because owner tests load them; current supplied specification overrides conflicting historical instructions.

## Automated pass

All commands ran locally using Node **22.22.2**, installed dependencies from `npm ci`, and repository-pinned Supabase CLI **2.117.0**.

| Check | Command | Observed result |
|---|---|---|
| Dependencies | `cd frontend && npm ci` | Passed; npm reported audit findings, no unrelated dependency remediation attempted |
| API types | `cd frontend && npm run api:generate` | Passed |
| TypeScript | `cd frontend && npm run typecheck` | Passed |
| ESLint | `cd frontend && npm run lint` | Passed, zero warnings allowed |
| Unit/component/accessibility | `cd frontend && npm test` | **49 files / 493 tests passed** |
| Production build | `cd frontend && npm run build` | Passed, Next.js 16.3.0 webpack build |
| Production fixture exclusion | `cd frontend && npm run test:production-fixtures` | Passed; no fixture markers in production client assets |
| Setup-script regressions | `node --test scripts/dev/__tests__/setup-local-env.test.mjs` | **17/17 passed** |
| Local stack | `source scripts/dev/tool-versions.sh && supabase_cli start` | Passed on existing Docker 27.4.1 / overlay2 |
| Local env | `bash scripts/dev/setup-local-env.sh` | Passed; generated ignored env with mode 600 |
| Fresh migration sequence | `source scripts/dev/tool-versions.sh && supabase_cli db reset` | Passed, seeded local DB; ledger has **44** migrations, max `20260909000900` |
| Database regressions | `source scripts/dev/tool-versions.sh && supabase_cli test db` | **7 files / 326 assertions passed** |
| Patch whitespace | `git diff --check` | Passed |
| Hook | Compared active hook to `.githooks/pre-commit` | Active symlink, matching contents |

Initial integration typecheck exposed missing `footerPromise`, old `RatingScreen`/`GoogleOpportunity` test props and an `exactOptionalPropertyTypes` optional notice ID. These were reconciled and the checks above rerun successfully. Existing tests were changed only to express the authorized journey transition, not to conceal failures.

## Local HTTP smoke pass

Started the production build using `cd frontend && npm run start`, with generated local Supabase credentials and fixtures disabled. Shell HTTP requests observed:

| Request | Result |
|---|---|
| Public home | 200 |
| `/q/abcdefghijklmnop` page shell | 200 |
| `/api/v1/public/q/abcdefghijklmnop` unknown context | 404 |
| Anonymous `/home` | 307 to `/login?next=%2Fhome` |
| Anonymous `/api/v1/customer-page` | 401 |
| Anonymous `/api/v1/customer-page/artwork?side=draft` | 401 |

These are HTTP smoke checks, not a recorded browser or authenticated owner walkthrough.

## Remaining findings and explicit limits

- **F01:** source composition integrated and component-tested; complete durable/browser handoff acceptance still belongs to pilot.
- **F02:** backend fork avoided; scope/assets/revisions still need forward migration work.
- **F03–F06, F08–F13:** pilot fixes required. In particular fixed canvas overflow, dark cascade, missing no-photo identity, radio keyboard submission, popup/effect handoff timing, pending click persistence, unscoped oldest-org RPCs, failed upload preview, Bearer-only reopened image, revisionless publish and bytea image serving remain. See exact service/route names and contract in the manifest.
- **F07, F14, F20–F22:** owner domain still required.
- **F15–F19:** NFC domain still required; physical read-back cannot be inferred from code/tests.
- **F23–F26:** billing domain still required; current webhook is a placeholder and missing entitlement still defaults active.
- **F27–F32:** SMS domain still required; older corrective branches are candidates, not integrated fixes.
- **F33–F36:** security/operations domain still required. Main controls retained, remaining grant/limiter/header gaps not claimed closed.
- **F37–F40:** real browser CI, mobile environment segregation, builds and release evidence still required.

## External blocked

No production or remote staging migration ledger was accessed. No Stripe/SMS credentials or remote projects were provisioned, and no external provider call, charge, real SMS, physical NFC operation or store submission was performed. Hardware, browser-device interoperability and provider/store evidence remain external release gates; they did not block this local baseline.

## Not tested

- Browser walkthrough, Playwright E2E/visual suite, Safari, native devices, 320–430px/200%-text visual matrix or popup behavior.
- Authenticated multi-organization customer-page editor, upload/publish/reopen flow, actual-backend end-to-end rating or end-to-end NFC provisioning.
- Populated upgrade from older schemas or remote applied-migration reconciliation.
- Owner migration-specific privilege attacks, distributed SMS races, verified Stripe flows, mobile build/signing, real monitoring/backup restore.

The existing pgTAP suite covers main's database regressions; its pass does not cover all new owner page authorization paths. The fixture/component suite does not prove real browser navigation or a Google review posting.

## Pilot handoff

Use this branch as the integration parent. Do not remerge #66/#67, import `customer_page_profiles`, edit the preserved migration files, or copy old collision-prone SMS/privilege histories wholesale. Use the assigned `2026091201xxxx`–`2026091206xxxx` ranges and the manifest's API contract. No individual PR is opened; pilot owns the central implementation PR after domain fixes.
