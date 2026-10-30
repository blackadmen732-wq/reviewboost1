# Production migration plan — `reviewboost` (`zoyqikgqfqulwkihjbev`)

Status: **proposed, not approved. Nothing here has been run against production.** See §0 for the gates.
Audited 2026-09-26 against PR #67 (`cursor/sprint-forge-owner-systems-v15-7042`).

## 0. Gates before any production migration (owner's decision, 2026-09-26)

Production stays untouched until every gate is closed:

1. Backend CI fully green on PR #67's head.
2. Stripe production configuration verified, including a real checkout.
3. Twilio may stay disabled if Text Requests are not launching yet, but the app
   must fail closed cleanly without it.
4. A same-day Supabase backup or PITR confirmed.
5. Decide whether the two existing orgs, **`ck`** and **`Min Corner`** (no
   Google link, no customer responses), are test orgs or real pilot businesses.
6. Then finalize their entitlement treatment.

**Do not start their 7-day entitlement clock.** As written, #12 and #20 below
give every existing org `trialing` with `trial_ends_at = now() + 7 days` at
the moment of the push. That must be replaced before the push by whichever
treatment gate 6 settles on. If they are test orgs, no paid subscription is
invented for them: they are reset/deleted later, or given an explicit,
controlled prelaunch grace period.

## 1. Where production is

- Last applied migration: `20260902004620 restore_rpc_create_organization_definer`.
- 36 migrations applied. 34 have content identical to the repo file at the same
  version (hashed with comments and whitespace removed).
- Three were applied through the dashboard/MCP under **different version numbers**
  than the repo uses. Their content is the same; only the version differs, and
  two of them also lack the repo file's `begin;`/`commit;` wrapper:

  | Production version | Repo version | Name | Content |
  |---|---|---|---|
  | 20260901112609 | 20260831000100 | nfc_provisioning | identical |
  | 20260901163415 | 20260901120000 | revoke_anon_nfc_provision | identical apart from begin/commit |
  | 20260902004620 | 20260901213000 | restore_rpc_create_organization_definer | identical apart from begin/commit |

  Because of this, a plain `supabase db push` **refuses to run**
  ("Remote migration versions not found in local migrations directory").
  Verified in rehearsal.
- **No out-of-band schema drift.** A fingerprint of production's `public` and `app`
  schemas matches a clean database built from the repo's first 36 migrations
  exactly: 160 columns, 83 constraints, 54 functions (bodies, security definer,
  search_path and grants), 26 policies, 16 relations (with RLS and grants),
  7 triggers, 2 pg_cron jobs.
- Data in production: 2 organizations (active), 2 owners, 2 locations (neither
  has a Google link), 2 active printable-QR Tags, 0 customer responses,
  0 review sessions, 0 Google clicks, 2 audit events, 3 auth users,
  0 Storage buckets.
- Extensions present: pgcrypto, pg_cron, uuid-ossp, supabase_vault,
  pg_stat_statements. The pending migrations need nothing new.

## 2. What is missing, in order

24 migrations: 23 already in the repo, plus the new bucket migration from PR #67.
"Destructive" means it drops, renames or rewrites existing objects or rows.

| # | Migration | What it changes | Destructive? | Assumes something production lacks? |
|---|---|---|---|---|
| 1 | 20260902000100 text_requests_consent | New enums + `sms_consent_events`, `sms_consent_state` (RLS on) and consent functions | No | No |
| 2 | 20260902000200 text_requests_suppression | New `sms_suppressions`, `sms_phone_optout`, pre-send gate | No | No |
| 3 | 20260902000300 text_requests_core | New `text_requests`, `sms_delivery_attempts` | No | No |
| 4 | 20260902000400 text_requests_outbox | New `sms_outbox`, `sms_webhook_inbox` | No | No |
| 5 | 20260902000500 text_requests_quota | New `sms_quota_ledger`, `sms_quota_balance` | No | No |
| 6 | 20260902000600 text_requests_pipeline | Send-lifecycle functions over #1–5 | No | No |
| 7 | 20260902000700 text_requests_service_rpcs | `public.rpc_sms_*` wrappers, service_role only | No | No |
| 8 | 20260902000800 dashboard_indexes | Org-wide indexes on responses/sessions | No (indexes on near-empty tables) | No |
| 9 | 20260915000100 destination_persistence | Adds `locations.destination_provider/url` + 2 checks; backfills from valid `google_review_url`; sync trigger; recreates the public resolver | Replaces constraints/functions; **backfill is a no-op here** (no location has a URL) | No |
| 10 | 20260915000200 destination_selection_events | **Renames `google_review_clicks` → `destination_selections`**, renames `clicked_at` → `selected_at`, adds NOT NULL `provider` (backfilled 'google'), renames constraints/index/policy | **Yes, renames.** 0 rows in production, so no data at risk; anything still reading the old name breaks | No |
| 11 | 20260915000300 owner_destination_write | Owner RPC for the destination; writes both columns | No | No |
| 12 | 20260915000400 entitlements | New `entitlement_snapshots`; **backfills every existing org as `trialing`** (no plan); creation trigger; public resolver now requires an entitlement that allows service | Changes access rules | No |
| 13 | 20260915000500 tag_and_location_caps | Recreates `rpc_create_stand` / location RPCs with plan caps | Replaces functions | No |
| 14 | 20260915000600 customer_page | New enums + `customer_page_assets`, `customer_page_profiles`, RPCs; public resolver returns the published page | Replaces resolver functions | No |
| 15 | 20260915000700 billing | New `billing_customers`, `billing_subscriptions`, `stripe_webhook_events`; webhook apply functions | No | No |
| 16 | 20260915000800 sms_two_source_ledger | New `sms_credit_grants`, `sms_reservation_slices`; reservation functions | Replaces functions | No |
| 17 | 20260915000900 sms_balance_owner_read | Owner-readable balance RPC | No | No |
| 18 | 20260915001000 sms_reconciliation | Reconciliation functions (may update stuck `text_requests`, none exist) | No | No |
| 19 | 20260915001100 stripe_event_retry | Lets a failed Stripe event be retried | Replaces a function | No |
| 20 | 20260915001200 trial_requires_checkout | **Every `trialing` row without an end gets `trial_ends_at = now() + 7 days`**; new constraints; new orgs start `suspended` until checkout; expired trials read as suspended | **Yes, behaviour: see §3** | No |
| 21 | 20260915001300 sms_ledger_carry_over | Carries existing SMS balance into grants (no balances exist) | No-op on data here | No |
| 22 | 20260915001400 setup_before_checkout | A suspended, never-subscribed org can still create its first Tag/location | Replaces functions | No |
| 23 | 20260917000100 account_deletion | New `account_deletions`; owner-initiated hard-delete RPC (the delete only runs when an owner calls it) | No (nothing runs at migrate time) | No |
| 24 | 20260926000100 customer_page_bucket | Creates/configures the `customer-page` bucket: public read, 5 MiB, JPEG/PNG/WebP | No (idempotent upsert) | No (needs Storage, which every hosted project has) |

## 3. Expected production impact

1. **Both existing businesses start a 7-day trial clock at migration time.**
   #12 marks them `trialing`; #20 gives that trial an end 7 days out. One day
   after it ends, their public `/q/{token}` page stops resolving ("closed door")
   unless the business has checked out through Stripe. Today neither location
   has a Google link, so neither page sends anyone anywhere yet, but this is the
   decision to confirm: **are these two orgs real customers, test accounts, or
   ones that should get a longer grace period** (a one-line follow-up update
   after the push)?
2. **Code must ship with the schema.** The renamed table (#10), the new tables
   and the changed RPCs mean the currently deployed frontend (whatever build
   production runs today) and the PR #67 frontend are each only correct against
   their own schema. Deploy the PR #67 frontend immediately after the push, with
   Stripe and SMS env configured. Nothing in the current repo reads
   `google_review_clicks`.
3. **Duration and locking.** The whole sequence applied in ~1.2 s on a replica
   with production's data volume. Every table touched is tiny, so locks are
   momentary.
4. **New features become live but inert until configured:** Text Requests (needs
   Twilio env), billing (needs Stripe env and webhook), Customer Page uploads
   (work immediately once the bucket exists).

## 4. Rehearsal results (local Supabase stack, same Postgres major 17)

| Test | Result |
|---|---|
| Clean database, all 60 migrations from empty | Applied; **554/554 pgTAP tests pass** |
| Bucket migration re-run, and run over a mis-configured bucket | Idempotent; converges to public/5 MiB/JPEG-PNG-WebP |
| Production replica: 36 migrations + production-shaped data (+ one extra org with a valid Google URL, a response and a click) | Schema fingerprint **identical to production** |
| Replica → apply the 24 pending migrations | Applied in 1.2 s; 554/554 pass (after removing the extra sample rating, which one test counts globally) |
| Data after migration | 3 orgs `trialing`, trial ends in 7 days; valid URL backfilled into `destination_*`; click row moved to `destination_selections` with `provider = 'google'`; old table gone; all 3 Tags still resolve |
| Replica with **production's exact migration history** (three different version numbers) → plain `db push` | Refused, as expected |
| → `migration repair` (history only) → `db push --dry-run` → `db push` | Dry run lists exactly the 24; push applies; final schema identical to the other replica |
| End-to-end upload against the migrated stack (bucket created only by the migration) | 21.5 MB camera JPEG prepared to 2.5 MB → ticket → Storage 200 → confirm → publish → public URL loads. Raw 21.5 MB upload refused (old behaviour); over-5-MiB, GIF and ticketless writes refused |

Local-only caveat found: `customer_page_assets.public_url` must start with
`https://`, and the local stack serves `http://127.0.0.1:54321`, so upload
confirmation never succeeds in local development. Production is https, so this
does not affect it. The rehearsal relaxed that check in the throwaway database only.

## 5. The procedure (to run only after approval)

Run from the repo root on PR #67's head, with the production database password.

```sh
# 0. Freeze: no deploys, no dashboard schema edits during the window.

# 1. Backups
#    a. Confirm in the dashboard (Database → Backups) that a platform backup
#       from today exists, or that PITR is enabled. This is the real rollback.
#    b. Also take a logical copy for reference:
supabase db dump --linked -f backup-schema.sql
supabase db dump --linked --data-only -f backup-data.sql
supabase db dump --linked --role-only -f backup-roles.sql

# 2. Align the migration history (writes only supabase_migrations.schema_migrations;
#    no schema change)
supabase migration repair --linked --status reverted 20260901112609 20260901163415 20260902004620
supabase migration repair --linked --status applied  20260831000100 20260901120000 20260901213000

# 3. Dry run: must list exactly the 24 migrations in §2 and nothing else
supabase db push --linked --dry-run

# 4. Apply
supabase db push --linked

# 5. Verify
#    - supabase migration list --linked         → 60 local = 60 remote
#    - storage bucket `customer-page`: public, 5242880, jpeg/png/webp
#    - entitlement_snapshots: one row per org; decide on the trial (§3.1)
#    - deploy the PR #67 frontend; open a Tag's /q page; upload a photo in the editor
```

## 6. Rollback and recovery

- **Primary: Supabase platform restore** (daily backup or PITR) to the moment
  before step 4. It restores the whole database: schema, grants, pg_cron jobs,
  and the migration history table. Then redeploy the frontend build that was
  live before.
- **Do not treat the logical dump as a rollback.** Rehearsal showed that
  restoring `db dump` output into a fresh project brings the data back exactly,
  but not the permissions: Supabase's default grants came back (for example
  `anon` had full write on `organizations`), pg_cron jobs were missing, and
  migration history was empty. It is useful for inspecting what was there, not
  for restoring production.
- **Partial failure:** `db push` stops at the first migration that fails; the
  ones before it stay applied and recorded (most of these files also wrap
  themselves in `begin;`/`commit;`, so a failing file leaves nothing half-done). Re-running
  `db push` after a fix continues from where it stopped. If the failure cannot
  be fixed forward quickly, use the platform restore.
- **History repair only (step 2)** is reversible by running the same two
  commands with `applied`/`reverted` swapped.
