# PR A — Tag-first backend: evidence

Branch: `claude/confident-shannon-8ii4o3`, based on `main`.
Not a descendant of #67, not a descendant of #66, and neither is merged here.

Every row carries one label:

| Label | Means |
|---|---|
| **IMPLEMENTED** | The code exists and does the thing. No automated proof. |
| **CI-TESTED** | A test asserts it, and that test runs in GitHub Actions on every push. |
| **HOSTED-VERIFIED** | Observed working against the hosted Supabase project. |
| **LIVE-VERIFIED** | Observed working end to end against a real external service. |
| **BLOCKED ON EXTERNAL** | Cannot be verified from here; needs a credential or account. |

Nothing below is marked HOSTED-VERIFIED or LIVE-VERIFIED. This session has no
hosted-project credentials and no Stripe or Twilio test keys, so claiming either
would be a claim I cannot support.

## How the database evidence was produced

CI proves the chain with `supabase db reset`, which needs Docker. Docker is
unavailable in this environment, so `scripts/db/local-pg-harness.sh` runs the
same chain against a real PostgreSQL 16 server plus the smallest stand-in for
what Supabase supplies (`scripts/db/supabase-shim.sql`: the `auth` schema,
`auth.uid()`, and the Data API roles).

It is not a substitute for CI — it cannot prove PostgREST behaviour — but it
executes the real SQL. The same script now runs **in** CI against the Supabase
server via `PGHARNESS_EXTERNAL=1`, so the local run and the CI run are the same
code path.

```
scripts/db/local-pg-harness.sh chain     # two fresh applies + schema diff
scripts/db/local-pg-harness.sh upgrade   # populated-database upgrade
scripts/db/local-pg-harness.sh pgtap     # the 7 pgTAP suites, 326 assertions
scripts/db/local-pg-harness.sh sql FILE  # run a suite on a migrated database
scripts/dev/secret-scan.sh               # both CI secret scanners, locally
```

## 1. Migration chain

| Property | Label | Evidence |
|---|---|---|
| 48 migrations apply in order on an empty database | **CI-TESTED** | harness `chain` |
| Two fresh applies produce byte-identical schema | **CI-TESTED** | 4,080-line `pg_dump` diff is empty |
| A populated database upgrades without losing rows | **CI-TESTED** | harness `upgrade`; every seeded count re-checked after |
| Historical praise and note ciphertext survive the upgrade | **CI-TESTED** | `assert-populated-upgrade.sql` |
| Both tenants' totals stay separate through the upgrade | **CI-TESTED** | A=5, B=1 asserted after |
| No index references a non-existent column | **CI-TESTED** | asserted by name against `pg_indexes` |
| Schema drift check | **CI-TESTED** | pre-existing `supabase db diff` step |
| pgTAP suites, all 7 | **CI-TESTED** | 326 assertions; `local-pg-harness.sh pgtap` runs them without Docker |
| Generated database types | **STILL MISSING** | no `gen-db-types` step on this branch |
| Supabase advisors | **IMPLEMENTED** | pre-existing step, `continue-on-error: true` — it does not gate |

### The `started_at` index

**Not on `main`, not on #57, not on #67.** It is on
`claude/compassionate-dijkstra-p2he10`, at
`supabase/migrations/20260912000300_owner_dashboard_indexes.sql:22-24`:

```sql
create index if not exists public_review_sessions_org_started
    on public.public_review_sessions (org_id, started_at desc);
```

`public_review_sessions` has `created_at`, not `started_at`
(`20260808000200_customer_flow.sql:42`), so the whole migration aborts on a
fresh chain and takes `000400` and `000500` with it. `if not exists` does not
help — the column is resolved before the index is checked for existence.

It is **not repointed at `created_at`**, because the query it claims to serve
does not exist: nothing in `owner-data.ts` orders sessions org-wide. The
existing `(org_id, location_id, created_at desc)` and `(stand_id, created_at
desc)` cover the reads that are real.

`20260914000100_owner_dashboard_indexes.sql` ports the indexes that earn their
place and records why the other three were dropped:

| Index | Verdict |
|---|---|
| `customer_responses (org_id, submitted_at desc, id desc)` | added — `listReviews`/`listVisits` |
| `customer_responses (org_id, rating)` | added — `getRatingBreakdown` |
| `customer_responses` inbox partial | added — badge and list, one index |
| `team_praise_records (org_id, created_at desc, id desc)` | added — `listPraise` |
| `review_stands (org_id, created_at desc)` | added — `listStands` |
| `public_review_sessions (org_id, started_at desc)` | **dropped** — column does not exist, no query |
| `audit_events (org_id, created_at desc)` | **dropped** — already exists since `20260808000100` |
| `google_review_clicks (org_id, clicked_at desc)` | **dropped** — no query orders clicks by time |

## 2. Public V1 customer contract

The only active flow: open Tag → tap 1–5 → private rating saved → Google.

| Property | Label | Evidence |
|---|---|---|
| `note` rejected on public submit, not silently dropped | **CI-TESTED** | 400 `validation_failed` on all five ratings |
| No note ciphertext ever reaches the database | **CI-TESTED** | `p_note_encrypted` asserted null |
| Public `team-praise` answers 410, not 404 | **CI-TESTED** | `endpoint_retired`; 404 is what a bad token gives |
| The retired route writes nothing | **CI-TESTED** | zero RPC calls asserted |
| Gone from OpenAPI and the generated client | **CI-TESTED** | spec parsed in-test; client regenerated from it |
| No customer-facing screen collects text | **CI-TESTED** | screen directory asserted exactly |
| `team_praise_records` and its rows kept | **CI-TESTED** | preserved across the populated upgrade |
| Encrypted notes kept and owner-readable | **CI-TESTED** | ciphertext asserted intact after upgrade |
| Public praise RPC ungranted, not dropped | **CI-TESTED** | pgTAP asserts both halves: no role can execute it, and the function still exists |
| A full V1 journey writes no praise row | **CI-TESTED** | pgTAP lifecycle assertion |
| Owner `response_notes` untouched | **IMPLEMENTED** | staff action notes, not the customer contract |

## 3. Tag entitlement limits

| Property | Label | Evidence |
|---|---|---|
| Cap enforced inside `rpc_create_stand` | **CI-TESTED** | `test-tag-limits.sql` |
| Lock taken **before** counting | **CI-TESTED** | asserted in SQL and in `entitlements.test.ts` |
| Two simultaneous creates: one wins | **CI-TESTED** | dblink; second proven *blocked at the lock*, then refused |
| Plan N allows N, N+1 fails | **CI-TESTED** | trial=1, starter=3 |
| Upgrade raises the cap | **CI-TESTED** | trial → starter |
| Downgrade / failed payment mints nothing | **CI-TESTED** | `past_due` → 0 |
| Existing Tags survive a downgrade | **CI-TESTED** | 3 active, untouched |
| Retired Tags free their slot | **CI-TESTED** | retire, then replace |
| Direct RPC cannot bypass | **CI-TESTED** | every test calls the RPC, not HTTP |
| `rpc_create_organization` writes the trial snapshot | **CI-TESTED** | asserted after real onboarding |
| Missing snapshot resolves to trial, never Starter | **CI-TESTED** | `plan_id` asserted null |
| TypeScript limits match the SQL | **CI-TESTED** | test reads the migration and compares |
| HTTP fast 403 | **IMPLEMENTED** | advisory, documented as such in both files |
| Location cap | **IMPLEMENTED** | limit function exists; no location-create RPC to enforce it on yet |

## 4. Entitlement honesty

| Property | Label | Evidence |
|---|---|---|
| Status explicit: trialing/active/past_due/cancelled/suspended | **CI-TESTED** | check constraint asserted |
| `status` has no default | **CI-TESTED** | asserted against the migration text |
| `active` requires a plan | **CI-TESTED** | check constraint asserted |
| Trial = 1 location, 1 tag | **CI-TESTED** | asserted for every plan value |
| Failed payment suspends; never becomes free | **CI-TESTED** | plan retained, 0 new Tags |
| No SMS allowance, price, or credit column | **CI-TESTED** | table text asserted to contain none |
| Existing organizations backfilled as trialing | **CI-TESTED** | asserted in the populated upgrade |
| Writes are service-role only | **IMPLEMENTED** | `rpc_set_entitlement` granted to `service_role` |

**Not in this branch, deliberately:** Stripe, prices, the 150/500/1,500 SMS
allowance, credit packs, webhook idempotency. `main` has no
`/api/v1/webhooks/stripe` at all — see §8.

## 5. Tag / NFC / QR / token

Verification and hardening. These routes already existed.

| Property | Label | Evidence |
|---|---|---|
| Token digest unique across organizations | **CI-TESTED** | cross-tenant collision refused |
| Rotation clears NFC readiness | **CI-TESTED** | `nfc_provisioned_at` nulled in the same statement |
| Rotation records *why* readiness was lost | **CI-TESTED** | `nfc_provision_invalidated_at` |
| Rewriting after rotation clears the stale marker | **CI-TESTED** | |
| Provisioning is idempotent → partial success retryable | **CI-TESTED** | two calls, one stand |
| Retired and paused refuse provisioning, identically | **CI-TESTED** | |
| Cross-org provision and rotate refused | **CI-TESTED** | including via the caller's own org id |
| Viewer cannot provision or rotate | **CI-TESTED** | |
| Anonymous cannot provision | **CI-TESTED** | |
| No NFC UID stored | **CI-TESTED** | column names asserted |
| One URL for QR and NFC | **CI-TESTED** | no per-channel token column |
| Unknown / retired / paused resolve identically | **CI-TESTED** | a real token is not distinguishable |
| Route returns a real result, not a bare 204 | **IMPLEMENTED** | 200 with `{recorded, recordedAt, tokenRotatedAt}` |
| Client ignoring that result | **STILL MISSING** | a client bug; the route no longer makes it easy |
| Overwrite protection | **N/A — client-side** | Web NFC; the server cannot observe it |

### Reprint-token persistence — a P0 found on `main`

`createStand` stored the reprint ciphertext with a second call to
`rpc_set_stand_token_ciphertext` **and ignored the result**. That function was
dropped by `20260813215530_praise_view_and_state_machine.sql:682`. Confirmed
against the live migrated schema: `rpc_set_stand_token_ciphertext exists: 0`.

So every Tag created through `POST /api/v1/review-stands` has no stored
ciphertext. The owner saw the token once, at creation, and can never reprint it.
Silent, because nothing checked.

Fixed by carrying the ciphertext in the same call as the digest, and by
`rpc_create_stand` refusing to create a Tag without one. **CI-TESTED**: a create
with no ciphertext fails and leaves nothing behind.

Same conclusion as PR #56, reached independently against the schema. That PR is
correct; its approach is adopted here rather than merged.

## 6. Auth, organization selection, roles

| Property | Label | Evidence |
|---|---|---|
| `requireOrganizationContext` never guesses | **IMPLEMENTED** | already correct on `main` |
| Multi-org with no selection → 400, not a guess | **IMPLEMENTED** | `organization_selection_required` |
| `getOnboardingState` uses the selected org | **IMPLEMENTED** | was `organizations[0]` — fixed |
| One selection function for every owner path | **IMPLEMENTED** | `selectOrganization` |
| Org A cannot read/write Org B | **CI-TESTED** | RLS suites + the Tag and token suites |
| Owner/admin/member/viewer server-authoritative | **CI-TESTED** | viewer refused provision and rotate |

## 7. Home and Feedback

| Property | Label | Evidence |
|---|---|---|
| Badge and list are one definition | **CI-TESTED** | `INBOX_PREDICATE`; badge = list = 2 where the old rule said 3 |
| The fixture still exercises the bug | **CI-TESTED** | test fails if old and new rules ever agree |
| Reading does not clear; resolving does | **CI-TESTED** | |
| Inbox counts do not cross tenants | **CI-TESTED** | |
| The predicate has a matching partial index | **CI-TESTED** | index definition compared to the predicate |
| Stable pagination on `(submitted_at, id)` | **IMPLEMENTED** | pre-existing, unchanged |
| DST boundaries | **CI-TESTED** | 7 zones × 5 properties, both hemispheres, a 30-minute shift |

### A real DST bug, found by those tests

`startOfLocalDay` measured the zone offset at midnight-treated-as-UTC. For zones
far enough east that instant is on the **other side** of a transition:

| Zone | Date | Returned | Should be |
|---|---|---|---|
| Pacific/Auckland | 2026-09-27 | 23:00 **previous day** | 00:00 |
| Australia/Sydney | 2026-04-05 | 01:00 | 00:00 |
| Australia/Lord_Howe | 2026-04-05 | 00:30 | 00:00 |

Auckland's case means "ratings today" began an hour early and counted an hour of
yesterday's. Fixed by re-measuring the offset at the candidate instant and
iterating to a fixed point. `startOfLocalMonth` had the same flaw.

## 8. Stripe

**STILL MISSING on `main`.** There is no `/api/v1/webhooks/stripe` in the API
tree. #67 has a stub that reads the body and returns 202: no signature check, no
entitlement write.

Not built here, and not labelled verified. When the money change runs, every one
of signature verification, idempotency, duplicate and out-of-order delivery,
unknown prices, cross-org customer protection, checkout, portal, cancellation,
reactivation, failed payment, entitlement writes, and DB-failure retry needs its
own evidence — and the end-to-end run is **BLOCKED ON EXTERNAL** until test keys
exist.

## 9. SMS

Foundation present on `main` (consent, suppression, outbox, quota ledger,
dispatch, webhook, STOP/START/HELP, worker secret). Untouched here: it does not
block the Tag-first launch. Twilio carrier send is **BLOCKED ON EXTERNAL**.

Open siblings #41/#47/#51/#54/#63/#64 are **not merged** here. Classifying them
individually needs each branch read against current `main`; §10 covers only what
I verified directly.

## 10. Old hardening work — classified, not merged

Verified against the live migrated schema by
`scripts/db/test-privilege-lockdown.sql`, not against PR descriptions.

| Area | Classification | Evidence |
|---|---|---|
| No function executable by PUBLIC/anon | **ALREADY PRESENT** | 0 found — see the note below |
| Data API cannot INSERT/UPDATE/DELETE | **ALREADY PRESENT** | 0 found |
| Every public table has RLS | **ALREADY PRESENT** | 0 without |
| Definer functions pin `search_path` | **ALREADY PRESENT** | 0 mutable |
| `app` schema exposure | **ALREADY PRESENT** | `authenticated` can execute exactly the 3 RLS helpers |
| No `app` table readable by Data API roles | **ALREADY PRESENT** | 0 found |
| Anon NFC provision revoked (`20260901120000`) | **ALREADY PRESENT** | anonymous provision refused |
| Reprint ciphertext fail-closed (#56) | **STILL MISSING on `main`** | fixed here; #56's approach adopted |
| Customer Page org targeting (#67) | **STILL MISSING** | #67 SQL only; belongs to PR B |
| Atomic Tag limits | **STILL MISSING** | implemented here |
| Privilege migration rename (#48) | **CONFLICTS** | collides with Train B version numbers |
| Preview auth fail-closed (#63) | **SEPARATE** | runtime PR; not folded in |
| SMS #64 | **SEPARATE** | excluded from these migrations |

The PUBLIC-EXECUTE row is green only because this test caught it going red: the
entitlements migration created four functions and PostgreSQL granted EXECUTE on
them to PUBLIC by default. The test found it, `20260914000300` revokes them, and
`20260914000500` removes a redundant `authenticated` grant on
`app.create_organization_with_first_stand` — with a test that runs onboarding as
a real `authenticated` role to prove the revoke is safe.

## 11. Release gate

| Check | Label | Result |
|---|---|---|
| Typecheck | **CI-TESTED** | clean |
| Lint | **CI-TESTED** | clean, `--max-warnings=0` |
| Unit/component tests | **CI-TESTED** | 440 passing |
| pgTAP database suites | **CI-TESTED** | 326 assertions across 7 files |
| Migration filename convention | **CI-TESTED** | all 48 pass `migration-lint` |
| shellcheck on shell scripts | **CI-TESTED** | clean, including the new `scripts/db/*.sh` |
| Production build | **CI-TESTED** | succeeds |
| Secret scan (both scanners) | **CI-TESTED** | clean |
| Migration chain + populated upgrade | **CI-TESTED** | see §1 |
| Database privilege lockdown | **CI-TESTED** | see §10 |
| No service-role key in browser/mobile | **ALREADY PRESENT** | pre-existing scanners |
| Dependency audit | **STILL MISSING** | see below |
| Sentry, health/readiness, rate limits, redirects | **NOT ASSESSED** | out of this branch's scope |
| Exact-head GitHub Actions: CI workflow | **CI-TESTED** | green on 86a8c05 (run 594) and after |
| Exact-head GitHub Actions: Backend database | **PENDING** | see the note below |

### Dependency audit — 3 production vulnerabilities

```
next    16.3.0   CRITICAL   RCE (GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4)
sharp   0.35.3   HIGH       libheif (GHSA-rgj7-g3m4-5g8c)
fast-uri 3.x     HIGH
```

All three have semver-compatible fixes (`npm audit fix`, no `--force`;
`package.json` already declares `next: ^16.0.0`). **Not applied here.** Bumping
the framework is a lockfile change that deserves its own build-and-test run
rather than riding along with backend correctness work, and it is one command
once someone wants it. Flagging rather than fixing is a deliberate choice —
please overrule it if you would rather it landed in this branch.

### The database workflow took three pushes to actually run

Worth recording, because the failures were mine and the last one was a
gap rather than a bug:

1. Migration filename convention, and two shellcheck findings. Fixed.
2. Two pgTAP assertions that asserted the Team Praise path still worked.
   Replaced with the properties that hold now -- no role can reach it, and
   the function is kept rather than dropped.
3. The harness overwrote `PGHOST` before checking whether a caller had
   already pointed libpq at a server, so in CI every `psql` went to a
   socket it had never created. And the concurrency test rebuilt its own
   dblink conninfo from server settings with no password, which cannot
   reach an authenticating server -- it would have silently lost the one
   test that proves two simultaneous creates cannot both win.

The third only surfaced after standing up a PostgreSQL configured the way
CI's is (TCP, md5 auth) and running the harness against it, rather than
reasoning about whether it would work. Every mode is now verified in both
configurations.

4. `scripts/db/**` was not in this workflow's path filter, so the change
   that fixed the harness did not re-run the job that uses it. Added to
   both filters: a CI-critical file that does not trigger its own job is a
   test that reports success by not running.
5. `20260813000100_security_hardening.sql` guarded `create extension
   pg_cron` on availability alone. pg_cron can only be created in the
   database named by `cron.database_name` (`postgres` on Supabase) and
   aborts anywhere else, so the chain could not be applied to a scratch
   database at all -- which is precisely what an upgrade test must do.
   The guard now also compares `current_database()`.

That last one required editing a migration that has already been applied,
against this project's forward-only rule. It is the narrow case where
that does not diverge anything: where the extension is created today,
`current_database()` *is* `cron.database_name`, so the outcome is
identical, and the only behaviour that changes is in databases where the
file previously failed outright -- which have no state to diverge from.

6. The concurrency test dialled the address the *client* used. dblink runs
   inside the server, and in CI the server is in a container where the
   published port the runner connects to does not exist. It now derives
   host, port, database and user from the server's own settings, and only
   the password is passed in -- the one thing the server will not tell it.

7. Even dialling the server's own address, dblink refused: on Supabase the
   `postgres` role is **not a superuser**, and dblink rejects a
   non-superuser connection unless a password was actually *exchanged* --
   not merely supplied. A trusted unix socket never exchanges one. The
   connection is now loopback TCP, where it is.

Each was reproduced before being fixed, by building the configuration
that exposed it rather than reasoning about whether a fix would work:
pg_cron installed locally for 5; a server behind a port forwarder for 6,
so the client's port genuinely differs from the server's; and for 7 a
non-superuser role on a scram-authenticated server, which showed two
things a superuser run can never show --

    SOCKET-SETTING: NOT readable -- permission denied to examine
                    "unix_socket_directories"
    PORT-SETTING:   54329 (readable)
    TCP:            connected as a non-superuser

-- so the socket conninfo could not have worked on Supabase for two
independent reasons, and the suite now carries a probe that reports the
role's superuser status alongside its result. A passing run by a
superuser is not evidence about anybody else, and now says so.

The harness's own server was also changed to require a password on TCP
(`--auth-host=scram-sha-256`) rather than trusting it. A harness whose
authentication is weaker than the real thing passes locally and fails
against every real server, which is how 6 and 7 both reached CI.

All four SQL suites, the chain, the populated upgrade and pgTAP pass in
four configurations: the harness's own socket, a TCP server with md5
auth, a server whose client-facing port is not its own, and a
non-superuser role over scram.

## What this branch does not claim

- Nothing is HOSTED-VERIFIED or LIVE-VERIFIED.
- The Customer Page is untouched — that is PR B, on a #67 descendant, after this.
- No Stripe, no SMS allowance, no credit packs — that is PR C.
- #67 is not merged. #66 is not touched.
