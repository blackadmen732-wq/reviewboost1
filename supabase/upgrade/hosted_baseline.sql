-- The hosted production schema, populated.
--
-- The hosted Supabase ledger was last recorded at 36 migrations: the repo's
-- first 36, through 20260901213000 (two of them under different ledger
-- versions — see docs/backend/ENVIRONMENT.md, "Migration History Repair").
-- It has none of Text Requests, the SMS ledger, entitlements, billing, the
-- Customer Page, or account deletion.
--
-- This is that database with real-shaped data in it. The proof applies the
-- remaining migrations on top and checks nothing was lost and that the
-- businesses already live keep working through the change.
--
--   scripts/backend/local-postgres.sh upgrade 20260901213000 hosted

\ir baseline_core.sql

-- A third business that never had a location, as a live one might be after
-- abandoning onboarding.
insert into public.organizations (id, name, slug, timezone, default_locale, status)
values ('00000000-0e10-0000-0000-000000000003', 'Legacy Abandoned', 'legacy-abandoned',
        'America/Chicago', 'en', 'active');
