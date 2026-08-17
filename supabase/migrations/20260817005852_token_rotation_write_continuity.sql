-- Extend previous-key fallback to all public write operations.
--
-- THE PROBLEM THIS FIXES
-- ----------------------
-- Migration 20260808000800 added previous-key fallback to resolve_public_stand,
-- but the four transactional write functions (public_create_session,
-- public_submit_response, public_record_google_click, public_submit_team_praise)
-- call resolve_public_stand with only the current-key hash. During a
-- TOKEN_DIGEST_KEY rotation, a stand whose digest has not yet been lazily
-- upgraded returns unknown_stand on every write, dropping active customer
-- sessions until the stand is rescanned via getContext.
--
-- THE FIX
-- -------
-- Each write function gains an optional p_previous_token_hash parameter,
-- forwarded to resolve_public_stand so both key versions are tried. The
-- lazy digest upgrade remains application-side (fire-and-forget in the
-- TypeScript service layer after any successful resolution).
--
-- The public RPC wrappers gain the same parameter, and all grants/revokes are
-- updated for the new signatures.

-- ============================================================ app functions ==

-- ---------------------------------------------------- create session ------

create or replace function app.public_create_session(
    p_token_hash              text,
    p_idempotency_key         text,
    p_request_hash            text,
    p_session_token_hash      text,
    p_locale                  text,
    p_client_hash             text,
    p_session_ttl_seconds     integer,
    p_idempotency_ttl_seconds integer,
    p_record_scan             boolean,
    p_response_body_encrypted text,
    p_previous_token_hash     text default null
)
returns table (outcome text, response_status smallint, response_body_encrypted text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    stand      record;
    claim      record;
    scope_key  text := p_token_hash;
    operation  text := 'session';
begin
    select * into stand
      from app.resolve_public_stand(p_token_hash, p_previous_token_hash);
    if stand.stand_id is null then
        return query select 'unknown_stand'::text, null::smallint, null::text;
        return;
    end if;

    select * into claim
      from app.claim_idempotency(stand.org_id, operation, scope_key, p_idempotency_key,
                                 p_request_hash, p_idempotency_ttl_seconds);

    if claim.outcome <> 'claimed' then
        return query select claim.outcome, claim.response_status, claim.response_body_encrypted;
        return;
    end if;

    insert into public.public_review_sessions
        (org_id, location_id, stand_id, session_token_hash, locale, client_hash, expires_at)
    values
        (stand.org_id, stand.location_id, stand.stand_id, p_session_token_hash,
         p_locale, p_client_hash, now() + make_interval(secs => p_session_ttl_seconds));

    if p_record_scan then
        update public.review_stands s
           set last_opened_at = now()
         where s.id = stand.stand_id;
    end if;

    perform app.complete_idempotency(operation, scope_key, p_idempotency_key,
                                     201::smallint, p_response_body_encrypted);

    return query select 'created'::text, 201::smallint, p_response_body_encrypted;
end;
$$;

-- --------------------------------------------------- submit response ------

create or replace function app.public_submit_response(
    p_token_hash              text,
    p_idempotency_key         text,
    p_request_hash            text,
    p_session_token_hash      text,
    p_response_token_hash     text,
    p_rating                  smallint,
    p_note_encrypted          text,
    p_note_key_version        smallint,
    p_idempotency_ttl_seconds integer,
    p_response_body_encrypted text,
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
    session   public.public_review_sessions%rowtype;
    scope_key text := p_token_hash;
    operation text := 'response';
begin
    select * into stand
      from app.resolve_public_stand(p_token_hash, p_previous_token_hash);
    if stand.stand_id is null then
        return query select 'unknown_stand'::text, null::smallint, null::text;
        return;
    end if;

    select * into claim
      from app.claim_idempotency(stand.org_id, operation, scope_key, p_idempotency_key,
                                 p_request_hash, p_idempotency_ttl_seconds);

    if claim.outcome <> 'claimed' then
        return query select claim.outcome, claim.response_status, claim.response_body_encrypted;
        return;
    end if;

    select * into session
      from public.public_review_sessions s
     where s.session_token_hash = p_session_token_hash
       and s.stand_id = stand.stand_id;

    if session.id is null then
        perform app.release_idempotency(operation, scope_key, p_idempotency_key);
        return query select 'session_invalid'::text, null::smallint, null::text;
        return;
    end if;

    if session.expires_at <= now() then
        perform app.release_idempotency(operation, scope_key, p_idempotency_key);
        return query select 'session_expired'::text, null::smallint, null::text;
        return;
    end if;

    if exists (select 1 from public.customer_responses r where r.session_id = session.id) then
        perform app.release_idempotency(operation, scope_key, p_idempotency_key);
        return query select 'response_conflict'::text, null::smallint, null::text;
        return;
    end if;

    insert into public.customer_responses
        (org_id, location_id, stand_id, session_id, response_token_hash,
         rating, note_encrypted, note_key_version)
    values
        (stand.org_id, stand.location_id, stand.stand_id, session.id, p_response_token_hash,
         p_rating, p_note_encrypted, p_note_key_version);

    perform app.complete_idempotency(operation, scope_key, p_idempotency_key,
                                     201::smallint, p_response_body_encrypted);

    return query select 'created'::text, 201::smallint, p_response_body_encrypted;
end;
$$;

-- ------------------------------------------------ record google click -----

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
language plpgsql
security definer
set search_path = ''
as $$
declare
    stand     record;
    claim     record;
    resp      public.customer_responses%rowtype;
    scope_key text := p_token_hash;
    operation text := 'google-click';
begin
    select * into stand
      from app.resolve_public_stand(p_token_hash, p_previous_token_hash);
    if stand.stand_id is null then
        return query select 'unknown_stand'::text, null::smallint, null::text;
        return;
    end if;

    select * into claim
      from app.claim_idempotency(stand.org_id, operation, scope_key, p_idempotency_key,
                                 p_request_hash, p_idempotency_ttl_seconds);

    if claim.outcome <> 'claimed' then
        return query select claim.outcome, claim.response_status, claim.response_body_encrypted;
        return;
    end if;

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

    insert into public.google_review_clicks (org_id, location_id, response_id)
    values (resp.org_id, resp.location_id, resp.id)
    on conflict (response_id) do nothing;

    perform app.complete_idempotency(operation, scope_key, p_idempotency_key,
                                     204::smallint, null);

    return query select 'created'::text, 204::smallint, null::text;
end;
$$;

-- ------------------------------------------------- submit team praise -----

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
    scope_key text := p_token_hash;
    operation text := 'team-praise';
begin
    select * into stand
      from app.resolve_public_stand(p_token_hash, p_previous_token_hash);
    if stand.stand_id is null then
        return query select 'unknown_stand'::text, null::smallint, null::text;
        return;
    end if;

    select * into claim
      from app.claim_idempotency(stand.org_id, operation, scope_key, p_idempotency_key,
                                 p_request_hash, p_idempotency_ttl_seconds);

    if claim.outcome <> 'claimed' then
        return query select claim.outcome, claim.response_status, claim.response_body_encrypted;
        return;
    end if;

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

    if exists (select 1 from public.team_praise_records t where t.response_id = resp.id) then
        perform app.release_idempotency(operation, scope_key, p_idempotency_key);
        return query select 'praise_conflict'::text, null::smallint, null::text;
        return;
    end if;

    insert into public.team_praise_records
        (id, org_id, location_id, response_id, first_name_encrypted,
         praise_note_encrypted, encryption_key_version, status)
    values
        (p_praise_id, resp.org_id, resp.location_id, resp.id, p_first_name_encrypted,
         p_note_encrypted, p_key_version, 'unmatched');

    perform app.complete_idempotency(operation, scope_key, p_idempotency_key,
                                     201::smallint, p_response_body_encrypted);

    return query select 'created'::text, 201::smallint, p_response_body_encrypted;
end;
$$;

-- ========================================================= public wrappers ==

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
    p_response_body_encrypted text,
    p_previous_token_hash     text default null
)
returns table (outcome text, response_status smallint, response_body_encrypted text)
language sql
security invoker
set search_path = ''
as $$
    select * from app.public_create_session(
        p_token_hash, p_idempotency_key, p_request_hash, p_session_token_hash,
        p_locale, p_client_hash, p_session_ttl_seconds, p_idempotency_ttl_seconds,
        p_record_scan, p_response_body_encrypted, p_previous_token_hash);
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
    p_response_body_encrypted text,
    p_previous_token_hash     text default null
)
returns table (outcome text, response_status smallint, response_body_encrypted text)
language sql
security invoker
set search_path = ''
as $$
    select * from app.public_submit_response(
        p_token_hash, p_idempotency_key, p_request_hash, p_session_token_hash,
        p_response_token_hash, p_rating, p_note_encrypted, p_note_key_version,
        p_idempotency_ttl_seconds, p_response_body_encrypted, p_previous_token_hash);
$$;

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
    select * from app.public_record_google_click(
        p_token_hash, p_idempotency_key, p_request_hash, p_session_token_hash,
        p_response_token_hash, p_idempotency_ttl_seconds, p_previous_token_hash);
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
    p_response_body_encrypted text,
    p_previous_token_hash     text default null
)
returns table (outcome text, response_status smallint, response_body_encrypted text)
language sql
security invoker
set search_path = ''
as $$
    select * from app.public_submit_team_praise(
        p_token_hash, p_idempotency_key, p_request_hash, p_session_token_hash,
        p_response_token_hash, p_praise_id, p_first_name_encrypted, p_note_encrypted,
        p_key_version, p_idempotency_ttl_seconds, p_response_body_encrypted,
        p_previous_token_hash);
$$;

-- ============================================================ privileges ====

-- Drop old-signature overloads to avoid ambiguous calls.
drop function if exists public.rpc_public_create_session(text, text, text, text, text, text, integer, integer, boolean, text);
drop function if exists public.rpc_public_submit_response(text, text, text, text, text, smallint, text, smallint, integer, text);
drop function if exists public.rpc_public_record_google_click(text, text, text, text, text, integer);
drop function if exists public.rpc_public_submit_team_praise(text, text, text, text, text, uuid, text, text, smallint, integer, text);

drop function if exists app.public_create_session(text, text, text, text, text, text, integer, integer, boolean, text);
drop function if exists app.public_submit_response(text, text, text, text, text, smallint, text, smallint, integer, text);
drop function if exists app.public_record_google_click(text, text, text, text, text, integer);
drop function if exists app.public_submit_team_praise(text, text, text, text, text, uuid, text, text, smallint, integer, text);

-- Revoke from non-service roles.
revoke all on function app.public_create_session(text, text, text, text, text, text, integer, integer, boolean, text, text) from public, anon, authenticated;
revoke all on function app.public_submit_response(text, text, text, text, text, smallint, text, smallint, integer, text, text) from public, anon, authenticated;
revoke all on function app.public_record_google_click(text, text, text, text, text, integer, text) from public, anon, authenticated;
revoke all on function app.public_submit_team_praise(text, text, text, text, text, uuid, text, text, smallint, integer, text, text) from public, anon, authenticated;

revoke all on function public.rpc_public_create_session(text, text, text, text, text, text, integer, integer, boolean, text, text) from public, anon, authenticated;
revoke all on function public.rpc_public_submit_response(text, text, text, text, text, smallint, text, smallint, integer, text, text) from public, anon, authenticated;
revoke all on function public.rpc_public_record_google_click(text, text, text, text, text, integer, text) from public, anon, authenticated;
revoke all on function public.rpc_public_submit_team_praise(text, text, text, text, text, uuid, text, text, smallint, integer, text, text) from public, anon, authenticated;

grant execute on function public.rpc_public_create_session(text, text, text, text, text, text, integer, integer, boolean, text, text) to service_role;
grant execute on function public.rpc_public_submit_response(text, text, text, text, text, smallint, text, smallint, integer, text, text) to service_role;
grant execute on function public.rpc_public_record_google_click(text, text, text, text, text, integer, text) to service_role;
grant execute on function public.rpc_public_submit_team_praise(text, text, text, text, text, uuid, text, text, smallint, integer, text, text) to service_role;

-- Verification.
do $$
begin
    assert (select has_function_privilege('service_role',
        'public.rpc_public_create_session(text, text, text, text, text, text, integer, integer, boolean, text, text)',
        'execute'));
    assert (select has_function_privilege('service_role',
        'public.rpc_public_submit_response(text, text, text, text, text, smallint, text, smallint, integer, text, text)',
        'execute'));
    assert (select has_function_privilege('service_role',
        'public.rpc_public_record_google_click(text, text, text, text, text, integer, text)',
        'execute'));
    assert (select has_function_privilege('service_role',
        'public.rpc_public_submit_team_praise(text, text, text, text, text, uuid, text, text, smallint, integer, text, text)',
        'execute'));
end;
$$;
