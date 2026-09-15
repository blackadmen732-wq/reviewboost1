-- What the click actually means.
--
-- `google_review_clicks` recorded one fact: the customer was handed to the
-- business's public review destination. It never meant a review was written,
-- submitted, or published — ReviewBoost cannot observe any of that — and the
-- table's own comment said so. But its name said "Google", and a name is what
-- a dashboard label, a metric, and the next engineer all copy.
--
-- The table is RENAMED rather than replaced, so every historical row survives
-- exactly as written, with its ids, its timestamps, and its unique constraint
-- on response_id intact. The provider column is added and backfilled to
-- 'google', which is what every existing row was.
--
-- The event is now: this customer selected the configured public review
-- destination, and here is which provider it was at the time.

alter table public.google_review_clicks
    rename to destination_selections;

alter table public.destination_selections
    rename column clicked_at to selected_at;

alter table public.destination_selections
    add column if not exists provider text;

-- Every row that existed was a Google handoff. Backfill before the column is
-- made mandatory, so the constraint can be trusted from here on.
update public.destination_selections
   set provider = 'google'
 where provider is null;

alter table public.destination_selections
    alter column provider set not null;

alter table public.destination_selections
    drop constraint if exists destination_selections_provider_check;
alter table public.destination_selections
    add constraint destination_selections_provider_check
        check (provider in ('google'));

comment on table public.destination_selections is
    'One row per customer response that was handed to the configured public review destination. It records the selection and the provider at that moment. It has never meant, and must never be reported as meaning, that a review was written, submitted, or published — ReviewBoost cannot observe any of those. Any metric built on this table must be named for the selection, not for an outcome.';
comment on column public.destination_selections.provider is
    'The destination provider the customer was handed to, as configured at that moment. Historical rows are ''google''.';

-- Renames carry indexes, constraints, policies, and grants with them. The
-- names are brought in line so nothing in the schema still says "google
-- click".
alter index if exists google_review_clicks_org_location_time_idx
    rename to destination_selections_org_location_time_idx;
alter table public.destination_selections
    rename constraint google_review_clicks_response_key to destination_selections_response_key;
alter table public.destination_selections
    rename constraint google_review_clicks_response_fk to destination_selections_response_fk;
alter table public.destination_selections
    rename constraint google_review_clicks_location_fk to destination_selections_location_fk;
alter policy google_review_clicks_select on public.destination_selections
    rename to destination_selections_select;

-- ======================================================== the write =========

-- Replaces rpc_public_record_google_click. Same transactional shape — one RPC,
-- one transaction, the idempotency claim and the domain write committing
-- together — with the provider taken from the resolved location rather than
-- assumed.
create or replace function public.rpc_public_record_destination_selection(
    p_token_hash                   text,
    p_idempotency_key              text,
    p_request_hash                 text,
    p_session_token_hash           text,
    p_response_token_hash          text,
    p_idempotency_ttl_seconds      integer,
    p_previous_token_hash          text default null,
    p_previous_session_token_hash  text default null,
    p_previous_response_token_hash text default null
)
returns table (
    outcome                  text,
    response_status          smallint,
    response_body_encrypted  text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    stand        record;
    claim        record;
    resp         public.customer_responses%rowtype;
    scope_key    text;
    v_operation  text := 'destination-selection';
    old_replay   record;
begin
    select * into stand
      from app.resolve_public_stand(p_token_hash, p_previous_token_hash);
    if stand.stand_id is null then
        return query select 'unknown_stand'::text, null::smallint, null::text;
        return;
    end if;

    -- A stand whose door is not configured never reached a customer, so a
    -- selection against it is not a thing that can have happened.
    if stand.destination_provider is null or stand.destination_url is null then
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

    select r.* into resp
      from public.customer_responses r
      join public.public_review_sessions s on s.id = r.session_id
     where (r.response_token_hash = p_response_token_hash
            or (p_previous_response_token_hash is not null
                and r.response_token_hash = p_previous_response_token_hash))
       and r.stand_id = stand.stand_id
       and (s.session_token_hash = p_session_token_hash
            or (p_previous_session_token_hash is not null
                and s.session_token_hash = p_previous_session_token_hash));

    if resp.id is null then
        perform app.release_idempotency(v_operation, scope_key, p_idempotency_key);
        return query select 'response_not_found'::text, null::smallint, null::text;
        return;
    end if;

    insert into public.destination_selections (org_id, location_id, response_id, provider)
    values (resp.org_id, resp.location_id, resp.id, stand.destination_provider)
    on conflict (response_id) do nothing;

    perform app.complete_idempotency(v_operation, scope_key, p_idempotency_key,
                                     204::smallint, null);

    return query select 'created'::text, 204::smallint, null::text;
end;
$$;

revoke all on function public.rpc_public_record_destination_selection(
    text, text, text, text, text, integer, text, text, text)
    from public, anon, authenticated;
grant execute on function public.rpc_public_record_destination_selection(
    text, text, text, text, text, integer, text, text, text)
    to service_role;

-- The Google-named write is gone. Its rows are not: they are the historical
-- head of destination_selections.
drop function if exists public.rpc_public_record_google_click(
    text, text, text, text, text, integer, text, text, text);
drop function if exists public.rpc_public_record_google_click(
    text, text, text, text, text, integer);
