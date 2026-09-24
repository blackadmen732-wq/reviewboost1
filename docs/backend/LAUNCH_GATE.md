# Backend launch gate

The single place that says whether the backend may take paying customers, and
what is still between it and that. Every row carries one state and the
evidence for it. Nothing here is "done" because it compiles.

| State | Meaning |
|---|---|
| IMPLEMENTED | Code exists at the branch head |
| TESTED | An automated test performs it and passes locally and in CI |
| STAGING VERIFIED | Exercised against a hosted non-production environment |
| LIVE VERIFIED | Exercised against production with the real provider |
| BLOCKED | Cannot proceed without something outside the repository |
| FAILED | Checked, and it does not hold |

**Where this was produced.** A cloud session with the repository, GitHub, a
local PostgreSQL 16 + pgTAP, and the Supabase CLI 2.117.0. Its network policy
refuses `*.supabase.co`, `api.supabase.com`, `api.vercel.com`, `api.stripe.com`,
`api.twilio.com` and `reviewboost.fit`, and no Supabase or Vercel connector or
credential was attached. **Nothing below is STAGING VERIFIED or LIVE VERIFIED.**
Hosted facts are the last recorded ones and are marked as such.

## 1. Source of truth

| Fact | Value | Evidence |
|---|---|---|
| Canonical PR | blackadmen732-wq/reviewboost1#67, `cursor/sprint-forge-owner-systems-v15-7042` | open, unmerged |
| PR #67 head | `e1701801190dc478c90c04e0a775ed1630d4c086` | unchanged since 2026-09-17; all 24 checks green on it |
| vs `main` | 57 ahead, 0 behind; `main` (`0155948`) is an ancestor | `git rev-list --left-right --count` |
| This work | `claude/festive-thompson-i28bpq` = PR #67 head + the commits listed in §8 | fast-forward of #67; no replacement integration branch |
| Other open PRs | blackadmen732-wq/reviewboost1#73 (SMS pricing engine), blackadmen732-wq/reviewboost1#74 (customer import) — both based on an older `main`, neither in #67 | GitHub |
| Repo migrations | **62** (59 on #67 + 3 added here) | `supabase/migrations` |
| Hosted ledger | **36 recorded — last known, NOT re-read** (egress blocked) | docs/backend/ENVIRONMENT.md "Migration History Repair"; prior audit |
| Hosted project ref | `zoyqikgqfqulwkihjbev` | docs/backend/ENVIRONMENT.md |
| Vercel state | **unknown in this session** (API and deployments unreachable). `frontend/vercel.json` crons are once-daily (Hobby floor) | file |

## 2. Migration reconciliation

### The divergence (last known)

The hosted ledger holds the repo's first 36 migrations, through
`20260901213000_restore_rpc_create_organization_definer`, with two recorded
under server-generated versions:

| Repo file | Hosted ledger version |
|---|---|
| `20260831000100_nfc_provisioning.sql` | `20260901112609` |
| `20260901120000_revoke_anon_nfc_provision.sql` | `20260901163415` |

26 repo migrations are not on hosted: `20260902000100` … `20260917000100`
(Text Requests ×7, dashboard indexes, destinations ×3, entitlements, caps,
Customer Page, billing, SMS two-source ledger, balance read, reconciliation,
Stripe retry, trial-requires-checkout, ledger carry-over, setup-before-checkout,
account deletion) and the three added here (`20260924000100` price authority,
`…0200` worker heartbeats, `…0300` billing customer lookup).

### What is proven locally (TESTED)

| Proof | Result | Command |
|---|---|---|
| Empty → head | 62 applied | `scripts/backend/local-postgres.sh reset` |
| pgTAP | 16 suites, 622 assertions | `… test` |
| **Hosted schema (36) + data → head** | 36 + 26 applied, **30/30** | `… upgrade 20260901213000 hosted` |
| Pre-destination (44) + SMS ledger data → head | 30/30 | `… upgrade 20260902000800 populated` |
| Duplicate apply of the renamed NFC migration | fails on its first statement (`column … already exists`), so in `db push`'s per-migration transaction nothing is half-applied | manual re-run on a head DB |
| Supabase security advisor on head | 0 ERROR; 10 INFO `rls_enabled_no_policy` (all intentional service-only tables) | `supabase db advisors --db-url … --type security` |
| Performance advisor on head | 1 WARN (`profiles` has two permissive SELECT policies), 30 INFO unindexed FKs, 45 INFO unused indexes (meaningless on an empty DB) | `--type performance` |
| CI | the upgrade proofs, pgTAP, the real `supabase db reset` + blocking security advisor all run on every push touching `supabase/**` | `.github/workflows/backend-database.yml` |

The hosted proof asserts: nothing lost (orgs, members, locations, Tags,
sessions, ratings, encrypted notes verbatim, Team Praise, audit), Google clicks
moved to `destination_selections` with original timestamps, valid legacy URLs
adopted and invalid ones not, **a Tag printed before the upgrade still resolves**,
no subscription or SMS credit minted, the price map empty, and an owner still
sees exactly one organization.

### Not proven, and why

* The hosted database's *actual* schema was not diffed against the 36-migration
  build (no access). The proof assumes nobody changed hosted outside
  migrations. Step 3 below checks that before anything is applied.
* The hosted *data* was not sampled. The fixture is realistic, not real.

### The production forward path (run by someone with access)

Never `apply_migration` through MCP (it re-stamps versions), never a raw ledger
`UPDATE`, never a reset.

1. **Backup.** Confirm a fresh automated backup (or take a logical dump:
   `supabase db dump --linked -f pre-launch-schema.sql` and
   `supabase db dump --linked --data-only -f pre-launch-data.sql`), stored
   outside Supabase. Record the time.
2. **Staging first.** Create a staging project, restore the production dump
   into it (or `db push` the first 36 and load a scrubbed copy), then run steps
   3–7 there. Nothing below touches production until staging is green.
3. **Drift check.** `supabase link --project-ref <ref>` then
   `supabase db diff --linked --schema public,app` against a local database
   built to `20260901213000` (`local-postgres.sh reset 20260901213000`). An
   empty diff means hosted is the schema the proof started from. A non-empty
   diff stops the release until explained.
4. **Ledger repair (ledger only, runs no SQL):**
   ```bash
   supabase migration repair --status reverted 20260901112609 20260901163415
   supabase migration repair --status applied  20260831000100 20260901120000
   supabase migration list --linked   # 36 local = 36 remote, 26 local-only
   ```
5. **Dry run:** `supabase db push --linked --dry-run` must list exactly the 26
   pending files above, in order, and nothing else.
6. **Apply:** `supabase db push --linked`. Each migration is its own
   transaction; a failure stops at that migration with earlier ones committed.
   Every one of the 26 was proven to apply on top of the previous, so a failure
   here means hosted differs from the proof — stop and diff, do not patch.
7. **Verify:** `supabase migration list --linked` (62 = 62);
   `supabase db advisors --linked --type security --fail-on error`;
   seed `billing_plan_prices` (§4); then the readiness gate (§5).

### The launch decision this upgrade forces — the trial cliff

`20260915000400_entitlements` + `20260915001200_trial_requires_checkout` make
every organization that exists at migration time `trialing` with **no plan and
a trial ending 7 days after the migration**. After that plus one day of grace,
a business that has not checked out is `suspended` and **its printed Tags stop
opening**. This is asserted in `hosted_upgrade_test.sql` §5 so it cannot be
missed. Whether live businesses should instead be grandfathered (a longer
trial, or a manual entitlement) is a business decision; if so it needs a
forward migration before step 6, not an edit.

## 3. Truth matrix

| Area | State | Evidence / what is missing |
|---|---|---|
| One canonical head, CI green at it | TESTED for #67 head; this branch's head: see CI on the latest commit | GitHub checks |
| Hosted migration history reconciled | **BLOCKED** — plan in §2; needs Supabase access | |
| Hosted schema matches application | **BLOCKED** — step 3 drift check | |
| Populated production-style upgrade | TESTED (hosted-schema fixture) | `supabase/upgrade/hosted_*` |
| Tenant isolation | TESTED | `cross_org_isolation_test.sql`, `praise_isolation_test.sql`, `column_security_test.sql`, `privilege_surface_test.sql` |
| Concurrency | TESTED at the database (SKIP LOCKED leases, idempotent grants: 50× invoice redelivery = one grant, inbox row locks) | `billing_sms_credit_test.sql`, `text_requests_test.sql`. No parallel-session race test beyond these |
| Stripe price → plan authority | TESTED | `stripe_price_authority_test.sql` (54), `billing.test.ts` |
| Unknown price fails closed, visibly, retryably | TESTED | same; `billing.price_unmapped` log event |
| Production config gate | TESTED | `lib/server/readiness.ts`, `readiness.test.ts` (41), `/api/v1/internal/readiness`, `scripts/release/check-readiness.mjs` |
| Independent encryption and digest keys in production | TESTED | `readiness.test.ts` "key separation" |
| Fake SMS impossible in production; real SMS impossible in preview | TESTED | `readiness.test.ts` "no fake SMS" |
| Scheduler cadence (1 min / 15 min) | **BLOCKED** — `vercel.json` is once-daily; per-minute needs Vercel Pro or an external scheduler (owner decision). Missed runs are now *detected*: TESTED | `worker_heartbeats`, `scheduler-health.test.ts` |
| Backlog drain after downtime | IMPLEMENTED + TESTED (drain loop, 20×25 per invocation); rate **not measured** on real infrastructure | |
| Real Stripe test-mode flow | **BLOCKED** — no Stripe credentials or egress | §6 script |
| Real Twilio flow | **BLOCKED** — no Twilio account, phone, or egress | §6 script |
| Webhook retry / out-of-order | TESTED at DB and handler; not against Stripe | |
| Monitoring and alerts active | **BLOCKED** — thresholds defined (OPERATIONS.md); no monitor exists yet | |
| Backups active | **BLOCKED** — plan-dependent, unverified | OPERATIONS.md |
| Restore drill | **BLOCKED** — not performed; RPO/RTO undefined until it is | OPERATIONS.md |
| Storage recovery | **BLOCKED** — procedure written, not drilled; bucket not created by any migration | OPERATIONS.md |
| Security advisor findings reviewed | TESTED on local head; hosted advisor **BLOCKED** | SECURITY_REVIEW.md |
| Service-role usage contained | TESTED (static guard) | `service-role-containment.test.ts` |
| Security docs match reality | TESTED for MFA claims | `mfa-claims.test.ts`; SYSTEM_CONTEXT §9 corrected |
| MFA / step-up on sensitive operations | **NOT IMPLEMENTED** — owner decision (§7) | |
| Dependency vulnerabilities (web) | TESTED — 0 prod advisories after upgrading next/sharp/fast-uri; CI blocks on high | `ci.yml` dependency-audit |
| Dependency vulnerabilities (mobile) | **FAILED** — 7 high in production deps; reported, not blocking | `npm audit --omit=dev` in `apps/mobile` |
| Load tests | **BLOCKED** — need a staging deployment; not performed | SCALING.md |
| Production smoke-test runbook | IMPLEMENTED | §5 |

**The backend is not production-ready.** Every BLOCKED row above is
launch-critical and needs hosted access, a provider account, or an owner
decision.

## 4. Per-environment setup (production and staging)

1. Environment variables: every one `readiness.ts` checks. The gate names any
   that are missing or malformed; values are never printed.
2. **Price map** (each environment, its own Stripe mode's prices):
   ```sql
   insert into public.billing_plan_prices (stripe_price_id, plan_id) values
     ('price_…', 'starter'), ('price_…', 'growth'), ('price_…', 'pro')
   on conflict (stripe_price_id) do update set plan_id = excluded.plan_id;
   ```
   A grandfathered price stays in the table with its plan. Removing a price
   stops new grants on it; cancellations still revoke.
3. **Storage:** create public bucket `customer-page`.
4. **Digest key.** Production requires `TOKEN_DIGEST_KEY` ≠
   `CUSTOMER_NOTE_ENCRYPTION_KEY` and an explicit `TOKEN_DIGEST_KEY_VERSION`.
   If production ever ran on the old fallback and Tags are printed, move off it
   by rotation — do not just set a new key, or every printed Tag stops
   resolving:
   `TOKEN_DIGEST_KEY_PREVIOUS` = the current `CUSTOMER_NOTE_ENCRYPTION_KEY`,
   `TOKEN_DIGEST_KEY` = new `openssl rand -base64 32`,
   `TOKEN_DIGEST_KEY_VERSION` = previous version + 1. Tags upgrade as scanned
   (`public_token_key_version`); remove the previous key when none remain.
5. **Scheduler:** Vercel Pro with
   `* * * * *` / `*/15 * * * *` in `frontend/vercel.json`, or an external
   scheduler hitting both URLs with `Authorization: Bearer $CRON_SECRET`
   (docs/SCHEDULING.md). Vercel only runs crons for production deployments,
   so previews never dispatch.
6. Supabase Auth: settings in docs/backend/ENVIRONMENT.md
   ("Hosted Supabase Auth").

## 5. Release procedure

Schema compatibility is a release property: **the database moves first, and
an application build is only promoted onto a database that already has its
schema.** The readiness gate enforces the last part mechanically
(`rpc_billing_price_catalog` exists only from `20260924000100`).

1. Canonical branch green at its exact head (both workflows).
2. Staging: backup → migrate (§2 steps 3–7) → deploy the same commit →
   `check-readiness.mjs` against staging → smoke tests (below).
3. Production backup verified and timestamped.
4. Production migration (§2 steps 3–7). Every migration here is additive or
   re-emits functions compatibly, **except** `20260924000100`, which replaces
   `rpc_billing_apply_invoice_paid`'s third argument: between it and the new
   build, `invoice.paid` events fail and Stripe retries them (delayed, not
   lost). Deploy the build promptly after.
5. Deploy the build **without assigning the production domain** (disable
   "auto-assign custom production domains" in Vercel, or
   `vercel deploy --prod --skip-domain`).
6. `READINESS_URL=<candidate URL> WORKER_SECRET=… node scripts/release/check-readiness.mjs`
   must exit 0. Otherwise the candidate is never promoted.
7. `vercel promote <candidate>`.
8. Smoke tests against production, then watch health for 30 minutes.
9. Rollback: application — `vercel rollback` to the previous deployment (the
   previous build is schema-compatible with every additive migration; for
   `20260924000100` its invoice call fails and retries until rolled forward).
   Database — **forward only**: a corrective migration, never a down-migration
   or a restore over live data unless §OPERATIONS restore criteria are met.

**Smoke tests** (production, with a real test business):
public Tag GET → create session → rating → destination event; owner sign-in
(6-digit OTP); billing page loads the plan from the backend; Checkout opens
(test card only on staging); a Text Request to an owned test phone is queued,
dispatched within 2 minutes, and marked delivered by the Twilio callback;
`/internal/health` 200 with `ok: true`; `/internal/readiness` 200.

## 6. Provider verification scripts (to run with access)

Stripe (test mode, staging): use the Stripe CLI (`stripe listen --forward-to
<staging>/api/v1/webhooks/stripe`) and `stripe trigger` / test clocks for:
checkout with required card → trialing; trial conversion; `invoice.paid` minting
the plan's SMS once; `invoice.payment_failed` → `past_due` → recovery;
upgrade/downgrade in the Portal; cancel-at-period-end; immediate cancel;
deletion; re-subscribe; `stripe events resend` for duplicates; an event
replayed after a newer one (stale); an unmapped price (expect 500 +
`billing.price_unmapped` + inbox row unprocessed, then map it and resend →
applied); an unknown customer (200, inbox row unprocessed); account deletion
cancelling the subscription first. After each, compare `billing_subscriptions`
and `entitlement_snapshots` with the Stripe dashboard.

Twilio (staging, `APP_ENV=staging`, real test phone): send; status callbacks
(delivered, undelivered); STOP → suppression and no further sends; START;
quiet-hours deferral; segment accounting against Twilio's reported segments;
allowance then purchased credit order; a provider-unknown send reconciled by
maintenance; dead-letter releasing credit.

## 7. Decisions only the owner can make

1. **Trial cliff for existing live businesses** (§2) — accept, or grandfather
   via a forward migration before production migration.
2. **Scheduler** — Vercel Pro, or an external scheduler.
3. **MFA** — build it (TOTP enrollment + server-side `aal2` on billing, member
   administration, organization deletion), or launch without it. The claim has
   been removed either way.
4. **Mobile dependency advisories** — the Expo SDK upgrade before the app ships.
5. **Access for verification** — a Supabase connector or token, Vercel access,
   Stripe test keys and a Twilio test account in a session whose network policy
   allows those hosts.

## 8. What changed on this branch

| Commit | Change |
|---|---|
| Stripe price authority | `billing_plan_prices`; RPCs resolve plan from price; metadata never read; unknown price fails closed and retryable |
| Next.js / sharp / fast-uri | critical RCE advisory (GHSA-2xp9-vwfh-vxw4) and highs fixed |
| Hosted-schema upgrade proof | fixture + 30 assertions; version-based migration markers |
| Privilege surface | pgTAP allowlist of browser-callable definers, grants, RLS, invoker views |
| CI | pinned Supabase CLI, blocking security advisor (was a no-op), upgrade job, blocking prod `npm audit` |
| Readiness gate | deployment tier, key separation, no fake SMS in production, live checks, promotion script |
| Scheduler | heartbeats, stale/failing detection, 503 health, drain loop |
| Service role | last table read moved to an RPC; two needless bypasses removed; static guard |
| Claims | TOTP/lockout claims corrected; MFA-claim guard |
| Logs | PostgREST `details` and phone numbers kept out |
