-- The callable RPC surface.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- PostgREST only exposes the schemas it is configured for — `public`,
-- `graphql_public`, and `storage` by default. The functions in `app` are
-- therefore unreachable over the API even for the service role, which is
-- exactly what we want for the internals but leaves the server unable to call
-- anything.
--
-- The alternative would be to expose the whole `app` schema. That would let any
-- caller *attempt* every internal helper and learn the shape of the system from
-- the errors, for no benefit.
--
-- Instead: five thin wrappers in `public`, one per public operation, each
-- granted only to `service_role`. The callable surface is exactly the five
-- things the customer flow does, and it is enumerable in one screen.
--
-- Wrappers are SECURITY INVOKER. They add no privilege of their own; the
-- privilege lives in the `app` functions they delegate to, which is where it
-- can be reviewed.

create or replace function public.rpc_public_resolve_stand(p_token_hash text)
returns table (
    org_id            uuid,
    location_id       uuid,
    stand_id          uuid,
    business_name     text,
    location_name     text,
    google_review_url text,
    default_locale    text
)
language sql
stable
security invoker
set search_path = ''
as $$
    select * from app.resolve_public_stand(p_token_hash);
$$;

create or replace function public.rpc_public_create_session(
    p_token_hash              text,
    p_idempotency_key         text,
    p_request_hash            text,
    p_session_token_hash      text,
    p_locale                  text,
    p_client_hash             text,
    p_session_ttl_seconds     integer,
    p_idempotency_ttl_seconds integer,
    p_record_scan             boolean,
    p_response_body_encrypted text
)
returns table (outcome text, response_status smallint, response_body_encrypted text)
language sql
security invoker
set search_path = ''
as $$
    select * from app.public_create_session(
        p_token_hash, p_idempotency_key, p_request_hash, p_session_token_hash,
        p_locale, p_client_hash, p_session_ttl_seconds, p_idempotency_ttl_seconds,
        p_record_scan, p_response_body_encrypted);
$$;

create or replace function public.rpc_public_submit_response(
    p_token_hash              text,
    p_idempotency_key         text,
    p_request_hash            text,
    p_session_token_hash      text,
    p_response_token_hash     text,
    p_rating                  smallint,
    p_note_encrypted          text,
    p_note_key_version        smallint,
    p_idempotency_ttl_seconds integer,
    p_response_body_encrypted text
)
returns table (outcome text, response_status smallint, response_body_encrypted text)
language sql
security invoker
set search_path = ''
as $$
    select * from app.public_submit_response(
        p_token_hash, p_idempotency_key, p_request_hash, p_session_token_hash,
        p_response_token_hash, p_rating, p_note_encrypted, p_note_key_version,
        p_idempotency_ttl_seconds, p_response_body_encrypted);
$$;

create or replace function public.rpc_public_record_google_click(
    p_token_hash              text,
    p_idempotency_key         text,
    p_request_hash            text,
    p_session_token_hash      text,
    p_response_token_hash     text,
    p_idempotency_ttl_seconds integer
)
returns table (outcome text, response_status smallint, response_body_encrypted text)
language sql
security invoker
set search_path = ''
as $$
    select * from app.public_record_google_click(
        p_token_hash, p_idempotency_key, p_request_hash, p_session_token_hash,
        p_response_token_hash, p_idempotency_ttl_seconds);
$$;

create or replace function public.rpc_public_submit_team_praise(
    p_token_hash              text,
    p_idempotency_key         text,
    p_request_hash            text,
    p_session_token_hash      text,
    p_response_token_hash     text,
    p_praise_id               uuid,
    p_first_name_encrypted    text,
    p_note_encrypted          text,
    p_key_version             smallint,
    p_idempotency_ttl_seconds integer,
    p_response_body_encrypted text
)
returns table (outcome text, response_status smallint, response_body_encrypted text)
language sql
security invoker
set search_path = ''
as $$
    select * from app.public_submit_team_praise(
        p_token_hash, p_idempotency_key, p_request_hash, p_session_token_hash,
        p_response_token_hash, p_praise_id, p_first_name_encrypted, p_note_encrypted,
        p_key_version, p_idempotency_ttl_seconds, p_response_body_encrypted);
$$;

create or replace function public.rpc_consume_rate_limit(
    p_bucket         text,
    p_bucket_key     text,
    p_limit          integer,
    p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language sql
security invoker
set search_path = ''
as $$
    select * from app.consume_rate_limit(p_bucket, p_bucket_key, p_limit, p_window_seconds);
$$;

-- Only the server may call these. `anon` and `authenticated` are the roles a
-- browser can reach with a Supabase key, so revoking them is what keeps the
-- customer flow server-mediated rather than client-driven.
revoke all on function public.rpc_public_resolve_stand(text) from public, anon, authenticated;
revoke all on function public.rpc_public_create_session(text, text, text, text, text, text, integer, integer, boolean, text) from public, anon, authenticated;
revoke all on function public.rpc_public_submit_response(text, text, text, text, text, smallint, text, smallint, integer, text) from public, anon, authenticated;
revoke all on function public.rpc_public_record_google_click(text, text, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.rpc_public_submit_team_praise(text, text, text, text, text, uuid, text, text, smallint, integer, text) from public, anon, authenticated;
revoke all on function public.rpc_consume_rate_limit(text, text, integer, integer) from public, anon, authenticated;

grant execute on function public.rpc_public_resolve_stand(text) to service_role;
grant execute on function public.rpc_public_create_session(text, text, text, text, text, text, integer, integer, boolean, text) to service_role;
grant execute on function public.rpc_public_submit_response(text, text, text, text, text, smallint, text, smallint, integer, text) to service_role;
grant execute on function public.rpc_public_record_google_click(text, text, text, text, text, integer) to service_role;
grant execute on function public.rpc_public_submit_team_praise(text, text, text, text, text, uuid, text, text, smallint, integer, text) to service_role;
grant execute on function public.rpc_consume_rate_limit(text, text, integer, integer) to service_role;
