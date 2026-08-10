-- Table privilege lockdown.
--
-- FOUND BY RUNNING THE MIGRATIONS AGAINST A REAL DATABASE, NOT BY READING THEM.
--
-- Two problems that inspection had missed, both of which only appear once
-- `\dp` is real:
--
-- 1. `anon` and `authenticated` held TRUNCATE, TRIGGER, and REFERENCES on every
--    table in `public`.
--
--    TRUNCATE is the dangerous one, because **row level security does not apply
--    to TRUNCATE**. Every policy in migration 300 could be perfect and any
--    signed-in user could still empty `customer_responses`, `team_praise_records`,
--    or `audit_events` for every business in the system. A policy that filters
--    rows is no defence against a statement that does not read rows.
--
--    TRIGGER is nearly as bad: the right to attach a trigger to a table is the
--    right to run arbitrary code, as the table owner, whenever anyone writes to
--    it.
--
-- 2. `authenticated` held no SELECT, INSERT, UPDATE, or DELETE at all.
--
--    A row level security policy grants nothing on its own — it *filters* what a
--    privilege already allows. Every dashboard policy written in migration 300
--    was therefore inert, and the owner portal would have failed with
--    "permission denied" on its first query. The policies looked correct and
--    protected nothing, because there was nothing to protect.
--
-- The privileges below are now stated explicitly rather than inherited, so the
-- grant and the policy can be reviewed side by side.

-- --------------------------------------------------- revoke everything ----

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- Future objects inherit nothing. Without this, the next migration that creates
-- a table reintroduces exactly the problem this one fixes — which is precisely
-- how `rate_limit_buckets` acquired TRUNCATE after migration 300 had already
-- revoked it from everything that existed at the time.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- ------------------------------------------------------------ anon --------
--
-- Nothing. Not one table, not one function.
--
-- The anonymous customer never touches a table: every public write goes through
-- a definer function the service role calls on their behalf, which derives the
-- tenant from the stand token. There is no query an anonymous caller should be
-- able to run, so there is no privilege to grant.

-- -------------------------------------------------- authenticated ---------
--
-- The minimum each dashboard policy needs. RLS filters the rows; these decide
-- which statements are possible at all. Neither is sufficient alone.

grant select, update on public.profiles to authenticated;

grant select, update on public.organizations to authenticated;

grant select, insert, update, delete on public.organization_members to authenticated;

grant select, insert, update, delete on public.locations to authenticated;

grant select, insert, update, delete on public.review_stands to authenticated;

-- Read-only. These rows are the customer's own words, written by the anonymous
-- path. No member — not even an owner — may insert or edit one, because
-- fabricating a response would corrupt the only honest signal the product
-- produces.
grant select on public.public_review_sessions to authenticated;
grant select on public.google_review_clicks to authenticated;

-- Update is for triage (`read_at`, `resolved_at`) and for matching praise. The
-- rating, the note, and the customer's text are not writable by anyone.
grant select, update on public.customer_responses to authenticated;
grant select, update on public.team_praise_records to authenticated;

-- Append-only history. Select only: no insert, update, or delete privilege
-- exists, so a user cannot write, rewrite, or erase the record of what was
-- done. The server appends with the service role.
grant select on public.audit_events to authenticated;

-- `idempotency_records` and `rate_limit_buckets` get nothing. They are
-- infrastructure, not tenant data, and no client has any reason to see them.

-- ---------------------------------------------------------- service -------
--
-- The service role is what the Route Handlers use. It bypasses RLS by design,
-- which is why it is confined to the narrow `rpc_*` surface rather than
-- querying tables directly.

grant usage on schema app to service_role;
