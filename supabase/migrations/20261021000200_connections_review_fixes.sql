-- Connections and customer lists: fixes from the review of PR #85.
--
-- 1. The sync worker loads a connection, its tokens and its chosen places
--    through one service-role function instead of reading three tables with
--    the service-role key (PR #67's containment rule).
-- 2. A provider marked `unavailable` keeps being retried. Before this, every
--    claimant only looked at `active` connections and `unavailable` cleared
--    the schedule, so nothing could ever succeed and bring it back.
-- 3. A customer's shown name follows its sources. Re-importing a list with a
--    corrected name shows the correction; removing a list stops showing that
--    list's name. A name from somewhere else is still never overwritten by a
--    spreadsheet.
-- 4. Membership is kept per import. Two sheets (or two files) that both list
--    a person no longer share one record, so removing one list leaves the
--    people the other list still has.

-- ======================================================== 1. load once =====

create or replace function public.rpc_integration_load_connection(
    p_org_id        uuid,
    p_connection_id uuid
)
returns table (
    id                  uuid,
    org_id              uuid,
    provider_id         text,
    workflow_id         text,
    external_account_id text,
    state               text,
    granted_scopes      text[],
    access_token_enc    text,
    refresh_token_enc   text,
    access_expires_at   timestamptz,
    refresh_expires_at  timestamptz,
    last_refreshed_at   timestamptz,
    mapped_location_ids text[]
)
language sql
stable
security definer
set search_path = ''
as $$
    select c.id, c.org_id, c.provider_id, c.workflow_id, c.external_account_id, c.state::text,
           c.granted_scopes,
           cr.access_token_enc, cr.refresh_token_enc, cr.access_expires_at, cr.refresh_expires_at,
           cr.last_refreshed_at,
           coalesce((select array_agg(m.external_location_id order by m.external_location_id)
                       from public.integration_location_mappings m
                      where m.connection_id = c.id), '{}')
      from public.integration_connections c
      left join public.integration_credentials cr on cr.connection_id = c.id and cr.org_id = c.org_id
     where c.id = p_connection_id and c.org_id = p_org_id;
$$;

revoke all on function public.rpc_integration_load_connection(uuid, uuid) from public, anon, authenticated;
grant execute on function public.rpc_integration_load_connection(uuid, uuid) to service_role;

-- ================================================ 2. keep on retrying =====

drop index if exists public.integration_connections_due_idx;
create index integration_connections_due_idx on public.integration_connections (next_sync_at)
    where state in ('active', 'unavailable');

-- As before, except that `unavailable` keeps its schedule: the scheduled
-- reconcile is the call that finds the provider back and recovers it.
create or replace function app.integration_set_state(
    p_connection_id uuid,
    p_org_id        uuid,
    p_to            public.integration_state,
    p_reason        text,
    p_actor         uuid
)
returns public.integration_state
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_conn public.integration_connections%rowtype;
begin
    select * into v_conn
      from public.integration_connections c
     where c.id = p_connection_id and c.org_id = p_org_id
       for update;

    if v_conn.id is null then
        raise exception 'not_found_or_forbidden' using errcode = 'P0002';
    end if;

    if v_conn.state = p_to then
        return v_conn.state;
    end if;

    if not app.integration_transition_allowed(v_conn.state, p_to) then
        raise exception 'connection_state_invalid' using errcode = 'P0001';
    end if;

    update public.integration_connections c
       set state = p_to,
           health = case when p_to = 'active' then c.health else 'healthy' end,
           warning_codes = case when p_to = 'active' then c.warning_codes else '{}' end,
           failing_since = case when p_to in ('active', 'unavailable') then c.failing_since else null end,
           disconnected_at = case when p_to = 'disconnected' then now() else c.disconnected_at end,
           purge_after = case when p_to = 'disconnected' then now() + interval '30 days' else c.purge_after end,
           next_sync_at = case
               when p_to in ('active', 'unavailable') then coalesce(c.next_sync_at, now() + interval '6 hours')
               else null end
     where c.id = p_connection_id;

    insert into public.integration_connection_events
        (connection_id, org_id, from_state, to_state, reason_code, actor_user_id, config_version)
    values
        (p_connection_id, p_org_id, v_conn.state, p_to, p_reason, p_actor, v_conn.config_version);

    insert into public.audit_events (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values (p_org_id, p_actor, case when p_actor is null then 'system' else 'user' end,
            'integration.state_changed', 'integration_connection', p_connection_id::text,
            jsonb_build_object('provider', v_conn.provider_id, 'from', v_conn.state,
                               'to', p_to, 'reason', p_reason));

    return p_to;
end;
$$;

-- Connections already unavailable lost their schedule under the old rule.
update public.integration_connections c
   set next_sync_at = now()
 where c.state = 'unavailable' and c.next_sync_at is null;

create or replace function app.integration_enqueue_run(
    p_connection_id   uuid,
    p_org_id          uuid,
    p_kind            text,
    p_stream          text,
    p_idempotency_key text,
    p_window_start    timestamptz,
    p_window_end      timestamptz
)
returns table (run_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_conn public.integration_connections%rowtype;
    v_id   uuid;
begin
    select * into v_conn
      from public.integration_connections c
     where c.id = p_connection_id and c.org_id = p_org_id;

    if v_conn.id is null then
        raise exception 'not_found_or_forbidden' using errcode = 'P0002';
    end if;
    if v_conn.state not in ('active', 'unavailable') then
        raise exception 'connection_state_invalid' using errcode = 'P0001';
    end if;

    insert into public.integration_sync_runs
        (connection_id, org_id, kind, stream, config_version, idempotency_key, window_start, window_end)
    values
        (p_connection_id, p_org_id, p_kind, p_stream, v_conn.config_version, p_idempotency_key,
         p_window_start, p_window_end)
    on conflict on constraint integration_sync_runs_idempotency do nothing
    returning id into v_id;

    if v_id is not null then
        return query select v_id, true;
        return;
    end if;

    return query
    select r.id, false from public.integration_sync_runs r
     where r.connection_id = p_connection_id and r.idempotency_key = p_idempotency_key;
end;
$$;

create or replace function app.integration_claim_runs(
    p_worker        text,
    p_limit         integer,
    p_lease_seconds integer
)
returns setof public.integration_sync_runs
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- A run whose worker keeps dying is not handed out forever.
    update public.integration_sync_runs r
       set status = 'failed', error_code = 'lease_exhausted', finished_at = now(),
           lease_owner = null, lease_expires_at = null
     where r.status = 'running'
       and r.lease_expires_at <= now()
       and r.attempts >= r.max_attempts;

    -- `unavailable` is still worked: a run that succeeds is what recovers it.
    return query
    with claimable as (
        select r.id
          from public.integration_sync_runs r
          join public.integration_connections c on c.id = r.connection_id
         where c.state in ('active', 'unavailable')
           and r.next_attempt_at <= now()
           and (r.status = 'queued'
                or (r.status = 'running' and r.lease_expires_at <= now() and r.attempts < r.max_attempts))
         order by r.next_attempt_at
         for update of r skip locked
         limit greatest(1, p_limit)
    )
    update public.integration_sync_runs r
       set status = 'running',
           attempts = r.attempts + 1,
           lease_owner = p_worker,
           lease_expires_at = now() + make_interval(secs => greatest(5, p_lease_seconds)),
           started_at = coalesce(r.started_at, now())
      from claimable cl
     where r.id = cl.id
    returning r.*;
end;
$$;

create or replace function app.integration_inbox_claim(
    p_worker        text,
    p_limit         integer,
    p_lease_seconds integer
)
returns setof public.integration_inbox
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.integration_inbox i
       set status = 'dead_letter', lease_owner = null, lease_expires_at = null,
           outcome_code = 'lease_exhausted', processed_at = now()
     where i.status = 'processing'
       and i.lease_expires_at <= now()
       and i.attempts >= i.max_attempts;

    -- Events for a connection that is neither active nor merely unavailable
    -- wait; held, not dropped.
    return query
    with claimable as (
        select i.id
          from public.integration_inbox i
          join public.integration_connections c on c.id = i.connection_id
         where c.state in ('active', 'unavailable')
           and i.next_attempt_at <= now()
           and (i.status = 'pending'
                or (i.status = 'processing' and i.lease_expires_at <= now() and i.attempts < i.max_attempts))
         order by i.occurred_at
         for update of i skip locked
         limit greatest(1, p_limit)
    )
    update public.integration_inbox i
       set status = 'processing',
           attempts = i.attempts + 1,
           lease_owner = p_worker,
           lease_expires_at = now() + make_interval(secs => greatest(5, p_lease_seconds))
      from claimable cl
     where i.id = cl.id
    returning i.*;
end;
$$;

create or replace function app.integration_due_connections(p_limit integer, p_interval_seconds integer)
returns table (connection_id uuid, org_id uuid, provider_id text, workflow_id text, config_version integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
    return query
    update public.integration_connections c
       set next_sync_at = now() + make_interval(secs => greatest(300, p_interval_seconds))
     where c.id in (
        select c2.id from public.integration_connections c2
         where c2.state in ('active', 'unavailable')
           and c2.next_sync_at is not null and c2.next_sync_at <= now()
         order by c2.next_sync_at
         limit greatest(1, p_limit)
         for update skip locked)
    returning c.id, c.org_id, c.provider_id, c.workflow_id, c.config_version;
end;
$$;

-- ========================================== 3. the name a contact shows =====

-- Recompute the shown name after a source's name for this contact went away
-- or changed. `p_dropped` is the ciphertext that source used to hold. The
-- shown name is replaced only when it is empty or is that dropped value, so
-- a name that came from elsewhere is left alone. The replacement prefers a
-- connected system's name, then `p_prefer` (the profile just written), then
-- the most recently updated list's.
create or replace function app.customer_refresh_display_name(p_customer_id uuid, p_dropped text, p_prefer uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.customers cu
       set display_name_encrypted = (
               select p.name_encrypted
                 from public.customer_source_profiles p
                where p.customer_id = cu.id and p.status = 'active' and p.name_encrypted is not null
                order by (p.connection_id is not null) desc, (p.id = p_prefer) is true desc,
                         p.updated_at desc, p.id
                limit 1),
           names_differ = (
               select count(distinct p.name_digest) > 1
                 from public.customer_source_profiles p
                where p.customer_id = cu.id and p.status = 'active' and p.name_digest is not null)
     where cu.id = p_customer_id
       and (cu.display_name_encrypted is null
            or (p_dropped is not null and cu.display_name_encrypted = p_dropped));

    update public.customers cu
       set names_differ = (
               select count(distinct p.name_digest) > 1
                 from public.customer_source_profiles p
                where p.customer_id = cu.id and p.status = 'active' and p.name_digest is not null)
     where cu.id = p_customer_id;
end;
$$;

revoke all on function app.customer_refresh_display_name(uuid, text, uuid) from public, anon, authenticated;

-- ============================================ 4. membership per import =====

-- Who each import brought in, and what it called them. The source profile
-- shows the newest list's view; these rows let removal fall back to an older
-- list that still has the person. Deleted with the import or the contact.
create table public.customer_list_members (
    import_id      uuid not null,
    org_id         uuid not null,
    customer_id    uuid not null,
    name_encrypted text,
    name_digest    text check (name_digest is null or char_length(name_digest) between 16 and 128),
    created_at     timestamptz not null default now(),
    primary key (import_id, customer_id),
    constraint customer_list_members_import_fk
        foreign key (import_id, org_id) references public.customer_list_imports (id, org_id) on delete cascade,
    constraint customer_list_members_customer_fk
        foreign key (customer_id, org_id) references public.customers (id, org_id) on delete cascade
);

create index customer_list_members_customer_idx on public.customer_list_members (customer_id);

alter table public.customer_list_members enable row level security;
revoke all on public.customer_list_members from anon, authenticated;
grant all on public.customer_list_members to service_role;

-- Imports made before this table: each profile records the import that last
-- wrote it, which is the membership that can still be known.
insert into public.customer_list_members (import_id, org_id, customer_id, name_encrypted, name_digest)
select p.list_import_id, p.org_id, p.customer_id, p.name_encrypted, p.name_digest
  from public.customer_source_profiles p
  join public.customer_list_imports i on i.id = p.list_import_id and i.status = 'active'
 where p.list_import_id is not null and p.connection_id is null
on conflict do nothing;

create or replace function app.customer_list_import(
    p_org_id        uuid,
    p_actor         uuid,
    p_source        text,
    p_label         text,
    p_ref_digest    text,
    p_rows_received integer,
    p_rows_unusable integer,
    p_rows          jsonb
)
returns table (import_id uuid, created_count integer, updated_count integer, unchanged_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_import    uuid;
    v_row       jsonb;
    v_customer  uuid;
    v_inserted  boolean;
    v_profile   public.customer_source_profiles%rowtype;
    v_seen      text[] := '{}';
    v_created   integer := 0;
    v_updated   integer := 0;
    v_unchanged integer := 0;
    v_name_enc  text;
    v_digest    text;
begin
    perform app.customer_list_require_admin(p_org_id, p_actor);

    if p_source not in ('google_sheets', 'csv') then
        raise exception 'invalid_source' using errcode = '22023';
    end if;
    if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
        raise exception 'invalid_rows' using errcode = '22023';
    end if;
    if jsonb_array_length(p_rows) > 2000 or p_rows_received > 2000
       or p_rows_received < jsonb_array_length(p_rows) or p_rows_unusable < 0 then
        raise exception 'too_many_rows' using errcode = '22023';
    end if;

    insert into public.customer_list_imports
        (org_id, source, source_label, source_ref_digest, rows_received, rows_unusable, created_by)
    values
        (p_org_id, p_source, nullif(btrim(p_label), ''), p_ref_digest, p_rows_received, p_rows_unusable, p_actor)
    returning id into v_import;

    for v_row in select value from jsonb_array_elements(p_rows)
    loop
        if (v_row ->> 'phone_hash') = any (v_seen) then
            continue;
        end if;
        v_seen := v_seen || (v_row ->> 'phone_hash');
        v_name_enc := nullif(v_row ->> 'name_encrypted', '');
        v_digest := nullif(v_row ->> 'name_digest', '');

        -- A new contact takes the list's name. An existing contact's name is
        -- revisited below, once the profile holds the list's current name.
        insert into public.customers as cu
            (org_id, phone_hash, phone_encrypted, phone_key_version, phone_last_four, display_name_encrypted)
        values
            (p_org_id,
             v_row ->> 'phone_hash',
             nullif(v_row ->> 'phone_encrypted', ''),
             coalesce((v_row ->> 'phone_key_version')::smallint, 1),
             nullif(v_row ->> 'phone_last_four', ''),
             v_name_enc)
        on conflict on constraint customers_org_phone_key do update
            set phone_encrypted = coalesce(cu.phone_encrypted, excluded.phone_encrypted),
                updated_at = now()
        returning cu.id, (xmax = 0) into v_customer, v_inserted;

        insert into public.customer_list_members (import_id, org_id, customer_id, name_encrypted, name_digest)
        values (v_import, p_org_id, v_customer, v_name_enc, v_digest)
        on conflict do nothing;

        select * into v_profile from public.customer_source_profiles p
         where p.customer_id = v_customer and p.source_kind = p_source and p.connection_id is null
           for update;

        if v_profile.id is null then
            insert into public.customer_source_profiles
                (org_id, customer_id, connection_id, source_kind, name_encrypted, name_digest, list_import_id)
            values
                (p_org_id, v_customer, null, p_source, v_name_enc, v_digest, v_import);
            if v_inserted then v_created := v_created + 1; else v_updated := v_updated + 1; end if;
        else
            if v_profile.status = 'active' and v_profile.name_digest is not distinct from v_digest then
                v_unchanged := v_unchanged + 1;
            else
                v_updated := v_updated + 1;
            end if;
            update public.customer_source_profiles p
               set name_encrypted = case when p.name_digest is not distinct from v_digest
                                         then p.name_encrypted else v_name_enc end,
                   name_digest = v_digest,
                   list_import_id = v_import,
                   last_synced_at = now(),
                   status = 'active'
             where p.id = v_profile.id;
        end if;

        -- Fills an empty name, and replaces one this list itself supplied
        -- when the list's name for the person changed.
        perform app.customer_refresh_display_name(
            v_customer,
            case when v_profile.name_digest is distinct from v_digest then v_profile.name_encrypted end,
            v_profile.id);
    end loop;

    update public.customer_list_imports i
       set created_count = v_created, updated_count = v_updated, unchanged_count = v_unchanged
     where i.id = v_import;

    return query select v_import, v_created, v_updated, v_unchanged;
end;
$$;

-- Take back an import. A person another active list of the same kind still
-- has keeps their profile, now showing that list's name for them. Otherwise
-- the profile goes, and a contact nothing else knows (no other source, no
-- visit) goes with it. A kept contact stops showing this list's name.
-- Idempotent.
create or replace function app.customer_list_remove(p_org_id uuid, p_actor uuid, p_import_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_import   public.customer_list_imports%rowtype;
    v_customer uuid;
    v_profile  public.customer_source_profiles%rowtype;
    v_other    public.customer_list_members%rowtype;
    v_ids      uuid[] := '{}';
    v_removed  integer := 0;
begin
    perform app.customer_list_require_admin(p_org_id, p_actor);

    select * into v_import from public.customer_list_imports i
     where i.id = p_import_id and i.org_id = p_org_id
       for update;
    if v_import.id is null then
        raise exception 'not_found_or_forbidden' using errcode = 'P0002';
    end if;
    if v_import.status = 'removed' then
        return 0;
    end if;

    update public.customer_list_imports i
       set status = 'removed', removed_at = now()
     where i.id = p_import_id;

    for v_customer in
        select m.customer_id from public.customer_list_members m where m.import_id = p_import_id
        union
        select p.customer_id from public.customer_source_profiles p
         where p.list_import_id = p_import_id and p.org_id = p_org_id
    loop
        v_ids := v_ids || v_customer;

        select * into v_profile from public.customer_source_profiles p
         where p.customer_id = v_customer and p.source_kind = v_import.source and p.connection_id is null
           for update;
        continue when v_profile.id is null;

        -- The newest other active list of this kind that has the person.
        select m.* into v_other
          from public.customer_list_members m
          join public.customer_list_imports i on i.id = m.import_id
         where m.customer_id = v_customer
           and m.import_id <> p_import_id
           and i.org_id = p_org_id and i.source = v_import.source and i.status = 'active'
         order by i.created_at desc, i.id desc
         limit 1;

        if v_other.import_id is null then
            delete from public.customer_source_profiles p where p.id = v_profile.id;
            perform app.customer_refresh_display_name(v_customer, v_profile.name_encrypted, null);
        elsif v_profile.list_import_id is distinct from v_other.import_id then
            update public.customer_source_profiles p
               set name_encrypted = v_other.name_encrypted,
                   name_digest = v_other.name_digest,
                   list_import_id = v_other.import_id
             where p.id = v_profile.id;
            if v_profile.name_digest is distinct from v_other.name_digest then
                perform app.customer_refresh_display_name(v_customer, v_profile.name_encrypted, v_profile.id);
            end if;
        end if;
    end loop;

    delete from public.customer_list_members m where m.import_id = p_import_id;

    with orphaned as (
        delete from public.customers cu
         where cu.id = any (v_ids)
           and cu.org_id = p_org_id
           and not exists (select 1 from public.customer_source_profiles p where p.customer_id = cu.id)
           and not exists (select 1 from public.customer_visits v where v.customer_id = cu.id)
        returning cu.id
    )
    select count(*) into v_removed from orphaned;

    return v_removed;
end;
$$;
