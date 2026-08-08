# Backend progress

Durable record for the Phase 1 backend work. Updated after every stable phase so
a lost context window costs nothing.

Branch: `backend/customer-flow-foundation`
Base: `codex/frontend-premium-redesign` @ `f64b519`

---

## Phase 0 — Git safety and evidence report

**Status: complete.**

### Git state at start

```
On branch codex/frontend-premium-redesign (up to date with origin)
Modified, uncommitted:  frontend/next-env.d.ts
                        frontend/package-lock.json
```

Both were left untouched and carried onto the new branch. Nothing was discarded,
reset, stashed, or overwritten.

`git ls-remote` confirms the remote is readable and the frontend agent has
pushed: `origin/codex/frontend-premium-redesign` = `f64b519b25c98d376d20f0a21b4659cded62a84e`,
identical to local. Nothing newer exists remotely.

Remote branches:

| Branch | SHA |
|---|---|
| `codex/frontend-premium-redesign` | `f64b519` |
| `docs/reviewboost-truth-baseline` | `97d8fe8` |
| `main` | `bdd0890` |

**Push requires credentials this environment does not have.** Reads work; `git
push` fails with `could not read Username for 'https://github.com'`. Commits are
durable locally.

### What the frontend calls

Five endpoints, contract at `frontend/contracts/customer-flow.openapi.yaml`
(unchanged since `e57bb58` — the premium redesign did not alter it):

| Method | Path | Success |
|---|---|---|
| GET | `/api/v1/public/q/{token}` | 200 context |
| POST | `/api/v1/public/q/{token}/sessions` | 201 new · 200 replay |
| POST | `/api/v1/public/q/{token}/responses` | 201 new · 200 replay |
| POST | `/api/v1/public/q/{token}/google-click` | 204 |
| POST | `/api/v1/public/q/{token}/team-praise` | 201 new · 200 replay |

Client behaviour that constrains the backend, read from
`frontend/lib/api/production-customer-flow-api.ts` and
`frontend/features/customer-flow/customer-flow.tsx`:

- Success bodies are **raw DTOs**. A `{ success, data }` wrapper breaks the
  generated `openapi-fetch` client.
- **202 is rejected outright** as `operation_not_terminal`.
- `googleReviewUrl` is **required and non-nullable**, and the client
  re-validates it against Google hosts in `lib/security/google-review-url.ts`. A
  URL the backend serves but the client rejects produces a dead flow with no
  diagnostic.
- Idempotency keys are `rb_{operation}_{uuid}` and are **persisted in
  sessionStorage**, so an offline retry reuses the same key. `f64b519` added a
  `getRandomValues` fallback for browsers without `randomUUID`; the format is
  unchanged.
- The context query retries once on non-404; a 404 is terminal and renders the
  "unavailable" state.

### What currently exists

Nothing on this branch serves those paths. `frontend/app/` contains only
`(customer)/q/[token]` — **there is no `app/api/` directory at all.**

What does exist is the legacy Express backend in `backend/`, which is where the
danger is.

### What conflicts

| Legacy behaviour | Location | Why it must not survive |
|---|---|---|
| `POST /q/:publicId/rating` gates on rating | `backend/src/http/routes/public.routes.js` | 4–5★ redirect to Google; below `review_threshold` diverted to a private form. Review gating. |
| `review_threshold` column and reads | `qr_stands`, `qrService.js`, `qrRepository.js`, `schemas.js` | The threshold itself |
| Required low-rating feedback | `qrService.submitRating` throws `feedback_required` | Forces an explanation out of unhappy customers before anything else |
| Contact collection in the public flow | `submitRatingSchema` accepts `contactPhone`, `contactEmail` | The public flow must collect no way to contact the customer |
| `feedback_intercepted` / `interceptRatePercent` | `messagingRepository.js`, `dashboard.routes.js` | Reports prevention as a product metric |
| Server-rendered star gate | `renderGatePage()` | Ships the gating UI from the API |
| `scanUrlFor()` uses `PUBLIC_API_URL` | `qrService.js` | Printed codes resolve to the gate, not the frontend |

All seven are **currently reachable on this branch.** They were removed on
`backend/customer-flow-v1` (six commits, local, unpushed); that work is not
merged here.

### What will be replaced

The five endpoints are rebuilt on **Next.js Route Handlers + Supabase**, not
Express. The legacy backend is evidence of requirements only — no Express,
custom JWT, Redis, or BullMQ is revived.

### Files I will touch

```
supabase/migrations/**          new
openapi/reviewboost-public-v1.yaml   new
frontend/app/api/v1/public/**   new — Route Handlers (backend-owned per the boundary)
frontend/lib/server/**          new — server-only modules
BACKEND_PROGRESS.md             new
FRONTEND_HANDOFF.md             new
docs/backend/**                 new
```

### Files I will not touch

Every React component, page, layout, style, animation, form, frontend reducer,
and frontend copy string. The whole of `backend/` (see blockers). Locked shared
files: `frontend/package.json`, lockfiles, `tsconfig.json`, `next.config.*`,
`middleware.ts`, `.env.example`, root `.gitignore`, existing CI workflows.

---

## Phase 1 — Database foundation

**Status: migrations written. NOT EXECUTED.**

Files:

```
supabase/migrations/20260808000100_core_tenancy.sql
supabase/migrations/20260808000200_customer_flow.sql
supabase/migrations/20260808000300_rls_policies.sql
supabase/migrations/20260808000400_public_flow_functions.sql
```

Ten tables: `organizations`, `organization_members`, `locations`,
`review_stands`, `public_review_sessions`, `customer_responses`,
`google_review_clicks`, `team_praise_records`, `idempotency_records`,
`audit_events`.

### The one design decision worth recording

The legacy schema declares every tenant table `FORCE ROW LEVEL SECURITY`. That
advice came from direct-PostgreSQL and **does not transfer to Supabase** — it is
the correction already recorded in `LESSONS.md` §5.2.

Under Supabase the tables are owned by `postgres`, and the Data API connects as
`anon` or `authenticated`, which are not the owner, so ordinary `ENABLE ROW
LEVEL SECURITY` already applies to every client request. Adding `FORCE` would
additionally subject `postgres` to the policies — which breaks every
`SECURITY DEFINER` function, because the definer *is* `postgres`. The function
would be subject to the policy it exists to satisfy and would silently write
nothing.

So: `ENABLE`, not `FORCE`. Anonymous customers get no direct table access at
all; every public write goes through a narrow `SECURITY DEFINER` function in the
private `app` schema, with `EXECUTE` revoked from `PUBLIC`, `anon`, and
`authenticated`.

### Not executed

No Docker, no `psql`, no PostgreSQL, no Supabase CLI in this environment.

```
docker         command not found
psql           command not found
supabase       command not found
```

**BLOCKED — DATABASE TESTS NOT EXECUTED.** No SQL in this branch has run. Every
statement about database behaviour is inspection-only until
`supabase db reset` or a CI Postgres executes it.

---

## Phase 2 — Route Handlers

**Status: BLOCKED on a dependency handoff.**

`@supabase/supabase-js` is not installed and appears in no lockfile. Adding it
requires editing `frontend/package.json`, which is a locked shared file.

Writing Route Handlers that import a package that does not exist would break
`next build` and `tsc`, which is worse than not writing them. The exact request
is in `FRONTEND_HANDOFF.md`.

Everything that does not need the client — migrations, database functions, the
OpenAPI document, validation schemas — proceeds meanwhile.

---

## Blockers

1. **`@supabase/supabase-js` is not installed.** Locked file. See
   `FRONTEND_HANDOFF.md`. Blocks all five Route Handlers.
2. **No database in this environment.** Migrations cannot be executed or tested
   here.
3. **`git push` has no credentials.** Commits are local only.
4. **I did not delete `backend/`, as instructed to.** Reasons in the next
   section. It needs an explicit decision.
5. **Review gating is reachable on this branch.** The legacy Express routes are
   live in `backend/` and the removal lives on an unmerged branch.

### On deleting `backend/`

The instruction was to delete or ignore it. I have **ignored** it and changed
nothing in it. I did not delete it, because:

- It holds the only implementation of these five endpoints that has ever been
  executed — `backend/customer-flow-v1`, six commits, 260 passing tests — and
  that branch is **unpushed**, so a delete plus a lost local clone loses it
  outright.
- The assignment itself says the legacy backend is evidence of requirements. The
  requirements not yet re-derived on Supabase are real: outbox, consent,
  suppression, quota reservation, reconciliation, audit.
- Deleting it does not make the gating unreachable in production; deploying the
  replacement does.

Recommended instead: push `backend/customer-flow-v1`, keep `backend/` until the
Supabase flow is live and verified, then remove it in one reviewed commit.

### On Twilio

Not started, deliberately. The assignment states *"Do not add SMS, billing, POS,
Google OAuth, AI replies, dashboards, or campaigns during this assignment"* and
*"Finish these five endpoints completely before touching later features"*, and
the same message asks for Twilio *"only after the five public endpoints are
complete."* The five endpoints are blocked on item 1 and are not complete, so
the phase gate has not opened. Requirements recovered from the legacy
implementation are listed in `docs/backend/SMS_REQUIREMENTS.md` when that phase
starts.

---

## Next action

Write `openapi/reviewboost-public-v1.yaml`, then the server-only validation and
idempotency modules that do not import the Supabase client. Route Handlers the
moment the dependency lands.
