# ATLAS integration — test commands and results

Branch `cursor/atlas-integration-4cd5`. Isolated. Not merged to `main`.

## Version uniqueness (must be empty)

```bash
ls supabase/migrations/*.sql | xargs -n1 basename | cut -d_ -f1 | sort | uniq -d
```

Recorded result: _pending_

## Fresh install

From an empty local database (Cloud Agent stack, CLI 2.117.0):

```bash
npx supabase@2.117.0 db reset
npx supabase@2.117.0 migration list --local
npx supabase@2.117.0 test db
```

Recorded result: _pending_

## Upgrade with existing data (main → this branch)

1. Reset to `main` migrations only (simulate a deployed main DB with seed data).
2. Insert tenant rows (two orgs, members, a stand, a text request, quota).
3. Apply this branch's new versions with `supabase migration up --local`.
4. Assert data survived and new functions/grants exist.
5. Re-run `supabase test db`.

Recorded result: _pending_

## Upgrade from a colliding #48 recording

Simulate `schema_migrations` already containing `20260908000400` with privilege
SQL applied (the #48 blob). Then apply remaining versions. SID attach must
arrive via `20260909000200`, not by rewriting `00400`.

Recorded result: _pending_

## Frontend unit (SMS + reprint path only; no Customer V2 / redesign)

```bash
cd frontend && npx vitest run tests/unit
```

Recorded result: _pending_

## Blockers

_pending_
