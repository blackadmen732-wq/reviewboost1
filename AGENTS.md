# ReviewBoost working agreement

## Product and authority

ReviewBoost serves local business owners collecting honest after-visit feedback through QR/NFC Tags and eligible one-to-one text requests. Preserve a short customer path and a quiet owner interface. Read `DESIGN.md` and `docs/design/PR67_ROUTE_PLAN.md` before frontend work.

Check the requested GitHub branch and remote updates at the start of each task and again before pushing. PR #67's branch is `cursor/sprint-forge-owner-systems-v15-7042`; continue there when working on this launch polish. Do not create a competing PR, force-push, overwrite another author's work, merge, deploy, run production migrations, or activate live messaging without explicit authorization. Current main governs backend/security/billing contracts; retain compatible newer PR67 additions. PR76's Phase 0 consent protections are reconciled here; its Connections foundation and PR77 retention proposals are outside this launch scope.

## Architecture and data flow

| Area | Responsibility |
|---|---|
| `frontend/app` | Next.js 16 App Router: public site, anonymous `/q/[token]`, authenticated owner pages, route handlers. Route groups are organizational, not URL segments. |
| `frontend/features` | Product workflows: public story, OTP, onboarding, owner shell, feedback/Insights, Tags, shared Customer Page editor/live canvas. |
| `frontend/components/ui` | Existing Radix/CVA-based primitives; reuse before adding a library. |
| `frontend/lib/server` | Server-only auth, tenant-scoped reads, validated RPC orchestration, encryption, billing, SMS, readiness. Never import into client code. |
| `frontend/lib/owner`, `lib/sms`, `lib/i18n` | Pure product models, approved SMS templates, customer words; shared logic stays free of secrets. |
| `frontend/styles` | Semantic tokens/global interaction styles; shared customer canvas; scoped public product styles. |
| `apps/mobile` | Expo/React Native owner app. Uses authenticated APIs; native NFC and release verification require real hardware. Four visible daily tabs; Account is secondary. |
| `supabase/migrations` | Append-only PostgreSQL schema/RLS/RPC history. Tenant state transitions and audit events are transactional. |
| `supabase/tests` | pgTAP permissions, state, invariants and migration behavior. |
| `openapi` | Public API contract and generated TypeScript source. Check owner endpoint schemas in route/service files as well. |
| `docs/backend`, `docs/dev` | Architecture, operations, local/cloud setup and provider launch gates. |

Owner: Supabase OTP → session + organization membership → server-rendered tenant reads / authorized `/api/v1` calls → validated service → RLS-scoped or narrowly guarded privileged RPC → PostgreSQL + append-only audit. Mutations refresh authoritative state; optimistic display never grants entitlements.

Customer: opaque Tag token → public session → shared published Customer Page → selected 1–5 rating → persisted response → same neutral Google destination. A click/handoff is not proof that a Google review was posted. Preview uses the same `CustomerVisitView`, not a second implementation.

SMS: selected Tag + phone + approved template → exact server preview + eligibility → separate explicit consent attestation if genuinely obtained → eligible scheduling/deduplication + credit reservation → outbox/worker/provider → verified webhook delivery or suppression. Sending and syncing must never manufacture consent. Provider errors are not success.

Billing: canonical catalog → server Checkout/Portal → signed Stripe webhook + deduplication → stored subscription/entitlements and ledger → UI. A return URL cannot grant a plan. Free setup is distinct from a paid subscription or trial.

## Commands

Node 22+; dependencies are locked separately in `frontend` and `apps/mobile`.

```sh
cd frontend
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run test:a11y
npm run test:e2e
npm run build
npm run test:production-fixtures
```

For local Supabase, use the pinned `supabase_cli` function in `scripts/dev/tool-versions.sh` (source it from Bash), then `supabase_cli start` and `supabase_cli test db`. Read `.cursor/install.sh`, `.cursor/start.sh` and `docs/dev/CLOUD_AGENT_ENVIRONMENT.md` for cloud prerequisites. `db reset` destroys local data: use a disposable validation project or obtain authorization when data must be preserved. Never target production during frontend verification.

```sh
cd apps/mobile
npm ci
npx tsc --noEmit
npm test
```

Read `frontend/AGENTS.md` and the relevant **installed** Next.js guide under `frontend/node_modules/next/dist/docs/` before changing App Router code. Only one Next dev process per checkout. If this environment's proxy prevents development WebSocket hydration, diagnose it and verify actual interactive state; an HTTP 200 or server screenshot is insufficient. Webpack is an available diagnostic (`npm run dev -- --webpack`).

## Conventions and hard rules

- TypeScript strict: preserve role gates, validation, explicit errors and safe internal return URLs. Do not replace a failed API read with a plausible zero, empty list or plan.
- Say **Tag** in product copy; existing database names and `/stands` URLs remain stable.
- Four daily destinations: Home, Feedback, Text Requests, Tags. Insights is inside Feedback; Settings is secondary. Legacy routes redirect without deleting historical data.
- All five ratings follow the same save/handoff. No gating, extra Continue, public notes, Team Praise step or theme builder.
- No photo means a completely white hero. Shared lower rounded rating panel, approved copy, five stars and small gray lightning footer remain consistent. Owner preview faithfully matches live.
- Do not invent customers, revenue, review completions, subscription state, trial credits, integrations, or working Connect buttons. Fixtures belong only in explicit tests/examples and must never enter production behavior.
- No implicit SMS consent. Keep evidence-backed consent separate from preview/send; preserve opted-out/suppressed states and server eligibility. Do not restore the retired free-form composer.
- Never log phone numbers, decrypted notes, tokens, cookies, secrets or provider payloads. Keep local environment/state files ignored.
- Cleanup needs evidence: search all callers and tests; remove only proven obsolete code. Do not delete data/migrations or unused-looking security machinery for aesthetics.
- For UI changes, inspect real loaded pages at mobile/tablet/desktop plus keyboard, reduced motion, relevant themes and failure states. Axe is useful but does not prove full accessibility compliance. Run checks appropriate to changed behavior; record provider/hardware verification separately.
- Root `AGENTS.md` and `DESIGN.md` must each remain below 32 KiB.

## Requested design tools

Impeccable, Awesome Design MD (Stripe reference) and UI Design Agent Kit are installed locally under `.agents/skills`; upstream shadcn is cloned at `design-kit/`. These reference checkouts are ignored rather than vendored into the product. `scripts/dev/install-design-references.py` recreates pinned installations; see `docs/design/reference-lock.json` for exact commits. User requirements and this existing product's contract outrank external templates or skill defaults. Do not introduce approval pauses, replacement branding or a new frontend merely because a reference suggests them.
