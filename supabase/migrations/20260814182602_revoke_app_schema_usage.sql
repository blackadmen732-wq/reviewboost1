-- Revoke USAGE on schema app from authenticated.
--
-- Migration 20260810000100_onboarding.sql granted this so the public
-- SECURITY INVOKER wrappers could reach app.* internal functions. Those
-- wrappers were converted to SECURITY DEFINER in 20260811000300, making
-- the USAGE grant unnecessary. With it still in place, any future function
-- added to the app schema is silently callable by authenticated via the
-- Data API — a latent privilege escalation path.

revoke usage on schema app from authenticated;

-- Prevent future functions in app from inheriting EXECUTE for authenticated.
alter default privileges in schema app revoke execute on functions from authenticated;
