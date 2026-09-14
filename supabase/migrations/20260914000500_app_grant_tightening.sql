-- Remove a redundant grant on the app schema.
--
-- `app.create_organization_with_first_stand` is granted to `authenticated`,
-- and has been since onboarding was written. It does not need to be:
-- `public.rpc_create_organization` is SECURITY DEFINER and owned by postgres,
-- so the inner call runs as the owner whatever the caller holds.
--
-- Not a privilege escalation as it stands -- the inner function is itself
-- SECURITY DEFINER and repeats the authentication and owned-organization-limit
-- checks, so calling it directly is equivalent to calling the wrapper. It is
-- removed because `authenticated` holds USAGE on the app schema (RLS policies
-- call the membership helpers as the calling user), which makes every grant in
-- that schema load-bearing for the audit, and a grant nothing needs is one
-- nobody will question when the function later changes.
--
-- 20260914000300 recreated this function, which restores PostgreSQL's default
-- PUBLIC EXECUTE, so both revokes are applied here after it.

begin;

revoke all on function app.create_organization_with_first_stand(
    text, text, text, text, text, text, text, text, text, smallint, text, text, smallint
) from public, anon, authenticated;

comment on function app.create_organization_with_first_stand(
    text, text, text, text, text, text, text, text, text, smallint, text, text, smallint
) is
    'Called only through public.rpc_create_organization, which is SECURITY '
    'DEFINER and owned by postgres. No Data API role holds EXECUTE; see '
    'scripts/db/test-privilege-lockdown.sql, which fails if that changes.';

commit;
