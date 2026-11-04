-- Connections foundation: connection records, credentials, sync machinery,
-- and the customer and visit model they feed.
--
-- Design: docs/connections/03 (lifecycle), 04 (registry and records),
-- 05 (customers and visits), 06 (ingestion and sync).
--
-- WHAT THIS ADDS
-- --------------
-- A business connects a tool it already uses (Square first). The connection
-- is a row with a lifecycle state that only one function may change. Its
-- tokens live in a table no client role can read. Events from the tool land
-- in an inbox before they are acknowledged; sync runs are leased the same way
-- the SMS outbox is. What comes in becomes phone-keyed contacts and visits,
-- each recording which connection produced it.
--
-- WHAT IT DELIBERATELY DOES NOT DO
-- --------------------------------
-- Nothing here records consent, creates a Text Request, reserves or grants
-- credit. A connection makes a customer findable; whether they may be texted
-- is still decided only by the consent ledger and `app.sms_can_send`.
--
-- Every write is a SECURITY DEFINER `app.integration_*` function reached by
-- the service role through a `public.rpc_integration_*` wrapper, after the
-- route has authenticated the user and resolved the organization from the
-- session. Owners and admins may read their own organization's connections,
-- runs, issues, contacts and visits; nobody else may read anything, and no
-- client role may write.

-- ================================================================ types =====

create type public.integration_state as enum (
    'connecting', 'authorization_required', 'active', 'reauth_required',
    'unavailable', 'error', 'disconnecting', 'disconnected'
);

create type public.integration_health as enum ('healthy', 'warning');

-- ========================================================= connections =====

create table public.integration_connections (
    id                       uuid primary key default gen_random_uuid(),
    org_id                   uuid not null references public.organizations (id) on delete cascade,
    provider_id              text not null check (provider_id ~ '^[a-z][a-z0-9_]{1,40}$'),
    workflow_id              text not null check (workflow_id ~ '^[a-z][a-z0-9_]{1,40}$'),
    -- The provider's id for the business's account (Square merchant id). The
    -- tenancy key for webhooks.
    external_account_id      text not null check (char_length(external_account_id) between 1 and 200),
    -- Owner-facing account name ("Corner Cafe LLC"). Display only.
    external_account_label   text check (char_length(external_account_label) <= 120),
    state                    public.integration_state not null,
    health                   public.integration_health not null default 'healthy',
    -- Fixed codes, translated by the UI. Never provider-supplied text.
    warning_codes            text[] not null default '{}',
    granted_scopes           text[] not null default '{}',
    config_version           integer not null default 1,
    last_test_config_version integer,
    last_test_passed         boolean,
    last_test_at             timestamptz,
    -- Counts only, never personal data.
    last_test_summary        jsonb,
    last_success_at          timestamptz,
    last_attempt_at          timestamptz,
    next_sync_at             timestamptz,
    -- Start of the current run of transient failures; drives `unavailable`.
    failing_since            timestamptz,
    last_error_code          text check (last_error_code is null or last_error_code ~ '^[a-z][a-z0-9_]{1,60}$'),
    created_by               uuid references auth.users (id) on delete set null,
    created_at               timestamptz not null default now(),
    updated_at               timestamptz not null default now(),
    disconnected_at          timestamptz,
    -- After a disconnect, data from this connection is kept until then so a
    -- reconnect can restore it; the worker deletes it afterwards.
    purge_after              timestamptz,
    constraint integration_connections_id_org_key unique (id, org_id)
);

-- One live connection per provider account across all organizations, so one
-- Square merchant cannot feed two businesses.
create unique index integration_connections_one_live_account
    on public.integration_connections (provider_id, external_account_id)
    where state <> 'disconnected';

-- One live connection per organization and provider.
create unique index integration_connections_one_live_per_org
    on public.integration_connections (org_id, provider_id)
    where state <> 'disconnected';

create index integration_connections_org_idx on public.integration_connections (org_id, created_at desc);
create index integration_connections_due_idx on public.integration_connections (next_sync_at)
    where state = 'active';

create trigger integration_connections_touch_updated_at
    before update on public.integration_connections
    for each row execute function app.touch_updated_at();

create table public.integration_location_mappings (
    connection_id         uuid not null,
    org_id                uuid not null,
    external_location_id  text not null check (char_length(external_location_id) between 1 and 200),
    external_location_name text check (char_length(external_location_name) <= 120),
    external_timezone     text check (char_length(external_timezone) <= 64),
    location_id           uuid not null,
    created_at            timestamptz not null default now(),
    primary key (connection_id, external_location_id),
    constraint integration_location_mappings_one_location unique (connection_id, location_id),
    constraint integration_location_mappings_connection_fk
        foreign key (connection_id, org_id)
            references public.integration_connections (id, org_id) on delete cascade,
    constraint integration_location_mappings_location_fk
        foreign key (location_id, org_id)
            references public.locations (id, org_id) on delete cascade
);

-- Append-only lifecycle history.
create table public.integration_connection_events (
    id             bigint generated always as identity primary key,
    connection_id  uuid not null,
    org_id         uuid not null,
    from_state     public.integration_state,
    to_state       public.integration_state not null,
    reason_code    text not null check (reason_code ~ '^[a-z][a-z0-9_]{1,60}$'),
    actor_user_id  uuid references auth.users (id) on delete set null,
    config_version integer,
    created_at     timestamptz not null default now(),
    constraint integration_connection_events_connection_fk
        foreign key (connection_id, org_id)
            references public.integration_connections (id, org_id) on delete cascade
);

create index integration_connection_events_connection_idx
    on public.integration_connection_events (connection_id, created_at desc);

-- ========================================================= credentials =====

-- Tokens, encrypted by the server under a key the database never sees, bound
-- to their connection so a ciphertext copied onto another row fails to
-- decrypt. No client role has any privilege and there are no policies.
create table public.integration_credentials (
    connection_id       uuid primary key,
    org_id              uuid not null,
    key_version         smallint not null check (key_version between 1 and 32767),
    access_token_enc    text not null,
    refresh_token_enc   text,
    access_expires_at   timestamptz,
    refresh_expires_at  timestamptz,
    token_obtained_at   timestamptz not null default now(),
    last_refreshed_at   timestamptz,
    -- Single-flight refresh: a worker takes this before refreshing.
    refresh_lock_until  timestamptz,
    constraint integration_credentials_connection_fk
        foreign key (connection_id, org_id)
            references public.integration_connections (id, org_id) on delete cascade
);

-- ======================================================= OAuth states =====

create table public.integration_oauth_states (
    state_digest            text primary key check (char_length(state_digest) between 32 and 128),
    org_id                  uuid not null references public.organizations (id) on delete cascade,
    user_id                 uuid not null references auth.users (id) on delete cascade,
    provider_id             text not null,
    workflow_id             text not null,
    requested_scopes        text[] not null default '{}',
    code_verifier_enc       text,
    reconnect_connection_id uuid,
    expires_at              timestamptz not null,
    used_at                 timestamptz,
    created_at              timestamptz not null default now()
);

create index integration_oauth_states_expiry_idx on public.integration_oauth_states (expires_at);

-- ============================================================== inbox =====

create table public.integration_inbox (
    id                  uuid primary key default gen_random_uuid(),
    provider_id         text not null,
    provider_event_id   text not null check (char_length(provider_event_id) between 1 and 200),
    external_account_id text not null check (char_length(external_account_id) between 1 and 200),
    connection_id       uuid references public.integration_connections (id) on delete set null,
    org_id              uuid references public.organizations (id) on delete cascade,
    event_type          text not null check (char_length(event_type) between 1 and 100),
    object_type         text check (char_length(object_type) <= 40),
    object_id           text check (char_length(object_id) <= 200),
    object_version      bigint,
    occurred_at         timestamptz not null,
    received_at         timestamptz not null default now(),
    payload_version     text not null check (char_length(payload_version) between 1 and 80),
    -- Raw body, encrypted; nulled after seven days.
    body_encrypted      text,
    status              text not null default 'pending'
        check (status in ('pending', 'processing', 'processed', 'skipped', 'dead_letter')),
    attempts            smallint not null default 0,
    max_attempts        smallint not null default 8,
    lease_owner         text,
    lease_expires_at    timestamptz,
    next_attempt_at     timestamptz not null default now(),
    outcome_code        text check (outcome_code is null or outcome_code ~ '^[a-z][a-z0-9_]{1,60}$'),
    processed_at        timestamptz,
    constraint integration_inbox_event_key unique (provider_id, provider_event_id)
);

create index integration_inbox_claimable_idx
    on public.integration_inbox (next_attempt_at)
    where status in ('pending', 'processing');

-- ========================================================== sync runs =====

create table public.integration_sync_runs (
    id               uuid primary key default gen_random_uuid(),
    connection_id    uuid not null,
    org_id           uuid not null,
    kind             text not null check (kind in ('backfill', 'incremental', 'manual', 'reconcile')),
    stream           text not null check (stream ~ '^[a-z][a-z0-9_]{1,40}$'),
    status           text not null default 'queued'
        check (status in ('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled')),
    config_version   integer not null,
    idempotency_key  text not null check (char_length(idempotency_key) between 1 and 200),
    window_start     timestamptz,
    window_end       timestamptz,
    cursor           text,
    counts           jsonb not null default '{}'::jsonb,
    lease_owner      text,
    lease_expires_at timestamptz,
    attempts         smallint not null default 0,
    max_attempts     smallint not null default 6,
    next_attempt_at  timestamptz not null default now(),
    error_code       text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{1,60}$'),
    started_at       timestamptz,
    finished_at      timestamptz,
    created_at       timestamptz not null default now(),
    constraint integration_sync_runs_idempotency unique (connection_id, idempotency_key),
    constraint integration_sync_runs_connection_fk
        foreign key (connection_id, org_id)
            references public.integration_connections (id, org_id) on delete cascade
);

create index integration_sync_runs_connection_idx
    on public.integration_sync_runs (connection_id, created_at desc);
create index integration_sync_runs_claimable_idx
    on public.integration_sync_runs (next_attempt_at)
    where status in ('queued', 'running');

create table public.integration_sync_checkpoints (
    connection_id  uuid not null,
    org_id         uuid not null,
    stream         text not null,
    high_water     timestamptz,
    updated_at     timestamptz not null default now(),
    primary key (connection_id, stream),
    constraint integration_sync_checkpoints_connection_fk
        foreign key (connection_id, org_id)
            references public.integration_connections (id, org_id) on delete cascade
);

-- The owner's "couldn't bring in" list. Hints carry at most an initial and
-- the last four digits, never a full name or number.
create table public.integration_record_issues (
    id             uuid primary key default gen_random_uuid(),
    connection_id  uuid not null,
    org_id         uuid not null,
    run_id         uuid references public.integration_sync_runs (id) on delete set null,
    inbox_id       uuid references public.integration_inbox (id) on delete set null,
    object_type    text not null check (object_type ~ '^[a-z][a-z0-9_]{1,40}$'),
    external_id    text not null check (char_length(external_id) between 1 and 200),
    issue_code     text not null check (issue_code ~ '^[a-z][a-z0-9_]{1,60}$'),
    display_hint   text check (char_length(display_hint) <= 80),
    first_seen_at  timestamptz not null default now(),
    last_seen_at   timestamptz not null default now(),
    resolved_at    timestamptz,
    constraint integration_record_issues_key unique (connection_id, object_type, external_id, issue_code),
    constraint integration_record_issues_connection_fk
        foreign key (connection_id, org_id)
            references public.integration_connections (id, org_id) on delete cascade
);

create index integration_record_issues_open_idx
    on public.integration_record_issues (connection_id, last_seen_at desc)
    where resolved_at is null;

-- ================================================== customers and visits =====

-- One reachable contact per business, keyed by phone, because consent,
-- opt-out and suppression are keyed by phone. Only numbers that normalise to
-- E.164 become contacts; anything else is an issue row, not a contact.
create table public.customers (
    id                     uuid primary key default gen_random_uuid(),
    org_id                 uuid not null references public.organizations (id) on delete cascade,
    phone_hash             text not null check (char_length(phone_hash) between 16 and 128),
    phone_encrypted        text,
    phone_key_version      smallint not null default 1,
    phone_last_four        text check (phone_last_four is null or phone_last_four ~ '^[0-9]{2,4}$'),
    -- The most recent name from the most recently updated source.
    display_name_encrypted text,
    -- Two sources call this number by different names (a shared family or
    -- business line). Shown to the owner; never resolved automatically.
    names_differ           boolean not null default false,
    first_seen_at          timestamptz not null default now(),
    last_seen_at           timestamptz not null default now(),
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),
    constraint customers_org_phone_key unique (org_id, phone_hash),
    constraint customers_id_org_key unique (id, org_id)
);

create trigger customers_touch_updated_at
    before update on public.customers
    for each row execute function app.touch_updated_at();

-- How each source knows a contact. Names are kept per source so a conflict is
-- visible rather than silently overwritten.
create table public.customer_source_profiles (
    id                 uuid primary key default gen_random_uuid(),
    org_id             uuid not null,
    customer_id        uuid not null,
    connection_id      uuid,
    source_kind        text not null check (source_kind in ('manual', 'csv', 'integration')),
    external_id        text check (char_length(external_id) between 1 and 200),
    name_encrypted     text,
    -- Keyed digest of the normalised name, so differing names can be detected
    -- without decrypting (ciphertexts of one name differ, by design).
    name_digest        text check (name_digest is null or char_length(name_digest) between 16 and 128),
    source_created_at  timestamptz,
    source_updated_at  timestamptz,
    source_version     bigint,
    last_synced_at     timestamptz not null default now(),
    config_version     integer,
    status             text not null default 'active' check (status in ('active', 'detached')),
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    constraint customer_source_profiles_integration_shape check (
        source_kind <> 'integration' or (connection_id is not null and external_id is not null)
    ),
    constraint customer_source_profiles_customer_fk
        foreign key (customer_id, org_id) references public.customers (id, org_id) on delete cascade,
    constraint customer_source_profiles_connection_fk
        foreign key (connection_id, org_id)
            references public.integration_connections (id, org_id) on delete cascade
);

create unique index customer_source_profiles_connection_external
    on public.customer_source_profiles (connection_id, external_id)
    where connection_id is not null;
create index customer_source_profiles_customer_idx on public.customer_source_profiles (customer_id);

create trigger customer_source_profiles_touch_updated_at
    before update on public.customer_source_profiles
    for each row execute function app.touch_updated_at();

-- A visit from a source. Amounts, items, staff and notes are never stored.
create table public.customer_visits (
    id                 uuid primary key default gen_random_uuid(),
    org_id             uuid not null,
    customer_id        uuid not null,
    location_id        uuid not null,
    connection_id      uuid,
    source_kind        text not null check (source_kind in ('manual', 'csv', 'integration')),
    external_id        text check (char_length(external_id) between 1 and 200),
    -- The source's id for the customer on this visit, so a profile that moves
    -- to a new phone number takes exactly its own visits with it.
    customer_external_id text check (char_length(customer_external_id) between 1 and 200),
    kind               text not null check (kind in ('payment', 'appointment')),
    status             text not null
        check (status in ('completed', 'appointment_time_passed', 'pending', 'cancelled', 'no_show')),
    occurred_at        timestamptz not null,
    source_updated_at  timestamptz,
    source_version     bigint,
    config_version     integer,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    constraint customer_visits_integration_shape check (
        source_kind <> 'integration' or (connection_id is not null and external_id is not null)
    ),
    constraint customer_visits_customer_fk
        foreign key (customer_id, org_id) references public.customers (id, org_id) on delete cascade,
    constraint customer_visits_location_fk
        foreign key (location_id, org_id) references public.locations (id, org_id) on delete cascade,
    constraint customer_visits_connection_fk
        foreign key (connection_id, org_id)
            references public.integration_connections (id, org_id) on delete cascade
);

create unique index customer_visits_connection_external
    on public.customer_visits (connection_id, kind, external_id)
    where connection_id is not null;
create index customer_visits_org_time_idx on public.customer_visits (org_id, occurred_at desc);
create index customer_visits_customer_idx on public.customer_visits (customer_id, occurred_at desc);

create trigger customer_visits_touch_updated_at
    before update on public.customer_visits
    for each row execute function app.touch_updated_at();

-- ================================================================ RLS =====

alter table public.integration_connections        enable row level security;
alter table public.integration_location_mappings  enable row level security;
alter table public.integration_connection_events  enable row level security;
alter table public.integration_credentials        enable row level security;
alter table public.integration_oauth_states       enable row level security;
alter table public.integration_inbox              enable row level security;
alter table public.integration_sync_runs          enable row level security;
alter table public.integration_sync_checkpoints   enable row level security;
alter table public.integration_record_issues      enable row level security;
alter table public.customers                      enable row level security;
alter table public.customer_source_profiles       enable row level security;
alter table public.customer_visits                enable row level security;

-- Owners and admins read their own organization's rows. Members and viewers
-- cannot: connecting is an owner job, and a contact list with phone numbers
-- is more sensitive than the feedback they can see.
create policy integration_connections_select_admin on public.integration_connections
    for select to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));
create policy integration_location_mappings_select_admin on public.integration_location_mappings
    for select to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));
create policy integration_connection_events_select_admin on public.integration_connection_events
    for select to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));
create policy integration_sync_runs_select_admin on public.integration_sync_runs
    for select to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));
create policy integration_record_issues_select_admin on public.integration_record_issues
    for select to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));
create policy customers_select_admin on public.customers
    for select to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));
create policy customer_source_profiles_select_admin on public.customer_source_profiles
    for select to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));
create policy customer_visits_select_admin on public.customer_visits
    for select to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

-- Read-only grants to match the policies. Credentials, OAuth states, the
-- inbox and checkpoints get nothing at all.
grant select on public.integration_connections       to authenticated;
grant select on public.integration_location_mappings to authenticated;
grant select on public.integration_connection_events to authenticated;
grant select on public.integration_sync_runs         to authenticated;
grant select on public.integration_record_issues     to authenticated;
grant select on public.customers                     to authenticated;
grant select on public.customer_source_profiles      to authenticated;
grant select on public.customer_visits               to authenticated;

revoke all on public.integration_credentials      from public, anon, authenticated;
revoke all on public.integration_oauth_states     from public, anon, authenticated;
revoke all on public.integration_inbox            from public, anon, authenticated;
revoke all on public.integration_sync_checkpoints from public, anon, authenticated;

-- =========================================================== lifecycle =====

create or replace function app.integration_transition_allowed(
    p_from public.integration_state,
    p_to   public.integration_state
)
returns boolean
language sql
immutable
set search_path = ''
as $$
    select case
        when p_from = p_to then true
        when p_from = 'authorization_required' then p_to in ('connecting', 'disconnecting')
        when p_from = 'connecting'             then p_to in ('active', 'authorization_required', 'disconnecting', 'disconnected')
        when p_from = 'active'                 then p_to in ('reauth_required', 'unavailable', 'error', 'disconnecting')
        when p_from = 'unavailable'            then p_to in ('active', 'reauth_required', 'disconnecting')
        when p_from = 'reauth_required'        then p_to in ('active', 'disconnecting')
        when p_from = 'error'                  then p_to in ('active', 'disconnecting')
        when p_from = 'disconnecting'          then p_to = 'disconnected'
        else false
    end;
$$;

-- The only way a connection's state changes. Idempotent when already there;
-- refuses an illegal move; records the move in the connection's history and
-- the organization's audit log in the same transaction.
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
               when p_to = 'active' then coalesce(c.next_sync_at, now() + interval '6 hours')
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

-- ======================================================== OAuth states =====

create or replace function app.integration_oauth_state_create(
    p_state_digest            text,
    p_org_id                  uuid,
    p_user_id                 uuid,
    p_provider_id             text,
    p_workflow_id             text,
    p_requested_scopes        text[],
    p_code_verifier_enc       text,
    p_reconnect_connection_id uuid,
    p_ttl_seconds             integer
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_expires timestamptz := now() + make_interval(secs => least(greatest(p_ttl_seconds, 60), 1800));
begin
    -- Housekeeping: states are useless a day after they expire.
    delete from public.integration_oauth_states where expires_at < now() - interval '1 day';

    if p_reconnect_connection_id is not null and not exists (
        select 1 from public.integration_connections c
         where c.id = p_reconnect_connection_id
           and c.org_id = p_org_id
           and c.provider_id = p_provider_id
           and c.state not in ('disconnecting', 'disconnected')
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0002';
    end if;

    insert into public.integration_oauth_states
        (state_digest, org_id, user_id, provider_id, workflow_id, requested_scopes,
         code_verifier_enc, reconnect_connection_id, expires_at)
    values
        (p_state_digest, p_org_id, p_user_id, p_provider_id, p_workflow_id,
         coalesce(p_requested_scopes, '{}'), p_code_verifier_enc, p_reconnect_connection_id, v_expires);

    return v_expires;
end;
$$;

-- Single use: the first caller with the right user and an unexpired state
-- gets it; every later caller, another user, or an expired state gets
-- `oauth_state_invalid`.
create or replace function app.integration_oauth_state_consume(
    p_state_digest text,
    p_user_id      uuid
)
returns table (
    org_id                  uuid,
    provider_id             text,
    workflow_id             text,
    requested_scopes        text[],
    code_verifier_enc       text,
    reconnect_connection_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
    return query
    update public.integration_oauth_states s
       set used_at = now()
     where s.state_digest = p_state_digest
       and s.user_id = p_user_id
       and s.used_at is null
       and s.expires_at > now()
    returning s.org_id, s.provider_id, s.workflow_id, s.requested_scopes,
              s.code_verifier_enc, s.reconnect_connection_id;

    if not found then
        raise exception 'oauth_state_invalid' using errcode = 'P0001';
    end if;
end;
$$;

-- ================================================ connection creation =====

create or replace function app.integration_store_credentials(
    p_connection_id      uuid,
    p_org_id             uuid,
    p_key_version        smallint,
    p_access_token_enc   text,
    p_refresh_token_enc  text,
    p_access_expires_at  timestamptz,
    p_refresh_expires_at timestamptz,
    p_refreshed          boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not exists (
        select 1 from public.integration_connections c
         where c.id = p_connection_id and c.org_id = p_org_id
           and c.state not in ('disconnecting', 'disconnected')
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0002';
    end if;

    insert into public.integration_credentials as cr
        (connection_id, org_id, key_version, access_token_enc, refresh_token_enc,
         access_expires_at, refresh_expires_at, token_obtained_at, last_refreshed_at)
    values
        (p_connection_id, p_org_id, p_key_version, p_access_token_enc, p_refresh_token_enc,
         p_access_expires_at, p_refresh_expires_at, now(),
         case when p_refreshed then now() else null end)
    on conflict (connection_id) do update
        set key_version = excluded.key_version,
            access_token_enc = excluded.access_token_enc,
            -- A provider that does not rotate refresh tokens returns none on
            -- refresh; keep the one we have.
            refresh_token_enc = coalesce(excluded.refresh_token_enc, cr.refresh_token_enc),
            access_expires_at = excluded.access_expires_at,
            refresh_expires_at = coalesce(excluded.refresh_expires_at, cr.refresh_expires_at),
            token_obtained_at = case when p_refreshed then cr.token_obtained_at else now() end,
            last_refreshed_at = case when p_refreshed then now() else cr.last_refreshed_at end,
            refresh_lock_until = null;
end;
$$;

-- Take the single-flight refresh lock. True means this caller may refresh.
create or replace function app.integration_lock_refresh(
    p_connection_id uuid,
    p_seconds       integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.integration_credentials cr
       set refresh_lock_until = now() + make_interval(secs => greatest(5, least(p_seconds, 300)))
     where cr.connection_id = p_connection_id
       and (cr.refresh_lock_until is null or cr.refresh_lock_until < now());
    return found;
end;
$$;

create or replace function app.integration_connection_create(
    p_org_id                 uuid,
    p_provider_id            text,
    p_workflow_id            text,
    p_external_account_id    text,
    p_external_account_label text,
    p_granted_scopes         text[],
    p_scopes_sufficient      boolean,
    p_actor                  uuid,
    p_key_version            smallint,
    p_access_token_enc       text,
    p_refresh_token_enc      text,
    p_access_expires_at      timestamptz,
    p_refresh_expires_at     timestamptz
)
returns table (connection_id uuid, state public.integration_state)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id    uuid;
    v_state public.integration_state :=
        case when p_scopes_sufficient then 'connecting' else 'authorization_required' end;
begin
    if exists (
        select 1 from public.integration_connections c
         where c.org_id = p_org_id and c.provider_id = p_provider_id and c.state <> 'disconnected'
    ) then
        raise exception 'connection_exists' using errcode = 'P0001';
    end if;

    if exists (
        select 1 from public.integration_connections c
         where c.provider_id = p_provider_id
           and c.external_account_id = p_external_account_id
           and c.state <> 'disconnected'
    ) then
        raise exception 'account_already_connected' using errcode = 'P0001';
    end if;

    begin
        insert into public.integration_connections
            (org_id, provider_id, workflow_id, external_account_id, external_account_label,
             state, granted_scopes, created_by)
        values
            (p_org_id, p_provider_id, p_workflow_id, p_external_account_id,
             left(p_external_account_label, 120), v_state, coalesce(p_granted_scopes, '{}'), p_actor)
        returning id into v_id;
    exception when unique_violation then
        -- Lost a race with a concurrent callback for the same account or org.
        raise exception 'account_already_connected' using errcode = 'P0001';
    end;

    insert into public.integration_credentials
        (connection_id, org_id, key_version, access_token_enc, refresh_token_enc,
         access_expires_at, refresh_expires_at)
    values
        (v_id, p_org_id, p_key_version, p_access_token_enc, p_refresh_token_enc,
         p_access_expires_at, p_refresh_expires_at);

    insert into public.integration_connection_events
        (connection_id, org_id, from_state, to_state, reason_code, actor_user_id, config_version)
    values (v_id, p_org_id, null, v_state, 'authorized', p_actor, 1);

    insert into public.audit_events (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values (p_org_id, p_actor, 'user', 'integration.connected', 'integration_connection', v_id::text,
            jsonb_build_object('provider', p_provider_id, 'workflow', p_workflow_id, 'state', v_state));

    return query select v_id, v_state;
end;
$$;

-- Sign in again on an existing connection: after missing permissions, or
-- after the provider stopped accepting our tokens. The account must be the
-- same one; switching accounts is a disconnect and a new connection.
create or replace function app.integration_connection_reauthorize(
    p_connection_id       uuid,
    p_org_id              uuid,
    p_external_account_id text,
    p_granted_scopes      text[],
    p_scopes_sufficient   boolean,
    p_actor               uuid,
    p_key_version         smallint,
    p_access_token_enc    text,
    p_refresh_token_enc   text,
    p_access_expires_at   timestamptz,
    p_refresh_expires_at  timestamptz
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
    if v_conn.state in ('disconnecting', 'disconnected') then
        raise exception 'connection_state_invalid' using errcode = 'P0001';
    end if;
    if v_conn.external_account_id <> p_external_account_id then
        raise exception 'account_mismatch' using errcode = 'P0001';
    end if;
    if not p_scopes_sufficient and v_conn.state <> 'authorization_required' then
        raise exception 'permissions_insufficient' using errcode = 'P0001';
    end if;

    perform app.integration_store_credentials(
        p_connection_id, p_org_id, p_key_version, p_access_token_enc, p_refresh_token_enc,
        p_access_expires_at, p_refresh_expires_at, false);

    update public.integration_connections c
       set granted_scopes = coalesce(p_granted_scopes, '{}'),
           failing_since = null,
           last_error_code = null
     where c.id = p_connection_id;

    if not p_scopes_sufficient then
        return v_conn.state;
    end if;

    return app.integration_set_state(
        p_connection_id, p_org_id,
        case v_conn.state
            when 'authorization_required' then 'connecting'::public.integration_state
            when 'reauth_required' then 'active'::public.integration_state
            when 'unavailable' then 'active'::public.integration_state
            else v_conn.state
        end,
        'reauthorized', p_actor);
end;
$$;

-- ====================================================== configuration =====

-- Replace the location mapping. Each ReviewBoost location at most once, each
-- belonging to this organization. Bumps the configuration version, which
-- invalidates any earlier test.
create or replace function app.integration_save_configuration(
    p_connection_id uuid,
    p_org_id        uuid,
    p_mappings      jsonb,
    p_actor         uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_conn    public.integration_connections%rowtype;
    v_count   integer;
    v_version integer;
begin
    select * into v_conn
      from public.integration_connections c
     where c.id = p_connection_id and c.org_id = p_org_id
       for update;

    if v_conn.id is null then
        raise exception 'not_found_or_forbidden' using errcode = 'P0002';
    end if;
    if v_conn.state not in ('connecting', 'active', 'error') then
        raise exception 'connection_state_invalid' using errcode = 'P0001';
    end if;
    if jsonb_typeof(p_mappings) <> 'array' or jsonb_array_length(p_mappings) = 0
       or jsonb_array_length(p_mappings) > 50 then
        raise exception 'configuration_invalid' using errcode = 'P0001';
    end if;

    select count(*) into v_count from jsonb_array_elements(p_mappings) m;
    if v_count <> (select count(distinct m->>'locationId') from jsonb_array_elements(p_mappings) m)
       or v_count <> (select count(distinct m->>'externalLocationId') from jsonb_array_elements(p_mappings) m) then
        raise exception 'configuration_invalid' using errcode = 'P0001';
    end if;

    if exists (
        select 1 from jsonb_array_elements(p_mappings) m
         where coalesce(m->>'externalLocationId', '') = ''
            or not exists (
                select 1 from public.locations l
                 where l.id::text = m->>'locationId' and l.org_id = p_org_id
            )
    ) then
        raise exception 'configuration_invalid' using errcode = 'P0001';
    end if;

    delete from public.integration_location_mappings where connection_id = p_connection_id;

    insert into public.integration_location_mappings
        (connection_id, org_id, external_location_id, external_location_name, external_timezone, location_id)
    select p_connection_id, p_org_id,
           m->>'externalLocationId',
           left(m->>'externalLocationName', 120),
           left(m->>'externalTimezone', 64),
           (m->>'locationId')::uuid
      from jsonb_array_elements(p_mappings) m;

    update public.integration_connections c
       set config_version = c.config_version + 1
     where c.id = p_connection_id
    returning c.config_version into v_version;

    insert into public.audit_events (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values (p_org_id, p_actor, 'user', 'integration.configured', 'integration_connection',
            p_connection_id::text,
            jsonb_build_object('config_version', v_version, 'locations', v_count));

    return v_version;
end;
$$;

-- Record a test against the configuration it ran on. A test for a version
-- that has since changed is refused, so activation can only follow a test of
-- what is actually configured.
create or replace function app.integration_record_test(
    p_connection_id  uuid,
    p_org_id         uuid,
    p_config_version integer,
    p_passed         boolean,
    p_summary        jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.integration_connections c
       set last_test_config_version = p_config_version,
           last_test_passed = p_passed,
           last_test_at = now(),
           last_test_summary = p_summary
     where c.id = p_connection_id
       and c.org_id = p_org_id
       and c.config_version = p_config_version
       and c.state in ('connecting', 'active', 'error');

    if not found then
        raise exception 'configuration_changed' using errcode = 'P0001';
    end if;
end;
$$;

-- ================================================================ runs =====

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
    if v_conn.state <> 'active' then
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

-- Turn the connection on. Only after a passing test of the current
-- configuration, and only with at least one mapped location. Queues the
-- backfill, one run per stream.
create or replace function app.integration_activate(
    p_connection_id uuid,
    p_org_id        uuid,
    p_actor         uuid,
    p_streams       text[],
    p_window_days   integer
)
returns table (run_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_conn   public.integration_connections%rowtype;
    v_stream text;
begin
    select * into v_conn
      from public.integration_connections c
     where c.id = p_connection_id and c.org_id = p_org_id
       for update;

    if v_conn.id is null then
        raise exception 'not_found_or_forbidden' using errcode = 'P0002';
    end if;
    if v_conn.state not in ('connecting', 'error') then
        raise exception 'connection_state_invalid' using errcode = 'P0001';
    end if;
    if v_conn.last_test_passed is not true
       or v_conn.last_test_config_version is distinct from v_conn.config_version then
        raise exception 'test_required' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.integration_location_mappings m where m.connection_id = p_connection_id) then
        raise exception 'configuration_invalid' using errcode = 'P0001';
    end if;

    perform app.integration_set_state(p_connection_id, p_org_id, 'active', 'activated', p_actor);

    foreach v_stream in array coalesce(p_streams, '{}') loop
        return query
        select e.run_id from app.integration_enqueue_run(
            p_connection_id, p_org_id, 'backfill', v_stream,
            format('backfill:%s:%s', v_conn.config_version, v_stream),
            now() - make_interval(days => least(greatest(p_window_days, 1), 90)), now()) e;
    end loop;
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

    return query
    with claimable as (
        select r.id
          from public.integration_sync_runs r
          join public.integration_connections c on c.id = r.connection_id
         where c.state = 'active'
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

-- Sum two {"key": number} objects. Counts only ever add up.
create or replace function app.integration_add_counts(p_a jsonb, p_b jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
    select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
      from (
        select k, sum(v)::bigint as v
          from (
            select key as k, (value)::text::numeric as v
              from jsonb_each(coalesce(p_a, '{}'::jsonb))
             where jsonb_typeof(value) = 'number'
            union all
            select key, (value)::text::numeric
              from jsonb_each(coalesce(p_b, '{}'::jsonb))
             where jsonb_typeof(value) = 'number'
          ) s
         group by k
      ) t;
$$;

-- Save progress after one page is applied, so a crash resumes from here.
create or replace function app.integration_run_checkpoint(
    p_run_id        uuid,
    p_worker        text,
    p_cursor        text,
    p_counts        jsonb,
    p_lease_seconds integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.integration_sync_runs r
       set cursor = p_cursor,
           counts = app.integration_add_counts(r.counts, p_counts),
           lease_expires_at = now() + make_interval(secs => greatest(5, p_lease_seconds))
     where r.id = p_run_id and r.lease_owner = p_worker and r.status = 'running';

    if not found then
        raise exception 'lease_lost' using errcode = 'P0001';
    end if;
end;
$$;

-- Put a run back after a transient failure, with backoff.
create or replace function app.integration_retry_run(
    p_run_id          uuid,
    p_worker          text,
    p_error_code      text,
    p_backoff_seconds integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_run public.integration_sync_runs%rowtype;
begin
    select * into v_run from public.integration_sync_runs r
     where r.id = p_run_id and r.lease_owner = p_worker
       for update;
    if v_run.id is null then
        return 'lease_lost';
    end if;

    if v_run.attempts >= v_run.max_attempts then
        perform app.integration_finish_run(p_run_id, p_worker, 'failed', p_error_code, null);
        return 'failed';
    end if;

    update public.integration_sync_runs r
       set status = 'queued', lease_owner = null, lease_expires_at = null, error_code = p_error_code,
           next_attempt_at = now() + make_interval(secs => greatest(1, least(p_backoff_seconds, 21600)))
     where r.id = p_run_id;
    return 'queued';
end;
$$;

-- Finish a run and update the connection's freshness and health.
create or replace function app.integration_finish_run(
    p_run_id     uuid,
    p_worker     text,
    p_status     text,
    p_error_code text,
    p_high_water timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_run public.integration_sync_runs%rowtype;
begin
    if p_status not in ('succeeded', 'partial', 'failed', 'cancelled') then
        raise exception 'invalid_status' using errcode = 'P0001';
    end if;

    update public.integration_sync_runs r
       set status = p_status, error_code = p_error_code, finished_at = now(),
           lease_owner = null, lease_expires_at = null, cursor = null
     where r.id = p_run_id and r.lease_owner = p_worker and r.status = 'running'
    returning r.* into v_run;

    if v_run.id is null then
        raise exception 'lease_lost' using errcode = 'P0001';
    end if;

    if p_status in ('succeeded', 'partial') then
        insert into public.integration_sync_checkpoints as cp (connection_id, org_id, stream, high_water)
        values (v_run.connection_id, v_run.org_id, v_run.stream, p_high_water)
        on conflict (connection_id, stream) do update
            set high_water = greatest(cp.high_water, excluded.high_water),
                updated_at = now();
    end if;

    update public.integration_connections c
       set last_attempt_at = now(),
           last_success_at = case when p_status in ('succeeded', 'partial') then now() else c.last_success_at end,
           last_error_code = case when p_status = 'failed' then p_error_code
                                  when p_status in ('succeeded', 'partial') then null
                                  else c.last_error_code end,
           failing_since = case when p_status in ('succeeded', 'partial') then null else c.failing_since end,
           warning_codes = case
               when p_status = 'partial' then
                   (select array_agg(distinct w) from unnest(c.warning_codes || array['records_skipped']) w)
               when p_status = 'succeeded' then array_remove(c.warning_codes, 'records_skipped')
               else c.warning_codes end
     where c.id = v_run.connection_id;

    update public.integration_connections c
       set health = case when cardinality(c.warning_codes) > 0 then 'warning'::public.integration_health
                         else 'healthy'::public.integration_health end
     where c.id = v_run.connection_id and c.state = 'active';
end;
$$;

-- What a provider call just told us about the connection as a whole.
--   ok         — a call succeeded: clear the failure streak, recover `unavailable`.
--   retryable  — 5xx, timeout, rate limit: after fifteen minutes of nothing
--                but these, the connection is `unavailable`.
--   auth       — the provider no longer accepts our tokens: `reauth_required`.
create or replace function app.integration_report_outcome(
    p_connection_id uuid,
    p_org_id        uuid,
    p_outcome       text,
    p_error_code    text
)
returns public.integration_state
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_conn public.integration_connections%rowtype;
begin
    select * into v_conn from public.integration_connections c
     where c.id = p_connection_id and c.org_id = p_org_id
       for update;
    if v_conn.id is null then
        raise exception 'not_found_or_forbidden' using errcode = 'P0002';
    end if;

    if p_outcome = 'ok' then
        update public.integration_connections c set failing_since = null where c.id = p_connection_id;
        if v_conn.state = 'unavailable' then
            return app.integration_set_state(p_connection_id, p_org_id, 'active', 'provider_recovered', null);
        end if;
        return v_conn.state;
    elsif p_outcome = 'retryable' then
        update public.integration_connections c
           set failing_since = coalesce(c.failing_since, now()), last_error_code = p_error_code
         where c.id = p_connection_id
        returning * into v_conn;
        if v_conn.state = 'active' and v_conn.failing_since <= now() - interval '15 minutes' then
            return app.integration_set_state(p_connection_id, p_org_id, 'unavailable', 'provider_unavailable', null);
        end if;
        return v_conn.state;
    elsif p_outcome = 'auth' then
        update public.integration_connections c set last_error_code = p_error_code where c.id = p_connection_id;
        if v_conn.state in ('active', 'unavailable') then
            return app.integration_set_state(p_connection_id, p_org_id, 'reauth_required', 'provider_auth_failed', null);
        end if;
        return v_conn.state;
    end if;

    raise exception 'invalid_outcome' using errcode = 'P0001';
end;
$$;

-- =============================================================== inbox =====

create or replace function app.integration_inbox_receive(
    p_provider_id         text,
    p_provider_event_id   text,
    p_external_account_id text,
    p_event_type          text,
    p_object_type         text,
    p_object_id           text,
    p_object_version      bigint,
    p_occurred_at         timestamptz,
    p_payload_version     text,
    p_body_encrypted      text
)
returns table (inbox_id uuid, inserted boolean, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_conn public.integration_connections%rowtype;
    v_id   uuid;
begin
    select * into v_conn from public.integration_connections c
     where c.provider_id = p_provider_id
       and c.external_account_id = p_external_account_id
       and c.state <> 'disconnected';

    insert into public.integration_inbox
        (provider_id, provider_event_id, external_account_id, connection_id, org_id,
         event_type, object_type, object_id, object_version, occurred_at, payload_version,
         body_encrypted, status, outcome_code, processed_at)
    values
        (p_provider_id, p_provider_event_id, p_external_account_id, v_conn.id, v_conn.org_id,
         p_event_type, p_object_type, p_object_id, p_object_version, p_occurred_at, p_payload_version,
         case when v_conn.id is null or v_conn.state = 'disconnecting' then null else p_body_encrypted end,
         case when v_conn.id is null or v_conn.state = 'disconnecting' then 'skipped' else 'pending' end,
         case when v_conn.id is null then 'no_live_connection'
              when v_conn.state = 'disconnecting' then 'connection_disconnecting'
              else null end,
         case when v_conn.id is null or v_conn.state = 'disconnecting' then now() else null end)
    on conflict on constraint integration_inbox_event_key do nothing
    returning id into v_id;

    if v_id is not null then
        return query select i.id, true, i.status from public.integration_inbox i where i.id = v_id;
        return;
    end if;

    return query
    select i.id, false, i.status from public.integration_inbox i
     where i.provider_id = p_provider_id and i.provider_event_id = p_provider_event_id;
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

    -- Events for a connection that is not active wait; held, not dropped.
    return query
    with claimable as (
        select i.id
          from public.integration_inbox i
          join public.integration_connections c on c.id = i.connection_id
         where c.state = 'active'
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

-- processed / skipped are final; retry puts it back with backoff, or into the
-- dead letter once attempts run out.
create or replace function app.integration_inbox_settle(
    p_id              uuid,
    p_worker          text,
    p_result          text,
    p_outcome_code    text,
    p_backoff_seconds integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_row public.integration_inbox%rowtype;
begin
    select * into v_row from public.integration_inbox i
     where i.id = p_id and i.lease_owner = p_worker and i.status = 'processing'
       for update;
    if v_row.id is null then
        return 'lease_lost';
    end if;

    if p_result in ('processed', 'skipped') then
        update public.integration_inbox i
           set status = p_result, outcome_code = p_outcome_code, processed_at = now(),
               lease_owner = null, lease_expires_at = null
         where i.id = p_id;
        return p_result;
    elsif p_result = 'retry' then
        if v_row.attempts >= v_row.max_attempts then
            update public.integration_inbox i
               set status = 'dead_letter', outcome_code = p_outcome_code, processed_at = now(),
                   lease_owner = null, lease_expires_at = null
             where i.id = p_id;
            return 'dead_letter';
        end if;
        update public.integration_inbox i
           set status = 'pending', outcome_code = p_outcome_code,
               lease_owner = null, lease_expires_at = null,
               next_attempt_at = now() + make_interval(secs => greatest(1, least(p_backoff_seconds, 21600)))
         where i.id = p_id;
        return 'pending';
    end if;

    raise exception 'invalid_result' using errcode = 'P0001';
end;
$$;

-- An operator's "try these again".
create or replace function app.integration_retry_dead_letters(p_connection_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_count integer;
begin
    update public.integration_inbox i
       set status = 'pending', attempts = 0, next_attempt_at = now(), outcome_code = 'operator_retry',
           processed_at = null
     where i.connection_id = p_connection_id and i.status = 'dead_letter';
    get diagnostics v_count = row_count;
    return v_count;
end;
$$;

-- ============================================================== apply =====

-- Upsert one customer from a source. Newer wins: an update no newer than what
-- is stored changes nothing. A phone change moves the source profile to the
-- contact for the new number; the old number keeps its consent history,
-- because that history belongs to the number.
create or replace function app.integration_apply_customer(
    p_connection_id     uuid,
    p_org_id            uuid,
    p_external_id       text,
    p_phone_hash        text,
    p_phone_encrypted   text,
    p_phone_key_version smallint,
    p_phone_last_four   text,
    p_name_encrypted    text,
    p_name_digest       text,
    p_source_created_at timestamptz,
    p_source_updated_at timestamptz,
    p_source_version    bigint
)
returns table (customer_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_conn     public.integration_connections%rowtype;
    v_profile  public.customer_source_profiles%rowtype;
    v_customer uuid;
    v_outcome  text;
begin
    select * into v_conn from public.integration_connections c
     where c.id = p_connection_id and c.org_id = p_org_id;
    if v_conn.id is null then
        raise exception 'not_found_or_forbidden' using errcode = 'P0002';
    end if;
    if v_conn.state in ('disconnecting', 'disconnected') then
        raise exception 'connection_state_invalid' using errcode = 'P0001';
    end if;

    select * into v_profile from public.customer_source_profiles p
     where p.connection_id = p_connection_id and p.external_id = p_external_id
       for update;

    if v_profile.id is not null then
        if p_source_version is not null and v_profile.source_version is not null then
            if p_source_version < v_profile.source_version then
                return query select v_profile.customer_id, 'stale'::text; return;
            elsif p_source_version = v_profile.source_version then
                return query select v_profile.customer_id, 'unchanged'::text; return;
            end if;
        elsif p_source_updated_at is not null and v_profile.source_updated_at is not null then
            if p_source_updated_at < v_profile.source_updated_at then
                return query select v_profile.customer_id, 'stale'::text; return;
            elsif p_source_updated_at = v_profile.source_updated_at then
                return query select v_profile.customer_id, 'unchanged'::text; return;
            end if;
        end if;
    end if;

    insert into public.customers as cu
        (org_id, phone_hash, phone_encrypted, phone_key_version, phone_last_four,
         display_name_encrypted)
    values
        (p_org_id, p_phone_hash, p_phone_encrypted, p_phone_key_version, p_phone_last_four,
         p_name_encrypted)
    on conflict on constraint customers_org_phone_key do update
        set phone_encrypted = coalesce(excluded.phone_encrypted, cu.phone_encrypted),
            phone_key_version = case when excluded.phone_encrypted is null
                                     then cu.phone_key_version else excluded.phone_key_version end,
            display_name_encrypted = coalesce(excluded.display_name_encrypted, cu.display_name_encrypted),
            updated_at = now()
    returning cu.id into v_customer;

    if v_profile.id is null then
        insert into public.customer_source_profiles
            (org_id, customer_id, connection_id, source_kind, external_id, name_encrypted, name_digest,
             source_created_at, source_updated_at, source_version, config_version)
        values
            (p_org_id, v_customer, p_connection_id, 'integration', p_external_id, p_name_encrypted,
             p_name_digest, p_source_created_at, p_source_updated_at, p_source_version,
             v_conn.config_version);
        v_outcome := 'created';
    else
        update public.customer_source_profiles p
           set customer_id = v_customer,
               name_encrypted = p_name_encrypted,
               name_digest = p_name_digest,
               source_created_at = coalesce(p_source_created_at, p.source_created_at),
               source_updated_at = p_source_updated_at,
               source_version = p_source_version,
               config_version = v_conn.config_version,
               last_synced_at = now(),
               status = 'active'
         where p.id = v_profile.id;
        -- A profile that moved takes its visits with it.
        if v_profile.customer_id <> v_customer then
            update public.customer_visits v
               set customer_id = v_customer
             where v.connection_id = p_connection_id
               and v.customer_external_id = p_external_id;
        end if;
        v_outcome := 'updated';
    end if;

    -- Re-evaluate the name conflict flag on the contact(s) touched.
    update public.customers cu
       set names_differ = (
           select count(distinct p.name_digest) > 1
             from public.customer_source_profiles p
            where p.customer_id = cu.id and p.status = 'active' and p.name_digest is not null)
     where cu.id in (v_customer, coalesce(v_profile.customer_id, v_customer));

    return query select v_customer, v_outcome;
end;
$$;

-- Upsert one visit. The location comes from the connection's mapping and the
-- contact from the source profile; either missing means no visit, and the
-- caller records why.
create or replace function app.integration_apply_visit(
    p_connection_id        uuid,
    p_org_id               uuid,
    p_kind                 text,
    p_external_id          text,
    p_customer_external_id text,
    p_external_location_id text,
    p_status               text,
    p_occurred_at          timestamptz,
    p_source_updated_at    timestamptz,
    p_source_version       bigint
)
returns table (visit_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_conn     public.integration_connections%rowtype;
    v_location uuid;
    v_customer uuid;
    v_visit    public.customer_visits%rowtype;
begin
    select * into v_conn from public.integration_connections c
     where c.id = p_connection_id and c.org_id = p_org_id;
    if v_conn.id is null then
        raise exception 'not_found_or_forbidden' using errcode = 'P0002';
    end if;
    if v_conn.state in ('disconnecting', 'disconnected') then
        raise exception 'connection_state_invalid' using errcode = 'P0001';
    end if;

    select m.location_id into v_location from public.integration_location_mappings m
     where m.connection_id = p_connection_id and m.external_location_id = p_external_location_id;
    if v_location is null then
        return query select null::uuid, 'location_not_mapped'::text; return;
    end if;

    select p.customer_id into v_customer from public.customer_source_profiles p
     where p.connection_id = p_connection_id and p.external_id = p_customer_external_id
       and p.status = 'active';
    if v_customer is null then
        return query select null::uuid, 'no_customer'::text; return;
    end if;

    select * into v_visit from public.customer_visits v
     where v.connection_id = p_connection_id and v.kind = p_kind and v.external_id = p_external_id
       for update;

    if v_visit.id is null then
        insert into public.customer_visits
            (org_id, customer_id, location_id, connection_id, source_kind, external_id,
             customer_external_id, kind, status, occurred_at, source_updated_at, source_version,
             config_version)
        values
            (p_org_id, v_customer, v_location, p_connection_id, 'integration', p_external_id,
             p_customer_external_id, p_kind, p_status, p_occurred_at, p_source_updated_at,
             p_source_version, v_conn.config_version)
        on conflict (connection_id, kind, external_id) where connection_id is not null do nothing
        returning * into v_visit;

        if v_visit.id is null then
            -- A concurrent writer inserted it first; the replay is a no-op.
            return query select v.id, 'unchanged'::text from public.customer_visits v
             where v.connection_id = p_connection_id and v.kind = p_kind and v.external_id = p_external_id;
            return;
        end if;

        update public.customers cu
           set last_seen_at = greatest(cu.last_seen_at, p_occurred_at),
               first_seen_at = least(cu.first_seen_at, p_occurred_at)
         where cu.id = v_customer;
        return query select v_visit.id, 'created'::text; return;
    end if;

    if (p_source_version is not null and v_visit.source_version is not null
            and p_source_version <= v_visit.source_version)
       or (p_source_version is null and p_source_updated_at is not null
            and v_visit.source_updated_at is not null
            and p_source_updated_at <= v_visit.source_updated_at) then
        return query select v_visit.id,
            case when p_source_version = v_visit.source_version
                   or (p_source_version is null and p_source_updated_at = v_visit.source_updated_at)
                 then 'unchanged' else 'stale' end::text;
        return;
    end if;

    update public.customer_visits v
       set customer_id = v_customer, customer_external_id = p_customer_external_id,
           location_id = v_location, status = p_status,
           occurred_at = p_occurred_at, source_updated_at = p_source_updated_at,
           source_version = p_source_version, config_version = v_conn.config_version
     where v.id = v_visit.id;

    update public.customers cu
       set last_seen_at = greatest(cu.last_seen_at, p_occurred_at)
     where cu.id = v_customer;

    return query select v_visit.id, 'updated'::text;
end;
$$;

create or replace function app.integration_record_issue(
    p_connection_id uuid,
    p_org_id        uuid,
    p_run_id        uuid,
    p_inbox_id      uuid,
    p_object_type   text,
    p_external_id   text,
    p_issue_code    text,
    p_display_hint  text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.integration_record_issues as ri
        (connection_id, org_id, run_id, inbox_id, object_type, external_id, issue_code, display_hint)
    values
        (p_connection_id, p_org_id, p_run_id, p_inbox_id, p_object_type, p_external_id, p_issue_code,
         left(p_display_hint, 80))
    on conflict on constraint integration_record_issues_key do update
        set last_seen_at = now(), resolved_at = null,
            run_id = coalesce(excluded.run_id, ri.run_id),
            inbox_id = coalesce(excluded.inbox_id, ri.inbox_id),
            display_hint = coalesce(excluded.display_hint, ri.display_hint);
end;
$$;

-- An object that now applies cleanly closes its open issues.
create or replace function app.integration_resolve_issues(
    p_connection_id uuid,
    p_object_type   text,
    p_external_id   text
)
returns void
language sql
security definer
set search_path = ''
as $$
    update public.integration_record_issues ri
       set resolved_at = now()
     where ri.connection_id = p_connection_id
       and ri.object_type = p_object_type
       and ri.external_id = p_external_id
       and ri.resolved_at is null;
$$;

-- ========================================================= disconnect =====

create or replace function app.integration_begin_disconnect(
    p_connection_id uuid,
    p_org_id        uuid,
    p_actor         uuid,
    p_reason        text
)
returns public.integration_state
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_state public.integration_state;
begin
    select c.state into v_state from public.integration_connections c
     where c.id = p_connection_id and c.org_id = p_org_id;
    if v_state is null then
        raise exception 'not_found_or_forbidden' using errcode = 'P0002';
    end if;
    if v_state in ('disconnecting', 'disconnected') then
        return v_state;
    end if;

    perform app.integration_set_state(p_connection_id, p_org_id, 'disconnecting', p_reason, p_actor);

    update public.integration_sync_runs r
       set status = 'cancelled', finished_at = now(), lease_owner = null, lease_expires_at = null
     where r.connection_id = p_connection_id and r.status in ('queued', 'running');

    return 'disconnecting';
end;
$$;

-- After revocation was attempted: delete the tokens (the only copy) and
-- finish. `p_revoke_outcome` is recorded so a failed revoke is visible.
create or replace function app.integration_finish_disconnect(
    p_connection_id  uuid,
    p_org_id         uuid,
    p_revoke_outcome text
)
returns public.integration_state
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_state public.integration_state;
begin
    select c.state into v_state from public.integration_connections c
     where c.id = p_connection_id and c.org_id = p_org_id
       for update;
    if v_state is null then
        raise exception 'not_found_or_forbidden' using errcode = 'P0002';
    end if;
    if v_state = 'disconnected' then
        return v_state;
    end if;
    if v_state <> 'disconnecting' then
        raise exception 'connection_state_invalid' using errcode = 'P0001';
    end if;

    delete from public.integration_credentials where connection_id = p_connection_id;

    return app.integration_set_state(
        p_connection_id, p_org_id, 'disconnected',
        case when p_revoke_outcome = 'revoked' then 'disconnected'
             else 'disconnected_revoke_failed' end,
        null);
end;
$$;

-- ========================================================== retention =====

-- Delete what a disconnect's grace period has run out on, expired raw bodies,
-- and contacts left with nothing that justifies keeping them. Consent events,
-- opt-outs, suppressions and Text Requests are never touched here.
create or replace function app.integration_purge(p_limit integer)
returns table (profiles_deleted integer, visits_deleted integer, customers_deleted integer, bodies_cleared integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_profiles  integer := 0;
    v_visits    integer := 0;
    v_customers integer := 0;
    v_bodies    integer := 0;
begin
    with gone as (
        select c.id from public.integration_connections c
         where c.state = 'disconnected' and c.purge_after is not null and c.purge_after <= now()
    ), dv as (
        delete from public.customer_visits v using gone where v.connection_id = gone.id
        returning v.id
    )
    select count(*) into v_visits from dv;

    with gone as (
        select c.id from public.integration_connections c
         where c.state = 'disconnected' and c.purge_after is not null and c.purge_after <= now()
    ), dp as (
        delete from public.customer_source_profiles p using gone where p.connection_id = gone.id
        returning p.id
    )
    select count(*) into v_profiles from dp;

    -- Visits from live connections are kept thirteen months.
    with dv as (
        delete from public.customer_visits v
         where v.occurred_at < now() - interval '13 months'
        returning v.id
    )
    select v_visits + count(*) into v_visits from dv;

    with orphan as (
        select cu.id from public.customers cu
         where not exists (select 1 from public.customer_source_profiles p where p.customer_id = cu.id)
           and not exists (select 1 from public.customer_visits v where v.customer_id = cu.id)
           and not exists (select 1 from public.sms_consent_state s
                            where s.org_id = cu.org_id and s.phone_hash = cu.phone_hash)
           and not exists (select 1 from public.text_requests t
                            where t.org_id = cu.org_id and t.recipient_phone_hash = cu.phone_hash)
         limit greatest(1, p_limit)
    ), dc as (
        delete from public.customers cu using orphan where cu.id = orphan.id returning cu.id
    )
    select count(*) into v_customers from dc;

    -- A contact kept for its message or consent history loses its name once
    -- no source describes it any more.
    update public.customers cu
       set display_name_encrypted = null, names_differ = false
     where cu.display_name_encrypted is not null
       and not exists (select 1 from public.customer_source_profiles p where p.customer_id = cu.id);

    update public.integration_inbox i
       set body_encrypted = null
     where i.body_encrypted is not null and i.received_at < now() - interval '7 days';
    get diagnostics v_bodies = row_count;

    delete from public.integration_inbox i
     where i.status in ('processed', 'skipped') and i.received_at < now() - interval '90 days';
    delete from public.integration_sync_runs r
     where r.finished_at is not null and r.finished_at < now() - interval '90 days';
    delete from public.integration_record_issues ri
     where ri.resolved_at is not null and ri.resolved_at < now() - interval '90 days';

    return query select v_profiles, v_visits, v_customers, v_bodies;
end;
$$;

-- Connections due for a scheduled reconcile; the worker enqueues one run per
-- stream and pushes `next_sync_at` forward.
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
         where c2.state = 'active' and c2.next_sync_at is not null and c2.next_sync_at <= now()
         order by c2.next_sync_at
         limit greatest(1, p_limit)
         for update skip locked)
    returning c.id, c.org_id, c.provider_id, c.workflow_id, c.config_version;
end;
$$;

-- ============================================================ grants =====

do $$
declare
    fn text;
begin
    foreach fn in array array[
        'app.integration_transition_allowed(public.integration_state, public.integration_state)',
        'app.integration_set_state(uuid, uuid, public.integration_state, text, uuid)',
        'app.integration_oauth_state_create(text, uuid, uuid, text, text, text[], text, uuid, integer)',
        'app.integration_oauth_state_consume(text, uuid)',
        'app.integration_store_credentials(uuid, uuid, smallint, text, text, timestamptz, timestamptz, boolean)',
        'app.integration_lock_refresh(uuid, integer)',
        'app.integration_connection_create(uuid, text, text, text, text, text[], boolean, uuid, smallint, text, text, timestamptz, timestamptz)',
        'app.integration_connection_reauthorize(uuid, uuid, text, text[], boolean, uuid, smallint, text, text, timestamptz, timestamptz)',
        'app.integration_save_configuration(uuid, uuid, jsonb, uuid)',
        'app.integration_record_test(uuid, uuid, integer, boolean, jsonb)',
        'app.integration_enqueue_run(uuid, uuid, text, text, text, timestamptz, timestamptz)',
        'app.integration_activate(uuid, uuid, uuid, text[], integer)',
        'app.integration_claim_runs(text, integer, integer)',
        'app.integration_add_counts(jsonb, jsonb)',
        'app.integration_run_checkpoint(uuid, text, text, jsonb, integer)',
        'app.integration_retry_run(uuid, text, text, integer)',
        'app.integration_finish_run(uuid, text, text, text, timestamptz)',
        'app.integration_report_outcome(uuid, uuid, text, text)',
        'app.integration_inbox_receive(text, text, text, text, text, text, bigint, timestamptz, text, text)',
        'app.integration_inbox_claim(text, integer, integer)',
        'app.integration_inbox_settle(uuid, text, text, text, integer)',
        'app.integration_retry_dead_letters(uuid)',
        'app.integration_apply_customer(uuid, uuid, text, text, text, smallint, text, text, text, timestamptz, timestamptz, bigint)',
        'app.integration_apply_visit(uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, bigint)',
        'app.integration_record_issue(uuid, uuid, uuid, uuid, text, text, text, text)',
        'app.integration_resolve_issues(uuid, text, text)',
        'app.integration_begin_disconnect(uuid, uuid, uuid, text)',
        'app.integration_finish_disconnect(uuid, uuid, text)',
        'app.integration_purge(integer)',
        'app.integration_due_connections(integer, integer)'
    ]
    loop
        execute format('revoke all on function %s from public, anon, authenticated;', fn);
        execute format('grant execute on function %s to service_role;', fn);
    end loop;
end $$;

-- ========================================================== wrappers =====
-- PostgREST exposes only `public`, so the server reaches each function above
-- through a definer wrapper granted to the service role alone. No logic here.

create or replace function public.rpc_integration_set_state(p_connection_id uuid, p_org_id uuid, p_to public.integration_state, p_reason text, p_actor uuid)
returns public.integration_state
language sql security definer set search_path = ''
as $$ select app.integration_set_state(p_connection_id, p_org_id, p_to, p_reason, p_actor); $$;

create or replace function public.rpc_integration_oauth_state_create(p_state_digest text, p_org_id uuid, p_user_id uuid, p_provider_id text, p_workflow_id text, p_requested_scopes text[], p_code_verifier_enc text, p_reconnect_connection_id uuid, p_ttl_seconds integer)
returns timestamptz
language sql security definer set search_path = ''
as $$ select app.integration_oauth_state_create(p_state_digest, p_org_id, p_user_id, p_provider_id, p_workflow_id, p_requested_scopes, p_code_verifier_enc, p_reconnect_connection_id, p_ttl_seconds); $$;

create or replace function public.rpc_integration_oauth_state_consume(p_state_digest text, p_user_id uuid)
returns table (
    org_id                  uuid,
    provider_id             text,
    workflow_id             text,
    requested_scopes        text[],
    code_verifier_enc       text,
    reconnect_connection_id uuid
)
language sql security definer set search_path = ''
as $$ select * from app.integration_oauth_state_consume(p_state_digest, p_user_id); $$;

create or replace function public.rpc_integration_store_credentials(p_connection_id uuid, p_org_id uuid, p_key_version smallint, p_access_token_enc text, p_refresh_token_enc text, p_access_expires_at timestamptz, p_refresh_expires_at timestamptz, p_refreshed boolean)
returns void
language sql security definer set search_path = ''
as $$ select app.integration_store_credentials(p_connection_id, p_org_id, p_key_version, p_access_token_enc, p_refresh_token_enc, p_access_expires_at, p_refresh_expires_at, p_refreshed); $$;

create or replace function public.rpc_integration_lock_refresh(p_connection_id uuid, p_seconds integer)
returns boolean
language sql security definer set search_path = ''
as $$ select app.integration_lock_refresh(p_connection_id, p_seconds); $$;

create or replace function public.rpc_integration_connection_create(p_org_id uuid, p_provider_id text, p_workflow_id text, p_external_account_id text, p_external_account_label text, p_granted_scopes text[], p_scopes_sufficient boolean, p_actor uuid, p_key_version smallint, p_access_token_enc text, p_refresh_token_enc text, p_access_expires_at timestamptz, p_refresh_expires_at timestamptz)
returns table (connection_id uuid, state public.integration_state)
language sql security definer set search_path = ''
as $$ select * from app.integration_connection_create(p_org_id, p_provider_id, p_workflow_id, p_external_account_id, p_external_account_label, p_granted_scopes, p_scopes_sufficient, p_actor, p_key_version, p_access_token_enc, p_refresh_token_enc, p_access_expires_at, p_refresh_expires_at); $$;

create or replace function public.rpc_integration_connection_reauthorize(p_connection_id uuid, p_org_id uuid, p_external_account_id text, p_granted_scopes text[], p_scopes_sufficient boolean, p_actor uuid, p_key_version smallint, p_access_token_enc text, p_refresh_token_enc text, p_access_expires_at timestamptz, p_refresh_expires_at timestamptz)
returns public.integration_state
language sql security definer set search_path = ''
as $$ select app.integration_connection_reauthorize(p_connection_id, p_org_id, p_external_account_id, p_granted_scopes, p_scopes_sufficient, p_actor, p_key_version, p_access_token_enc, p_refresh_token_enc, p_access_expires_at, p_refresh_expires_at); $$;

create or replace function public.rpc_integration_save_configuration(p_connection_id uuid, p_org_id uuid, p_mappings jsonb, p_actor uuid)
returns integer
language sql security definer set search_path = ''
as $$ select app.integration_save_configuration(p_connection_id, p_org_id, p_mappings, p_actor); $$;

create or replace function public.rpc_integration_record_test(p_connection_id uuid, p_org_id uuid, p_config_version integer, p_passed boolean, p_summary jsonb)
returns void
language sql security definer set search_path = ''
as $$ select app.integration_record_test(p_connection_id, p_org_id, p_config_version, p_passed, p_summary); $$;

create or replace function public.rpc_integration_enqueue_run(p_connection_id uuid, p_org_id uuid, p_kind text, p_stream text, p_idempotency_key text, p_window_start timestamptz, p_window_end timestamptz)
returns table (run_id uuid, created boolean)
language sql security definer set search_path = ''
as $$ select * from app.integration_enqueue_run(p_connection_id, p_org_id, p_kind, p_stream, p_idempotency_key, p_window_start, p_window_end); $$;

create or replace function public.rpc_integration_activate(p_connection_id uuid, p_org_id uuid, p_actor uuid, p_streams text[], p_window_days integer)
returns table (run_id uuid)
language sql security definer set search_path = ''
as $$ select * from app.integration_activate(p_connection_id, p_org_id, p_actor, p_streams, p_window_days); $$;

create or replace function public.rpc_integration_claim_runs(p_worker text, p_limit integer, p_lease_seconds integer)
returns setof public.integration_sync_runs
language sql security definer set search_path = ''
as $$ select * from app.integration_claim_runs(p_worker, p_limit, p_lease_seconds); $$;

create or replace function public.rpc_integration_run_checkpoint(p_run_id uuid, p_worker text, p_cursor text, p_counts jsonb, p_lease_seconds integer)
returns void
language sql security definer set search_path = ''
as $$ select app.integration_run_checkpoint(p_run_id, p_worker, p_cursor, p_counts, p_lease_seconds); $$;

create or replace function public.rpc_integration_retry_run(p_run_id uuid, p_worker text, p_error_code text, p_backoff_seconds integer)
returns text
language sql security definer set search_path = ''
as $$ select app.integration_retry_run(p_run_id, p_worker, p_error_code, p_backoff_seconds); $$;

create or replace function public.rpc_integration_finish_run(p_run_id uuid, p_worker text, p_status text, p_error_code text, p_high_water timestamptz)
returns void
language sql security definer set search_path = ''
as $$ select app.integration_finish_run(p_run_id, p_worker, p_status, p_error_code, p_high_water); $$;

create or replace function public.rpc_integration_report_outcome(p_connection_id uuid, p_org_id uuid, p_outcome text, p_error_code text)
returns public.integration_state
language sql security definer set search_path = ''
as $$ select app.integration_report_outcome(p_connection_id, p_org_id, p_outcome, p_error_code); $$;

create or replace function public.rpc_integration_inbox_receive(p_provider_id text, p_provider_event_id text, p_external_account_id text, p_event_type text, p_object_type text, p_object_id text, p_object_version bigint, p_occurred_at timestamptz, p_payload_version text, p_body_encrypted text)
returns table (inbox_id uuid, inserted boolean, status text)
language sql security definer set search_path = ''
as $$ select * from app.integration_inbox_receive(p_provider_id, p_provider_event_id, p_external_account_id, p_event_type, p_object_type, p_object_id, p_object_version, p_occurred_at, p_payload_version, p_body_encrypted); $$;

create or replace function public.rpc_integration_inbox_claim(p_worker text, p_limit integer, p_lease_seconds integer)
returns setof public.integration_inbox
language sql security definer set search_path = ''
as $$ select * from app.integration_inbox_claim(p_worker, p_limit, p_lease_seconds); $$;

create or replace function public.rpc_integration_inbox_settle(p_id uuid, p_worker text, p_result text, p_outcome_code text, p_backoff_seconds integer)
returns text
language sql security definer set search_path = ''
as $$ select app.integration_inbox_settle(p_id, p_worker, p_result, p_outcome_code, p_backoff_seconds); $$;

create or replace function public.rpc_integration_retry_dead_letters(p_connection_id uuid)
returns integer
language sql security definer set search_path = ''
as $$ select app.integration_retry_dead_letters(p_connection_id); $$;

create or replace function public.rpc_integration_apply_customer(p_connection_id uuid, p_org_id uuid, p_external_id text, p_phone_hash text, p_phone_encrypted text, p_phone_key_version smallint, p_phone_last_four text, p_name_encrypted text, p_name_digest text, p_source_created_at timestamptz, p_source_updated_at timestamptz, p_source_version bigint)
returns table (customer_id uuid, outcome text)
language sql security definer set search_path = ''
as $$ select * from app.integration_apply_customer(p_connection_id, p_org_id, p_external_id, p_phone_hash, p_phone_encrypted, p_phone_key_version, p_phone_last_four, p_name_encrypted, p_name_digest, p_source_created_at, p_source_updated_at, p_source_version); $$;

create or replace function public.rpc_integration_apply_visit(p_connection_id uuid, p_org_id uuid, p_kind text, p_external_id text, p_customer_external_id text, p_external_location_id text, p_status text, p_occurred_at timestamptz, p_source_updated_at timestamptz, p_source_version bigint)
returns table (visit_id uuid, outcome text)
language sql security definer set search_path = ''
as $$ select * from app.integration_apply_visit(p_connection_id, p_org_id, p_kind, p_external_id, p_customer_external_id, p_external_location_id, p_status, p_occurred_at, p_source_updated_at, p_source_version); $$;

create or replace function public.rpc_integration_record_issue(p_connection_id uuid, p_org_id uuid, p_run_id uuid, p_inbox_id uuid, p_object_type text, p_external_id text, p_issue_code text, p_display_hint text)
returns void
language sql security definer set search_path = ''
as $$ select app.integration_record_issue(p_connection_id, p_org_id, p_run_id, p_inbox_id, p_object_type, p_external_id, p_issue_code, p_display_hint); $$;

create or replace function public.rpc_integration_resolve_issues(p_connection_id uuid, p_object_type text, p_external_id text)
returns void
language sql security definer set search_path = ''
as $$ select app.integration_resolve_issues(p_connection_id, p_object_type, p_external_id); $$;

create or replace function public.rpc_integration_begin_disconnect(p_connection_id uuid, p_org_id uuid, p_actor uuid, p_reason text)
returns public.integration_state
language sql security definer set search_path = ''
as $$ select app.integration_begin_disconnect(p_connection_id, p_org_id, p_actor, p_reason); $$;

create or replace function public.rpc_integration_finish_disconnect(p_connection_id uuid, p_org_id uuid, p_revoke_outcome text)
returns public.integration_state
language sql security definer set search_path = ''
as $$ select app.integration_finish_disconnect(p_connection_id, p_org_id, p_revoke_outcome); $$;

create or replace function public.rpc_integration_purge(p_limit integer)
returns table (profiles_deleted integer, visits_deleted integer, customers_deleted integer, bodies_cleared integer)
language sql security definer set search_path = ''
as $$ select * from app.integration_purge(p_limit); $$;

create or replace function public.rpc_integration_due_connections(p_limit integer, p_interval_seconds integer)
returns table (connection_id uuid, org_id uuid, provider_id text, workflow_id text, config_version integer)
language sql security definer set search_path = ''
as $$ select * from app.integration_due_connections(p_limit, p_interval_seconds); $$;

do $$
declare
    fn text;
begin
    foreach fn in array array[
        'public.rpc_integration_set_state(uuid, uuid, public.integration_state, text, uuid)',
        'public.rpc_integration_oauth_state_create(text, uuid, uuid, text, text, text[], text, uuid, integer)',
        'public.rpc_integration_oauth_state_consume(text, uuid)',
        'public.rpc_integration_store_credentials(uuid, uuid, smallint, text, text, timestamptz, timestamptz, boolean)',
        'public.rpc_integration_lock_refresh(uuid, integer)',
        'public.rpc_integration_connection_create(uuid, text, text, text, text, text[], boolean, uuid, smallint, text, text, timestamptz, timestamptz)',
        'public.rpc_integration_connection_reauthorize(uuid, uuid, text, text[], boolean, uuid, smallint, text, text, timestamptz, timestamptz)',
        'public.rpc_integration_save_configuration(uuid, uuid, jsonb, uuid)',
        'public.rpc_integration_record_test(uuid, uuid, integer, boolean, jsonb)',
        'public.rpc_integration_enqueue_run(uuid, uuid, text, text, text, timestamptz, timestamptz)',
        'public.rpc_integration_activate(uuid, uuid, uuid, text[], integer)',
        'public.rpc_integration_claim_runs(text, integer, integer)',
        'public.rpc_integration_run_checkpoint(uuid, text, text, jsonb, integer)',
        'public.rpc_integration_retry_run(uuid, text, text, integer)',
        'public.rpc_integration_finish_run(uuid, text, text, text, timestamptz)',
        'public.rpc_integration_report_outcome(uuid, uuid, text, text)',
        'public.rpc_integration_inbox_receive(text, text, text, text, text, text, bigint, timestamptz, text, text)',
        'public.rpc_integration_inbox_claim(text, integer, integer)',
        'public.rpc_integration_inbox_settle(uuid, text, text, text, integer)',
        'public.rpc_integration_retry_dead_letters(uuid)',
        'public.rpc_integration_apply_customer(uuid, uuid, text, text, text, smallint, text, text, text, timestamptz, timestamptz, bigint)',
        'public.rpc_integration_apply_visit(uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, bigint)',
        'public.rpc_integration_record_issue(uuid, uuid, uuid, uuid, text, text, text, text)',
        'public.rpc_integration_resolve_issues(uuid, text, text)',
        'public.rpc_integration_begin_disconnect(uuid, uuid, uuid, text)',
        'public.rpc_integration_finish_disconnect(uuid, uuid, text)',
        'public.rpc_integration_purge(integer)',
        'public.rpc_integration_due_connections(integer, integer)'
    ]
    loop
        execute format('revoke all on function %s from public, anon, authenticated;', fn);
        execute format('grant execute on function %s to service_role;', fn);
    end loop;
end $$;

-- ============================================================ health =====

-- Counts and ages only, for /api/v1/internal/health. No organization ids, no
-- account ids, nothing about a customer.
create or replace function public.rpc_integration_health()
returns table (
    inbox_pending         bigint,
    oldest_pending_age_s  bigint,
    dead_letters          bigint,
    connections_by_state  jsonb,
    connections_stalled   bigint,
    runs_failed_24h       bigint
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        (select count(*) from public.integration_inbox where status in ('pending', 'processing')),
        (select coalesce(extract(epoch from now() - min(received_at))::bigint, 0)
           from public.integration_inbox where status in ('pending', 'processing')),
        (select count(*) from public.integration_inbox where status = 'dead_letter'),
        (select coalesce(jsonb_object_agg(state, n), '{}'::jsonb)
           from (select state::text, count(*) as n from public.integration_connections
                  where state <> 'disconnected' group by state) s),
        (select count(*) from public.integration_connections
          where state = 'active'
            and coalesce(last_success_at, created_at) < now() - interval '24 hours'),
        (select count(*) from public.integration_sync_runs
          where status = 'failed' and finished_at > now() - interval '24 hours');
$$;

revoke all on function public.rpc_integration_health() from public, anon, authenticated;
grant execute on function public.rpc_integration_health() to service_role;

-- ======================================================= yield a run =====

-- A worker out of time hands the run back without spending an attempt, so a
-- large backfill spread over many short invocations never runs out of tries.
create or replace function app.integration_yield_run(p_run_id uuid, p_worker text)
returns void
language sql
security definer
set search_path = ''
as $$
    update public.integration_sync_runs r
       set status = 'queued', lease_owner = null, lease_expires_at = null,
           attempts = greatest(r.attempts - 1, 0), next_attempt_at = now()
     where r.id = p_run_id and r.lease_owner = p_worker and r.status = 'running';
$$;

create or replace function public.rpc_integration_yield_run(p_run_id uuid, p_worker text)
returns void
language sql security definer set search_path = ''
as $$ select app.integration_yield_run(p_run_id, p_worker); $$;

revoke all on function app.integration_yield_run(uuid, text) from public, anon, authenticated;
grant execute on function app.integration_yield_run(uuid, text) to service_role;
revoke all on function public.rpc_integration_yield_run(uuid, text) from public, anon, authenticated;
grant execute on function public.rpc_integration_yield_run(uuid, text) to service_role;
