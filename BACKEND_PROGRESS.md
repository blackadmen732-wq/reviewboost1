# Backend progress

Durable record for the Phase 1 backend work, so a lost context window costs
nothing.

Branch: `backend/customer-flow-foundation`
Base: `codex/frontend-premium-redesign` @ `f64b519`

| Commit | What |
|---|---|
| `bef1a26` | Supabase tenancy and customer-flow schema |
| `ead2b19` | Pre-existing frontend lockfile and next-env changes |
| `1d17229` | Five public Route Handlers, server foundation, tests |

**Not pushed.** See blockers.

---

## Phase 0 — Git safety and evidence report

**Complete.** Branch created from the pushed frontend head; the two
pre-existing modified files (`frontend/next-env.d.ts`,
`frontend/package-lock.json`) were carried over untouched and later committed on
explicit instruction.

The frontend expects five endpoints; none existed on any branch as Route
Handlers. The legacy Express backend in `backend/` still contains live review
gating (`POST /q/:publicId/rating`, `review_threshold`, required low-rating
feedback, contact collection, `feedback_intercepted`). Nothing in `backend/` was
modified.

---

## Phase 1 — Database foundation

**Complete as written. NOT EXECUTED.**

```
supabase/migrations/20260808000100_core_tenancy.sql
supabase/migrations/20260808000200_customer_flow.sql
supabase/migrations/20260808000300_rls_policies.sql
supabase/migrations/20260808000400_public_flow_functions.sql
supabase/migrations/20260808000500_rate_limits.sql
supabase/migrations/20260808000600_public_rpc_surface.sql
```

Eleven tables: `profiles`, `organizations`, `organization_members`, `locations`,
`review_stands`, `public_review_sessions`, `customer_responses`,
`google_review_clicks`, `team_praise_records`, `idempotency_records`,
`audit_events`, plus `rate_limit_buckets`.

### Decisions worth keeping

**RLS is `ENABLE`, not `FORCE`.** The legacy schema forces it everywhere; that
advice came from direct PostgreSQL and does not transfer. Under Supabase these
tables are owned by `postgres` and the Data API connects as `anon` or
`authenticated`, so plain `ENABLE` already covers every client request. `FORCE`
would additionally subject `postgres` to the policies and break every
`SECURITY DEFINER` function, because the definer *is* `postgres` — the function
would be subject to the policy it exists to satisfy and would silently write
nothing. This is the correction already recorded in `LESSONS.md` §5.2.

**One RPC per operation, not two.** A PostgREST call is a transaction, so
splitting the idempotency claim from the work would put a commit between them
and let two racing retries both pass. Claim, work, and stored result commit
together or not at all.

**No function accepts an org, location, or stand id.** A caller who could name a
tenant could write unlimited fabricated feedback into it.

**A thin `public.rpc_*` surface, six functions.** PostgREST only exposes
configured schemas, so `app` is unreachable over the API — good for the
internals, useless for the server. Rather than exposing all of `app`, six
`SECURITY INVOKER` wrappers in `public` delegate to it, each granted only to
`service_role`. The callable surface is exactly what the flow does and fits on
one screen.

**Rate limiting lives in the database.** Route Handlers are serverless, so a
per-instance counter gives an attacker the budget times however many instances
are warm. The check-and-increment is a single statement, so two concurrent
requests cannot both read "under the limit".

---

## Phase 2 — Route Handlers

**Complete.** Typecheck clean, production build clean, 75 new tests passing.

```
frontend/app/api/v1/public/q/[token]/route.ts               GET  context
frontend/app/api/v1/public/q/[token]/sessions/route.ts      POST session
frontend/app/api/v1/public/q/[token]/responses/route.ts     POST response
frontend/app/api/v1/public/q/[token]/google-click/route.ts  POST click
frontend/app/api/v1/public/q/[token]/team-praise/route.ts   POST praise

frontend/lib/server/env.ts                    lazy, validated, server-only
frontend/lib/server/crypto.ts                 AES-256-GCM, keyed digests, tokens
frontend/lib/server/errors.ts                 the one error shape
frontend/lib/server/logger.ts                 structured JSON, recursive redaction
frontend/lib/server/http.ts                   security headers, request id, handler wrapper
frontend/lib/server/validation.ts             Zod, strict schemas
frontend/lib/server/google-review-url.ts      allowlist, matches the client exactly
frontend/lib/server/request-meta.ts           address → keyed fingerprint, never stored
frontend/lib/server/supabase.ts               service-role client
frontend/lib/server/customer-flow-service.ts  the five operations
```

**CORS stopped being a problem rather than being solved.** The API and the
customer page are the same Next application, so the browser makes a same-origin
request and never issues a preflight. The failure that blocked every mutation on
the Express backend — `Idempotency-Key` missing from the allowlist — cannot
occur here.

### Contradictions resolved, as instructed

- **`frontend/package.json` was locked, then explicitly unlocked.** Added
  `@supabase/supabase-js@2.112.2` and `server-only@0.0.1`, both pinned. Nothing
  else in that file changed.
- **Shared server modules live in `frontend/lib/server/`, not under
  `app/api/`.** The brief allowed backend files "inside `frontend/app/api/`".
  Burying shared modules there makes them look like routes; `lib/server/**` is
  unambiguously server-only and every file carries the `server-only` import, so
  an accidental client import is a build error rather than a leaked key.

### Two bugs the tests caught

- **The byte ceiling on notes was unreachable.** 2,000 UTF-16 code units cannot
  exceed 6,000 bytes, so an 8,000-byte cap never fired — dead code pretending to
  be a control. It is now the true worst case, and a test keeps the two limits
  consistent if anyone raises the character limit later.
- **The praise id was generated in the database**, which left a retry with no
  stored body to replay. The application generates it now, like the session and
  response tokens.

---

## Test results

```
npx tsc --noEmit          → exit 0
npx next build            → exit 0, all five routes registered as dynamic
npx vitest run            → 13 files, 129 tests, 129 passed, 0 failed
```

Of those, 75 are new and backend-owned:

| File | Tests | Proves |
|---|---|---|
| `tests/unit/server-foundation.test.ts` | 35 | token entropy, digest domain separation, encryption round-trip and tamper rejection, Google URL parity with the client, canonicalisation, Unicode preservation, log redaction, env validation |
| `tests/unit/public-api-contract.test.ts` | 40 | all five endpoints, identical handling of ratings 1–5, error envelope, indistinguishable 404s, no tenant leakage, idempotency semantics, security headers, rate limiting, CORS |

The 54 pre-existing frontend tests still pass unchanged.

### What these tests do NOT prove

Supabase is mocked. Everything **above** the database is verified; the database's
own half is not:

- idempotent replay actually collapsing duplicates
- two racing requests producing one row
- row level security isolating tenants
- anonymous direct table access being denied
- encryption at rest in the stored row
- one response per session, one praise per response

**BLOCKED — DATABASE TESTS NOT EXECUTED.** No Docker, no `psql`, no Supabase
CLI in this environment. No SQL in this repository has ever run.

---

## Blockers

1. **`git push` has no credentials.** No `credential.helper`, no
   `~/.git-credentials`, no `GITHUB_TOKEN`, no SSH key, no `gh`. Both backend
   branches exist only on this machine. **I cannot create a token — that needs
   the user, in a terminal, and the token must not be pasted into chat.**
2. **No database.** Migrations and RLS remain unverified.
3. **Review gating is reachable on this branch** via the legacy Express app in
   `backend/`. The replacement is not deployed.

### Not deleted: `backend/`

Instructed to delete or ignore it; **ignored**, nothing changed. Not deleted
because it holds the only implementation of these endpoints that has ever run
(`backend/customer-flow-v1`, 260 tests), that branch is unpushed, and deleting
does not make the gate unreachable — deploying the replacement does. Sequence:
push, harvest requirements, cut over, then remove in one reviewed commit.

### Not started: Twilio

The brief says *"Do not add SMS during this assignment"* and *"only after the
five public endpoints are complete."* The endpoints are complete in code but
unverified against a database, so the gate has not opened. Requirements worth
recovering from the legacy implementation when it does: carrier-accurate segment
counting (GSM-7 160/153, UCS-2 70/67), integer-cent money, consent capture,
STOP/HELP handling, suppression checked immediately before each send, quiet
hours in the recipient's timezone, and a durable outbox — Route Handlers have no
long-running worker, which is the open architectural question for that phase.

---

## Next action

1. Push both branches (needs credentials).
2. `supabase init && supabase db reset` against local Postgres, then write and
   run the RLS and idempotency tests in `supabase/tests`.
3. Seed one organization, location, and stand; run the flow end to end.
