-- Restore public.rpc_create_organization to SECURITY DEFINER.
--
-- Regression history:
--   20260811000300_revoke_app_schema_usage made the public rpc_* wrappers
--   SECURITY DEFINER so an authenticated caller never needs EXECUTE on the
--   private app.* functions, and revoked EXECUTE on those inner functions from
--   authenticated. That is the intended design: the app schema stays private.
--
--   20260813210557_foundation_hardening and 20260813215530_praise_view_and_
--   state_machine each recreated public.rpc_create_organization (expanding it
--   to the 13-argument token-ciphertext signature) but wrote it as
--   `security invoker`. While those same migrations also granted the inner
--   app.create_organization_with_first_stand to authenticated, the INVOKER
--   wrapper still worked. 20260814182627_revoke_direct_inserts then re-revoked
--   the inner function from authenticated (correctly keeping app.* private) but
--   left the wrapper as INVOKER — so an authenticated caller now reaches the
--   private function AS ITSELF and fails with 42501, surfacing as a 503 on
--   POST /api/v1/onboarding ("permission denied for function
--   create_organization_with_first_stand").
--
-- Fix: restore the wrapper to SECURITY DEFINER (its owner is postgres, which
-- owns and can execute the inner function). The app schema stays private —
-- authenticated/anon are NOT granted access to app.create_organization_with_
-- first_stand. Signature and body are otherwise identical to the current
-- 13-argument definition; only the security attribute and grants change.

begin;

create or replace function public.rpc_create_organization(
    p_name               text,
    p_slug               text,
    p_timezone           text,
    p_default_locale     text,
    p_location_name      text,
    p_google_review_url  text,
    p_stand_token_hash   text,
    p_stand_token_prefix text,
    p_stand_label        text,
    p_token_key_version  smallint,
    p_request_id         text,
    p_token_ciphertext   text,
    p_cipher_key_version smallint
)
returns table (org_id uuid, location_id uuid, stand_id uuid)
language sql
security definer
set search_path = ''
as $$
    select * from app.create_organization_with_first_stand(
        p_name, p_slug, p_timezone, p_default_locale, p_location_name,
        p_google_review_url, p_stand_token_hash, p_stand_token_prefix,
        p_stand_label, p_token_key_version, p_request_id,
        p_token_ciphertext, p_cipher_key_version);
$$;

-- Deterministic grants on the public wrapper: PUBLIC and anon must not reach
-- it; the intended client role (authenticated) and the server's service_role
-- may. `revoke all from public, anon` does not touch authenticated's grant,
-- but the explicit grant keeps the end state unambiguous.
revoke all on function public.rpc_create_organization(
    text, text, text, text, text, text, text, text, text, smallint, text, text, smallint
) from public, anon;

grant execute on function public.rpc_create_organization(
    text, text, text, text, text, text, text, text, text, smallint, text, text, smallint
) to authenticated, service_role;

-- Keep the private app.* function private. Only postgres (which owns it, and
-- which the SECURITY DEFINER wrapper runs as) may execute it. This is already
-- the hosted state after 20260814182627; re-asserting it here is idempotent and
-- guards against the wrapper and the inner grant drifting apart again.
revoke all on function app.create_organization_with_first_stand(
    text, text, text, text, text, text, text, text, text, smallint, text, text, smallint
) from public, anon, authenticated;

commit;
