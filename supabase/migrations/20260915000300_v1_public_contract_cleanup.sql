-- V1 public contract cleanup.
--
-- 1. REMOVE PUBLIC NOTES from the active submit-response path.
--    The V1 customer submit contract is: sessionId + rating. Nothing else.
--    Historical note_encrypted rows are NOT deleted and NOT altered.
--    The columns remain in customer_responses for owner history.
--    New submissions simply insert NULL for note_encrypted / note_key_version.
--
-- 2. DEACTIVATE TEAM PRAISE at the public database layer.
--    The app.public_submit_team_praise function is replaced with one that
--    always returns 'gone' (HTTP 410), which the API layer maps to 410 Gone.
--    Historical team_praise_records rows are NOT deleted.
--    Owner-side reads and owner-side RLS remain intact.

-- =================================== submit response without note ==========

-- New signature drops p_note_encrypted and p_note_key_version.
-- Stores NULL for both columns — historical rows with encrypted notes are
-- unaffected.
create or replace function app.public_submit_response(
    p_token_hash              text,
    p_idempotency_key         text,
    p_request_hash            text,
    p_session_token_hash      text,
    p_response_token_hash     text,
    p_rating                  smallint,
    p_idempotency_ttl_seconds integer,
    p_response_body_encrypted text,
    p_previous_token_hash             text default null,
    p_previous_session_token_hash     text default null
)
returns table (outcome text, response_status smallint, response_body_encrypted text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    stand      record;
    claim      record;
    session    public.public_review_sessions%rowtype;
    scope_key    text;
    v_operation  text := 'response';
    old_replay   record;
begin
    select * into stand
      from app.resolve_public_stand(p_token_hash, p_previous_token_hash);
    if stand.stand_id is null then
        return query select 'unknown_stand'::text, null::smallint, null::text;
        return;
    end if;

    scope_key := stand.stand_id::text;

    select * into claim
      from app.claim_idempotency(stand.org_id, v_operation, scope_key, p_idempotency_key,
                                 p_request_hash, p_idempotency_ttl_seconds);

    if claim.outcome = 'claimed' then
        select ir.state, ir.request_hash, ir.response_status, ir.response_body_encrypted
          into old_replay
          from public.idempotency_records ir
         where ir.org_id = stand.org_id
           and ir.operation = v_operation
           and ir.idempotency_key = p_idempotency_key
           and ir.expires_at > now()
           and (ir.scope_key = p_token_hash
                or (p_previous_token_hash is not null and ir.scope_key = p_previous_token_hash))
         limit 1;

        if found then
            perform app.release_idempotency(v_operation, scope_key, p_idempotency_key);

            if old_replay.request_hash <> p_request_hash then
                return query select 'conflict'::text, null::smallint, null::text;
                return;
            end if;

            if old_replay.state = 'completed' then
                return query select 'replay'::text, old_replay.response_status, old_replay.response_body_encrypted;
                return;
            end if;

            return query select 'in_progress'::text, null::smallint, null::text;
            return;
        end if;
    end if;

    if claim.outcome <> 'claimed' then
        return query select claim.outcome, claim.response_status, claim.response_body_encrypted;
        return;
    end if;

    select * into session
      from public.public_review_sessions s
     where (s.session_token_hash = p_session_token_hash
            or (p_previous_session_token_hash is not null
                and s.session_token_hash = p_previous_session_token_hash))
       and s.stand_id = stand.stand_id;

    if session.id is null then
        perform app.release_idempotency(v_operation, scope_key, p_idempotency_key);
        return query select 'session_invalid'::text, null::smallint, null::text;
        return;
    end if;

    if session.expires_at <= now() then
        perform app.release_idempotency(v_operation, scope_key, p_idempotency_key);
        return query select 'session_expired'::text, null::smallint, null::text;
        return;
    end if;

    if exists (select 1 from public.customer_responses r where r.session_id = session.id) then
        perform app.release_idempotency(v_operation, scope_key, p_idempotency_key);
        return query select 'response_conflict'::text, null::smallint, null::text;
        return;
    end if;

    -- Rating stored exactly as given. Note columns remain null — V1 removes
    -- public note collection. Historical rows with notes are untouched.
    insert into public.customer_responses
        (org_id, location_id, stand_id, session_id, response_token_hash,
         rating, note_encrypted, note_key_version)
    values
        (stand.org_id, stand.location_id, stand.stand_id, session.id, p_response_token_hash,
         p_rating, null, 1);

    perform app.complete_idempotency(v_operation, scope_key, p_idempotency_key,
                                     201::smallint, p_response_body_encrypted);

    return query select 'created'::text, 201::smallint, p_response_body_encrypted;
end;
$$;

revoke all on function app.public_submit_response(text, text, text, text, text, smallint, integer, text, text, text)
    from public, anon, authenticated;
grant execute on function app.public_submit_response(text, text, text, text, text, smallint, integer, text, text, text)
    to service_role;

-- New public RPC wrapper without note params.
create or replace function public.rpc_public_submit_response(
    p_token_hash              text,
    p_idempotency_key         text,
    p_request_hash            text,
    p_session_token_hash      text,
    p_response_token_hash     text,
    p_rating                  smallint,
    p_idempotency_ttl_seconds integer,
    p_response_body_encrypted text,
    p_previous_token_hash             text default null,
    p_previous_session_token_hash     text default null
)
returns table (outcome text, response_status smallint, response_body_encrypted text)
language sql
security invoker
set search_path = ''
as $$
    select * from app.public_submit_response(
        p_token_hash, p_idempotency_key, p_request_hash, p_session_token_hash,
        p_response_token_hash, p_rating, p_idempotency_ttl_seconds,
        p_response_body_encrypted, p_previous_token_hash,
        p_previous_session_token_hash);
$$;

revoke all on function public.rpc_public_submit_response(text, text, text, text, text, smallint, integer, text, text, text)
    from public, anon, authenticated;
grant execute on function public.rpc_public_submit_response(text, text, text, text, text, smallint, integer, text, text, text)
    to service_role;

-- Drop old overloads with note params to prevent accidental use.
drop function if exists app.public_submit_response(text, text, text, text, text, smallint, text, smallint, integer, text, text, text);
drop function if exists public.rpc_public_submit_response(text, text, text, text, text, smallint, text, smallint, integer, text, text, text);

-- ================================== team praise: 410 tombstone =============

-- Replaces the active team-praise write function with a 410 tombstone.
-- Historical team_praise_records rows are NOT affected.
-- Owner-side RLS and history features are unaffected.
create or replace function app.public_submit_team_praise(
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
    p_response_body_encrypted text,
    p_previous_token_hash             text default null,
    p_previous_session_token_hash     text default null,
    p_previous_response_token_hash    text default null
)
returns table (outcome text, response_status smallint, response_body_encrypted text)
language sql
security definer
set search_path = ''
as $$
    -- Team Praise is not active in V1. Returns 'gone' so the API layer
    -- maps this to HTTP 410 Gone.
    select 'gone'::text, null::smallint, null::text;
$$;

revoke all on function app.public_submit_team_praise(text, text, text, text, text, uuid, text, text, smallint, integer, text, text, text, text)
    from public, anon, authenticated;
grant execute on function app.public_submit_team_praise(text, text, text, text, text, uuid, text, text, smallint, integer, text, text, text, text)
    to service_role;

-- The public RPC wrapper also returns 'gone'.
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
    p_response_body_encrypted text,
    p_previous_token_hash             text default null,
    p_previous_session_token_hash     text default null,
    p_previous_response_token_hash    text default null
)
returns table (outcome text, response_status smallint, response_body_encrypted text)
language sql
security invoker
set search_path = ''
as $$
    select 'gone'::text, null::smallint, null::text;
$$;

revoke all on function public.rpc_public_submit_team_praise(text, text, text, text, text, uuid, text, text, smallint, integer, text, text, text, text)
    from public, anon, authenticated;
grant execute on function public.rpc_public_submit_team_praise(text, text, text, text, text, uuid, text, text, smallint, integer, text, text, text, text)
    to service_role;
