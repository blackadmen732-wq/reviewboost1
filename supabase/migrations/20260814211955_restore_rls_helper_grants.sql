-- Restore grants for app.* RLS helper functions.
--
-- The app_schema_lockdown migration revoked all EXECUTE from authenticated,
-- but three SECURITY DEFINER functions in app are called by RLS policies
-- which evaluate as the authenticated user. The user needs USAGE on the
-- schema and EXECUTE on these specific functions to trigger the policies.

grant usage on schema app to authenticated;

grant execute on function app.is_org_member(uuid) to authenticated;
grant execute on function app.has_org_role(uuid, public.member_role[]) to authenticated;
grant execute on function app.shares_organization(uuid) to authenticated;
