# ATLAS integration — test commands and results

Branch `cursor/atlas-integration-4cd5`. Isolated. Not merged to `main`.
CLI: `npx --yes supabase@2.117.0` (2.117.0). Host: Cloud Agent local stack.

## Version uniqueness

```bash
ls supabase/migrations/*.sql | xargs -n1 basename | cut -d_ -f1 | sort | uniq -d
```

Result: **empty** (no duplicate versions). `20260908000400` is SID only;
privilege is `20260908000500`.

## Fresh install

```bash
npx --yes supabase@2.117.0 db reset --yes --local
npx --yes supabase@2.117.0 migration list --local
npx --yes supabase@2.117.0 test db
npx --yes supabase@2.117.0 db reset --yes --local   # second reset
npx --yes supabase@2.117.0 db diff --schema public,app
```

Results (pre-`20260909000400` index follow-up):

- Reset applied all `20260908` / `20260909` files including forwards.
- `migration list`: local == remote through `20260909000300`.
- **pgTAP `Files=8, Tests=451, Result: PASS`** (includes `privilege_attack_test.sql`
  and 143 `text_requests_test.sql` assertions).
- Second reset finished without error.
- `db diff --schema public,app`: **No schema changes found**.

## Upgrade with existing data (main → this branch)

Boot DB had only the 43 `main` versions. Fixture inserted a stand, session,
rating-2 response, scheduled text request, and a 100-credit allocation on
Corner Cafe, then:

```bash
npx --yes supabase@2.117.0 migration up --local
```

Applied: `20260908000100` … `20260909000300` (8 files).

Post-upgrade:

- Response `ffff6666-…` rating **2** still present.
- Text request `aaaa7777-…` status `scheduled`, last-four `7777`.
- Stand ciphertext `v1:enc-upgrade-stand-token` unchanged.
- Quota ledger allocation `upgrade-quota-pack` amount 100 unchanged.
- Functions present: `sms_reconcile_attach_sid`, `rpc_sms_reconcile_attach_sid`,
  `rpc_get_stand_token_ciphertext`, `sms_quota_fifo_used`.
- `authenticated` cannot SELECT stand/message ciphertext; anon cannot EXECUTE
  reprint RPC; authenticated can.
- `sms_reconcile_attach_sid(null,…)` returns `invalid`.

pgTAP on that dirty DB: **450/451**. The single failure is
`customer_flow_test.sql` test 21 (`array_agg(rating)` over the whole table)
seeing the fixture's extra `2`. Not a migration defect; the assertion is not
org-scoped. Fresh reset is 451/451.

## Upgrade from a colliding #48 recording

```bash
npx --yes supabase@2.117.0 db reset --yes --local --version 20260902000700
# apply privilege SQL (the #48 blob) and record version 20260908000400
npx --yes supabase@2.117.0 migration up --local
# → LegacyMigrationMissingRemoteError (00100–00300 sit before recorded 00400)
npx --yes supabase@2.117.0 migration up --local --include-all --yes
npx --yes supabase@2.117.0 test db
```

- Plain `migration up` **refuses** to insert versions before the last remote
  version. Operator step for #48-style DBs: **`--include-all`**.
- With `--include-all`, applied `00100`–`00300`, skipped `00400`, applied
  `00500` and all three `20260909` forwards.
- `pg_get_functiondef(sms_reconcile_attach_sid)` contains `never steal a SID`
  (from `20260909000200`, not from skipped `00400`).
- Ciphertext SELECT for `authenticated` remains false.
- **pgTAP `Files=8, Tests=451, Result: PASS`**.

## Frontend unit

```bash
cd frontend && npx vitest run tests/unit
```

Result: **Test Files 29 passed; Tests 414 passed.**

## Query shape (#40) — after critical path

See `docs/backend/ATLAS_QUERY_SHAPE_EVIDENCE.md`. 12,000-row hot org:

- Authenticated inbox **64.6 ms → 0.78 ms** after
  `(org_id, submitted_at DESC, id DESC)`.
- Cross-tenant count stays **0**.
- Exact `COUNT(*)` still ~61 ms under per-row RLS (not fixed by the index;
  not weakened).

## Blockers

- **No merge.** Customer V2 and FE redesign untouched.
- Hosted / production migrate not run.
- Live Twilio not run.
- #48-style databases need `migration up --include-all` (documented).
- Dashboard exact-count tiles still pay per-row RLS; proposed, not shipped.
- `customer_flow_test.sql` test 21 is not tenant-scoped; dirty-DB upgrades
  can fail that one assertion without schema error.
