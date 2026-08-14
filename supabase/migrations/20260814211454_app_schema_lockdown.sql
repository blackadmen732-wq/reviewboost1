-- Complete app schema lockdown.
--
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default.
-- Previous migrations revoked USAGE from authenticated but not from
-- PUBLIC or anon, and did not revoke default EXECUTE from PUBLIC.
-- All app.* functions are internal — only SECURITY DEFINER wrappers
-- in public should reach them.

-- Revoke USAGE from all non-superuser roles
revoke usage on schema app from public;
revoke usage on schema app from anon;
revoke usage on schema app from authenticated;

-- Revoke EXECUTE on all existing app functions from non-owners
revoke all on all functions in schema app from public;
revoke all on all functions in schema app from anon;
revoke all on all functions in schema app from authenticated;

-- Prevent future app functions from inheriting default EXECUTE
alter default privileges in schema app revoke execute on functions from public;
alter default privileges in schema app revoke execute on functions from anon;
alter default privileges in schema app revoke execute on functions from authenticated;
