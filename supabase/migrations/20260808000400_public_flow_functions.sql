-- ReviewBoost public customer flow — transactional functions
--
-- WHY THESE EXIST
-- ---------------
-- Each PostgREST RPC call is one transaction. Splitting "claim the idempotency
-- key" and "do the work" into two calls would put a commit between them, and
-- two racing retries could both pass the claim. So each public operation is a
-- single function that claims, works, and records the result together — one
-- transaction, or nothing.
--
-- A client timeout therefore cannot produce a session, response, click, or
-- praise record with no stored result to replay. There is no window in which
-- half of it happened.
--
-- WHY SECURITY DEFINER IS CORRECT HERE
-- ------------------------------------
-- The customer is anonymous. There is no `auth.uid()`, so no RLS policy could
-- ever grant them the write, and loosening the policies to admit them would
-- open the same door to every other anonymous caller.
--
-- These functions are the narrow alternative: they derive org, location, and
-- stand from the token digest and can touch exactly one business. **None of
-- them accepts an org_id, location_id, or stand_id.** A caller who could name a
-- tenant could write unlimited fabricated feedback into it, which is precisely
-- the attack the token indirection prevents.
--
-- EXECUTE is revoked from PUBLIC, anon, and authenticated, and granted only to
-- service_role — so they are unreachable from a browser even with a valid
-- Supabase session.
--
-- REVIEW INTEGRITY
-- ----------------
-- No function below reads `rating` to decide anything. It is stored and never
-- branched on.

-- --------------------------------------------------- idempotency claim ----

-- How long an unfinished claim may sit before another request may take it over.
-- Only reachable if the backend died mid-transaction; an ordinary failure rolls
-- the claim back with the work.
create or replace function app.claim_idempotency(
    p_org_id           uuid,
    p_operation        text,
    p_scope_key        text,
    p_idempotency_key  text,
    p_request_hash     text,
    p_ttl_seconds      integer,
    p_stale_seconds    integer default 60
)
returns table (outcome text, response_status smallint, response_body_encrypted text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    claimed_id uuid;
    existing   public.idempotency_records%rowtype;
begin
    -- `on conflict do nothing` waits for a concurrent uncommitted insert of the
    -- same key rather than racing it. That is what makes two simultaneous
    -- retries produce one row: the loser blocks until the winner commits, then
    -- reads the completed record below and replays it.
    insert into public.idempotency_records
        (org_id, operation, scope_key, idempotency_key, request_hash, expires_at)
    values
        (p_org_id, p_operation, p_scope_key, p_idempotency_key, p_request_hash,
         now() + make_interval(secs => p_ttl_seconds))
    on conflict (operation, scope_key, idempotency_key) do nothing
    returning id into claimed_id;

    if claimed_id is not null then
        return query select 'claimed'::text, null::smallint, null::text;
        return;
    end if;

    select * into existing
      from public.idempotency_records r
     where r.operation = p_operation
       and r.scope_key = p_scope_key
       and r.idempotency_key = p_idempotency_key
       for update;

    -- Past retention, so there is nothing left to replay. Reusing the key after
    -- that window starts a fresh operation rather than returning stale data.
    if existing.id is null or existing.expires_at <= now() then
        delete from public.idempotency_records r
         where r.operation = p_operation
           and r.scope_key = p_scope_key
           and r.idempotency_key = p_idempotency_key;

        insert into public.idempotency_records
            (org_id, operation, scope_key, idempotency_key, request_hash, expires_at)
        values
            (p_org_id, p_operation, p_scope_key, p_idempotency_key, p_request_hash,
             now() + make_interval(secs => p_ttl_seconds));

        return query select 'claimed'::text, null::smallint, null::text;
        return;
    end if;

    -- Checked before state: a retry carrying different data is a conflict, and
    -- must never be answered with somebody else's stored result.
    if existing.request_hash <> p_request_hash then
        return query select 'conflict'::text, null::smallint, null::text;
        return;
    end if;

    if existing.state = 'completed' then
        return query select 'replay'::text,
                            existing.response_status,
                            existing.response_body_encrypted;
        return;
    end if;

    if existing.claimed_at <= now() - make_interval(secs => p_stale_seconds) then
        update public.idempotency_records r
           set claimed_at = now(),
               expires_at = now() + make_interval(secs => p_ttl_seconds)
         where r.id = existing.id;

        return query select 'claimed'::text, null::smallint, null::text;
        return;
    end if;

    return query select 'in_progress'::text, null::smallint, null::text;
end;
$$;

create or replace function app.complete_idempotency(
    p_operation       text,
    p_scope_key       text,
    p_idempotency_key text,
    p_status          smallint,
    p_body_encrypted  text
)
returns void
language sql
security definer
set search_path = ''
as $$
    update public.idempotency_records r
       set state = 'completed',
           response_status = p_status,
           response_body_encrypted = p_body_encrypted,
           completed_at = now()
     where r.operation = p_operation
       and r.scope_key = p_scope_key
       and r.idempotency_key = p_idempotency_key;
$$;

-- A domain precondition failed after the claim was taken. Releasing it keeps
-- the key usable, so a customer who corrects the problem and retries is not
-- locked out until retention expires.
create or replace function app.release_idempotency(
    p_operation       text,
    p_scope_key       text,
    p_idempotency_key text
)
returns void
language sql
security definer
set search_path = ''
as $$
    delete from public.idempotency_records r
     where r.operation = p_operation
       and r.scope_key = p_scope_key
       and r.idempotency_key = p_idempotency_key
       and r.state = 'in_progress';
$$;

-- ------------------------------------------------------ public context ----

-- Read-only. Records nothing: a link preview, a crawler, or an owner refreshing
-- the page must not inflate a business's numbers, so the scan is recorded when
-- a session is created instead.
--
-- Returns no row for an unknown, paused, or retired stand, so the caller cannot
-- tell them apart.
create or replace function app.resolve_public_stand(p_token_hash text)
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
security definer
set search_path = ''
as $$
    select o.id,
           l.id,
           s.id,
           o.name,
           l.name,
           l.google_review_url,
           coalesce(l.default_locale, o.default_locale)
      from public.review_stands s
      join public.locations l on l.id = s.location_id and l.org_id = s.org_id
      join public.organizations o on o.id = s.org_id
     where s.public_token_hash = p_token_hash
       and s.status = 'active'
       and l.status = 'active'
       and o.status = 'active';
$$;

-- ---------------------------------------------------- create session ------

create or replace function app.public_create_session(
    p_token_hash          text,
    p_idempotency_key     text,
    p_request_hash        text,
    p_session_token_hash  text,
    p_locale              text,
    p_client_hash         text,
    p_session_ttl_seconds integer,
    p_idempotency_ttl_seconds integer,
    p_record_scan         boolean,
    p_response_body_encrypted text
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
    select * into stand from app.resolve_public_stand(p_token_hash);
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

    -- Bots get a working session but are never counted, so scan numbers stay
    -- meaningful to the business paying for them.
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
    p_response_body_encrypted text
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
    select * into stand from app.resolve_public_stand(p_token_hash);
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

    -- Scoped to the stand, so a session issued at one business is simply not
    -- found at another rather than being reported as belonging elsewhere.
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

    -- The rating is stored exactly as given. Nothing here reads it.
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

-- Records that the Google action was *selected*. Not that a review was written,
-- submitted, or published — ReviewBoost cannot observe any of that.
create or replace function app.public_record_google_click(
    p_token_hash              text,
    p_idempotency_key         text,
    p_request_hash            text,
    p_session_token_hash      text,
    p_response_token_hash     text,
    p_idempotency_ttl_seconds integer
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
    select * into stand from app.resolve_public_stand(p_token_hash);
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

    -- Stand, session, and response must all agree. A response token on its own
    -- is not enough: that is what stops one leaked token being replayed against
    -- a different session or a different business.
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

    -- Deduplicated per response, so a customer who taps twice — or reopens the
    -- tab, generating a fresh idempotency key — produces one record.
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
    p_first_name_encrypted    text,
    p_note_encrypted          text,
    p_key_version             smallint,
    p_idempotency_ttl_seconds integer,
    p_response_body_encrypted text
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
    select * into stand from app.resolve_public_stand(p_token_hash);
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

    -- Deliberately does not select r.rating. Team Praise never sees it.
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

    -- Stored unmatched. Matching is a human decision made later, with the
    -- rating deliberately out of view.
    insert into public.team_praise_records
        (org_id, location_id, response_id, first_name_encrypted,
         praise_note_encrypted, encryption_key_version, status)
    values
        (resp.org_id, resp.location_id, resp.id, p_first_name_encrypted,
         p_note_encrypted, p_key_version, 'unmatched');

    perform app.complete_idempotency(operation, scope_key, p_idempotency_key,
                                     201::smallint, p_response_body_encrypted);

    return query select 'created'::text, 201::smallint, p_response_body_encrypted;
end;
$$;

-- ------------------------------------------------------------ retention ---

-- Sessions are not deleted: a session is the scan a business paid for, and
-- customer_responses cascades from it, so removing one to expire a hash would
-- destroy business history. Only the short-lived client hash is scrubbed.
create or replace function app.purge_public_flow_ephemera(
    p_client_hash_retention_days integer default 7
)
returns table (client_hashes_scrubbed integer, idempotency_records_purged integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
    scrubbed integer;
    purged   integer;
begin
    update public.public_review_sessions s
       set client_hash = null
     where s.client_hash is not null
       and s.created_at <= now() - make_interval(days => p_client_hash_retention_days);
    get diagnostics scrubbed = row_count;

    delete from public.idempotency_records r where r.expires_at <= now();
    get diagnostics purged = row_count;

    return query select scrubbed, purged;
end;
$$;

-- ------------------------------------------------------------- grants -----
--
-- Unreachable from a browser even with a valid Supabase session. Only the
-- server, holding the service-role key, may call these.

revoke all on function app.claim_idempotency(uuid, text, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function app.complete_idempotency(text, text, text, smallint, text) from public, anon, authenticated;
revoke all on function app.release_idempotency(text, text, text) from public, anon, authenticated;
revoke all on function app.resolve_public_stand(text) from public, anon, authenticated;
revoke all on function app.public_create_session(text, text, text, text, text, text, integer, integer, boolean, text) from public, anon, authenticated;
revoke all on function app.public_submit_response(text, text, text, text, text, smallint, text, smallint, integer, text) from public, anon, authenticated;
revoke all on function app.public_record_google_click(text, text, text, text, text, integer) from public, anon, authenticated;
revoke all on function app.public_submit_team_praise(text, text, text, text, text, text, text, smallint, integer, text) from public, anon, authenticated;
revoke all on function app.purge_public_flow_ephemera(integer) from public, anon, authenticated;

grant execute on function app.resolve_public_stand(text) to service_role;
grant execute on function app.public_create_session(text, text, text, text, text, text, integer, integer, boolean, text) to service_role;
grant execute on function app.public_submit_response(text, text, text, text, text, smallint, text, smallint, integer, text) to service_role;
grant execute on function app.public_record_google_click(text, text, text, text, text, integer) to service_role;
grant execute on function app.public_submit_team_praise(text, text, text, text, text, text, text, smallint, integer, text) to service_role;
grant execute on function app.purge_public_flow_ephemera(integer) to service_role;
