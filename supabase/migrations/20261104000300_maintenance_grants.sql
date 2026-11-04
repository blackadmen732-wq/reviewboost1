-- Maintenance could not settle stuck sends or release dead-lettered credit.
--
-- 20260915001000_sms_reconciliation added two service-role entry points,
-- public.rpc_sms_reconcile_aged_unknowns and public.rpc_sms_release_dead_letters.
-- Both are SECURITY INVOKER wrappers around a definer function in `app`, and
-- the `app` functions were revoked from public (which removes the default
-- EXECUTE) and never granted to service_role. So the maintenance worker, which
-- runs as service_role, got "permission denied" on both steps every run:
-- sends whose outcome the provider never reported were never settled, and
-- dead-lettered messages never gave their credit back. Health reported
-- `maintenance_failing`. pgTAP missed it because its cases called the `app`
-- functions as the table owner.
--
-- The grant is the pattern the public flow already uses
-- (`grant execute on function app.public_create_session(...) to service_role`).
-- maintenance_grants_test.sql calls both as service_role, and fails for any
-- service-role wrapper that calls an `app` function service_role cannot run.

grant execute on function app.sms_reconcile_aged_unknowns(integer) to service_role;
grant execute on function app.sms_release_dead_letters() to service_role;
