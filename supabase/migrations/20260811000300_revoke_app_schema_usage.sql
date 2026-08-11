-- Lock down direct access to app-schema internal functions.
--
-- The public.rpc_* wrappers were SECURITY INVOKER, which meant the
-- authenticated caller needed EXECUTE on the inner app.* functions too.
-- That also meant the inner functions were callable directly through the
-- Data API, bypassing the public wrapper entirely.
--
-- Fix: make the public wrappers SECURITY DEFINER so they run as postgres
-- and can call the inner functions without the caller having EXECUTE.
-- Then revoke EXECUTE on the inner functions from authenticated.
-- The inner functions still validate auth.uid() themselves.

-- ============================================================
-- A. Redefine public wrappers as SECURITY DEFINER
-- ============================================================

-- DROP first: PostgreSQL's CREATE OR REPLACE cannot remove parameter
-- defaults from an existing function, so a plain replace would fail
-- with SQLSTATE 42P13 if the prior definition carried defaults.

drop function if exists public.rpc_record_audit_event(uuid, text, text, text, text, jsonb);

drop function if exists public.rpc_record_audit_event(uuid, text, text, text, text, jsonb);

create function public.rpc_record_audit_event(
    p_org_id      uuid,
    p_action      text,
    p_target_type text,
    p_target_id   text,
    p_request_id  text default null,
    p_metadata    jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
    select app.record_audit_event(p_org_id, p_action, p_target_type, p_target_id,
                                  p_request_id, p_metadata);
$$;

drop function if exists public.rpc_create_organization(text, text, text, text, text, text, text, text, text, smallint, text);

create function public.rpc_create_organization(
    p_name             text,
    p_slug             text,
    p_timezone         text,
    p_default_locale   text,
    p_location_name    text,
    p_google_review_url text,
    p_stand_token_hash text,
    p_stand_token_prefix text,
    p_stand_label      text,
    p_token_key_version smallint,
    p_request_id       text
)
returns table (org_id uuid, location_id uuid, stand_id uuid)
language sql
security definer
set search_path = ''
as $$
    select * from app.create_organization_with_first_stand(
        p_name, p_slug, p_timezone, p_default_locale, p_location_name,
        p_google_review_url, p_stand_token_hash, p_stand_token_prefix,
        p_stand_label, p_token_key_version, p_request_id);
$$;

drop function if exists public.rpc_set_stand_token_ciphertext(uuid, text, smallint);

create function public.rpc_set_stand_token_ciphertext(
    p_stand_id   uuid,
    p_ciphertext text,
    p_key_version smallint
)
returns boolean
language sql
security definer
set search_path = ''
as $$
    select app.set_stand_token_ciphertext(p_stand_id, p_ciphertext, p_key_version);
$$;

-- ============================================================
-- B. Revoke direct EXECUTE on inner functions from authenticated
-- ============================================================

revoke execute on function app.create_organization_with_first_stand(text, text, text, text, text, text, text, text, text, smallint, text) from authenticated;
revoke execute on function app.record_audit_event(uuid, text, text, text, text, jsonb) from authenticated;
revoke execute on function app.set_stand_token_ciphertext(uuid, text, smallint) from authenticated;
