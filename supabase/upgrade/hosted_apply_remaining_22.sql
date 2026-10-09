-- ============================================================================
-- ReviewBoost — bring the live Supabase database up to the code's schema
-- ============================================================================
--
-- WHAT THIS IS
--   The 22 migrations the live database is still missing, in order, verbatim
--   from the repository, plus the ledger row each one owes.
--
--   Already applied earlier (nothing to do): the 8 Text Requests / dashboard
--   migrations. After this runs the ledger holds all 66 names the build's
--   readiness gate checks for.
--
-- HOW TO RUN IT
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file
--   -> Run. It is wrapped in a single transaction: either every migration
--   lands or none of them do, so a failure leaves the database exactly as it
--   is now -- and running it twice is harmless for the same reason. The
--   editor will warn that the query is destructive: it is, on purpose. Four
--   existing functions (app.resolve_public_stand, rpc_public_resolve_stand,
--   rpc_create_stand, rpc_public_record_google_click) are dropped and
--   recreated with wider return types, which is the only way Postgres lets a
--   function change its result columns. Confirm it.
--
-- WHY A PASTE AND NOT ME
--   This session's Supabase tool refuses any statement beginning with DROP
--   without an interactive confirmation it cannot collect, and nine of these
--   migrations drop a function, policy or trigger before recreating it.
--   Nothing here is edited to work around that: it is the repository files,
--   byte for byte.
--
-- ============================================================================

begin;

-- ===========================================================================
-- MIGRATION: 20260915000100_destination_persistence.sql
-- ===========================================================================

-- ReviewBoost owns the door.
--
-- WHAT THIS CHANGES
-- -----------------
-- A Tag's QR and NFC carry one ReviewBoost URL, `/q/{token}`, and nothing
-- else. Where that door leads is server state — so it can be changed without
-- reprinting a single sticker or reprogramming a single chip.
--
-- Until now the only thing behind the door was `locations.google_review_url`,
-- a single text column. That made Google the architecture rather than the
-- first provider in it. This adds `destination_provider` and
-- `destination_url`, which together are the canonical destination, and
-- backfills them from every `google_review_url` that passes validation.
--
-- `google_review_url` IS DELIBERATELY NOT DROPPED. It stays as a
-- compatibility column, kept in step by the owner write path, for as long as
-- any reader still expects it. The canonical truth is the destination pair.
--
-- FAIL CLOSED
-- -----------
-- An unknown provider is rejected, not stored and ignored. A URL that is not
-- on that provider's host allowlist is rejected. HTTPS only, no credentials in
-- the authority, no ports. A location with no valid destination resolves to a
-- closed door, which the public API renders as the same dead link as an
-- unknown token.

-- ============================================================ validator =====

-- The provider-aware gate. Delegates to the existing Google validator for the
-- one provider V1 enables, and refuses everything else — so adding a provider
-- is a deliberate act here, never an accident at a call site.
create or replace function public._validate_destination_url(
    p_provider text,
    p_url      text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
    if p_provider is null or p_url is null then
        return false;
    end if;

    if p_provider = 'google' then
        return public._validate_google_review_url(p_url);
    end if;

    -- Unknown provider. There is no general "any HTTPS URL" branch and there
    -- must never be one: this function is the only thing standing between a
    -- compromised owner account and an open redirect on every Tag.
    return false;
end;
$$;

revoke all on function public._validate_destination_url(text, text)
    from public, anon;
grant execute on function public._validate_destination_url(text, text)
    to authenticated, service_role;

-- ================================================== destination columns =====

alter table public.locations
    add column if not exists destination_provider text,
    add column if not exists destination_url text;

comment on column public.locations.destination_provider is
    'Review destination provider. V1 enables ''google'' only. Null means no destination is configured and the door stays closed.';
comment on column public.locations.destination_url is
    'The validated destination URL for the configured provider. Canonical: google_review_url is compatibility storage only.';

-- Both set or both null. A provider with no URL and a URL with no provider are
-- each a half-configured door, and a half-configured door is the state where
-- someone reads one column and ignores the other.
alter table public.locations
    drop constraint if exists locations_destination_pair_check;
alter table public.locations
    add constraint locations_destination_pair_check
        check (
            (destination_provider is null and destination_url is null)
            or (destination_provider is not null and destination_url is not null)
        );

-- The allowlist, enforced by the database rather than trusted from the caller.
-- A direct UPDATE by a future migration, a console session, or a bug in an RPC
-- cannot store a destination this rejects.
alter table public.locations
    drop constraint if exists locations_destination_valid_check;
alter table public.locations
    add constraint locations_destination_valid_check
        check (
            destination_url is null
            or public._validate_destination_url(destination_provider, destination_url)
        );

-- ======================================================== backfill ==========

-- Every location whose existing Google URL still passes validation keeps
-- working with no owner action. One that does not is left with a null
-- destination: a closed door an owner can see and fix, rather than a URL the
-- resolver would reject on every scan.
update public.locations
   set destination_provider = 'google',
       destination_url      = google_review_url
 where destination_provider is null
   and google_review_url is not null
   and public._validate_google_review_url(google_review_url);

-- ============================================ compatibility window =========

-- For as long as `google_review_url` is still written — by the legacy owner
-- RPC, by a seed file, by a test fixture — the canonical destination has to
-- follow it, or a door configured through the old path would resolve as
-- closed. A trigger makes that true for every writer, including ones nobody
-- remembered to update, which is the whole risk of a compatibility window.
--
-- It only ever fills in a destination the caller did not set explicitly: a
-- write that names destination_provider/destination_url wins, because that is
-- the canonical path. An invalid Google URL leaves the destination null and
-- the door closed, which is the safe direction.
create or replace function app.sync_destination_from_google_url()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.destination_url is distinct from coalesce(old.destination_url, null)
       or new.destination_provider is distinct from coalesce(old.destination_provider, null) then
        -- The caller set the canonical fields. Leave them alone.
        return new;
    end if;

    if new.google_review_url is null or new.google_review_url = '' then
        new.destination_provider := null;
        new.destination_url      := null;
        return new;
    end if;

    if public._validate_google_review_url(new.google_review_url) then
        new.destination_provider := 'google';
        new.destination_url      := new.google_review_url;
    else
        new.destination_provider := null;
        new.destination_url      := null;
    end if;

    return new;
end;
$$;

drop trigger if exists locations_sync_destination on public.locations;
create trigger locations_sync_destination
    before insert or update of google_review_url, destination_provider, destination_url
    on public.locations
    for each row
    execute function app.sync_destination_from_google_url();

-- ================================================ resolver return shape =====

-- `create or replace function` cannot change a function's return type, and
-- `app.resolve_public_stand` is gaining two columns. The wrapper is dropped
-- first because it is the only object that names the old signature; the
-- plpgsql write functions read the result into a `record`, so they take the
-- wider row without change. Grants do not survive a drop and are restored
-- below.
drop function if exists public.rpc_public_resolve_stand(text, text);
drop function if exists app.resolve_public_stand(text, text);

/**
 * Resolve a stand to the business, the location, and the door behind it.
 *
 * Returns no row for an unknown, paused, or retired stand, an inactive
 * location, or a suspended organization — all of which stay indistinguishable
 * from each other and from a token that never existed.
 *
 * `p_previous_token_hash` is null outside a key rotation. The matched version
 * comes back so the caller knows whether a re-digest is owed.
 */
create function app.resolve_public_stand(
    p_token_hash          text,
    p_previous_token_hash text default null
)
returns table (
    org_id               uuid,
    location_id          uuid,
    stand_id             uuid,
    business_name        text,
    location_name        text,
    google_review_url    text,
    destination_provider text,
    destination_url      text,
    default_locale       text,
    matched_key_version  smallint
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
           l.destination_provider,
           l.destination_url,
           coalesce(l.default_locale, o.default_locale),
           s.public_token_key_version
      from public.review_stands s
      join public.locations l on l.id = s.location_id and l.org_id = s.org_id
      join public.organizations o on o.id = s.org_id
     where (s.public_token_hash = p_token_hash
            or (p_previous_token_hash is not null
                and s.public_token_hash = p_previous_token_hash))
       and s.status = 'active'
       and l.status = 'active'
       and o.status = 'active';
$$;

create function public.rpc_public_resolve_stand(
    p_token_hash          text,
    p_previous_token_hash text default null
)
returns table (
    org_id               uuid,
    location_id          uuid,
    stand_id             uuid,
    business_name        text,
    location_name        text,
    google_review_url    text,
    destination_provider text,
    destination_url      text,
    default_locale       text,
    matched_key_version  smallint
)
language sql
stable
security invoker
set search_path = ''
as $$
    select * from app.resolve_public_stand(p_token_hash, p_previous_token_hash);
$$;

revoke all on function app.resolve_public_stand(text, text)
    from public, anon, authenticated;
grant execute on function app.resolve_public_stand(text, text) to service_role;

revoke all on function public.rpc_public_resolve_stand(text, text)
    from public, anon, authenticated;
grant execute on function public.rpc_public_resolve_stand(text, text) to service_role;


insert into supabase_migrations.schema_migrations (version, name)
values ('20260915000100', 'destination_persistence')
on conflict do nothing;

-- ===========================================================================
-- MIGRATION: 20260915000200_destination_selection_events.sql
-- ===========================================================================

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


insert into supabase_migrations.schema_migrations (version, name)
values ('20260915000200', 'destination_selection_events')
on conflict do nothing;

-- ===========================================================================
-- MIGRATION: 20260915000300_owner_destination_write.sql
-- ===========================================================================

-- The owner's write authority over the door.
--
-- Changing where a Tag leads must never change the Tag. Same token, same QR,
-- same NFC chip, same `/q/{token}` — and the very next scan arrives at the new
-- destination. That is the whole point of ReviewBoost owning the door, and it
-- only holds if there is one authoritative, authorised write for it.
--
-- `rpc_update_location(p_google_review_url)` is not that write. It names one
-- provider in its signature, and it takes no organization, so which business
-- is being changed is inferred from the location id alone. This adds a write
-- that takes the selected organization explicitly, proves the caller may act
-- for it, validates the destination server-side, and records an audit event.
--
-- The legacy RPC keeps working for names; its Google field stays in step
-- through the compatibility trigger. It is no longer the authority.

create or replace function public.rpc_update_location_destination(
    p_org_id      uuid,
    p_location_id uuid,
    p_provider    text,
    p_url         text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor        uuid := (select auth.uid());
    v_location_org uuid;
    v_cur_provider text;
    v_cur_url      text;
    v_clearing     boolean;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    if p_org_id is null or p_location_id is null then
        raise exception 'org and location are required' using errcode = 'P0001';
    end if;

    v_clearing := p_url is null or btrim(p_url) = '';

    -- An unknown provider is refused before anything is read, so a typo in a
    -- provider name can never be stored as a destination nobody validates.
    if not v_clearing and (p_provider is null or p_provider not in ('google')) then
        raise exception 'unknown_destination_provider' using errcode = 'P0001';
    end if;

    if not v_clearing then
        p_url := btrim(p_url);
        if not public._validate_destination_url(p_provider, p_url) then
            raise exception 'invalid_destination_url' using errcode = 'P0001';
        end if;
    end if;

    select org_id, destination_provider, destination_url
      into v_location_org, v_cur_provider, v_cur_url
      from public.locations
     where id = p_location_id
     for update;

    -- Three different failures — no such location, a location in another
    -- organization, and a caller who may not act for this one — deliberately
    -- raise the same error. Telling them apart would confirm that a guessed
    -- location id is real and which tenant owns it.
    if v_location_org is null or v_location_org <> p_org_id then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    if not exists (
        select 1 from public.organization_members
         where org_id = p_org_id
           and user_id = v_actor
           and status = 'active'
           and role in ('owner', 'admin')
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    if v_clearing then
        if v_cur_provider is null and v_cur_url is null then
            return;
        end if;
        update public.locations
           set destination_provider = null,
               destination_url      = null,
               google_review_url    = null,
               updated_at           = now()
         where id = p_location_id
           and org_id = p_org_id;
    else
        if v_cur_provider is not distinct from p_provider
           and v_cur_url is not distinct from p_url then
            return;
        end if;
        update public.locations
           set destination_provider = p_provider,
               destination_url      = p_url,
               -- Compatibility storage, kept in step for as long as anything
               -- still reads it. Only Google has a legacy column to mirror.
               google_review_url    = case
                                          when p_provider = 'google' then p_url
                                          else google_review_url
                                      end,
               updated_at           = now()
         where id = p_location_id
           and org_id = p_org_id;
    end if;

    -- The URLs are recorded because a destination is public information an
    -- owner chose, and "who pointed our Tags somewhere else, and when" is
    -- exactly the question an audit log exists to answer.
    perform app.record_audit_event(
        p_org_id,
        'location.destination_updated',
        'location',
        p_location_id::text,
        null,
        jsonb_build_object(
            'from_provider', v_cur_provider,
            'to_provider',   case when v_clearing then null else p_provider end,
            'from_url',      v_cur_url,
            'to_url',        case when v_clearing then null else p_url end
        )
    );
end;
$$;

revoke all on function public.rpc_update_location_destination(uuid, uuid, text, text)
    from public, anon;
grant execute on function public.rpc_update_location_destination(uuid, uuid, text, text)
    to authenticated;

-- ===================================================== audit allowlist ======

-- The audit recorder refuses any action name not on its list, which is what
-- keeps the log a closed vocabulary rather than free text. The new action has
-- to be added there deliberately. Everything else about this function is
-- unchanged from 20260811000100.
create or replace function app.record_audit_event(
    p_org_id      uuid,
    p_action      text,
    p_target_type text,
    p_target_id   text,
    p_request_id  text default null,
    p_metadata    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    actor uuid := (select auth.uid());
    allowed_actions constant text[] := array[
        'stand.token_rotated',
        'stand.created',
        'stand.deactivated',
        'location.created',
        'location.updated',
        'location.destination_updated',
        'member.role_changed',
        'member.suspended',
        'member.removed',
        'member.invited',
        'organization.created',
        'organization.updated',
        'staff.created',
        'staff.updated'
    ];
begin
    if actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    if p_action is null or not (p_action = any(allowed_actions)) then
        raise exception 'unknown audit action: %', coalesce(p_action, '(null)')
            using errcode = '42501';
    end if;

    if not exists (
        select 1 from public.organization_members m
         where m.org_id = p_org_id and m.user_id = actor and m.status = 'active'
    ) then
        raise exception 'not a member of that organization' using errcode = '42501';
    end if;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
    values
        (p_org_id, actor, 'user', p_action, p_target_type, p_target_id, p_request_id, p_metadata);
end;
$$;

revoke all on function app.record_audit_event(uuid, text, text, text, text, jsonb)
    from public, anon;


insert into supabase_migrations.schema_migrations (version, name)
values ('20260915000300', 'owner_destination_write')
on conflict do nothing;

-- ===========================================================================
-- MIGRATION: 20260915000400_entitlements.sql
-- ===========================================================================

-- What a business is entitled to, in one place the database can enforce.
--
-- This is not the money system. Stripe, the seven-day clock, invoices and SMS
-- credits land later and write into this table. What lands here is the single
-- honest answer to "may this organization do that?", held where a concurrent
-- request cannot get a different answer than the one before it.
--
-- THE RULES THIS ENCODES
-- ----------------------
-- There is no permanent free plan. An organization that has not paid is
-- `trialing`, never a free Starter, and a missing entitlement row is not a
-- generous default — it is a closed door. Every limit below is enforced by the
-- database; an HTTP pre-check exists only so an owner gets a sentence instead
-- of a 500.
--
--   plan      price   locations  Tags  monthly SMS segments
--   trial     $0          1        1     0
--   starter   $49         1        3   150
--   growth    $79         2        8   500
--   pro       $129        5       25  1500
--
-- PAST_DUE IS A GRACE PERIOD, NOT A SHUTDOWN
-- ------------------------------------------
-- A failed card closes nothing a customer can see. The door stays open while
-- `past_due` so a business does not lose a day of reviews to a bank's fraud
-- heuristic, but nothing new may be created. Suspension — the end of dunning,
-- or a deliberate act — is what closes the door. Cancellation closes it too,
-- and neither deletes anything: the Tags, the ratings and the destination all
-- survive so that paying again reopens the same physical Tag.

-- ============================================================ the table =====

create table if not exists public.entitlement_snapshots (
    org_id                uuid primary key references public.organizations (id) on delete cascade,
    -- Null only before a plan has been chosen. A trial requires a selected
    -- future paid plan, so this stops being null once billing lands; a status
    -- other than `trialing` may never have a null plan.
    plan_id               text check (plan_id is null or plan_id in ('starter', 'growth', 'pro')),
    status                text not null
        check (status in ('trialing', 'active', 'past_due', 'cancelled', 'suspended')),
    -- Tracked separately from `status`, because "cancelling at the end of the
    -- period" is an active subscription that still works, and conflating the
    -- two is how a business loses service it has paid for.
    cancel_at_period_end  boolean not null default false,
    trial_ends_at         timestamptz,
    current_period_end    timestamptz,
    -- Where this state came from: a Stripe event id, a backfill, an admin
    -- action. An entitlement nobody can explain is one nobody can correct.
    source                text not null check (char_length(source) between 1 and 200),
    updated_at            timestamptz not null default now(),

    constraint entitlement_plan_required_when_not_trialing
        check (status = 'trialing' or plan_id is not null)
);

comment on table public.entitlement_snapshots is
    'The authoritative answer to what an organization may do. Written only by the service role and by the billing pipeline; readable by that organization''s members. A missing row means no entitlement, which fails closed.';

alter table public.entitlement_snapshots enable row level security;

revoke all on public.entitlement_snapshots from public, anon, authenticated;
grant select on public.entitlement_snapshots to authenticated;

drop policy if exists entitlement_snapshots_select on public.entitlement_snapshots;
create policy entitlement_snapshots_select on public.entitlement_snapshots
    for select to authenticated
    using (app.is_org_member(org_id));

-- ========================================================== the limits ======

-- One mapping, in the database, because the database is what enforces it. A
-- frontend constant is a label; it is never the authority.
create or replace function app.entitlement_tag_limit(p_plan_id text, p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
    select case
        when p_status = 'trialing' then 1
        when p_status = 'active' and p_plan_id = 'starter' then 3
        when p_status = 'active' and p_plan_id = 'growth' then 8
        when p_status = 'active' and p_plan_id = 'pro' then 25
        else 0
    end;
$$;

create or replace function app.entitlement_location_limit(p_plan_id text, p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
    select case
        when p_status = 'trialing' then 1
        when p_status = 'active' and p_plan_id = 'starter' then 1
        when p_status = 'active' and p_plan_id = 'growth' then 2
        when p_status = 'active' and p_plan_id = 'pro' then 5
        else 0
    end;
$$;

-- The monthly included allowance a *successful paid invoice* mints. Nothing
-- mints it on checkout or on subscription creation, and a trial gets none.
create or replace function app.entitlement_monthly_sms(p_plan_id text)
returns integer
language sql
immutable
set search_path = ''
as $$
    select case p_plan_id
        when 'starter' then 150
        when 'growth' then 500
        when 'pro' then 1500
        else 0
    end;
$$;

-- Whether the public door opens at all. See the note above on past_due.
create or replace function app.entitlement_allows_service(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
    select p_status in ('trialing', 'active', 'past_due');
$$;

revoke all on function app.entitlement_tag_limit(text, text) from public, anon, authenticated;
revoke all on function app.entitlement_location_limit(text, text) from public, anon, authenticated;
revoke all on function app.entitlement_monthly_sms(text) from public, anon, authenticated;
revoke all on function app.entitlement_allows_service(text) from public, anon, authenticated;

-- ========================================================== the backfill ====

-- Organizations that existed before billing are trialing. They are explicitly
-- NOT called active Starter: inventing a paid plan for someone who never paid
-- is the exact failure this table exists to prevent.
insert into public.entitlement_snapshots (org_id, plan_id, status, source)
select o.id, null, 'trialing', 'pre_billing_backfill'
  from public.organizations o
on conflict (org_id) do nothing;

-- Every organization created from here on gets its entitlement in the same
-- transaction as the organization itself, so there is no window in which a
-- business exists with no answer to "what may it do?".
create or replace function app.initialize_entitlement_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.entitlement_snapshots (org_id, plan_id, status, source)
    values (new.id, null, 'trialing', 'onboarding')
    on conflict (org_id) do nothing;
    return new;
end;
$$;

revoke all on function app.initialize_entitlement_snapshot() from public, anon, authenticated;

drop trigger if exists organizations_initialize_entitlement on public.organizations;
create trigger organizations_initialize_entitlement
    after insert on public.organizations
    for each row
    execute function app.initialize_entitlement_snapshot();

-- ==================================================== payment and the door ==

-- The door now also asks whether the account is entitled to service. A
-- suspended or cancelled business's Tags resolve to exactly the same neutral
-- dead link as an unknown token: the customer standing at the counter is not
-- who "this business has not paid" is for, and saying it would be a disclosure
-- about the business to anyone holding a token.
--
-- Nothing is deleted. The Tag, its token, its QR, its NFC chip and every
-- rating survive, so paying again reopens the same physical Tag rather than
-- requiring a reprint.
--
-- The return shape is unchanged, so this one can be replaced in place.
create or replace function app.resolve_public_stand(
    p_token_hash          text,
    p_previous_token_hash text default null
)
returns table (
    org_id               uuid,
    location_id          uuid,
    stand_id             uuid,
    business_name        text,
    location_name        text,
    google_review_url    text,
    destination_provider text,
    destination_url      text,
    default_locale       text,
    matched_key_version  smallint
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
           l.destination_provider,
           l.destination_url,
           coalesce(l.default_locale, o.default_locale),
           s.public_token_key_version
      from public.review_stands s
      join public.locations l on l.id = s.location_id and l.org_id = s.org_id
      join public.organizations o on o.id = s.org_id
      join public.entitlement_snapshots e on e.org_id = o.id
     where (s.public_token_hash = p_token_hash
            or (p_previous_token_hash is not null
                and s.public_token_hash = p_previous_token_hash))
       and s.status = 'active'
       and l.status = 'active'
       and o.status = 'active'
       and app.entitlement_allows_service(e.status);
$$;

revoke all on function app.resolve_public_stand(text, text)
    from public, anon, authenticated;
grant execute on function app.resolve_public_stand(text, text) to service_role;


insert into supabase_migrations.schema_migrations (version, name)
values ('20260915000400', 'entitlements')
on conflict do nothing;

-- ===========================================================================
-- MIGRATION: 20260915000500_tag_and_location_caps.sql
-- ===========================================================================

-- Caps the database enforces, and a Tag that cannot be created half-made.
--
-- TWO DEFECTS THIS CLOSES
-- -----------------------
-- 1. `rpc_create_stand` inserted the Tag, and the encrypted copy of its token —
--    the only thing that makes a reprint or an NFC rewrite possible — was
--    stored by a *second* call afterwards, whose error was discarded. A Tag
--    could therefore exist, be reported as created, and be impossible to
--    reprint. Creation now takes the ciphertext and stores it in the same
--    statement, and refuses anything that is not the envelope `encrypt()`
--    writes. If the ciphertext is not there, the Tag is not there.
--
-- 2. Nothing counted. Plan limits lived in HTTP handlers, where two concurrent
--    creates both read "2 of 3 used" and both insert. The count now happens
--    behind a lock on the organization's entitlement row, so the second
--    request counts what the first one committed.
--
-- The lock is on `entitlement_snapshots`, not on the Tags: it is one row per
-- organization, it is the thing being spent, and taking it also means a
-- concurrent billing write cannot change the plan underneath a create that is
-- already counting against the old one.

-- ======================================================= Tag creation =======

-- The old seven-argument form is dropped rather than left beside the new one.
-- An overload without the ciphertext is a path back to the defect.
drop function if exists public.rpc_create_stand(uuid, uuid, text, text, text, smallint, text);
drop function if exists public.rpc_create_stand(uuid, uuid, text, text, text, smallint, text, text, smallint);

create function public.rpc_create_stand(
    p_org_id             uuid,
    p_location_id        uuid,
    p_label              text,
    p_stand_token_hash   text,
    p_stand_token_prefix text,
    p_token_key_version  smallint,
    p_request_id         text,
    p_token_ciphertext   text,
    p_cipher_key_version smallint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor     uuid := (select auth.uid());
    v_role      text;
    v_stand_id  uuid;
    v_plan_id   text;
    v_status    text;
    v_limit     integer;
    v_count     integer;
begin
    if v_actor is null then
        raise exception 'not_authenticated' using errcode = 'P0001';
    end if;

    -- SQL cannot decrypt, but it can refuse anything that is not the
    -- `v1:<b64>:<b64>:<b64>` envelope `encrypt()` produces — which is enough to
    -- stop a truncated, empty, or plaintext value being stored as if it were
    -- recoverable key material.
    if p_cipher_key_version is null
       or p_token_ciphertext is null
       or btrim(p_token_ciphertext) !~
          '^v1:[A-Za-z0-9+/]{8,}={0,2}:[A-Za-z0-9+/]{8,}={0,2}:[A-Za-z0-9+/]{8,}={0,2}$'
    then
        raise exception 'ciphertext_required' using errcode = 'P0001';
    end if;

    select om.role into v_role
      from public.organization_members om
     where om.org_id = p_org_id
       and om.user_id = v_actor
       and om.status = 'active';

    if v_role is null or v_role not in ('owner', 'admin') then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    if not exists (
        select 1 from public.locations
         where id = p_location_id and org_id = p_org_id
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    -- The concurrency boundary. Two creates for one organization serialize
    -- here; the second counts after the first has committed.
    select e.plan_id, e.status
      into v_plan_id, v_status
      from public.entitlement_snapshots e
     where e.org_id = p_org_id
       for update;

    if not found then
        -- No entitlement is not a generous default.
        raise exception 'entitlement_missing' using errcode = 'P0001';
    end if;

    v_limit := app.entitlement_tag_limit(v_plan_id, v_status);
    if v_limit <= 0 then
        raise exception 'entitlement_inactive' using errcode = 'P0001';
    end if;

    -- Retired Tags do not count: a business that retires one has freed the
    -- slot, and charging them for a sticker in a drawer would be absurd.
    select count(*)::integer into v_count
      from public.review_stands s
     where s.org_id = p_org_id
       and s.status <> 'retired';

    if v_count >= v_limit then
        raise exception 'tag_limit_reached' using errcode = 'P0001';
    end if;

    insert into public.review_stands
        (org_id, location_id, public_token_hash, public_token_prefix, label,
         stand_type, status, activated_at, public_token_key_version,
         public_token_encrypted, token_encryption_key_version)
    values
        (p_org_id, p_location_id, p_stand_token_hash, p_stand_token_prefix,
         coalesce(nullif(btrim(p_label), ''), 'Front Desk'), 'printable_qr',
         'active', now(), coalesce(p_token_key_version, 1),
         btrim(p_token_ciphertext), p_cipher_key_version)
    returning id into v_stand_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
    values
        (p_org_id, v_actor, 'user', 'stand.created', 'review_stand',
         v_stand_id::text, p_request_id,
         jsonb_build_object('locationId', p_location_id));

    return v_stand_id;
end;
$$;

revoke all on function public.rpc_create_stand(uuid, uuid, text, text, text, smallint, text, text, smallint)
    from public, anon;
grant execute on function public.rpc_create_stand(uuid, uuid, text, text, text, smallint, text, text, smallint)
    to authenticated;

-- ================================================== location creation =======

-- Locations could only be created by onboarding, which makes exactly one. A
-- plan that sells two or five of them needs a way to add the others, and that
-- way has to count under the same lock as Tags do.
create or replace function public.rpc_create_location(
    p_org_id     uuid,
    p_name       text,
    p_timezone   text default null,
    p_locale     text default null,
    p_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor       uuid := (select auth.uid());
    v_role        text;
    v_location_id uuid;
    v_plan_id     text;
    v_status      text;
    v_limit       integer;
    v_count       integer;
    v_name        text;
begin
    if v_actor is null then
        raise exception 'not_authenticated' using errcode = 'P0001';
    end if;

    v_name := btrim(coalesce(p_name, ''));
    if char_length(v_name) < 1 or char_length(v_name) > 160 then
        raise exception 'invalid_location_name' using errcode = 'P0001';
    end if;

    select om.role into v_role
      from public.organization_members om
     where om.org_id = p_org_id
       and om.user_id = v_actor
       and om.status = 'active';

    if v_role is null or v_role not in ('owner', 'admin') then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    select e.plan_id, e.status
      into v_plan_id, v_status
      from public.entitlement_snapshots e
     where e.org_id = p_org_id
       for update;

    if not found then
        raise exception 'entitlement_missing' using errcode = 'P0001';
    end if;

    v_limit := app.entitlement_location_limit(v_plan_id, v_status);
    if v_limit <= 0 then
        raise exception 'entitlement_inactive' using errcode = 'P0001';
    end if;

    select count(*)::integer into v_count
      from public.locations l
     where l.org_id = p_org_id
       and l.status = 'active';

    if v_count >= v_limit then
        raise exception 'location_limit_reached' using errcode = 'P0001';
    end if;

    -- No destination is set here. A new location's door starts closed, and the
    -- owner points it somewhere deliberately through the destination write.
    insert into public.locations (org_id, name, timezone, default_locale)
    select p_org_id,
           v_name,
           coalesce(p_timezone, o.timezone, 'UTC'),
           coalesce(p_locale, o.default_locale, 'en')
      from public.organizations o
     where o.id = p_org_id
    returning id into v_location_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
    values
        (p_org_id, v_actor, 'user', 'location.created', 'location',
         v_location_id::text, p_request_id, '{}'::jsonb);

    return v_location_id;
end;
$$;

revoke all on function public.rpc_create_location(uuid, text, text, text, text)
    from public, anon;
grant execute on function public.rpc_create_location(uuid, text, text, text, text)
    to authenticated;

-- ================================================ rotation and the chip =====

-- A rotated token makes every NFC chip already written for that Tag stale:
-- tapping one leads to a token that no longer resolves. The server has to say
-- so rather than leave the owner to infer it, so provisioning state is cleared
-- and the Tag reads as needing a rewrite until it is programmed again.
--
-- The QR is not invalidated by this in the same way — a reprint uses the new
-- token — but the same rule applies: rotation is the deliberate act that
-- retires printed copies, which is exactly why changing a *destination* must
-- never rotate a token.
create or replace function public.rpc_rotate_stand_token(
    p_stand_id           uuid,
    p_org_id             uuid,
    p_new_token_hash     text,
    p_new_token_prefix   text,
    p_key_version        smallint,
    p_request_id         text,
    p_token_ciphertext   text,
    p_cipher_key_version smallint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    -- Same envelope check as creation: a rotation that stored an unusable
    -- ciphertext would leave a live Tag nobody can reprint.
    if p_cipher_key_version is null
       or p_token_ciphertext is null
       or btrim(p_token_ciphertext) !~
          '^v1:[A-Za-z0-9+/]{8,}={0,2}:[A-Za-z0-9+/]{8,}={0,2}:[A-Za-z0-9+/]{8,}={0,2}$'
    then
        raise exception 'ciphertext_required' using errcode = 'P0001';
    end if;

    if not exists (
        select 1 from public.organization_members
         where org_id = p_org_id
           and user_id = v_actor
           and status = 'active'
           and role in ('owner', 'admin')
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    update public.review_stands
       set public_token_hash = p_new_token_hash,
           public_token_prefix = p_new_token_prefix,
           public_token_key_version = p_key_version,
           token_rotated_at = now(),
           public_token_encrypted = btrim(p_token_ciphertext),
           token_encryption_key_version = p_cipher_key_version,
           -- Needs rewriting.
           nfc_provisioned_at = null,
           nfc_provisioned_by = null
     where id = p_stand_id
       and org_id = p_org_id;

    if not found then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
    values
        (p_org_id, v_actor, 'user', 'stand.token_rotated', 'review_stand',
         p_stand_id::text, p_request_id, '{}'::jsonb);
end;
$$;

revoke all on function public.rpc_rotate_stand_token(uuid, uuid, text, text, smallint, text, text, smallint)
    from public, anon;
grant execute on function public.rpc_rotate_stand_token(uuid, uuid, text, text, smallint, text, text, smallint)
    to authenticated;


insert into supabase_migrations.schema_migrations (version, name)
values ('20260915000500', 'tag_and_location_caps')
on conflict do nothing;

-- ===========================================================================
-- MIGRATION: 20260915000600_customer_page.sql
-- ===========================================================================

-- The Customer Page: the branding a customer actually sees.
--
-- WHAT THIS IS, AND WHAT IT IS NOT
-- --------------------------------
-- It is the look of `/q/{token}` — the logo, the hero image, the line of
-- copy that sits above the stars. It is NOT a screen between the star and
-- the destination. V1's customer contract is one tap, and this changes how
-- that one screen looks, never how many screens there are.
--
-- DRAFT AND PUBLISHED ARE TWO DIFFERENT THINGS
-- --------------------------------------------
-- Owners edit `draft`. Publishing copies it into `published` and bumps a
-- version. The public flow reads `published` and nothing else, so a
-- half-finished edit cannot reach a customer, and the owner's phone preview
-- and the live page can be rendered from the same shape.
--
-- The published snapshot carries the asset URLs already resolved, rather than
-- ids to look up later. That is deliberate: a live page must not change
-- because someone deleted an asset row, and the public read must not need a
-- join to serve a customer standing at a counter.
--
-- SCOPE
-- -----
-- A page belongs to an organization. A location may override it. The public
-- resolver prefers the location's published page and falls back to the
-- organization's; if neither is published the flow renders its own plain
-- default, because a business that has not designed a page still has
-- customers and must still be able to take a rating.

-- ========================================================== enums ===========

do $$
begin
    if not exists (select 1 from pg_type where typname = 'customer_page_scope') then
        create type public.customer_page_scope as enum ('organization', 'location');
    end if;
    if not exists (select 1 from pg_type where typname = 'customer_page_asset_kind') then
        create type public.customer_page_asset_kind as enum ('logo', 'hero');
    end if;
    if not exists (select 1 from pg_type where typname = 'customer_page_asset_status') then
        create type public.customer_page_asset_status as enum ('pending', 'ready');
    end if;
end $$;

-- ========================================================== assets ==========

-- One row per uploaded image. `pending` means the row exists and the bytes may
-- not; `ready` means the upload was confirmed. Publish refuses to reference
-- anything that is not ready, which is what stops a live page pointing at an
-- object that was never finished.
create table if not exists public.customer_page_assets (
    id            uuid primary key default gen_random_uuid(),
    org_id        uuid not null references public.organizations (id) on delete cascade,
    kind          public.customer_page_asset_kind not null,
    status        public.customer_page_asset_status not null default 'pending',
    storage_path  text not null unique
                  check (char_length(storage_path) between 1 and 400),
    content_type  text not null
                  check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
    byte_size     integer check (byte_size is null or (byte_size > 0 and byte_size <= 5242880)),
    public_url    text check (public_url is null or public_url ~ '^https://'),
    uploaded_by   uuid references auth.users (id) on delete set null,
    created_at    timestamptz not null default now(),
    confirmed_at  timestamptz,

    constraint customer_page_assets_ready_shape
        check (status = 'pending' or (public_url is not null and confirmed_at is not null)),
    constraint customer_page_assets_id_org_key unique (id, org_id)
);

comment on table public.customer_page_assets is
    'Images an owner uploaded for their Customer Page. A row is created before the upload and confirmed after, so a page can never be published pointing at bytes that never arrived.';

create index if not exists customer_page_assets_org_idx
    on public.customer_page_assets (org_id, created_at desc);

alter table public.customer_page_assets enable row level security;
revoke all on public.customer_page_assets from public, anon, authenticated;
grant select on public.customer_page_assets to authenticated;

drop policy if exists customer_page_assets_select on public.customer_page_assets;
create policy customer_page_assets_select on public.customer_page_assets
    for select to authenticated
    using (app.is_org_member(org_id));

-- ========================================================= profiles =========

create table if not exists public.customer_page_profiles (
    id                 uuid primary key default gen_random_uuid(),
    org_id             uuid not null references public.organizations (id) on delete cascade,
    scope              public.customer_page_scope not null,
    location_id        uuid,

    draft              jsonb not null default '{}'::jsonb,
    draft_updated_by   uuid references auth.users (id) on delete set null,
    draft_updated_at   timestamptz not null default now(),

    published          jsonb,
    published_version  integer not null default 0 check (published_version >= 0),
    published_by       uuid references auth.users (id) on delete set null,
    published_at       timestamptz,

    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),

    constraint customer_page_profiles_scope_shape
        check (
            (scope = 'organization' and location_id is null)
            or (scope = 'location' and location_id is not null)
        ),
    -- A location override can only belong to its own organization. The
    -- composite foreign key makes that structural rather than remembered.
    constraint customer_page_profiles_location_fk
        foreign key (location_id, org_id)
        references public.locations (id, org_id) on delete cascade,
    constraint customer_page_profiles_published_shape
        check (
            (published is null and published_version = 0 and published_at is null)
            or (published is not null and published_version > 0 and published_at is not null)
        )
);

comment on table public.customer_page_profiles is
    'The Customer Page. Owners edit `draft`; the public flow reads `published` and nothing else. The published snapshot carries resolved asset URLs so a live page cannot change because an asset row did.';

create unique index if not exists customer_page_profiles_org_unique
    on public.customer_page_profiles (org_id)
    where scope = 'organization';

create unique index if not exists customer_page_profiles_location_unique
    on public.customer_page_profiles (org_id, location_id)
    where scope = 'location';

alter table public.customer_page_profiles enable row level security;
revoke all on public.customer_page_profiles from public, anon, authenticated;
grant select on public.customer_page_profiles to authenticated;

drop policy if exists customer_page_profiles_select on public.customer_page_profiles;
create policy customer_page_profiles_select on public.customer_page_profiles
    for select to authenticated
    using (app.is_org_member(org_id));

-- ======================================================== validation ========

-- What a page may contain. Anything not named here is rejected rather than
-- stored and ignored: an unknown key in a draft is a field someone believes
-- they set, and a page that silently drops it is worse than one that refuses.
create or replace function app.validate_customer_page_content(p_content jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
    v_key      text;
    v_tagline  text;
begin
    if p_content is null or jsonb_typeof(p_content) <> 'object' then
        raise exception 'invalid_page_content' using detail = 'Content must be an object.';
    end if;

    for v_key in select jsonb_object_keys(p_content) loop
        if v_key not in ('templateId', 'tagline', 'logoAssetId', 'heroAssetId') then
            raise exception 'unknown_page_field'
                using detail = format('Unsupported field: %s', v_key);
        end if;
    end loop;

    if p_content ? 'templateId'
       and (p_content ->> 'templateId') not in ('classic', 'bold', 'minimal') then
        raise exception 'invalid_page_template'
            using detail = 'Template is not one of the approved looks.';
    end if;

    if p_content ? 'tagline' then
        v_tagline := p_content ->> 'tagline';
        if v_tagline is not null and char_length(v_tagline) > 120 then
            raise exception 'invalid_page_tagline'
                using detail = 'Tagline must be 120 characters or fewer.';
        end if;
    end if;
end;
$$;

revoke all on function app.validate_customer_page_content(jsonb) from public, anon, authenticated;

-- ===================================================== owner read/write =====

-- Every one of these takes the organization explicitly. Choosing the business
-- from "the caller's first membership" is how an owner of two businesses
-- edits the wrong one without being told.
create or replace function app.customer_page_authorize(p_org_id uuid, p_location_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    if not exists (
        select 1 from public.organization_members
         where org_id = p_org_id
           and user_id = v_actor
           and status = 'active'
           and role in ('owner', 'admin')
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    if p_location_id is not null and not exists (
        select 1 from public.locations
         where id = p_location_id and org_id = p_org_id
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    return v_actor;
end;
$$;

revoke all on function app.customer_page_authorize(uuid, uuid) from public, anon, authenticated;

create or replace function public.rpc_customer_page_save_draft(
    p_org_id      uuid,
    p_location_id uuid,
    p_draft       jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor   uuid;
    v_scope   public.customer_page_scope;
    v_id      uuid;
begin
    v_actor := app.customer_page_authorize(p_org_id, p_location_id);
    perform app.validate_customer_page_content(p_draft);

    v_scope := case when p_location_id is null then 'organization' else 'location' end;

    if v_scope = 'organization' then
        insert into public.customer_page_profiles
            (org_id, scope, location_id, draft, draft_updated_by, draft_updated_at, updated_at)
        values (p_org_id, 'organization', null, p_draft, v_actor, now(), now())
        on conflict (org_id) where scope = 'organization'
        do update set draft = excluded.draft,
                      draft_updated_by = excluded.draft_updated_by,
                      draft_updated_at = now(),
                      updated_at = now()
        returning id into v_id;
    else
        insert into public.customer_page_profiles
            (org_id, scope, location_id, draft, draft_updated_by, draft_updated_at, updated_at)
        values (p_org_id, 'location', p_location_id, p_draft, v_actor, now(), now())
        on conflict (org_id, location_id) where scope = 'location'
        do update set draft = excluded.draft,
                      draft_updated_by = excluded.draft_updated_by,
                      draft_updated_at = now(),
                      updated_at = now()
        returning id into v_id;
    end if;

    return v_id;
end;
$$;

revoke all on function public.rpc_customer_page_save_draft(uuid, uuid, jsonb) from public, anon;
grant execute on function public.rpc_customer_page_save_draft(uuid, uuid, jsonb) to authenticated;

-- Publish: the draft becomes what customers see, with its assets resolved.
--
-- An asset that is still `pending` — an upload that was started and never
-- finished — is refused here rather than published as a broken image. That is
-- the rule "upload must complete before publish can reference it", enforced
-- where it cannot be skipped.
create or replace function public.rpc_customer_page_publish(
    p_org_id      uuid,
    p_location_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor     uuid;
    v_profile   public.customer_page_profiles%rowtype;
    v_snapshot  jsonb;
    v_asset_id  uuid;
    v_url       text;
    v_version   integer;
begin
    v_actor := app.customer_page_authorize(p_org_id, p_location_id);

    select * into v_profile
      from public.customer_page_profiles
     where org_id = p_org_id
       and ((p_location_id is null and scope = 'organization')
            or (p_location_id is not null and scope = 'location' and location_id = p_location_id))
       for update;

    if not found then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    perform app.validate_customer_page_content(v_profile.draft);

    v_snapshot := v_profile.draft;

    -- Resolve each referenced asset into the URL the published page carries.
    foreach v_asset_id in array array[
        nullif(v_profile.draft ->> 'logoAssetId', '')::uuid,
        nullif(v_profile.draft ->> 'heroAssetId', '')::uuid
    ] loop
        continue when v_asset_id is null;

        select a.public_url into v_url
          from public.customer_page_assets a
         where a.id = v_asset_id
           and a.org_id = p_org_id
           and a.status = 'ready';

        if v_url is null then
            raise exception 'asset_not_ready'
                using errcode = 'P0001',
                      detail = 'An image is still uploading, or does not belong to this business.';
        end if;

        if v_asset_id = nullif(v_profile.draft ->> 'logoAssetId', '')::uuid then
            v_snapshot := jsonb_set(v_snapshot, '{logoUrl}', to_jsonb(v_url), true);
        end if;
        if v_asset_id = nullif(v_profile.draft ->> 'heroAssetId', '')::uuid then
            v_snapshot := jsonb_set(v_snapshot, '{heroUrl}', to_jsonb(v_url), true);
        end if;
    end loop;

    v_version := v_profile.published_version + 1;

    update public.customer_page_profiles
       set published = v_snapshot,
           published_version = v_version,
           published_by = v_actor,
           published_at = now(),
           updated_at = now()
     where id = v_profile.id;

    return v_version;
end;
$$;

revoke all on function public.rpc_customer_page_publish(uuid, uuid) from public, anon;
grant execute on function public.rpc_customer_page_publish(uuid, uuid) to authenticated;

-- Take the page down without deleting the work. The draft survives, so
-- "unpublish, fix it, publish again" is not "start over".
create or replace function public.rpc_customer_page_unpublish(
    p_org_id      uuid,
    p_location_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform app.customer_page_authorize(p_org_id, p_location_id);

    update public.customer_page_profiles
       set published = null,
           published_version = 0,
           published_by = null,
           published_at = null,
           updated_at = now()
     where org_id = p_org_id
       and ((p_location_id is null and scope = 'organization')
            or (p_location_id is not null and scope = 'location' and location_id = p_location_id));

    if not found then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;
end;
$$;

revoke all on function public.rpc_customer_page_unpublish(uuid, uuid) from public, anon;
grant execute on function public.rpc_customer_page_unpublish(uuid, uuid) to authenticated;

-- ======================================================== asset writes ======

create or replace function public.rpc_customer_page_asset_begin(
    p_org_id       uuid,
    p_kind         public.customer_page_asset_kind,
    p_storage_path text,
    p_content_type text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid;
    v_id    uuid;
begin
    v_actor := app.customer_page_authorize(p_org_id, null);

    insert into public.customer_page_assets
        (org_id, kind, status, storage_path, content_type, uploaded_by)
    values (p_org_id, p_kind, 'pending', p_storage_path, p_content_type, v_actor)
    returning id into v_id;

    return v_id;
end;
$$;

revoke all on function public.rpc_customer_page_asset_begin(uuid, public.customer_page_asset_kind, text, text)
    from public, anon;
grant execute on function public.rpc_customer_page_asset_begin(uuid, public.customer_page_asset_kind, text, text)
    to authenticated;

-- Confirmation is a service-role write, because it asserts something only the
-- server can check: that the bytes are actually in storage. An owner's browser
-- claiming "I uploaded it" is not evidence.
create or replace function public.rpc_customer_page_asset_confirm(
    p_asset_id   uuid,
    p_org_id     uuid,
    p_public_url text,
    p_byte_size  integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.customer_page_assets
       set status = 'ready',
           public_url = p_public_url,
           byte_size = p_byte_size,
           confirmed_at = now()
     where id = p_asset_id
       and org_id = p_org_id
       and status = 'pending';

    if not found then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;
end;
$$;

revoke all on function public.rpc_customer_page_asset_confirm(uuid, uuid, text, integer)
    from public, anon, authenticated;
grant execute on function public.rpc_customer_page_asset_confirm(uuid, uuid, text, integer)
    to service_role;

-- ====================================================== public resolver =====

-- The published page for one stand: the location's own if it has one, else the
-- organization's, else nothing — and "nothing" is a page that still works.
create or replace function app.resolve_customer_page(p_org_id uuid, p_location_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select p.published
      from public.customer_page_profiles p
     where p.org_id = p_org_id
       and p.published is not null
       and (p.scope = 'organization'
            or (p.scope = 'location' and p.location_id = p_location_id))
     order by case when p.scope = 'location' then 0 else 1 end
     limit 1;
$$;

revoke all on function app.resolve_customer_page(uuid, uuid) from public, anon, authenticated;
grant execute on function app.resolve_customer_page(uuid, uuid) to service_role;

-- ================================================ the resolver, once more ===

-- The page joins the row the public flow already fetches rather than becoming
-- a second round trip. A customer standing at a counter waits for exactly one
-- database call to find out what they are looking at.
--
-- The return shape changes, so the wrapper and the function are dropped and
-- recreated in dependency order and their grants restored. The plpgsql write
-- functions read this into a `record` and take the wider row unchanged.
drop function if exists public.rpc_public_resolve_stand(text, text);
drop function if exists app.resolve_public_stand(text, text);

create function app.resolve_public_stand(
    p_token_hash          text,
    p_previous_token_hash text default null
)
returns table (
    org_id               uuid,
    location_id          uuid,
    stand_id             uuid,
    business_name        text,
    location_name        text,
    google_review_url    text,
    destination_provider text,
    destination_url      text,
    customer_page        jsonb,
    default_locale       text,
    matched_key_version  smallint
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
           l.destination_provider,
           l.destination_url,
           app.resolve_customer_page(o.id, l.id),
           coalesce(l.default_locale, o.default_locale),
           s.public_token_key_version
      from public.review_stands s
      join public.locations l on l.id = s.location_id and l.org_id = s.org_id
      join public.organizations o on o.id = s.org_id
      join public.entitlement_snapshots e on e.org_id = o.id
     where (s.public_token_hash = p_token_hash
            or (p_previous_token_hash is not null
                and s.public_token_hash = p_previous_token_hash))
       and s.status = 'active'
       and l.status = 'active'
       and o.status = 'active'
       and app.entitlement_allows_service(e.status);
$$;

create function public.rpc_public_resolve_stand(
    p_token_hash          text,
    p_previous_token_hash text default null
)
returns table (
    org_id               uuid,
    location_id          uuid,
    stand_id             uuid,
    business_name        text,
    location_name        text,
    google_review_url    text,
    destination_provider text,
    destination_url      text,
    customer_page        jsonb,
    default_locale       text,
    matched_key_version  smallint
)
language sql
stable
security invoker
set search_path = ''
as $$
    select * from app.resolve_public_stand(p_token_hash, p_previous_token_hash);
$$;

revoke all on function app.resolve_public_stand(text, text)
    from public, anon, authenticated;
grant execute on function app.resolve_public_stand(text, text) to service_role;

revoke all on function public.rpc_public_resolve_stand(text, text)
    from public, anon, authenticated;
grant execute on function public.rpc_public_resolve_stand(text, text) to service_role;


insert into supabase_migrations.schema_migrations (version, name)
values ('20260915000600', 'customer_page')
on conflict do nothing;

-- ===========================================================================
-- MIGRATION: 20260915000700_billing.sql
-- ===========================================================================

-- Billing state, and the one place Stripe is allowed to write it.
--
-- THE AUTHORITY
-- -------------
-- Stripe's webhooks and this database are what decide whether a business is
-- entitled to anything. A browser landing on a success page is not: it proves
-- a redirect happened, not that money moved, and it can be opened by anyone
-- who knows the URL. Nothing in this schema is reachable from a browser.
--
-- WHAT MAKES A WEBHOOK SAFE
-- -------------------------
-- Stripe delivers at least once, out of order, and retries for days. So:
--   * the event is written to a durable inbox keyed by Stripe's own event id,
--     which is what makes a redelivery a no-op rather than a second charge of
--     consequences;
--   * the signature is verified *before* anything is written, so the inbox
--     cannot be filled by anyone who can reach the URL;
--   * every subscription write carries the event's timestamp, and an older
--     event cannot overwrite a newer one — a `customer.subscription.updated`
--     that arrives after the `deleted` that followed it must not resurrect a
--     cancelled plan;
--   * the subscription row and the entitlement it implies are written in the
--     same transaction, so there is no moment where a business is paid-up in
--     one table and cut off in the other.

-- ===================================================== stripe customers =====

create table if not exists public.billing_customers (
    org_id             uuid primary key references public.organizations (id) on delete cascade,
    stripe_customer_id text not null unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

comment on table public.billing_customers is
    'One Stripe customer per organization. The unique constraint is what stops a second checkout creating a second customer and a second subscription for the same business.';

alter table public.billing_customers enable row level security;
revoke all on public.billing_customers from public, anon, authenticated;
-- Deliberately not readable by members: it carries no information an owner
-- needs and every reason not to be enumerable.

-- ================================================ stripe subscriptions ======

create table if not exists public.billing_subscriptions (
    org_id                 uuid primary key references public.organizations (id) on delete cascade,
    stripe_subscription_id text not null unique check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
    stripe_price_id        text,
    plan_id                text check (plan_id is null or plan_id in ('starter', 'growth', 'pro')),
    -- Stripe's own vocabulary, stored as Stripe says it. The product's
    -- entitlement status is derived from this, never conflated with it.
    stripe_status          text not null,
    cancel_at_period_end   boolean not null default false,
    current_period_start   timestamptz,
    current_period_end     timestamptz,
    trial_ends_at          timestamptz,
    -- Out-of-order protection. An event older than the one already applied is
    -- discarded rather than replayed over newer truth.
    last_event_at          timestamptz not null,
    last_event_id          text not null,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now()
);

alter table public.billing_subscriptions enable row level security;
revoke all on public.billing_subscriptions from public, anon, authenticated;
grant select on public.billing_subscriptions to authenticated;

drop policy if exists billing_subscriptions_select on public.billing_subscriptions;
create policy billing_subscriptions_select on public.billing_subscriptions
    for select to authenticated
    using (app.is_org_member(org_id));

-- ==================================================== the webhook inbox =====

create table if not exists public.stripe_webhook_events (
    id            text primary key check (id ~ '^evt_[A-Za-z0-9]+$'),
    type          text not null,
    payload       jsonb not null,
    event_created timestamptz not null,
    received_at   timestamptz not null default now(),
    processed_at  timestamptz,
    attempts      integer not null default 0,
    last_error    text
);

comment on table public.stripe_webhook_events is
    'Durable inbox. The primary key is Stripe''s own event id, so a redelivery collides instead of being handled twice. A row is written only after the signature has been verified.';

create index if not exists stripe_webhook_events_unprocessed_idx
    on public.stripe_webhook_events (received_at)
    where processed_at is null;

alter table public.stripe_webhook_events enable row level security;
revoke all on public.stripe_webhook_events from public, anon, authenticated;

-- ======================================================= the projection =====

-- Stripe's subscription status, translated into what the product means by it.
--
-- `incomplete` is a subscription whose first payment never succeeded: not a
-- trial, not active, and not something to give service for. `unpaid` is the
-- end of dunning. Anything unrecognised suspends rather than defaulting to
-- service — a status Stripe adds later must not silently grant a plan.
create or replace function app.entitlement_status_from_stripe(p_stripe_status text)
returns text
language sql
immutable
set search_path = ''
as $$
    select case p_stripe_status
        when 'trialing' then 'trialing'
        when 'active' then 'active'
        when 'past_due' then 'past_due'
        when 'canceled' then 'cancelled'
        when 'incomplete_expired' then 'cancelled'
        when 'unpaid' then 'suspended'
        when 'incomplete' then 'suspended'
        when 'paused' then 'suspended'
        else 'suspended'
    end;
$$;

revoke all on function app.entitlement_status_from_stripe(text) from public, anon, authenticated;

-- ========================================================= inbox writes =====

-- Returns 'stored' for a new event and 'duplicate' for one already seen. The
-- caller does the work only for 'stored', which is what makes Stripe's
-- at-least-once delivery harmless.
create or replace function public.rpc_stripe_event_record(
    p_event_id      text,
    p_type          text,
    p_payload       jsonb,
    p_event_created timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.stripe_webhook_events (id, type, payload, event_created)
    values (p_event_id, p_type, p_payload, p_event_created)
    on conflict (id) do nothing;

    if not found then
        return 'duplicate';
    end if;

    return 'stored';
end;
$$;

create or replace function public.rpc_stripe_event_complete(p_event_id text)
returns void
language sql
security definer
set search_path = ''
as $$
    update public.stripe_webhook_events
       set processed_at = now(),
           attempts = attempts + 1,
           last_error = null
     where id = p_event_id;
$$;

create or replace function public.rpc_stripe_event_fail(p_event_id text, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
    update public.stripe_webhook_events
       set attempts = attempts + 1,
           last_error = left(p_error, 2000)
     where id = p_event_id;
$$;

revoke all on function public.rpc_stripe_event_record(text, text, jsonb, timestamptz)
    from public, anon, authenticated;
revoke all on function public.rpc_stripe_event_complete(text) from public, anon, authenticated;
revoke all on function public.rpc_stripe_event_fail(text, text) from public, anon, authenticated;
grant execute on function public.rpc_stripe_event_record(text, text, jsonb, timestamptz) to service_role;
grant execute on function public.rpc_stripe_event_complete(text) to service_role;
grant execute on function public.rpc_stripe_event_fail(text, text) to service_role;

-- ==================================================== customer linkage ======

create or replace function public.rpc_billing_link_customer(
    p_org_id             uuid,
    p_stripe_customer_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.billing_customers (org_id, stripe_customer_id)
    values (p_org_id, p_stripe_customer_id)
    on conflict (org_id) do update
        set stripe_customer_id = excluded.stripe_customer_id,
            updated_at = now();
end;
$$;

revoke all on function public.rpc_billing_link_customer(uuid, text) from public, anon, authenticated;
grant execute on function public.rpc_billing_link_customer(uuid, text) to service_role;

-- ================================================== the subscription write ==

-- The one write that changes what a business may do.
--
-- Returns 'applied' or 'stale'. Stale means an older event arrived after a
-- newer one — Stripe does that — and nothing was changed.
create or replace function public.rpc_billing_apply_subscription(
    p_org_id                 uuid,
    p_stripe_subscription_id text,
    p_stripe_price_id        text,
    p_plan_id                text,
    p_stripe_status          text,
    p_cancel_at_period_end   boolean,
    p_current_period_start   timestamptz,
    p_current_period_end     timestamptz,
    p_trial_ends_at          timestamptz,
    p_event_id               text,
    p_event_created          timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_existing   public.billing_subscriptions%rowtype;
    v_status     text;
begin
    if p_plan_id is not null and p_plan_id not in ('starter', 'growth', 'pro') then
        raise exception 'unknown_plan' using errcode = 'P0001';
    end if;

    select * into v_existing
      from public.billing_subscriptions
     where org_id = p_org_id
       for update;

    if found and v_existing.last_event_at > p_event_created then
        -- An event older than what has already been applied. Discarding it is
        -- the whole point: a `subscription.updated` delivered after the
        -- `deleted` that followed it must not resurrect a cancelled plan.
        return 'stale';
    end if;

    v_status := app.entitlement_status_from_stripe(p_stripe_status);

    insert into public.billing_subscriptions as b
        (org_id, stripe_subscription_id, stripe_price_id, plan_id, stripe_status,
         cancel_at_period_end, current_period_start, current_period_end, trial_ends_at,
         last_event_at, last_event_id)
    values
        (p_org_id, p_stripe_subscription_id, p_stripe_price_id, p_plan_id, p_stripe_status,
         coalesce(p_cancel_at_period_end, false), p_current_period_start, p_current_period_end,
         p_trial_ends_at, p_event_created, p_event_id)
    on conflict (org_id) do update
        set stripe_subscription_id = excluded.stripe_subscription_id,
            stripe_price_id        = excluded.stripe_price_id,
            plan_id                = excluded.plan_id,
            stripe_status          = excluded.stripe_status,
            cancel_at_period_end   = excluded.cancel_at_period_end,
            current_period_start   = excluded.current_period_start,
            current_period_end     = excluded.current_period_end,
            trial_ends_at          = excluded.trial_ends_at,
            last_event_at          = excluded.last_event_at,
            last_event_id          = excluded.last_event_id,
            updated_at             = now();

    -- Same transaction. There is no moment where a business is paid-up in one
    -- table and cut off in the other.
    insert into public.entitlement_snapshots as e
        (org_id, plan_id, status, cancel_at_period_end, trial_ends_at, current_period_end, source)
    values
        (p_org_id, p_plan_id, v_status, coalesce(p_cancel_at_period_end, false),
         p_trial_ends_at, p_current_period_end, 'stripe:' || p_event_id)
    on conflict (org_id) do update
        set plan_id              = excluded.plan_id,
            status               = excluded.status,
            cancel_at_period_end = excluded.cancel_at_period_end,
            trial_ends_at        = excluded.trial_ends_at,
            current_period_end   = excluded.current_period_end,
            source               = excluded.source,
            updated_at           = now();

    return 'applied';
end;
$$;

revoke all on function public.rpc_billing_apply_subscription(
    uuid, text, text, text, text, boolean, timestamptz, timestamptz, timestamptz, text, timestamptz)
    from public, anon, authenticated;
grant execute on function public.rpc_billing_apply_subscription(
    uuid, text, text, text, text, boolean, timestamptz, timestamptz, timestamptz, text, timestamptz)
    to service_role;

-- ================================================ finding the org again =====

-- Stripe events carry the customer, not the organization. This is the lookup,
-- and it is deliberately the only one: an event whose customer is unknown is
-- left unprocessed and visible in the inbox rather than guessed at.
create or replace function public.rpc_billing_org_for_customer(p_stripe_customer_id text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
    select org_id from public.billing_customers where stripe_customer_id = p_stripe_customer_id;
$$;

revoke all on function public.rpc_billing_org_for_customer(text) from public, anon, authenticated;
grant execute on function public.rpc_billing_org_for_customer(text) to service_role;


insert into supabase_migrations.schema_migrations (version, name)
values ('20260915000700', 'billing')
on conflict do nothing;

-- ===========================================================================
-- MIGRATION: 20260915000800_sms_two_source_ledger.sql
-- ===========================================================================

-- SMS credit has exactly two sources, and they are not interchangeable.
--
-- 1. MONTHLY INCLUDED — minted only by a *paid* invoice for a billing period,
--    expires at the end of that period, never rolls over.
-- 2. PURCHASED PREPAID — bought once, persists across renewals, survives
--    cancellation in storage, and grants no software access by itself.
--
-- Monthly is always spent first. A business that has 2 monthly and 100
-- purchased, sending a 3-segment message, ends with 0 monthly and 99
-- purchased — never 2 monthly and 97 purchased, and never a single pooled
-- number that loses the distinction and lets expiring credit sit unspent
-- while prepaid credit is burned.
--
-- WHY GRANTS AND SLICES
-- ---------------------
-- A single "available" integer cannot answer "which of these expires on
-- Thursday?". So credit lives in grants, and a reservation records exactly
-- which grants it took from and how much from each. Settling consumes those
-- same slices; releasing gives back to those same grants. The source a refund
-- returns to is the source it came from, not whichever is convenient.
--
-- The existing append-only `sms_quota_ledger` keeps its job as the audit
-- record and its idempotency keys. What changes is that the numbers it
-- describes now have a source.

-- ============================================================== grants ======

create table if not exists public.sms_credit_grants (
    id           uuid primary key default gen_random_uuid(),
    org_id       uuid not null references public.organizations (id) on delete cascade,
    source       text not null check (source in ('monthly', 'purchased')),
    segments     bigint not null check (segments > 0),
    consumed     bigint not null default 0 check (consumed >= 0),
    reserved     bigint not null default 0 check (reserved >= 0),
    granted_at   timestamptz not null default now(),
    -- Monthly expires at the billing period boundary. Purchased never does.
    expires_at   timestamptz,
    -- What caused this grant, and the id that makes it happen exactly once no
    -- matter how many times Stripe delivers the event.
    origin_kind  text not null check (origin_kind in ('invoice', 'purchase', 'manual')),
    origin_id    text not null check (char_length(origin_id) between 1 and 200),
    note         text,

    constraint sms_credit_grants_not_overspent check (consumed + reserved <= segments),
    constraint sms_credit_grants_monthly_expires
        check (source <> 'monthly' or expires_at is not null),
    constraint sms_credit_grants_purchased_persists
        check (source <> 'purchased' or expires_at is null),
    constraint sms_credit_grants_origin_key unique (org_id, origin_kind, origin_id)
);

comment on table public.sms_credit_grants is
    'Every SMS segment a business has, and where it came from. Monthly grants expire at their billing period boundary and never roll over; purchased grants never expire and survive cancellation. Spending takes monthly first.';

create index if not exists sms_credit_grants_spendable_idx
    on public.sms_credit_grants (org_id, source, expires_at, granted_at);

alter table public.sms_credit_grants enable row level security;
revoke all on public.sms_credit_grants from public, anon, authenticated;
grant select on public.sms_credit_grants to authenticated;

drop policy if exists sms_credit_grants_select on public.sms_credit_grants;
create policy sms_credit_grants_select on public.sms_credit_grants
    for select to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

-- ============================================================= slices =======

create table if not exists public.sms_reservation_slices (
    org_id          uuid not null references public.organizations (id) on delete cascade,
    correlation_key text not null,
    grant_id        uuid not null references public.sms_credit_grants (id) on delete cascade,
    segments        bigint not null check (segments > 0),
    status          text not null default 'held' check (status in ('held', 'consumed', 'released')),
    created_at      timestamptz not null default now(),
    settled_at      timestamptz,

    primary key (org_id, correlation_key, grant_id)
);

comment on table public.sms_reservation_slices is
    'Which grants one reservation took from, and how much from each. Settlement and release act on these exact slices, so credit always returns to the source it came from.';

create index if not exists sms_reservation_slices_grant_idx
    on public.sms_reservation_slices (grant_id) where status = 'held';

alter table public.sms_reservation_slices enable row level security;
revoke all on public.sms_reservation_slices from public, anon, authenticated;

-- ============================================================ granting ======

-- Idempotent on (org, origin_kind, origin_id). Fifty deliveries of the same
-- Stripe invoice produce one grant.
create or replace function app.sms_grant_credits(
    p_org_id      uuid,
    p_source      text,
    p_segments    bigint,
    p_origin_kind text,
    p_origin_id   text,
    p_expires_at  timestamptz default null,
    p_note        text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_grant_id uuid;
begin
    if p_segments is null or p_segments <= 0 then
        raise exception 'invalid_grant_amount' using errcode = 'P0001';
    end if;

    perform app.sms_quota_lock_balance(p_org_id);

    insert into public.sms_credit_grants
        (org_id, source, segments, expires_at, origin_kind, origin_id, note)
    values (p_org_id, p_source, p_segments, p_expires_at, p_origin_kind, p_origin_id, p_note)
    on conflict (org_id, origin_kind, origin_id) do nothing
    returning id into v_grant_id;

    if v_grant_id is null then
        -- Already granted. Not an error: this is what a redelivered webhook
        -- looks like, and it must change nothing.
        return null;
    end if;

    insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, expires_at, note)
    values (p_org_id, 'allocation', p_segments,
            p_origin_kind || ':' || p_origin_id, p_expires_at,
            coalesce(p_note, p_source))
    on conflict (org_id, kind, correlation_key) do nothing;

    update public.sms_quota_balance b
       set allocated = b.allocated + p_segments, updated_at = now()
     where b.org_id = p_org_id;

    return v_grant_id;
end;
$$;

revoke all on function app.sms_grant_credits(uuid, text, bigint, text, text, timestamptz, text)
    from public, anon, authenticated;

-- ============================================================ balances ======

-- What is actually spendable right now, by source. Expired monthly credit is
-- simply not counted; nothing has to sweep it for the number to be right.
create or replace function app.sms_balance(p_org_id uuid)
returns table (monthly bigint, purchased bigint, total bigint)
language sql
stable
security definer
set search_path = ''
as $$
    with spendable as (
        select g.source, sum(g.segments - g.consumed - g.reserved) as available
          from public.sms_credit_grants g
         where g.org_id = p_org_id
           and (g.expires_at is null or g.expires_at > now())
         group by g.source
    )
    select
        coalesce((select available from spendable where source = 'monthly'), 0)::bigint,
        coalesce((select available from spendable where source = 'purchased'), 0)::bigint,
        coalesce((select sum(available) from spendable), 0)::bigint;
$$;

revoke all on function app.sms_balance(uuid) from public, anon, authenticated;

create or replace function public.rpc_sms_balance(p_org_id uuid)
returns table (monthly bigint, purchased bigint, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select * from app.sms_balance(p_org_id);
$$;

revoke all on function public.rpc_sms_balance(uuid) from public, anon, authenticated;
grant execute on function public.rpc_sms_balance(uuid) to service_role;

-- ========================================================== reserving =======

-- Monthly first, then purchased; within a source, the credit that expires
-- soonest goes first. Records exactly what it took from where.
create or replace function app.sms_quota_reserve(
    p_org_id          uuid,
    p_amount          bigint,
    p_correlation_key text,
    p_request_id      uuid default null
)
returns table (reserved boolean, available_after bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_available bigint;
    v_needed    bigint;
    v_take      bigint;
    v_grant     record;
begin
    perform app.sms_quota_lock_balance(p_org_id);

    -- Already reserved under this key: idempotent success, nothing taken twice.
    if exists (
        select 1 from public.sms_reservation_slices s
         where s.org_id = p_org_id and s.correlation_key = p_correlation_key
    ) then
        return query select true, (select total from app.sms_balance(p_org_id));
        return;
    end if;

    select total into v_available from app.sms_balance(p_org_id);

    if p_amount is null or p_amount <= 0 then
        raise exception 'invalid_reserve_amount' using errcode = 'P0001';
    end if;

    if v_available < p_amount then
        return query select false, v_available;
        return;
    end if;

    v_needed := p_amount;

    for v_grant in
        select g.id, (g.segments - g.consumed - g.reserved) as available
          from public.sms_credit_grants g
         where g.org_id = p_org_id
           and (g.expires_at is null or g.expires_at > now())
           and (g.segments - g.consumed - g.reserved) > 0
         order by
            -- Monthly before purchased, always.
            case g.source when 'monthly' then 0 else 1 end,
            -- Within a source, whatever expires soonest.
            g.expires_at asc nulls last,
            g.granted_at asc,
            g.id asc
           for update
    loop
        exit when v_needed <= 0;

        v_take := least(v_needed, v_grant.available);

        insert into public.sms_reservation_slices
            (org_id, correlation_key, grant_id, segments, status)
        values (p_org_id, p_correlation_key, v_grant.id, v_take, 'held');

        -- Qualified: this function's RETURNS TABLE also declares `reserved`,
        -- and an unqualified reference resolves to the variable, not the column.
        update public.sms_credit_grants g
           set reserved = g.reserved + v_take
         where g.id = v_grant.id;

        v_needed := v_needed - v_take;
    end loop;

    if v_needed > 0 then
        -- The balance said there was enough and the grants disagreed. That is
        -- a corrupted ledger, not a business without credit, and it must not
        -- be rounded down into a partial send.
        raise exception 'quota_slice_shortfall' using errcode = 'P0001';
    end if;

    insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id)
    values (p_org_id, 'reservation', p_amount, p_correlation_key, p_request_id)
    on conflict (org_id, kind, correlation_key) do nothing;

    update public.sms_quota_balance b
       set reserved = b.reserved + p_amount, updated_at = now()
     where b.org_id = p_org_id;

    return query select true, (v_available - p_amount);
end;
$$;

-- ========================================================== settling ========

create or replace function app.sms_quota_consume(
    p_org_id          uuid,
    p_amount          bigint,
    p_correlation_key text,
    p_request_id      uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_slice    record;
    v_inserted uuid;
begin
    perform app.sms_quota_lock_balance(p_org_id);

    insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id)
    values (p_org_id, 'consumption', p_amount, p_correlation_key, p_request_id)
    on conflict (org_id, kind, correlation_key) do nothing
    returning id into v_inserted;

    if v_inserted is null then
        return false; -- already settled
    end if;

    for v_slice in
        select s.grant_id, s.segments
          from public.sms_reservation_slices s
         where s.org_id = p_org_id
           and s.correlation_key = p_correlation_key
           and s.status = 'held'
           for update
    loop
        update public.sms_credit_grants
           set reserved = greatest(0, reserved - v_slice.segments),
               consumed = consumed + v_slice.segments
         where id = v_slice.grant_id;
    end loop;

    update public.sms_reservation_slices
       set status = 'consumed', settled_at = now()
     where org_id = p_org_id and correlation_key = p_correlation_key and status = 'held';

    update public.sms_quota_balance b
       set reserved = greatest(0, b.reserved - p_amount),
           consumed = b.consumed + p_amount,
           updated_at = now()
     where b.org_id = p_org_id;

    return true;
end;
$$;

-- ========================================================== releasing =======

create or replace function app.sms_quota_release(
    p_org_id          uuid,
    p_amount          bigint,
    p_correlation_key text,
    p_request_id      uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_slice    record;
    v_inserted uuid;
begin
    perform app.sms_quota_lock_balance(p_org_id);

    insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id)
    values (p_org_id, 'release', p_amount, p_correlation_key, p_request_id)
    on conflict (org_id, kind, correlation_key) do nothing
    returning id into v_inserted;

    if v_inserted is null then
        return false;
    end if;

    -- Back to the grants it came from. A release that returned monthly credit
    -- as purchased would quietly hand a business permanent credit for a
    -- message it never sent.
    for v_slice in
        select s.grant_id, s.segments
          from public.sms_reservation_slices s
         where s.org_id = p_org_id
           and s.correlation_key = p_correlation_key
           and s.status = 'held'
           for update
    loop
        update public.sms_credit_grants
           set reserved = greatest(0, reserved - v_slice.segments)
         where id = v_slice.grant_id;
    end loop;

    update public.sms_reservation_slices
       set status = 'released', settled_at = now()
     where org_id = p_org_id and correlation_key = p_correlation_key and status = 'held';

    update public.sms_quota_balance b
       set reserved = greatest(0, b.reserved - p_amount), updated_at = now()
     where b.org_id = p_org_id;

    return true;
end;
$$;

-- ====================================================== legacy allocate =====

-- The old single-bucket allocate stays callable so nothing that used it
-- breaks, but credit it creates now has a source like everything else.
--
-- The mapping is the honest one: credit with an expiry behaves exactly as
-- monthly included credit does — spent first, gone at its boundary — and
-- credit without one behaves as prepaid. There is no third kind.
create or replace function app.sms_quota_allocate(
    p_org_id          uuid,
    p_amount          bigint,
    p_correlation_key text,
    p_expires_at      timestamptz default null,
    p_note            text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_grant uuid;
begin
    v_grant := app.sms_grant_credits(
        p_org_id,
        case when p_expires_at is null then 'purchased' else 'monthly' end,
        p_amount,
        'manual',
        p_correlation_key,
        p_expires_at,
        p_note);
    return v_grant is not null;
end;
$$;

-- ==================================================== available, once =======

-- One definition of "spendable", derived from the grants rather than from a
-- projection that has to be swept. Expired monthly credit stops counting the
-- moment it expires, with nothing to run and nothing to get behind.
create or replace function app.sms_quota_available(p_org_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
    select total from app.sms_balance(p_org_id);
$$;

-- ============================================= invoices mint monthly ========

-- The ONLY thing that creates monthly allowance.
--
-- Not checkout — a checkout session is an intent. Not subscription creation —
-- a subscription can exist unpaid. A *paid invoice for a billing period* is
-- the event that means money moved, and it mints exactly the plan's allowance,
-- once, expiring at the end of the period it paid for.
--
-- A failed invoice mints nothing at all, which is why there is no branch here
-- for one: the caller only reaches this on `invoice.paid`.
create or replace function public.rpc_billing_apply_invoice_paid(
    p_org_id       uuid,
    p_invoice_id   text,
    p_plan_id      text,
    p_period_start timestamptz,
    p_period_end   timestamptz,
    p_amount_paid  bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_segments integer;
    v_grant    uuid;
begin
    if p_plan_id is null or p_plan_id not in ('starter', 'growth', 'pro') then
        -- A plan nobody recognises gets nothing, rather than the cheapest
        -- tier's allowance.
        return 'no_plan';
    end if;

    if p_amount_paid is null or p_amount_paid <= 0 then
        -- A zero-amount invoice is a trial's invoice. A trial includes no SMS.
        return 'not_paid';
    end if;

    if p_period_end is null then
        raise exception 'invoice_missing_period' using errcode = 'P0001';
    end if;

    v_segments := app.entitlement_monthly_sms(p_plan_id);
    if v_segments <= 0 then
        return 'no_allowance';
    end if;

    v_grant := app.sms_grant_credits(
        p_org_id,
        'monthly',
        v_segments,
        'invoice',
        p_invoice_id,
        p_period_end,
        'monthly included for ' || p_plan_id);

    if v_grant is null then
        return 'duplicate';
    end if;

    return 'granted';
end;
$$;

revoke all on function public.rpc_billing_apply_invoice_paid(uuid, text, text, timestamptz, timestamptz, bigint)
    from public, anon, authenticated;
grant execute on function public.rpc_billing_apply_invoice_paid(uuid, text, text, timestamptz, timestamptz, bigint)
    to service_role;

-- ============================================= purchased credit packs =======

-- A one-off purchase. Duplicate delivery of the same payment produces one
-- allocation, and the credit never expires.
create or replace function public.rpc_billing_apply_credit_purchase(
    p_org_id     uuid,
    p_payment_id text,
    p_segments   bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_grant uuid;
begin
    if p_segments is null or p_segments <= 0 then
        raise exception 'invalid_purchase_amount' using errcode = 'P0001';
    end if;

    v_grant := app.sms_grant_credits(
        p_org_id, 'purchased', p_segments, 'purchase', p_payment_id, null, 'purchased pack');

    if v_grant is null then
        return 'duplicate';
    end if;

    return 'granted';
end;
$$;

revoke all on function public.rpc_billing_apply_credit_purchase(uuid, text, bigint)
    from public, anon, authenticated;
grant execute on function public.rpc_billing_apply_credit_purchase(uuid, text, bigint)
    to service_role;


insert into supabase_migrations.schema_migrations (version, name)
values ('20260915000800', 'sms_two_source_ledger')
on conflict do nothing;

-- ===========================================================================
-- MIGRATION: 20260915000900_sms_balance_owner_read.sql
-- ===========================================================================

-- Let an owner read their own SMS balance without a service-role client.
--
-- `rpc_sms_balance` was service-role only, which pushed the owner-facing read
-- onto a client that bypasses row level security — and this repository has a
-- test whose whole job is to stop that happening, because a service-role read
-- in the owner data layer returns every tenant's rows and no mocked test
-- notices.
--
-- So the check moves into the function: it is SECURITY DEFINER, it proves the
-- caller is an active member of the organization it was asked about, and it is
-- callable by `authenticated`. A member asking about someone else's
-- organization gets zeros, which is the same answer they would get for an
-- organization that has never bought anything — nothing is confirmed either way.
create or replace function public.rpc_sms_balance(p_org_id uuid)
returns table (monthly bigint, purchased bigint, total bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
begin
    -- The service role has no JWT and needs no membership: it is the server
    -- acting on a webhook or a worker, and it is already trusted.
    if v_actor is not null and not exists (
        select 1 from public.organization_members m
         where m.org_id = p_org_id
           and m.user_id = v_actor
           and m.status = 'active'
    ) then
        return query select 0::bigint, 0::bigint, 0::bigint;
        return;
    end if;

    return query select * from app.sms_balance(p_org_id);
end;
$$;

revoke all on function public.rpc_sms_balance(uuid) from public, anon;
grant execute on function public.rpc_sms_balance(uuid) to authenticated, service_role;


insert into supabase_migrations.schema_migrations (version, name)
values ('20260915000900', 'sms_balance_owner_read')
on conflict do nothing;

-- ===========================================================================
-- MIGRATION: 20260915001000_sms_reconciliation.sql
-- ===========================================================================

-- The workers that finish what a send starts.
--
-- Two things are left hanging by a real provider integration, and both cost
-- money if nobody picks them up.
--
-- 1. PROVIDER_UNKNOWN. The submit request timed out *after* it left, so nobody
--    knows whether the provider accepted it. Retrying risks sending twice, so
--    the pipeline correctly does neither: it does not retry and it does not
--    touch the quota. But a reservation held forever is credit a business
--    cannot spend on a message they may never have sent.
--
--    After the reconciliation window closes, the reservation is SETTLED AS
--    SPENT, not released. The provider probably did accept it, and the
--    asymmetry matters: settling a message that never went out costs a
--    business one segment, while releasing one that did go out hands out free
--    sends forever to anyone who can cause a timeout. The attempt stays
--    `unresolved` so it is visible and countable rather than quietly closed.
--
-- 2. DEAD LETTERS. An outbox job that exhausted its attempts before any
--    provider submit. Nothing left, so the reservation is released — that one
--    is unambiguous.

create or replace function app.sms_reconcile_aged_unknowns(p_older_than_seconds integer default 900)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    r       record;
    v_count integer := 0;
begin
    for r in
        select a.id, a.org_id, a.request_id, tr.reserved_quota
          from public.sms_delivery_attempts a
          join public.text_requests tr on tr.id = a.request_id
         where a.status = 'provider_unknown'
           and a.reconciliation_state = 'unresolved'
           and a.settled_at < now() - make_interval(secs => greatest(p_older_than_seconds, 60))
           and coalesce(tr.reserved_quota, 0) > 0
    loop
        -- Idempotent on the correlation key, so a second pass changes nothing.
        if app.sms_quota_consume(r.org_id, r.reserved_quota::bigint,
                                 'req:' || r.request_id::text, r.request_id) then
            v_count := v_count + 1;
        end if;
    end loop;

    return v_count;
end;
$$;

revoke all on function app.sms_reconcile_aged_unknowns(integer) from public, anon, authenticated;

create or replace function public.rpc_sms_reconcile_aged_unknowns(p_older_than_seconds integer default 900)
returns integer
language sql
security invoker
set search_path = ''
as $$
    select app.sms_reconcile_aged_unknowns(p_older_than_seconds);
$$;

revoke all on function public.rpc_sms_reconcile_aged_unknowns(integer) from public, anon, authenticated;
grant execute on function public.rpc_sms_reconcile_aged_unknowns(integer) to service_role;

-- --------------------------------------------------------- dead letters ----

create or replace function app.sms_release_dead_letters()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    r       record;
    v_count integer := 0;
begin
    for r in
        select o.id as outbox_id, tr.id as request_id, tr.org_id, tr.reserved_quota
          from public.sms_outbox o
          join public.text_requests tr on tr.id = o.request_id
         where o.status = 'dead_letter'
           and tr.status in ('queued', 'sending')
           and coalesce(tr.reserved_quota, 0) > 0
           -- Only when nothing ever reached the provider. An attempt that did
           -- is the previous function's business, not this one's.
           and not exists (
               select 1 from public.sms_delivery_attempts a
                where a.request_id = tr.id
                  and a.status in ('submitted', 'delivered', 'provider_unknown')
           )
    loop
        if app.sms_quota_release(r.org_id, r.reserved_quota::bigint,
                                 'req:' || r.request_id::text, r.request_id) then
            update public.text_requests
               set status = 'failed', failed_at = now()
             where id = r.request_id and status in ('queued', 'sending');
            v_count := v_count + 1;
        end if;
    end loop;

    return v_count;
end;
$$;

revoke all on function app.sms_release_dead_letters() from public, anon, authenticated;

create or replace function public.rpc_sms_release_dead_letters()
returns integer
language sql
security invoker
set search_path = ''
as $$
    select app.sms_release_dead_letters();
$$;

revoke all on function public.rpc_sms_release_dead_letters() from public, anon, authenticated;
grant execute on function public.rpc_sms_release_dead_letters() to service_role;

-- ------------------------------------------------------- what to watch -----

-- The numbers an operator needs to know whether the pipeline is healthy,
-- in one read rather than five. Counts only: nothing here carries a phone
-- number, a message, or a token.
create or replace function public.rpc_sms_health()
returns table (
    outbox_pending        bigint,
    outbox_dead_letter    bigint,
    oldest_pending_age_s  bigint,
    provider_unknown      bigint,
    oldest_unknown_age_s  bigint,
    webhooks_unprocessed  bigint,
    stripe_unprocessed    bigint
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        (select count(*) from public.sms_outbox where status = 'pending'),
        (select count(*) from public.sms_outbox where status = 'dead_letter'),
        (select coalesce(extract(epoch from now() - min(created_at))::bigint, 0)
           from public.sms_outbox where status = 'pending'),
        (select count(*) from public.sms_delivery_attempts
          where status = 'provider_unknown' and reconciliation_state = 'unresolved'),
        (select coalesce(extract(epoch from now() - min(settled_at))::bigint, 0)
           from public.sms_delivery_attempts
          where status = 'provider_unknown' and reconciliation_state = 'unresolved'),
        (select count(*) from public.sms_webhook_inbox where processed_at is null),
        (select count(*) from public.stripe_webhook_events where processed_at is null);
$$;

revoke all on function public.rpc_sms_health() from public, anon, authenticated;
grant execute on function public.rpc_sms_health() to service_role;


insert into supabase_migrations.schema_migrations (version, name)
values ('20260915001000', 'sms_reconciliation')
on conflict do nothing;

-- ===========================================================================
-- MIGRATION: 20260915001100_stripe_event_retry.sql
-- ===========================================================================

-- A Stripe event that failed once must be able to succeed later.
--
-- The inbox was keyed on Stripe's event id so that a redelivery could not
-- apply the same event twice. It did that. What it also did was refuse the
-- retry: the row existed, so the second delivery was called a duplicate and
-- answered 200, whether or not the first attempt had ever finished.
--
-- Stripe retries a webhook for days precisely so a transient failure — a
-- database blip, a customer row that had not yet been linked — does not cost
-- the event. Nothing else in this system reprocesses that row: there is no
-- sweeper over `stripe_webhook_events`. So one unlucky second was enough to
-- lose a subscription change or a month's SMS allowance permanently, and the
-- only evidence was a row with `processed_at` still null.
--
-- A delivery is a duplicate when the event has been *processed*. Until then
-- it is a retry, and it runs. That is safe because every handler is
-- idempotent at the database: the subscription apply is ordered by Stripe's
-- own event timestamps, and a monthly grant is unique on the invoice that
-- minted it. Concurrent redeliveries of the same unprocessed event serialise
-- on the inbox row rather than racing each other.

create or replace function public.rpc_stripe_event_record(
    p_event_id      text,
    p_type          text,
    p_payload       jsonb,
    p_event_created timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_processed_at timestamptz;
begin
    insert into public.stripe_webhook_events (id, type, payload, event_created)
    values (p_event_id, p_type, p_payload, p_event_created)
    on conflict (id) do nothing;

    if found then
        return 'stored';
    end if;

    -- The row was already here. Take it, so that two deliveries arriving
    -- together do not both decide they are the one that should apply it.
    select e.processed_at
      into v_processed_at
      from public.stripe_webhook_events e
     where e.id = p_event_id
       for update;

    if v_processed_at is not null then
        return 'duplicate';
    end if;

    -- Recorded but never finished: this delivery is the retry.
    return 'stored';
end;
$$;

revoke all on function public.rpc_stripe_event_record(text, text, jsonb, timestamptz)
    from public, anon, authenticated;
grant execute on function public.rpc_stripe_event_record(text, text, jsonb, timestamptz)
    to service_role;

comment on function public.rpc_stripe_event_record(text, text, jsonb, timestamptz) is
    'Records one Stripe event in the durable inbox. Returns ''duplicate'' only for an event that has already been processed to completion; an event recorded but not yet processed returns ''stored'' so that Stripe''s retry actually retries it.';


insert into supabase_migrations.schema_migrations (version, name)
values ('20260915001100', 'stripe_event_retry')
on conflict do nothing;

-- ===========================================================================
-- MIGRATION: 20260915001200_trial_requires_checkout.sql
-- ===========================================================================

-- A trial is something Stripe starts, not something signing up grants.
--
-- WHAT WAS WRONG
-- --------------
-- Creating an organization wrote `trialing` with no plan, no card and no end
-- date. `app.entitlement_allows_service` opens the door for `trialing`, and
-- nothing anywhere expired a row whose `trial_ends_at` was null. So anyone who
-- could create an organization got an unlimited free customer flow, forever —
-- a permanent free plan, arrived at by accident, in a product whose money
-- rules begin "there is no free plan".
--
-- WHAT IS TRUE NOW
-- ----------------
-- A new organization starts `suspended` with no plan: it exists, it can be set
-- up, and its Tags do not serve customers until a verified Stripe subscription
-- says otherwise. That is the fail-closed default this table was built for.
-- The seven-day trial still exists and is still free — it starts when Stripe
-- says a subscription entered `trialing`, which is after a card and a plan.
--
-- A trial now has to have an end, and an ended trial stops opening the door
-- whether or not anything swept it. `app.entitlement_effective_status` is that
-- rule, applied where the answer is used, so a lapsed trial cannot be kept
-- alive by a maintenance job that did not run.
--
-- THE ONE DAY OF GRACE
-- --------------------
-- Stripe's own `customer.subscription.updated` arrives moments after a trial
-- converts, but "moments" is not a guarantee, and closing a paying business's
-- door over a webhook's latency is the worse failure. A trial that ended more
-- than a day ago with nothing from Stripe is over; before that it still works.
-- This is the same reasoning that keeps `past_due` open.
--
-- ORGANIZATIONS THAT EXISTED BEFORE BILLING
-- -----------------------------------------
-- They were backfilled `trialing` with no end. They are given a real seven-day
-- trial from this migration rather than being cut off mid-sentence, and it
-- expires like any other. Nobody keeps a permanent free plan.

-- ======================================================= what a trial is ====

create or replace function app.entitlement_effective_status(
    p_status        text,
    p_trial_ends_at timestamptz
)
returns text
language sql
stable
set search_path = ''
as $$
    select case
        when p_status = 'trialing'
             and p_trial_ends_at is not null
             and p_trial_ends_at <= now() - interval '1 day'
        then 'suspended'
        else p_status
    end;
$$;

revoke all on function app.entitlement_effective_status(text, timestamptz)
    from public, anon, authenticated;

comment on function app.entitlement_effective_status(text, timestamptz) is
    'The status that actually governs, given the clock. A trial whose end passed more than a day ago reads as suspended; everything else reads as itself.';

-- ========================================================= the constraints ==

-- Existing planless trials become real, finite trials rather than permanent
-- ones. Done before the constraint so the constraint can be trusted.
update public.entitlement_snapshots
   set trial_ends_at = now() + interval '7 days',
       source = 'backfill:trial_end_added',
       updated_at = now()
 where status = 'trialing'
   and trial_ends_at is null;

alter table public.entitlement_snapshots
    drop constraint if exists entitlement_plan_required_when_not_trialing;

-- `suspended` with no plan is the state of an organization that has never
-- subscribed. `active`, `past_due` and `cancelled` are states that can only be
-- reached through a subscription, so they still cannot exist without a plan.
alter table public.entitlement_snapshots
    add constraint entitlement_plan_required_once_subscribed
    check (status in ('trialing', 'suspended') or plan_id is not null);

alter table public.entitlement_snapshots
    drop constraint if exists entitlement_trial_has_an_end;

alter table public.entitlement_snapshots
    add constraint entitlement_trial_has_an_end
    check (status <> 'trialing' or trial_ends_at is not null);

-- ====================================================== the new front door ==

create or replace function app.initialize_entitlement_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- Fail closed. A business that has not been through checkout has an
    -- entitlement that says so, rather than no row (which would also fail
    -- closed, but with no way to tell "never subscribed" from "lost the row").
    insert into public.entitlement_snapshots (org_id, plan_id, status, source)
    values (new.id, null, 'suspended', 'awaiting_checkout')
    on conflict (org_id) do nothing;
    return new;
end;
$$;

revoke all on function app.initialize_entitlement_snapshot() from public, anon, authenticated;

-- ============================================ the door asks about the clock =

create or replace function app.resolve_public_stand(
    p_token_hash          text,
    p_previous_token_hash text default null
)
returns table (
    org_id               uuid,
    location_id          uuid,
    stand_id             uuid,
    business_name        text,
    location_name        text,
    google_review_url    text,
    destination_provider text,
    destination_url      text,
    customer_page        jsonb,
    default_locale       text,
    matched_key_version  smallint
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
           l.destination_provider,
           l.destination_url,
           app.resolve_customer_page(o.id, l.id),
           coalesce(l.default_locale, o.default_locale),
           s.public_token_key_version
      from public.review_stands s
      join public.locations l on l.id = s.location_id and l.org_id = s.org_id
      join public.organizations o on o.id = s.org_id
      join public.entitlement_snapshots e on e.org_id = o.id
     where (s.public_token_hash = p_token_hash
            or (p_previous_token_hash is not null
                and s.public_token_hash = p_previous_token_hash))
       and s.status = 'active'
       and l.status = 'active'
       and o.status = 'active'
       and app.entitlement_allows_service(
               app.entitlement_effective_status(e.status, e.trial_ends_at));
$$;

revoke all on function app.resolve_public_stand(text, text)
    from public, anon, authenticated;
grant execute on function app.resolve_public_stand(text, text) to service_role;

-- ================================================ and so do the cap checks ==

create or replace function public.rpc_create_stand(
    p_org_id             uuid,
    p_location_id        uuid,
    p_label              text,
    p_stand_token_hash   text,
    p_stand_token_prefix text,
    p_token_key_version  smallint,
    p_request_id         text,
    p_token_ciphertext   text,
    p_cipher_key_version smallint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor     uuid := (select auth.uid());
    v_role      text;
    v_stand_id  uuid;
    v_plan_id   text;
    v_status    text;
    v_limit     integer;
    v_count     integer;
begin
    if v_actor is null then
        raise exception 'not_authenticated' using errcode = 'P0001';
    end if;

    -- SQL cannot decrypt, but it can refuse anything that is not the
    -- `v1:<b64>:<b64>:<b64>` envelope `encrypt()` produces — which is enough to
    -- stop a truncated, empty, or plaintext value being stored as if it were
    -- recoverable key material.
    if p_cipher_key_version is null
       or p_token_ciphertext is null
       or btrim(p_token_ciphertext) !~
          '^v1:[A-Za-z0-9+/]{8,}={0,2}:[A-Za-z0-9+/]{8,}={0,2}:[A-Za-z0-9+/]{8,}={0,2}$'
    then
        raise exception 'ciphertext_required' using errcode = 'P0001';
    end if;

    select om.role into v_role
      from public.organization_members om
     where om.org_id = p_org_id
       and om.user_id = v_actor
       and om.status = 'active';

    if v_role is null or v_role not in ('owner', 'admin') then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    if not exists (
        select 1 from public.locations
         where id = p_location_id and org_id = p_org_id
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    -- The concurrency boundary. Two creates for one organization serialize
    -- here; the second counts after the first has committed.
    select e.plan_id, app.entitlement_effective_status(e.status, e.trial_ends_at)
      into v_plan_id, v_status
      from public.entitlement_snapshots e
     where e.org_id = p_org_id
       for update;

    if not found then
        -- No entitlement is not a generous default.
        raise exception 'entitlement_missing' using errcode = 'P0001';
    end if;

    v_limit := app.entitlement_tag_limit(v_plan_id, v_status);
    if v_limit <= 0 then
        raise exception 'entitlement_inactive' using errcode = 'P0001';
    end if;

    -- Retired Tags do not count: a business that retires one has freed the
    -- slot, and charging them for a sticker in a drawer would be absurd.
    select count(*)::integer into v_count
      from public.review_stands s
     where s.org_id = p_org_id
       and s.status <> 'retired';

    if v_count >= v_limit then
        raise exception 'tag_limit_reached' using errcode = 'P0001';
    end if;

    insert into public.review_stands
        (org_id, location_id, public_token_hash, public_token_prefix, label,
         stand_type, status, activated_at, public_token_key_version,
         public_token_encrypted, token_encryption_key_version)
    values
        (p_org_id, p_location_id, p_stand_token_hash, p_stand_token_prefix,
         coalesce(nullif(btrim(p_label), ''), 'Front Desk'), 'printable_qr',
         'active', now(), coalesce(p_token_key_version, 1),
         btrim(p_token_ciphertext), p_cipher_key_version)
    returning id into v_stand_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
    values
        (p_org_id, v_actor, 'user', 'stand.created', 'review_stand',
         v_stand_id::text, p_request_id,
         jsonb_build_object('locationId', p_location_id));

    return v_stand_id;
end;
$$;

create or replace function public.rpc_create_location(
    p_org_id     uuid,
    p_name       text,
    p_timezone   text default null,
    p_locale     text default null,
    p_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor       uuid := (select auth.uid());
    v_role        text;
    v_location_id uuid;
    v_plan_id     text;
    v_status      text;
    v_limit       integer;
    v_count       integer;
    v_name        text;
begin
    if v_actor is null then
        raise exception 'not_authenticated' using errcode = 'P0001';
    end if;

    v_name := btrim(coalesce(p_name, ''));
    if char_length(v_name) < 1 or char_length(v_name) > 160 then
        raise exception 'invalid_location_name' using errcode = 'P0001';
    end if;

    select om.role into v_role
      from public.organization_members om
     where om.org_id = p_org_id
       and om.user_id = v_actor
       and om.status = 'active';

    if v_role is null or v_role not in ('owner', 'admin') then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    select e.plan_id, app.entitlement_effective_status(e.status, e.trial_ends_at)
      into v_plan_id, v_status
      from public.entitlement_snapshots e
     where e.org_id = p_org_id
       for update;

    if not found then
        raise exception 'entitlement_missing' using errcode = 'P0001';
    end if;

    v_limit := app.entitlement_location_limit(v_plan_id, v_status);
    if v_limit <= 0 then
        raise exception 'entitlement_inactive' using errcode = 'P0001';
    end if;

    select count(*)::integer into v_count
      from public.locations l
     where l.org_id = p_org_id
       and l.status = 'active';

    if v_count >= v_limit then
        raise exception 'location_limit_reached' using errcode = 'P0001';
    end if;

    -- No destination is set here. A new location's door starts closed, and the
    -- owner points it somewhere deliberately through the destination write.
    insert into public.locations (org_id, name, timezone, default_locale)
    select p_org_id,
           v_name,
           coalesce(p_timezone, o.timezone, 'UTC'),
           coalesce(p_locale, o.default_locale, 'en')
      from public.organizations o
     where o.id = p_org_id
    returning id into v_location_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
    values
        (p_org_id, v_actor, 'user', 'location.created', 'location',
         v_location_id::text, p_request_id, '{}'::jsonb);

    return v_location_id;
end;
$$;

revoke all on function public.rpc_create_stand(uuid, uuid, text, text, text, smallint, text, text, smallint)
    from public, anon, authenticated;
grant execute on function public.rpc_create_stand(uuid, uuid, text, text, text, smallint, text, text, smallint)
    to authenticated, service_role;

revoke all on function public.rpc_create_location(uuid, text, text, text, text)
    from public, anon, authenticated;
grant execute on function public.rpc_create_location(uuid, text, text, text, text)
    to authenticated, service_role;

-- ======================================= and the state stops lying visibly ==

-- The read-time rule above is what governs. This exists so that what an owner
-- and an operator *see* matches it: a lapsed trial that still reads
-- `trialing` in the billing screen is a support call waiting to happen.
-- Idempotent, and safe to miss: skipping it changes no decision.
create or replace function public.rpc_entitlements_expire_trials()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_count integer;
begin
    with lapsed as (
        update public.entitlement_snapshots e
           set status = 'suspended',
               source = 'trial_expired',
               updated_at = now()
         where e.status = 'trialing'
           and e.trial_ends_at is not null
           and e.trial_ends_at <= now() - interval '1 day'
        returning 1
    )
    select count(*)::integer into v_count from lapsed;

    return v_count;
end;
$$;

revoke all on function public.rpc_entitlements_expire_trials() from public, anon, authenticated;
grant execute on function public.rpc_entitlements_expire_trials() to service_role;

-- ===================================== and Stripe cannot start an endless one

-- Same function, one rule added: see the note inside. Re-emitted here rather
-- than edited in place, because a landed migration is history.

create or replace function public.rpc_billing_apply_subscription(
    p_org_id                 uuid,
    p_stripe_subscription_id text,
    p_stripe_price_id        text,
    p_plan_id                text,
    p_stripe_status          text,
    p_cancel_at_period_end   boolean,
    p_current_period_start   timestamptz,
    p_current_period_end     timestamptz,
    p_trial_ends_at          timestamptz,
    p_event_id               text,
    p_event_created          timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_existing    public.billing_subscriptions%rowtype;
    v_status      text;
    v_trial_ends  timestamptz;
begin
    if p_plan_id is not null and p_plan_id not in ('starter', 'growth', 'pro') then
        raise exception 'unknown_plan' using errcode = 'P0001';
    end if;

    select * into v_existing
      from public.billing_subscriptions
     where org_id = p_org_id
       for update;

    if found and v_existing.last_event_at > p_event_created then
        -- An event older than what has already been applied. Discarding it is
        -- the whole point: a `subscription.updated` delivered after the
        -- `deleted` that followed it must not resurrect a cancelled plan.
        return 'stale';
    end if;

    v_status := app.entitlement_status_from_stripe(p_stripe_status);

    -- A trial with no end is the permanent free plan this product does not
    -- have. Stripe always sends `trial_end` for a trialing subscription, so
    -- this is the case where it did not: take the period end, and if there is
    -- no end to be had, do not open the door on the strength of a date nobody
    -- supplied.
    v_trial_ends := coalesce(p_trial_ends_at, p_current_period_end);
    if v_status = 'trialing' and v_trial_ends is null then
        v_status := 'suspended';
    end if;

    insert into public.billing_subscriptions as b
        (org_id, stripe_subscription_id, stripe_price_id, plan_id, stripe_status,
         cancel_at_period_end, current_period_start, current_period_end, trial_ends_at,
         last_event_at, last_event_id)
    values
        (p_org_id, p_stripe_subscription_id, p_stripe_price_id, p_plan_id, p_stripe_status,
         coalesce(p_cancel_at_period_end, false), p_current_period_start, p_current_period_end,
         p_trial_ends_at, p_event_created, p_event_id)
    on conflict (org_id) do update
        set stripe_subscription_id = excluded.stripe_subscription_id,
            stripe_price_id        = excluded.stripe_price_id,
            plan_id                = excluded.plan_id,
            stripe_status          = excluded.stripe_status,
            cancel_at_period_end   = excluded.cancel_at_period_end,
            current_period_start   = excluded.current_period_start,
            current_period_end     = excluded.current_period_end,
            trial_ends_at          = excluded.trial_ends_at,
            last_event_at          = excluded.last_event_at,
            last_event_id          = excluded.last_event_id,
            updated_at             = now();

    -- Same transaction. There is no moment where a business is paid-up in one
    -- table and cut off in the other.
    insert into public.entitlement_snapshots as e
        (org_id, plan_id, status, cancel_at_period_end, trial_ends_at, current_period_end, source)
    values
        (p_org_id, p_plan_id, v_status, coalesce(p_cancel_at_period_end, false),
         v_trial_ends, p_current_period_end, 'stripe:' || p_event_id)
    on conflict (org_id) do update
        set plan_id              = excluded.plan_id,
            status               = excluded.status,
            cancel_at_period_end = excluded.cancel_at_period_end,
            trial_ends_at        = excluded.trial_ends_at,
            current_period_end   = excluded.current_period_end,
            source               = excluded.source,
            updated_at           = now();

    return 'applied';
end;
$$;

revoke all on function public.rpc_billing_apply_subscription(
    uuid, text, text, text, text, boolean, timestamptz, timestamptz, timestamptz, text, timestamptz)
    from public, anon, authenticated;
grant execute on function public.rpc_billing_apply_subscription(
    uuid, text, text, text, text, boolean, timestamptz, timestamptz, timestamptz, text, timestamptz)
    to service_role;


insert into supabase_migrations.schema_migrations (version, name)
values ('20260915001200', 'trial_requires_checkout')
on conflict do nothing;

-- ===========================================================================
-- MIGRATION: 20260915001300_sms_ledger_carry_over.sql
-- ===========================================================================

-- Credit a business already paid for does not disappear because we changed
-- how credit is stored.
--
-- WHAT WAS WRONG
-- --------------
-- 20260915000800 moved the answer to "how many segments may this business
-- send?" from the `sms_quota_balance` projection to `sms_credit_grants`, and
-- rewrote every reader to ask the grants. It did not carry the old balances
-- across. On a database with real data that is not a refactor, it is a
-- deletion: every organization wakes up with a balance of zero, cannot send,
-- and cannot see where its credit went. Reservations already in flight are
-- worse — they have no slices, so settling them restores nothing to anybody.
--
-- A second gap in the same change: `app.sms_quota_refund` was left as it was.
-- Consumption moved to the grants, but a refund still only decremented the
-- projection nobody reads, so a message that a provider ultimately rejected
-- took the customer's credit with it. Both are fixed here.
--
-- WHAT IS CARRIED, AND WHAT IS NOT
-- --------------------------------
-- Every allocation that has not lapsed becomes a grant carrying its own
-- expiry, so credit that was going to expire still expires and credit that
-- never expires still does not. What is preserved exactly is the number that
-- matters to a business: what it can spend today. Allocations that had
-- already lapsed are not resurrected — they were not spendable before this
-- migration and they are not spendable after it.
--
-- Reservations still in flight are given slices from those grants, so
-- settling or releasing one puts the credit back where it came from rather
-- than nowhere.

-- ========================================================== the refund ======

create or replace function app.sms_quota_refund(
    p_org_id          uuid,
    p_amount          bigint,
    p_correlation_key text,
    p_request_id      uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_slice    record;
    v_inserted uuid;
begin
    perform app.sms_quota_lock_balance(p_org_id);

    insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id)
    values (p_org_id, 'refund', p_amount, p_correlation_key, p_request_id)
    on conflict (org_id, kind, correlation_key) do nothing
    returning id into v_inserted;

    if v_inserted is null then
        return false;
    end if;

    -- Back to the exact grants it was taken from. Credit that came from a
    -- monthly grant returns to that grant — if the month has since ended the
    -- credit is gone, which is correct: a refund is not a way to turn expiring
    -- credit into permanent credit.
    for v_slice in
        select s.grant_id, s.segments
          from public.sms_reservation_slices s
         where s.org_id = p_org_id
           and s.correlation_key = p_correlation_key
           and s.status = 'consumed'
           for update
    loop
        update public.sms_credit_grants
           set consumed = greatest(0, consumed - v_slice.segments)
         where id = v_slice.grant_id;
    end loop;

    update public.sms_reservation_slices
       set status = 'released', settled_at = now()
     where org_id = p_org_id
       and correlation_key = p_correlation_key
       and status = 'consumed';

    update public.sms_quota_balance b
       set consumed = greatest(0, b.consumed - p_amount), updated_at = now()
     where b.org_id = p_org_id;

    return true;
end;
$$;

comment on function app.sms_quota_refund(uuid, bigint, text, uuid) is
    'Gives back credit for a message the provider ultimately rejected, to the grants it was taken from. A refund into an expired monthly grant restores nothing spendable, which is the point.';

-- ========================================================= the carry-over ===

do $$
declare
    v_org        record;
    v_alloc      record;
    v_grant      record;
    v_res        record;
    v_surviving  bigint;
    v_lapsed     bigint;
    v_available  bigint;
    v_placed     bigint;
    v_left       bigint;
    v_take       bigint;
begin
    -- A database that never had the old ledger has nothing to carry.
    if to_regclass('public.sms_quota_balance') is null
       or to_regclass('public.sms_quota_ledger') is null then
        return;
    end if;

    for v_org in
        select b.org_id, b.allocated, b.reserved, b.consumed
          from public.sms_quota_balance b
         where b.allocated > 0 or b.reserved > 0 or b.consumed > 0
         order by b.org_id
    loop
        -- 1. Allocations that are still live become grants, each keeping its
        --    own expiry and its own identity, so this can run twice without
        --    minting anything a second time.
        for v_alloc in
            select l.id, l.amount, l.expires_at, l.effective_at, l.note
              from public.sms_quota_ledger l
             where l.org_id = v_org.org_id
               and l.kind = 'allocation'
               and l.amount > 0
               and (l.expires_at is null or l.expires_at > now())
               and not exists (
                   select 1
                     from public.sms_quota_ledger x
                    where x.org_id = l.org_id
                      and x.kind = 'expiration'
                      and x.correlation_key = 'expire:' || l.id::text)
             order by l.effective_at, l.id
        loop
            insert into public.sms_credit_grants
                (org_id, source, segments, granted_at, expires_at,
                 origin_kind, origin_id, note)
            values (
                v_org.org_id,
                case when v_alloc.expires_at is null then 'purchased' else 'monthly' end,
                v_alloc.amount,
                v_alloc.effective_at,
                v_alloc.expires_at,
                'manual',
                'legacy-allocation:' || v_alloc.id::text,
                coalesce(v_alloc.note, 'carried over from the single-bucket ledger'))
            on conflict (org_id, origin_kind, origin_id) do nothing;
        end loop;

        select coalesce(sum(g.segments), 0)
          into v_surviving
          from public.sms_credit_grants g
         where g.org_id = v_org.org_id;

        if v_surviving = 0 then
            continue;
        end if;

        -- 2. Reservations still in flight get their slices, taken in the order
        --    the new ledger spends: monthly first, soonest expiry first.
        v_placed := 0;

        for v_res in
            select l.correlation_key, l.amount
              from public.sms_quota_ledger l
             where l.org_id = v_org.org_id
               and l.kind = 'reservation'
               and l.amount > 0
               and not exists (
                   select 1
                     from public.sms_quota_ledger s
                    where s.org_id = l.org_id
                      and s.kind in ('consumption', 'release')
                      and s.correlation_key = l.correlation_key)
               and not exists (
                   select 1
                     from public.sms_reservation_slices s
                    where s.org_id = l.org_id
                      and s.correlation_key = l.correlation_key)
             order by l.effective_at, l.id
        loop
            v_left := v_res.amount;

            for v_grant in
                select g.id, (g.segments - g.consumed - g.reserved) as free
                  from public.sms_credit_grants g
                 where g.org_id = v_org.org_id
                   and g.segments > g.consumed + g.reserved
                 order by case g.source when 'monthly' then 0 else 1 end,
                          g.expires_at asc nulls last, g.granted_at, g.id
                   for update
            loop
                exit when v_left <= 0;

                v_take := least(v_left, v_grant.free);
                if v_take > 0 then
                    insert into public.sms_reservation_slices
                        (org_id, correlation_key, grant_id, segments, status)
                    values (v_org.org_id, v_res.correlation_key, v_grant.id, v_take, 'held')
                    on conflict (org_id, correlation_key, grant_id) do nothing;

                    update public.sms_credit_grants
                       set reserved = reserved + v_take
                     where id = v_grant.id;

                    v_left := v_left - v_take;
                    v_placed := v_placed + v_take;
                end if;
            end loop;
        end loop;

        -- 3. What is left spendable must match what was spendable before.
        --
        --    Rather than replaying every historical consumption — which would
        --    charge surviving credit for messages paid out of allocations that
        --    have since lapsed — this preserves the one number a business can
        --    act on: how much it can send today.
        select coalesce(sum(l.amount), 0)
          into v_lapsed
          from public.sms_quota_ledger l
         where l.org_id = v_org.org_id
           and l.kind = 'allocation'
           and l.expires_at is not null
           and l.expires_at <= now()
           and not exists (
               select 1
                 from public.sms_quota_ledger x
                where x.org_id = l.org_id
                  and x.kind = 'expiration'
                  and x.correlation_key = 'expire:' || l.id::text);

        v_available := greatest(
            0,
            v_org.allocated - v_org.reserved - v_org.consumed - v_lapsed);

        v_left := v_surviving - v_placed - v_available;

        for v_grant in
            select g.id, (g.segments - g.consumed - g.reserved) as free
              from public.sms_credit_grants g
             where g.org_id = v_org.org_id
               and g.segments > g.consumed + g.reserved
             order by case g.source when 'monthly' then 0 else 1 end,
                      g.expires_at asc nulls last, g.granted_at, g.id
               for update
        loop
            exit when v_left <= 0;

            v_take := least(v_left, v_grant.free);
            if v_take > 0 then
                update public.sms_credit_grants
                   set consumed = consumed + v_take
                 where id = v_grant.id;
                v_left := v_left - v_take;
            end if;
        end loop;
    end loop;
end
$$;


insert into supabase_migrations.schema_migrations (version, name)
values ('20260915001300', 'sms_ledger_carry_over')
on conflict do nothing;

-- ===========================================================================
-- MIGRATION: 20260915001400_setup_before_checkout.sql
-- ===========================================================================

-- Setting a business up is not the same as serving its customers.
--
-- Making a never-subscribed organization `suspended` closed the public door,
-- which is right. It also closed the front door: the caps read `suspended` as
-- "no Tags, no locations", so a business that had just signed up could not
-- create the one Tag onboarding exists to give it. Nobody would ever reach
-- checkout, because the product would be unusable before it.
--
-- The two questions are separate, and this separates them:
--
--   may this business SET UP?      one location, one Tag, before paying
--   may its Tags SERVE CUSTOMERS?  only once billing says so
--
-- `app.entitlement_allows_service` is untouched: a suspended organization's
-- Tag still resolves to the same neutral dead link as an unknown token. What
-- changes is that an owner can name their business, set their destination,
-- print their QR code and see exactly what a customer will see — and then be
-- asked for a card to switch it on. A Tag that serves nobody is not a free
-- plan; it is a product someone can look at before buying.
--
-- SUSPENDED AFTER PAYING IS NOT THE SAME STATE
-- --------------------------------------------
-- An organization suspended at the end of dunning has a plan on its
-- entitlement. It gets no setup allowance: its Tags exist already, and it does
-- not get to make more while it owes money. The difference is exactly the one
-- the billing screen already draws — "choose a plan" versus "suspended" — and
-- it is the presence of a plan that tells them apart.

create or replace function app.entitlement_tag_limit(p_plan_id text, p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
    select case
        when p_status = 'trialing' then 1
        -- Never subscribed: the setup allowance. Serves nobody.
        when p_status = 'suspended' and p_plan_id is null then 1
        when p_status = 'active' and p_plan_id = 'starter' then 3
        when p_status = 'active' and p_plan_id = 'growth' then 8
        when p_status = 'active' and p_plan_id = 'pro' then 25
        else 0
    end;
$$;

create or replace function app.entitlement_location_limit(p_plan_id text, p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
    select case
        when p_status = 'trialing' then 1
        when p_status = 'suspended' and p_plan_id is null then 1
        when p_status = 'active' and p_plan_id = 'starter' then 1
        when p_status = 'active' and p_plan_id = 'growth' then 2
        when p_status = 'active' and p_plan_id = 'pro' then 5
        else 0
    end;
$$;

revoke all on function app.entitlement_tag_limit(text, text) from public, anon, authenticated;
revoke all on function app.entitlement_location_limit(text, text) from public, anon, authenticated;

comment on function app.entitlement_tag_limit(text, text) is
    'How many Tags this entitlement allows. A business that has never subscribed gets one, so that it can be set up; that Tag serves no customers until billing opens the door.';


insert into supabase_migrations.schema_migrations (version, name)
values ('20260915001400', 'setup_before_checkout')
on conflict do nothing;

-- ===========================================================================
-- MIGRATION: 20260917000100_account_deletion.sql
-- ===========================================================================

-- Deleting the account, for real.
--
-- Until now the only way out was an email to privacy@reviewboost.fit. That is
-- not a deletion route a store will accept — Apple's 5.1.1(v) requires an app
-- that creates accounts to let a person start deleting one from inside it —
-- and it is not one a person can use at the moment they most want to.
--
-- WHY THIS HARD-DELETES WHEN THE REST OF THE SCHEMA DOES NOT
-- ----------------------------------------------------------
-- `organizations.closed_at` exists because closing a business is not deleting
-- it: a closed business can reopen, and its ratings are its own history. The
-- comment on that column — "Nothing is hard-deleted while dependent business
-- history exists" — is the right rule for closure and the wrong one for this.
-- A deletion request is a request to stop holding the data. A status flag that
-- leaves every phone number and every encrypted note in place answers a
-- different question than the one being asked.
--
-- So this is the one path that truly removes. Every tenant table cascades from
-- `organizations`, which is what makes that safe to say: the delete is one
-- statement and the foreign keys carry it everywhere, rather than a list of
-- tables that will drift out of date the first time someone adds one. The
-- pgTAP test asserts that completeness rather than trusting it.
--
-- WHAT DELIBERATELY SURVIVES
-- --------------------------
--   * `sms_webhook_inbox.org_id` is `on delete set null`, so a signature-
--     verified provider receipt outlives the account with nothing tying it to
--     one. Its body is encrypted and its phone numbers went with the cascade.
--   * The tombstone below, which records that an id was deleted and when. A
--     deletion nobody can confirm is one support cannot answer a question
--     about. It holds counts, never content, and no name.
--   * Stripe invoices. Money that has moved is a record both sides are
--     required to keep; the subscription is cancelled, and the API route does
--     that *before* this function runs, because a business billed for an
--     account that no longer exists is the worst outcome available here.

-- ========================================================== the tombstone ===

create table if not exists public.account_deletions (
    id             bigint generated always as identity primary key,
    -- Deliberately NOT a foreign key, to either table. The rows these would
    -- point at are the rows this record exists to say were destroyed, and a
    -- cascade would take the evidence with them.
    org_id         uuid not null,
    actor_user_id  uuid,
    -- Counts, never contents. "How much went" is answerable without holding
    -- anything back that was supposed to go.
    removed        jsonb not null default '{}'::jsonb,
    created_at     timestamptz not null default now()
);

comment on table public.account_deletions is
    'One row per deleted organization: that it happened, when, who asked, and how much went. No name, no contents, and no foreign key that a cascade could follow.';

alter table public.account_deletions enable row level security;
revoke all on public.account_deletions from public, anon, authenticated;
-- No policy, by design. The people who could read it no longer have an
-- account; support reads it with the service role.

-- ====================================================== the deletion ========

-- Takes the organization explicitly and the business's own name as a
-- confirmation, and checks both here rather than only in the UI. A typed
-- confirmation enforced solely in a form is a convention; enforced in the
-- function it is a property, and this is the one call in the system where
-- getting the wrong tenant is unrecoverable.
--
-- Identity is never an argument. The actor is `auth.uid()` and nothing else,
-- so there is no shape of this call in which one person names another and
-- deletes their business.
create or replace function public.rpc_delete_organization(
    p_org_id       uuid,
    p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor   uuid := (select auth.uid());
    v_name    text;
    v_removed jsonb;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    if p_org_id is null then
        raise exception 'organization is required' using errcode = 'P0001';
    end if;

    -- Locked before the authority check so that two concurrent deletions
    -- cannot both pass it and both try to cascade.
    select name into v_name
      from public.organizations
     where id = p_org_id
     for update;

    -- A business that does not exist, and one the caller may not delete, are
    -- the same error. Telling them apart would confirm that a guessed id is a
    -- real business.
    if v_name is null then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    -- Owner only. An admin can run the business day to day; ending it is not
    -- part of that, and the role split exists precisely so this call is
    -- narrower than the others.
    if not exists (
        select 1 from public.organization_members
         where org_id = p_org_id
           and user_id = v_actor
           and status = 'active'
           and role = 'owner'
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    -- Case- and space-insensitive, because the check is for deliberateness,
    -- not for typing accuracy. Someone who has typed their own business name
    -- has understood the question; someone who clicked through a dialog has
    -- not.
    if p_confirmation is null
       or lower(btrim(p_confirmation)) <> lower(btrim(v_name)) then
        raise exception 'confirmation_mismatch' using errcode = 'P0001';
    end if;

    -- Counted before the delete, for the tombstone. These are the tables a
    -- person would ask about: what the business collected, and who it texted.
    select jsonb_build_object(
               'locations',     (select count(*) from public.locations where org_id = p_org_id),
               'tags',          (select count(*) from public.review_stands where org_id = p_org_id),
               'ratings',       (select count(*) from public.customer_responses where org_id = p_org_id),
               'phone_numbers', (select count(*) from public.sms_consent_state where org_id = p_org_id),
               'texts_sent',    (select count(*) from public.text_requests where org_id = p_org_id),
               'members',       (select count(*) from public.organization_members where org_id = p_org_id)
           )
      into v_removed;

    -- Written before the delete. `audit_events` cascades from the
    -- organization, so an audit row about this would be destroyed by the
    -- statement it describes.
    insert into public.account_deletions (org_id, actor_user_id, removed)
    values (p_org_id, v_actor, v_removed);

    -- One statement. Every tenant table carries `org_id ... on delete
    -- cascade`, so this reaches all of them, including the ones added after
    -- this function was written.
    delete from public.organizations where id = p_org_id;

    return v_removed;
end;
$$;

revoke all on function public.rpc_delete_organization(uuid, text) from public, anon;
grant execute on function public.rpc_delete_organization(uuid, text) to authenticated;

-- ================================================== billing references ======

-- The Stripe ids for one organization, so the API route can cancel the
-- subscription before the rows holding these ids are destroyed.
--
-- `billing_customers` is deliberately unreadable by members, and this does not
-- change that: the function is service-role only and the route never returns
-- what it reads. It exists so the service-role client keeps its rule of
-- calling narrow `app.*` functions rather than querying tables.
create or replace function app.billing_refs_for_org(p_org_id uuid)
returns table (
    stripe_customer_id     text,
    stripe_subscription_id text,
    stripe_status          text
)
language sql
stable
security definer
set search_path = ''
as $$
    select c.stripe_customer_id, s.stripe_subscription_id, s.stripe_status
      from public.billing_customers c
      left join public.billing_subscriptions s on s.org_id = c.org_id
     where c.org_id = p_org_id;
$$;

revoke all on function app.billing_refs_for_org(uuid) from public, anon, authenticated;
grant execute on function app.billing_refs_for_org(uuid) to service_role;


insert into supabase_migrations.schema_migrations (version, name)
values ('20260917000100', 'account_deletion')
on conflict do nothing;

-- ===========================================================================
-- MIGRATION: 20260926000100_customer_page_bucket.sql
-- ===========================================================================

-- The Customer Page image bucket, for every environment.
--
-- Until now the bucket existed only in supabase/config.toml, which configures
-- the local stack and nothing else: a hosted project that ran every migration
-- still had no bucket, and every owner upload failed at the signed-URL step.
--
-- Public read: a published page stamps the image's public URL into what a
-- customer's browser loads directly, and the bucket holds only what an owner
-- deliberately uploaded as their page's photo.
--
-- Writes are never public. No storage.objects policy grants anon or
-- authenticated an insert, update or delete here, so the only way in is the
-- signed upload URL the server mints (service role) for one path under the
-- caller's own organization — see lib/server/customer-page-service.ts.
--
-- The limits match the upload pipeline: the owner's browser normalises every
-- photo to JPEG or WebP under 5 MiB before asking for a ticket, and the API
-- still accepts PNG. Anything else is refused by storage itself.
--
-- Idempotent: re-running converges the bucket to these settings, whether it
-- was absent, created by hand in the dashboard, or seeded from config.toml.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'customer-page',
    'customer-page',
    true,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
    set name               = excluded.name,
        public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;


insert into supabase_migrations.schema_migrations (version, name)
values ('20260926000100', 'customer_page_bucket')
on conflict do nothing;

-- ===========================================================================
-- MIGRATION: 20260926000200_feedback_insights.sql
-- ===========================================================================

-- Feedback → Insights: one read-only aggregation over the ratings a business
-- has received.
--
-- WHAT IT ANSWERS
-- ---------------
-- How many ratings of each star value arrived between consecutive boundaries.
-- The caller passes the boundaries — local midnights computed from the
-- business's own time zone by lib/utils/local-day.ts, where daylight-saving
-- days are 23 or 25 hours long and are tested as such — and gets back one row
-- per (bucket, star value) that has any ratings in it:
--
--     bucket n  =  p_bounds[n] <= submitted_at < p_bounds[n + 1]
--
-- Every boundary is explicit. The first is inclusive, the last is exclusive,
-- and nothing outside them is read. So the current period, the previous period
-- it is compared with, and the day in progress are each a bucket the server
-- chose on purpose, never an interval the database guessed — which is what
-- lets the screen keep a half-finished today out of any comparison.
--
-- Doing the counting here replaces the other two ways of getting the same
-- numbers: about twenty separate count queries per screen, or shipping every
-- rating row to the server process to add up there.
--
-- ISOLATION
-- ---------
-- SECURITY INVOKER, deliberately. The function runs as the signed-in caller, so
-- the customer_responses row level security policy (active members of the
-- organization only) applies to every row it counts. It cannot return anything
-- a direct select by the same person could not; asking about another business
-- returns nothing, which is the same answer as a business with no ratings, so
-- nothing is confirmed either way. The explicit org_id filter on top is not the
-- security boundary — RLS is — it is what keeps someone who belongs to two
-- businesses from seeing them added together, and it is what the index needs.
--
-- The location filter narrows within the organization; it can never widen it.
-- A location id belonging to another business simply matches no rows.
--
-- It reads and never writes (STABLE), and only `authenticated` may call it:
-- not anon, and not the service role, which bypasses row level security and
-- has no reason to ask this question.
--
-- WHAT IT DOES NOT DO
-- -------------------
-- It counts ratings only. It does not touch destination selections, so it can
-- never be read as "reviews received" on any other site. Every star value is
-- counted the same way, and nothing here depends on which value was chosen.

create or replace function public.rpc_feedback_insights(
    p_org_id      uuid,
    p_bounds      timestamptz[],
    p_location_id uuid default null
)
returns table (bucket integer, rating smallint, responses bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
    v_count integer := coalesce(array_length(p_bounds, 1), 0);
begin
    if p_org_id is null then
        raise exception 'p_org_id is required' using errcode = '22023';
    end if;

    -- Two boundaries make one bucket. Sixty-four is far past anything the
    -- screen asks for (a 90-day view needs twelve), and keeps the call cheap.
    if v_count < 2 or v_count > 64 then
        raise exception 'p_bounds must hold between 2 and 64 boundaries'
            using errcode = '22023';
    end if;

    for i in 1 .. v_count loop
        if p_bounds[i] is null then
            raise exception 'p_bounds must not contain nulls' using errcode = '22023';
        end if;
        -- width_bucket assumes sorted thresholds and gives quietly wrong
        -- answers otherwise, so unsorted input is refused rather than counted.
        if i > 1 and p_bounds[i] <= p_bounds[i - 1] then
            raise exception 'p_bounds must be strictly ascending' using errcode = '22023';
        end if;
    end loop;

    -- The longest view is 90 days compared with the 90 before it. A span
    -- beyond 400 days is not a question the product asks.
    if p_bounds[v_count] - p_bounds[1] > interval '400 days' then
        raise exception 'p_bounds may span at most 400 days' using errcode = '22023';
    end if;

    return query
        select width_bucket(r.submitted_at, p_bounds)::integer as bucket,
               r.rating,
               count(*)                                        as responses
          from public.customer_responses r
         where r.org_id = p_org_id
           and (p_location_id is null or r.location_id = p_location_id)
           and r.submitted_at >= p_bounds[1]
           and r.submitted_at <  p_bounds[v_count]
         group by 1, 2
         order by 1, 2;
end;
$$;

comment on function public.rpc_feedback_insights(uuid, timestamptz[], uuid) is
    'Ratings per star value between explicit boundaries, for Feedback → Insights. '
    'Read-only; runs as the caller under row level security.';

revoke all on function public.rpc_feedback_insights(uuid, timestamptz[], uuid)
    from public, anon, service_role;
grant execute on function public.rpc_feedback_insights(uuid, timestamptz[], uuid)
    to authenticated;


insert into supabase_migrations.schema_migrations (version, name)
values ('20260926000200', 'feedback_insights')
on conflict do nothing;

-- ===========================================================================
-- MIGRATION: 20260927000100_tag_routing_invariants.sql
-- ===========================================================================

-- The Tag is dumb. ReviewBoost is the routing layer.
--
-- A physical Tag — a printed QR code, an NFC chip — carries one thing: the
-- stable ReviewBoost URL `/q/{public token}`. Everything behind it is resolved
-- from server state at the moment a customer opens it:
--
--   public token → review_stands row → organization / location
--                → published Customer Page + current destination
--
-- So a business can change its Google link, its Customer Page, or which
-- location a Tag belongs to, and every Tag already in the field follows on the
-- very next scan. Nothing is reprinted or reprogrammed.
--
-- AUDIT RESULT
-- ------------
-- The architecture already had this shape. `review_stands` *is* the routing
-- record, keyed by the public token's digest; the destination and the page are
-- joined in at resolution time (`app.resolve_public_stand`), never copied onto
-- the Tag. Rotating the *digest key* re-hashes lazily on scan without changing
-- the token (20260808000800). The only thing that changes the printed URL is
-- the explicit owner/admin action "Make a new code" (`rpc_rotate_stand_token`),
-- which exists to revoke a Tag that has leaked or been copied.
--
-- No migration to a separate "public id → routing record" table is needed:
-- that indirection is already here. What was missing was enforcement — nothing
-- stopped a future write path from touching the Tag's identity as a side
-- effect, and nothing required a destination to be a review-writing link. This
-- migration adds both.
--
-- 1. TAG IDENTITY IS IMMUTABLE EXCEPT BY EXPLICIT ROTATION
--    A trigger refuses any change to a Tag's public token digest, prefix or
--    reprint ciphertext unless the same write is either
--      * the explicit rotation (it stamps token_rotated_at), or
--      * a key-version upgrade that re-digests / re-encrypts the SAME token.
--    Editing a label, moving a Tag to another location, changing a
--    destination, publishing a Customer Page, pausing or programming a Tag —
--    none of them can alter what is printed on it.
--
-- 2. NEW DESTINATIONS MUST BE GOOGLE REVIEW-WRITING LINKS
--    The resolvable allowlist (`_validate_google_review_url`) accepts any
--    Google Maps listing or opaque short link. Those open a place page, not the
--    review box, and a short link can be re-pointed by whoever controls it.
--    Any destination that is set or changed from now on must be one of the
--    two forms that open Google's review-writing dialog for a specific place:
--      https://search.google.com/local/writereview?placeid=<place id>
--      https://g.page/r/<profile id>/review
--    Existing rows keep resolving under the old allowlist, so no Tag in the
--    field goes dark; the next time an owner edits the destination it has to
--    be a review link.

-- ======================================================= strict validator ==

create or replace function public._is_google_review_writing_url(p_url text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
    v_rest  text;
    v_slash integer;
    v_auth  text;
    v_path  text;
    v_q     integer;
    v_query text;
begin
    -- The resolvable allowlist first: HTTPS, no credentials, no port, no
    -- oversized input, a Google host. Everything below only narrows it.
    if not public._validate_google_review_url(p_url) then
        return false;
    end if;

    v_rest  := substring(p_url from 9);
    v_slash := position('/' in v_rest);
    if v_slash = 0 then
        return false;
    end if;
    v_auth := rtrim(lower(substring(v_rest from 1 for v_slash - 1)), '.');
    v_path := substring(v_rest from v_slash);
    v_q    := position('?' in v_path);
    v_query := case when v_q > 0 then substring(v_path from v_q + 1) else '' end;
    if v_q > 0 then
        v_path := substring(v_path from 1 for v_q - 1);
    end if;
    -- A fragment never reaches Google's server; it cannot make a listing a
    -- review link.
    v_path := split_part(v_path, '#', 1);

    if v_auth = 'search.google.com' then
        return v_path = '/local/writereview'
           and ('&' || split_part(v_query, '#', 1)) ~ '&placeid=[A-Za-z0-9_-]+(&|$)';
    end if;

    if v_auth = 'g.page' then
        return v_path ~ '^/r/[A-Za-z0-9_-]+/review/?$';
    end if;

    return false;
end;
$$;

comment on function public._is_google_review_writing_url(text) is
    'True only for a Google link that opens the review-writing dialog for one '
    'place. Required for every destination set or changed after 2026-09-27.';

revoke all on function public._is_google_review_writing_url(text) from public, anon;
grant execute on function public._is_google_review_writing_url(text) to authenticated, service_role;

-- The provider-aware form, for write paths.
create or replace function public._validate_destination_write(
    p_provider text,
    p_url      text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
    if p_provider = 'google' then
        return public._is_google_review_writing_url(p_url);
    end if;
    return false;
end;
$$;

revoke all on function public._validate_destination_write(text, text) from public, anon;
grant execute on function public._validate_destination_write(text, text) to authenticated, service_role;

-- ================================= every new destination is a review link ==

-- Runs after `locations_sync_destination` (triggers fire in name order), so a
-- legacy write of google_review_url is checked on the destination it produced.
-- Only a destination that is actually being set or changed is checked: a
-- rename of a location whose older link predates this rule still saves, and
-- its Tags keep working.
create or replace function app.enforce_review_link_destination()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.destination_url is null then
        return new;
    end if;

    if tg_op = 'UPDATE'
       and new.destination_url is not distinct from old.destination_url
       and new.destination_provider is not distinct from old.destination_provider then
        return new;
    end if;

    -- A URL outside the resolvable allowlist is left to the table's CHECK
    -- (locations_destination_valid_check), which refuses it as before. This
    -- trigger narrows only what that allowlist would otherwise let through.
    if not public._validate_destination_url(new.destination_provider, new.destination_url) then
        return new;
    end if;

    if not public._validate_destination_write(new.destination_provider, new.destination_url) then
        -- Same error the owner write path already raises for a bad URL, so
        -- every caller maps it to the same 422.
        raise exception 'invalid_destination_url' using errcode = 'P0001';
    end if;

    return new;
end;
$$;

drop trigger if exists locations_writereview_destination on public.locations;
create trigger locations_writereview_destination
    before insert or update of google_review_url, destination_provider, destination_url
    on public.locations
    for each row
    execute function app.enforce_review_link_destination();

-- ====================================== Tag identity: rotation only ========

create or replace function app.guard_tag_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_rotation boolean := new.token_rotated_at is distinct from old.token_rotated_at;
begin
    if new.public_token_hash is distinct from old.public_token_hash
       and not v_rotation
       and not (new.public_token_key_version > old.public_token_key_version) then
        raise exception 'tag_identity_immutable'
            using errcode = 'P0001',
                  detail = 'A Tag''s public token changes only through rpc_rotate_stand_token.';
    end if;

    if new.public_token_prefix is distinct from old.public_token_prefix and not v_rotation then
        raise exception 'tag_identity_immutable'
            using errcode = 'P0001',
                  detail = 'A Tag''s public token changes only through rpc_rotate_stand_token.';
    end if;

    -- The reprint ciphertext may be written the first time (a Tag created
    -- before reprinting existed), re-encrypted under a newer key, or replaced
    -- by a rotation. Anything else would print a code for a different token.
    if new.public_token_encrypted is distinct from old.public_token_encrypted
       and old.public_token_encrypted is not null
       and not v_rotation
       and not (new.token_encryption_key_version > old.token_encryption_key_version) then
        raise exception 'tag_identity_immutable'
            using errcode = 'P0001',
                  detail = 'A Tag''s public token changes only through rpc_rotate_stand_token.';
    end if;

    return new;
end;
$$;

drop trigger if exists review_stands_guard_identity on public.review_stands;
create trigger review_stands_guard_identity
    before update on public.review_stands
    for each row
    execute function app.guard_tag_identity();

comment on trigger review_stands_guard_identity on public.review_stands is
    'The URL printed on a Tag changes only by explicit rotation. Destination, '
    'Customer Page, location and label changes resolve at scan time instead.';


insert into supabase_migrations.schema_migrations (version, name)
values ('20260927000100', 'tag_routing_invariants')
on conflict do nothing;

-- ===========================================================================
-- MIGRATION: 20260928000100_stripe_price_authority.sql
-- ===========================================================================

-- The Stripe Price is the only thing that decides a plan.
--
-- Until now the subscription webhook resolved a plan as "the price we
-- recognise, OR `subscription.metadata.plan_id`", and this function trusted
-- whatever `p_plan_id` it was handed. Metadata is a free-text field on the
-- Stripe object: anything that can write a subscription in the Stripe account
-- (a dashboard edit, a support tool, a test script pointed at the wrong key)
-- could put `plan_id=pro` on a subscription for a price this product does not
-- sell, and the business would get Pro. Payment authority cannot live in a
-- field nobody pays for.
--
-- THE RULE
-- --------
--   Stripe Price ID  ->  ReviewBoost plan, read from `billing_plan_prices`.
--
-- The mapping lives here, in the database that grants the entitlement, so the
-- grant does not depend on the application having been configured the same
-- way. The application's STRIPE_PRICE_* variables are only used to *create*
-- checkouts; the production readiness gate refuses to promote a deployment
-- whose variables disagree with this table.
--
-- AN UNKNOWN PRICE
-- ----------------
-- Fails closed and loudly. The function raises `unknown_price`, the webhook
-- inbox row keeps `processed_at` null with the error recorded, Stripe gets a
-- 500 and retries, and `/internal/health` reports the stuck event. Once an
-- operator adds the price to `billing_plan_prices`, the next retry (or a
-- manual resend from the Stripe dashboard) applies it. Nothing is granted in
-- between, and nothing is lost.
--
-- The one exception is an event that can only take access *away*
-- (cancelled / suspended) for an organization that already has a plan on
-- record: revoking is always safe, so it applies against the plan already
-- held rather than leaving a cancelled subscription entitled.
--
-- `p_plan_id` stays in the signature so an application build that still sends
-- it keeps working through the deploy, but it is now only a cross-check: if it
-- disagrees with the price, the event fails (`plan_price_mismatch`) rather than
-- one of the two being silently believed.

-- ============================================================ the mapping ===

create table if not exists public.billing_plan_prices (
    stripe_price_id text primary key
        check (stripe_price_id ~ '^price_[A-Za-z0-9_]+$'),
    plan_id         text not null check (plan_id in ('starter', 'growth', 'pro')),
    created_at      timestamptz not null default now()
);

comment on table public.billing_plan_prices is
    'Authoritative Stripe Price -> ReviewBoost plan mapping. Subscriptions and invoices for a price not listed here grant nothing and fail visibly. Maintained by an operator per environment; never derived from Stripe metadata.';

alter table public.billing_plan_prices enable row level security;
-- No policies: nothing but service_role and definer functions reads it.
revoke all on table public.billing_plan_prices from public, anon, authenticated;
grant select, insert, update, delete on table public.billing_plan_prices to service_role;

create or replace function app.plan_for_price(p_stripe_price_id text)
returns text
language sql
stable
set search_path = ''
as $$
    select p.plan_id
      from public.billing_plan_prices p
     where p.stripe_price_id = p_stripe_price_id
$$;

revoke all on function app.plan_for_price(text) from public, anon, authenticated;

-- The readiness gate reads the mapping through this, so it can prove the
-- deployment's STRIPE_PRICE_* variables are the prices the database grants on.
create or replace function public.rpc_billing_price_catalog()
returns table (stripe_price_id text, plan_id text)
language sql
stable
security definer
set search_path = ''
as $$
    select p.stripe_price_id, p.plan_id
      from public.billing_plan_prices p
     order by p.plan_id, p.stripe_price_id
$$;

revoke all on function public.rpc_billing_price_catalog() from public, anon, authenticated;
grant execute on function public.rpc_billing_price_catalog() to service_role;

-- ================================================== subscription events ====

create or replace function public.rpc_billing_apply_subscription(
    p_org_id                 uuid,
    p_stripe_subscription_id text,
    p_stripe_price_id        text,
    p_plan_id                text,
    p_stripe_status          text,
    p_cancel_at_period_end   boolean,
    p_current_period_start   timestamptz,
    p_current_period_end     timestamptz,
    p_trial_ends_at          timestamptz,
    p_event_id               text,
    p_event_created          timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_existing    public.billing_subscriptions%rowtype;
    v_has_row     boolean;
    v_plan        text;
    v_status      text;
    v_trial_ends  timestamptz;
    v_held_plan   text;
begin
    if p_org_id is null or p_stripe_subscription_id is null
       or p_event_id is null or p_event_created is null then
        raise exception 'malformed_subscription_event' using errcode = 'P0001';
    end if;

    select * into v_existing
      from public.billing_subscriptions
     where org_id = p_org_id
       for update;
    v_has_row := found;

    if v_has_row and v_existing.last_event_at > p_event_created then
        -- An event older than what has already been applied. A
        -- `subscription.updated` delivered after the `deleted` that followed
        -- it must not resurrect a cancelled plan.
        return 'stale';
    end if;

    v_status := app.entitlement_status_from_stripe(p_stripe_status);
    v_plan   := app.plan_for_price(p_stripe_price_id);

    if v_plan is null then
        -- Revoking access never needs to know the plan: apply a
        -- cancellation or suspension against the plan already on record.
        select e.plan_id into v_held_plan
          from public.entitlement_snapshots e
         where e.org_id = p_org_id;

        if v_status in ('cancelled', 'suspended') and v_held_plan is not null then
            v_plan := v_held_plan;
        else
            raise exception 'unknown_price'
                using errcode = 'P0001',
                      detail  = format('Stripe price %s is not in billing_plan_prices', coalesce(p_stripe_price_id, '<none>')),
                      hint    = 'Add the price to public.billing_plan_prices, then resend the event.';
        end if;
    elsif p_plan_id is not null and p_plan_id is distinct from v_plan then
        raise exception 'plan_price_mismatch'
            using errcode = 'P0001',
                  detail  = format('caller said %s, price %s is %s', p_plan_id, p_stripe_price_id, v_plan);
    end if;

    -- A trial with no end is the permanent free plan this product does not
    -- have. Take the period end, and if there is none, do not open the door
    -- on the strength of a date nobody supplied.
    v_trial_ends := coalesce(p_trial_ends_at, p_current_period_end);
    if v_status = 'trialing' and v_trial_ends is null then
        v_status := 'suspended';
    end if;

    insert into public.billing_subscriptions as b
        (org_id, stripe_subscription_id, stripe_price_id, plan_id, stripe_status,
         cancel_at_period_end, current_period_start, current_period_end, trial_ends_at,
         last_event_at, last_event_id)
    values
        (p_org_id, p_stripe_subscription_id, p_stripe_price_id, v_plan, p_stripe_status,
         coalesce(p_cancel_at_period_end, false), p_current_period_start, p_current_period_end,
         p_trial_ends_at, p_event_created, p_event_id)
    on conflict (org_id) do update
        set stripe_subscription_id = excluded.stripe_subscription_id,
            stripe_price_id        = excluded.stripe_price_id,
            plan_id                = excluded.plan_id,
            stripe_status          = excluded.stripe_status,
            cancel_at_period_end   = excluded.cancel_at_period_end,
            current_period_start   = excluded.current_period_start,
            current_period_end     = excluded.current_period_end,
            trial_ends_at          = excluded.trial_ends_at,
            last_event_at          = excluded.last_event_at,
            last_event_id          = excluded.last_event_id,
            updated_at             = now();

    insert into public.entitlement_snapshots as e
        (org_id, plan_id, status, cancel_at_period_end, trial_ends_at, current_period_end, source)
    values
        (p_org_id, v_plan, v_status, coalesce(p_cancel_at_period_end, false),
         v_trial_ends, p_current_period_end, 'stripe:' || p_event_id)
    on conflict (org_id) do update
        set plan_id              = excluded.plan_id,
            status               = excluded.status,
            cancel_at_period_end = excluded.cancel_at_period_end,
            trial_ends_at        = excluded.trial_ends_at,
            current_period_end   = excluded.current_period_end,
            source               = excluded.source,
            updated_at           = now();

    return 'applied';
end;
$$;

revoke all on function public.rpc_billing_apply_subscription(
    uuid, text, text, text, text, boolean, timestamptz, timestamptz, timestamptz, text, timestamptz)
    from public, anon, authenticated;
grant execute on function public.rpc_billing_apply_subscription(
    uuid, text, text, text, text, boolean, timestamptz, timestamptz, timestamptz, text, timestamptz)
    to service_role;

-- ======================================================= paid invoices =====

-- Same argument types, but the third argument is now the Stripe price, not a
-- plan name the caller chose. The parameter is renamed, which Postgres only
-- allows by dropping the old function. An application build still sending
-- `p_plan_id` gets "function not found", the event stays unprocessed and
-- Stripe retries it — so this migration must land before the build that calls
-- the new signature, and a paid invoice in that window is delayed, not lost.
drop function if exists public.rpc_billing_apply_invoice_paid(uuid, text, text, timestamptz, timestamptz, bigint);

create function public.rpc_billing_apply_invoice_paid(
    p_org_id          uuid,
    p_invoice_id      text,
    p_stripe_price_id text,
    p_period_start    timestamptz,
    p_period_end      timestamptz,
    p_amount_paid     bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_plan     text;
    v_segments integer;
    v_grant    uuid;
begin
    if p_org_id is null or p_invoice_id is null then
        raise exception 'malformed_invoice_event' using errcode = 'P0001';
    end if;

    if p_amount_paid is null or p_amount_paid <= 0 then
        -- A zero-amount invoice is a trial's invoice. A trial includes no SMS.
        return 'not_paid';
    end if;

    if p_stripe_price_id is null then
        -- An invoice with no subscription price on it is not a plan renewal.
        return 'no_plan';
    end if;

    v_plan := app.plan_for_price(p_stripe_price_id);
    if v_plan is null then
        -- Money moved for a price this product does not know. Not the
        -- cheapest tier's allowance, not nothing-and-forget: fail, stay in
        -- the inbox, and be applied once the price is mapped.
        raise exception 'unknown_price'
            using errcode = 'P0001',
                  detail  = format('Stripe price %s is not in billing_plan_prices', p_stripe_price_id),
                  hint    = 'Add the price to public.billing_plan_prices, then resend the event.';
    end if;

    if p_period_end is null then
        raise exception 'invoice_missing_period' using errcode = 'P0001';
    end if;

    v_segments := app.entitlement_monthly_sms(v_plan);
    if v_segments <= 0 then
        return 'no_allowance';
    end if;

    v_grant := app.sms_grant_credits(
        p_org_id,
        'monthly',
        v_segments,
        'invoice',
        p_invoice_id,
        p_period_end,
        'monthly included for ' || v_plan);

    if v_grant is null then
        return 'duplicate';
    end if;

    return 'granted';
end;
$$;

revoke all on function public.rpc_billing_apply_invoice_paid(uuid, text, text, timestamptz, timestamptz, bigint)
    from public, anon, authenticated;
grant execute on function public.rpc_billing_apply_invoice_paid(uuid, text, text, timestamptz, timestamptz, bigint)
    to service_role;


insert into supabase_migrations.schema_migrations (version, name)
values ('20260928000100', 'stripe_price_authority')
on conflict do nothing;

-- ===========================================================================
-- MIGRATION: 20260928000200_worker_heartbeats.sql
-- ===========================================================================

-- Did the scheduler actually run?
--
-- Every worker is idempotent and a missed run is caught by the next one, which
-- is exactly why a scheduler that has stopped is invisible: nothing errors, the
-- outbox simply stops draining, and `/internal/health` saw an empty outbox as
-- healthy. A business with no Text Requests queued looked identical to a
-- product whose dispatcher had not run for a week.
--
-- Each worker invocation now records when it started and how it ended. Health
-- compares those timestamps with the cadence the worker is meant to have, so
-- a dead or throttled scheduler is a health failure on its own, before any
-- message is late.

create table if not exists public.worker_heartbeats (
    worker             text primary key
                       check (worker in ('sms_dispatch', 'maintenance')),
    last_started_at    timestamptz,
    last_succeeded_at  timestamptz,
    last_failed_at     timestamptz,
    -- A short, operator-facing reason. Never a message body, phone or token:
    -- the caller passes an error code, not an exception dump.
    last_error         text check (last_error is null or char_length(last_error) <= 300),
    runs               bigint not null default 0,
    updated_at         timestamptz not null default now()
);

comment on table public.worker_heartbeats is
    'One row per scheduled worker: when it last started, succeeded and failed. Read by /internal/health to detect a scheduler that has stopped or slowed.';

alter table public.worker_heartbeats enable row level security;
revoke all on table public.worker_heartbeats from public, anon, authenticated;
grant select on table public.worker_heartbeats to service_role;

-- p_outcome: 'started' | 'succeeded' | 'failed'
create or replace function public.rpc_worker_heartbeat(
    p_worker  text,
    p_outcome text,
    p_error   text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_outcome not in ('started', 'succeeded', 'failed') then
        raise exception 'invalid_heartbeat_outcome' using errcode = 'P0001';
    end if;

    insert into public.worker_heartbeats as h
        (worker, last_started_at, last_succeeded_at, last_failed_at, last_error, runs)
    values
        (p_worker,
         case when p_outcome = 'started'   then now() end,
         case when p_outcome = 'succeeded' then now() end,
         case when p_outcome = 'failed'    then now() end,
         case when p_outcome = 'failed'    then left(p_error, 300) end,
         case when p_outcome = 'started'   then 1 else 0 end)
    on conflict (worker) do update
        set last_started_at   = coalesce(excluded.last_started_at, h.last_started_at),
            last_succeeded_at = coalesce(excluded.last_succeeded_at, h.last_succeeded_at),
            last_failed_at    = coalesce(excluded.last_failed_at, h.last_failed_at),
            last_error        = case p_outcome when 'failed' then excluded.last_error
                                               when 'succeeded' then null
                                               else h.last_error end,
            runs              = h.runs + excluded.runs,
            updated_at        = now();
end;
$$;

revoke all on function public.rpc_worker_heartbeat(text, text, text) from public, anon, authenticated;
grant execute on function public.rpc_worker_heartbeat(text, text, text) to service_role;

-- Seconds since each worker last succeeded (null: never), for health.
create or replace function public.rpc_worker_health()
returns table (
    worker                text,
    last_success_age_s    bigint,
    last_started_age_s    bigint,
    failing               boolean,
    last_error            text
)
language sql
stable
security definer
set search_path = ''
as $$
    select w.worker,
           extract(epoch from now() - h.last_succeeded_at)::bigint,
           extract(epoch from now() - h.last_started_at)::bigint,
           coalesce(h.last_failed_at > coalesce(h.last_succeeded_at, '-infinity'::timestamptz), false),
           h.last_error
      from (values ('sms_dispatch'), ('maintenance')) as w(worker)
      left join public.worker_heartbeats h on h.worker = w.worker
$$;

revoke all on function public.rpc_worker_health() from public, anon, authenticated;
grant execute on function public.rpc_worker_health() to service_role;


insert into supabase_migrations.schema_migrations (version, name)
values ('20260928000200', 'worker_heartbeats')
on conflict do nothing;

-- ===========================================================================
-- MIGRATION: 20260928000300_billing_customer_lookup.sql
-- ===========================================================================

-- The last direct table read through the service-role client.
--
-- `ensureStripeCustomer` looked up an organization's Stripe customer with
-- `service.from("billing_customers")` — the one place the server's
-- RLS-bypassing client queried a table rather than calling a narrow function.
-- This is that lookup as a function: one organization in, one id out,
-- service_role only. The static guard in
-- frontend/tests/unit/service-role-containment.test.ts keeps it the last.

create or replace function public.rpc_billing_customer_for_org(p_org_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select c.stripe_customer_id
      from public.billing_customers c
     where c.org_id = p_org_id
$$;

revoke all on function public.rpc_billing_customer_for_org(uuid) from public, anon, authenticated;
grant execute on function public.rpc_billing_customer_for_org(uuid) to service_role;


insert into supabase_migrations.schema_migrations (version, name)
values ('20260928000300', 'billing_customer_lookup')
on conflict do nothing;

-- ===========================================================================
-- MIGRATION: 20260928000400_applied_migrations_read.sql
-- ===========================================================================

-- Let the release gate see which migrations this database has.
--
-- A build is only safe on a database that already has every migration the
-- build was written against. The readiness gate compares the migration names
-- compiled into the build (frontend/lib/server/schema-manifest.ts) with this
-- ledger and refuses promotion if any is missing.
--
-- Names, not versions: migrations applied through the dashboard/MCP were
-- re-stamped with server-generated versions (three on the hosted project),
-- but keep their names.
--
-- plpgsql so the body is not resolved at creation: the plain-Postgres test
-- shim has no supabase_migrations schema. There it raises, and the gate
-- reports the ledger as unreadable — which is the fail-closed answer.

create or replace function public.rpc_applied_migrations()
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    return query select m.name::text from supabase_migrations.schema_migrations m;
end;
$$;

revoke all on function public.rpc_applied_migrations() from public, anon, authenticated;
grant execute on function public.rpc_applied_migrations() to service_role;


insert into supabase_migrations.schema_migrations (version, name)
values ('20260928000400', 'applied_migrations_read')
on conflict do nothing;

-- ===========================================================================
-- Prove it landed before committing: 66 names, nothing missing.
-- ===========================================================================

do $guard$
declare
    n integer;
begin
    select count(*) into n from supabase_migrations.schema_migrations;
    if n <> 66 then
        raise exception 'expected 66 migrations in the ledger, found %', n;
    end if;
end;
$guard$;

commit;
