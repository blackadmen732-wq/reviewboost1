-- Generic destination review-step events.
--
-- Replaces the active google-click model with a provider-aware event:
-- "the customer selected the configured public-review destination."
--
-- WHY A NEW TABLE INSTEAD OF ALTERING google_review_clicks
-- ---------------------------------------------------------
-- google_review_clicks carries real historical data that must not be lost.
-- Adding a provider column with a default of 'google' is safe for history,
-- but altering the RPC name and semantics while preserving old rows is a
-- forward migration, not a rewrite.
--
-- This migration:
--   1. Adds destination_provider column to google_review_clicks so historical
--      rows carry their provider (backfilled to 'google').
--   2. Renames app.public_record_google_click to app.public_record_destination_step
--      (with a compatibility wrapper for the old name during transition).
--   3. The new RPC is rpc_public_record_destination_step; the old
--      rpc_public_record_google_click becomes a 410 tombstone at the API layer.

-- ============================================= backfill =====================

alter table public.google_review_clicks
    add column if not exists destination_provider text not null default 'google'
        check (destination_provider in ('google'));

comment on column public.google_review_clicks.destination_provider is
    'Provider for which the customer selected the review destination. Always ''google'' for historical rows.';

-- =========================================== new generic function ==========

create or replace function app.public_record_destination_step(
    p_token_hash              text,
    p_idempotency_key         text,
    p_request_hash            text,
    p_session_token_hash      text,
    p_response_token_hash     text,
    p_idempotency_ttl_seconds integer,
    p_previous_token_hash     text default null
)
returns table (outcome text, response_status smallint, response_body_encrypted text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    stand     record;
    claim     record;
    resp      public.customer_responses%rowtype;
    scope_key text;
    operation text := 'destination-step';
begin
    select * into stand
      from app.resolve_public_stand(p_token_hash, p_previous_token_hash);
    if stand.stand_id is null then
        return query select 'unknown_stand'::text, null::smallint, null::text;
        return;
    end if;

    scope_key := stand.stand_id::text;

    select * into claim
      from app.claim_idempotency(stand.org_id, operation, scope_key, p_idempotency_key,
                                 p_request_hash, p_idempotency_ttl_seconds);

    if claim.outcome <> 'claimed' then
        return query select claim.outcome, claim.response_status, claim.response_body_encrypted;
        return;
    end if;

    -- Stand, session, and response must all agree.
    select r.* into resp
      from public.customer_responses r
      join public.public_review_sessions s on s.id = r.session_id
     where r.response_token_hash = p_response_token_hash
       and r.stand_id = stand.stand_id
       and s.session_token_hash = p_session_token_hash;

    if resp.id is null then
        perform app.release_idempotency(operation, scope_key, p_idempotency_key);
        return query select 'response_not_found'::text, null::smallint, null::text;
        return;
    end if;

    -- provider comes from the stand's canonical destination.
    -- Falls back to 'google' when destination columns are not yet backfilled
    -- (compatibility during migration).
    insert into public.google_review_clicks (
        org_id, location_id, response_id, destination_provider
    )
    values (
        resp.org_id,
        resp.location_id,
        resp.id,
        coalesce(stand.destination_provider, 'google')
    )
    on conflict (response_id) do nothing;

    perform app.complete_idempotency(operation, scope_key, p_idempotency_key,
                                     204::smallint, null);

    return query select 'created'::text, 204::smallint, null::text;
end;
$$;

revoke all on function app.public_record_destination_step(text, text, text, text, text, integer, text)
    from public, anon, authenticated;
grant execute on function app.public_record_destination_step(text, text, text, text, text, integer, text)
    to service_role;

-- =========================================== public RPC wrapper ============

create or replace function public.rpc_public_record_destination_step(
    p_token_hash              text,
    p_idempotency_key         text,
    p_request_hash            text,
    p_session_token_hash      text,
    p_response_token_hash     text,
    p_idempotency_ttl_seconds integer,
    p_previous_token_hash     text default null
)
returns table (outcome text, response_status smallint, response_body_encrypted text)
language sql
security invoker
set search_path = ''
as $$
    select * from app.public_record_destination_step(
        p_token_hash, p_idempotency_key, p_request_hash,
        p_session_token_hash, p_response_token_hash, p_idempotency_ttl_seconds,
        p_previous_token_hash);
$$;

revoke all on function public.rpc_public_record_destination_step(text, text, text, text, text, integer, text)
    from public, anon, authenticated;
grant execute on function public.rpc_public_record_destination_step(text, text, text, text, text, integer, text)
    to service_role;

-- Compatibility wrapper: the old name still resolves so any in-flight deploys
-- do not hard-fail. It delegates to the new function.
create or replace function app.public_record_google_click(
    p_token_hash              text,
    p_idempotency_key         text,
    p_request_hash            text,
    p_session_token_hash      text,
    p_response_token_hash     text,
    p_idempotency_ttl_seconds integer,
    p_previous_token_hash     text default null
)
returns table (outcome text, response_status smallint, response_body_encrypted text)
language sql
security definer
set search_path = ''
as $$
    select * from app.public_record_destination_step(
        p_token_hash, p_idempotency_key, p_request_hash,
        p_session_token_hash, p_response_token_hash, p_idempotency_ttl_seconds,
        p_previous_token_hash);
$$;

revoke all on function app.public_record_google_click(text, text, text, text, text, integer, text)
    from public, anon, authenticated;
grant execute on function app.public_record_google_click(text, text, text, text, text, integer, text)
    to service_role;

-- ====================================== rpc compatibility wrapper ==========

-- The public rpc_public_record_google_click remains callable during the
-- transition window. It delegates to the new generic function.
create or replace function public.rpc_public_record_google_click(
    p_token_hash              text,
    p_idempotency_key         text,
    p_request_hash            text,
    p_session_token_hash      text,
    p_response_token_hash     text,
    p_idempotency_ttl_seconds integer,
    p_previous_token_hash     text default null
)
returns table (outcome text, response_status smallint, response_body_encrypted text)
language sql
security invoker
set search_path = ''
as $$
    select * from app.public_record_destination_step(
        p_token_hash, p_idempotency_key, p_request_hash,
        p_session_token_hash, p_response_token_hash, p_idempotency_ttl_seconds,
        p_previous_token_hash);
$$;

revoke all on function public.rpc_public_record_google_click(text, text, text, text, text, integer, text)
    from public, anon, authenticated;
grant execute on function public.rpc_public_record_google_click(text, text, text, text, text, integer, text)
    to service_role;
