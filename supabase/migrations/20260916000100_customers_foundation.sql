-- ReviewBoost Customers — canonical model + import/integration foundation.
--
-- One business has ONE customer list regardless of source. Manual entry, CSV,
-- Google Sheets, Square, Toast, Clover, Vagaro, Housecall Pro — every future
-- connector writes into the SAME canonical `customers` table via the same
-- normalize → dedupe → match/create → link pipeline. This migration lands the
-- schema; adapters plug in through the source-adapter contract in TypeScript
-- (frontend/lib/server/customers/) without changing any downstream code.
--
-- CONSENT IS KEPT SEPARATE. A customer existing in this system does NOT mean
-- they have opted in to SMS: Text Requests continue to gate every send through
-- the merged consent/suppression stack (sms_consent_state + sms_phone_optout).
-- Adding a customer never mints consent.
--
-- PII (phone / email) is stored the way Text Requests already stores it: a
-- keyed digest for matching + AES-256-GCM ciphertext for the rare read-back +
-- a last-four fragment for recognition. Raw phones and emails never live at
-- rest.

-- ------------------------------------------------------------ enums --------

create type public.customer_source_kind as enum (
    'manual', 'csv', 'google_sheets', 'square', 'toast', 'clover', 'vagaro', 'housecall_pro', 'other'
);

create type public.customer_contact_kind as enum ('phone', 'email');

create type public.customer_import_status as enum (
    'pending', 'running', 'succeeded', 'failed', 'partial'
);

create type public.customer_import_row_action as enum (
    'imported', 'matched', 'duplicate', 'invalid', 'skipped'
);

-- ----------------------------------------------------- canonical customer -

create table public.customers (
    id                 uuid primary key default gen_random_uuid(),
    org_id             uuid not null references public.organizations (id) on delete cascade,
    display_name       text check (display_name is null or char_length(display_name) between 1 and 200),
    -- Optional primary phone identity (matches the Text Requests convention).
    phone_hash         text check (phone_hash is null or char_length(phone_hash) between 32 and 96),
    phone_encrypted    text,
    phone_key_version  smallint,
    phone_last_four    text check (phone_last_four is null or phone_last_four ~ '^[0-9]{4}$'),
    -- Optional primary email identity.
    email_hash         text check (email_hash is null or char_length(email_hash) between 32 and 96),
    email_encrypted    text,
    email_key_version  smallint,
    email_domain       text,
    -- First/last time we observed this identity (any source).
    first_seen_at      timestamptz not null default now(),
    last_seen_at       timestamptz not null default now(),
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),

    -- A phone (once assigned) is unique per org so cross-source imports collapse
    -- to one canonical customer without cross-org leakage. Email likewise.
    constraint customers_phone_unique_per_org unique (org_id, phone_hash),
    constraint customers_email_unique_per_org unique (org_id, email_hash)
);

create index customers_org_last_seen_idx on public.customers (org_id, last_seen_at desc);
create index customers_phone_hash_idx on public.customers (phone_hash) where phone_hash is not null;
create index customers_email_hash_idx on public.customers (email_hash) where email_hash is not null;

-- All contact identities a canonical customer is known by. A person may have
-- more than one phone or email; the customers.phone_hash / email_hash columns
-- are the primary identity, this table records the full set.
create table public.customer_contact_identities (
    id           uuid primary key default gen_random_uuid(),
    customer_id  uuid not null references public.customers (id) on delete cascade,
    org_id       uuid not null references public.organizations (id) on delete cascade,
    kind         public.customer_contact_kind not null,
    -- Keyed digest of the normalized value (E.164 for phone, lowercased email).
    value_hash   text not null check (char_length(value_hash) between 32 and 96),
    value_encrypted text,
    key_version  smallint,
    last_four    text check (last_four is null or last_four ~ '^[0-9]{4}$'),
    label        text check (label is null or char_length(label) between 1 and 60),
    created_at   timestamptz not null default now(),
    constraint customer_contact_identities_unique
        unique (org_id, kind, value_hash)
);

create index customer_contact_identities_customer_idx
    on public.customer_contact_identities (customer_id);

-- ------------------------------------------- source connections -----------

-- One row per configured import source, per org. Manual entry doesn't need a
-- row (it uses a synthetic 'manual' source at import time); a CSV import
-- creates one implicitly for the upload session.
create table public.customer_source_connections (
    id             uuid primary key default gen_random_uuid(),
    org_id         uuid not null references public.organizations (id) on delete cascade,
    kind           public.customer_source_kind not null,
    name           text not null check (char_length(name) between 1 and 120),
    -- Adapter-specific configuration (encrypted at rest for future POS connectors).
    config_encrypted text,
    status         text not null default 'active' check (status in ('active', 'paused', 'disabled')),
    created_by     uuid,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    constraint customer_source_connections_org_name unique (org_id, kind, name)
);

-- External-source identity: this canonical customer, at this source, is
-- known by this external_id. A source_connection may not be set (manual/CSV).
create table public.customer_external_links (
    id                 uuid primary key default gen_random_uuid(),
    customer_id        uuid not null references public.customers (id) on delete cascade,
    org_id             uuid not null references public.organizations (id) on delete cascade,
    source_connection_id uuid references public.customer_source_connections (id) on delete set null,
    source_kind        public.customer_source_kind not null,
    external_id        text not null check (char_length(external_id) between 1 and 200),
    source_metadata    jsonb,
    linked_at          timestamptz not null default now(),
    constraint customer_external_links_unique
        unique (org_id, source_kind, external_id)
);

create index customer_external_links_customer_idx
    on public.customer_external_links (customer_id);

-- --------------------------------------------------- import jobs / rows ---

create table public.customer_import_jobs (
    id                  uuid primary key default gen_random_uuid(),
    org_id              uuid not null references public.organizations (id) on delete cascade,
    source_connection_id uuid references public.customer_source_connections (id) on delete set null,
    source_kind         public.customer_source_kind not null,
    -- Idempotency: retrying an import with the same key returns the same job.
    idempotency_key     text check (idempotency_key is null or char_length(idempotency_key) between 8 and 200),
    status              public.customer_import_status not null default 'pending',
    dry_run             boolean not null default false,
    total_rows          integer not null default 0 check (total_rows >= 0),
    imported_count      integer not null default 0 check (imported_count >= 0),
    matched_count       integer not null default 0 check (matched_count >= 0),
    duplicate_count     integer not null default 0 check (duplicate_count >= 0),
    invalid_count       integer not null default 0 check (invalid_count >= 0),
    skipped_count       integer not null default 0 check (skipped_count >= 0),
    unknown_consent_count integer not null default 0 check (unknown_consent_count >= 0),
    error               text,
    started_at          timestamptz,
    finished_at         timestamptz,
    created_by          uuid,
    created_at          timestamptz not null default now(),
    constraint customer_import_jobs_idempotent unique (org_id, idempotency_key)
);

create index customer_import_jobs_org_created_idx
    on public.customer_import_jobs (org_id, created_at desc);

-- One row per input row from the source, with the action taken and (for
-- failures) the error. Bounded per job so an oversized upload cannot fill the
-- table; the app-layer limit is what enforces the input size, this is durable
-- audit for what did happen.
create table public.customer_import_rows (
    id            uuid primary key default gen_random_uuid(),
    job_id        uuid not null references public.customer_import_jobs (id) on delete cascade,
    org_id        uuid not null references public.organizations (id) on delete cascade,
    row_number    integer not null check (row_number >= 1),
    action        public.customer_import_row_action not null,
    matched_customer_id uuid references public.customers (id) on delete set null,
    external_id   text,
    -- Never store the raw input row here. Redacted diagnostics only.
    error         text check (error is null or char_length(error) between 1 and 500),
    created_at    timestamptz not null default now(),
    constraint customer_import_rows_unique unique (job_id, row_number)
);

create index customer_import_rows_job_idx on public.customer_import_rows (job_id);

-- --------------------------------------------------- visits / events ------

-- One row per observed interaction (POS check-in, appointment, purchase). Kept
-- deliberately loose in schema — every source names its own kind — but
-- consistently attributed to a canonical customer so downstream analytics
-- doesn't need to know which POS the row came from.
create table public.customer_visits (
    id            uuid primary key default gen_random_uuid(),
    customer_id   uuid not null references public.customers (id) on delete cascade,
    org_id        uuid not null references public.organizations (id) on delete cascade,
    source_kind   public.customer_source_kind not null,
    external_id   text,
    occurred_at   timestamptz not null,
    note_encrypted text,
    meta          jsonb,
    created_at    timestamptz not null default now(),
    constraint customer_visits_source_dedupe
        unique nulls not distinct (org_id, source_kind, external_id)
);

create index customer_visits_customer_time_idx
    on public.customer_visits (customer_id, occurred_at desc);

-- --------------------------------------------------- sync checkpoints -----

create table public.customer_source_sync_checkpoints (
    source_connection_id uuid primary key references public.customer_source_connections (id) on delete cascade,
    org_id        uuid not null references public.organizations (id) on delete cascade,
    kind          public.customer_source_kind not null,
    -- Adapter-defined cursor (page token, last-modified, hi-water mark).
    cursor_value  text,
    updated_at    timestamptz not null default now()
);

-- ------------------------------------------------------------- RLS --------

do $$
declare
    t text;
begin
    foreach t in array array[
        'customers', 'customer_contact_identities', 'customer_source_connections',
        'customer_external_links', 'customer_import_jobs', 'customer_import_rows',
        'customer_visits', 'customer_source_sync_checkpoints'
    ]
    loop
        execute format('alter table public.%I enable row level security;', t);
        -- Owners/admins read their own org's rows; no client writes (service
        -- role only via the import service and adapter RPCs).
        execute format(
            'create policy %I_select_admin on public.%I for select to authenticated '
            || 'using (app.has_org_role(org_id, array[''owner'', ''admin'']::public.member_role[]));',
            t, t);
        execute format('grant select on public.%I to authenticated;', t);
    end loop;
end $$;

-- --------------------------------------------- definer writers ------------

-- Match or create a canonical customer by phone hash (with optional email).
-- Idempotent: matching an existing phone updates last_seen_at and returns the
-- same customer id; a new phone creates one row. Cross-org leakage is
-- impossible: matches are always scoped to (org_id, phone_hash).
create or replace function app.customer_upsert_by_phone(
    p_org_id            uuid,
    p_phone_hash        text,
    p_phone_encrypted   text,
    p_phone_key_version smallint,
    p_phone_last_four   text,
    p_display_name      text,
    p_email_hash        text,
    p_email_encrypted   text,
    p_email_key_version smallint,
    p_email_domain      text
)
returns table (customer_id uuid, matched boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
    v_matched boolean := false;
begin
    if p_phone_hash is null then
        raise exception 'phone_hash is required to upsert a customer';
    end if;

    select id into v_id
      from public.customers
     where org_id = p_org_id and phone_hash = p_phone_hash;

    if v_id is not null then
        v_matched := true;
        update public.customers
           set last_seen_at = now(),
               display_name = coalesce(display_name, p_display_name),
               email_hash = coalesce(email_hash, p_email_hash),
               email_encrypted = coalesce(email_encrypted, p_email_encrypted),
               email_key_version = coalesce(email_key_version, p_email_key_version),
               email_domain = coalesce(email_domain, p_email_domain),
               updated_at = now()
         where id = v_id;
    else
        insert into public.customers
            (org_id, display_name, phone_hash, phone_encrypted, phone_key_version, phone_last_four,
             email_hash, email_encrypted, email_key_version, email_domain)
        values
            (p_org_id, p_display_name, p_phone_hash, p_phone_encrypted, p_phone_key_version, p_phone_last_four,
             p_email_hash, p_email_encrypted, p_email_key_version, p_email_domain)
        returning id into v_id;
    end if;

    -- Record the phone as a contact identity (idempotent).
    insert into public.customer_contact_identities
        (customer_id, org_id, kind, value_hash, value_encrypted, key_version, last_four)
    values
        (v_id, p_org_id, 'phone', p_phone_hash, p_phone_encrypted, p_phone_key_version, p_phone_last_four)
    on conflict (org_id, kind, value_hash) do nothing;

    if p_email_hash is not null then
        insert into public.customer_contact_identities
            (customer_id, org_id, kind, value_hash, value_encrypted, key_version, label)
        values
            (v_id, p_org_id, 'email', p_email_hash, p_email_encrypted, p_email_key_version, p_email_domain)
        on conflict (org_id, kind, value_hash) do nothing;
    end if;

    return query select v_id, v_matched;
end;
$$;

-- Link a canonical customer to a source's external id, idempotent per
-- (org, source_kind, external_id). Prevents a row leaking to another org via
-- external id collision because uniqueness is scoped by org.
create or replace function app.customer_external_link(
    p_org_id             uuid,
    p_customer_id        uuid,
    p_source_kind        public.customer_source_kind,
    p_source_connection_id uuid,
    p_external_id        text,
    p_metadata           jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    insert into public.customer_external_links
        (customer_id, org_id, source_connection_id, source_kind, external_id, source_metadata)
    values
        (p_customer_id, p_org_id, p_source_connection_id, p_source_kind, p_external_id, p_metadata)
    on conflict (org_id, source_kind, external_id) do update
       set source_connection_id = coalesce(excluded.source_connection_id,
                                           public.customer_external_links.source_connection_id),
           source_metadata = coalesce(excluded.source_metadata,
                                      public.customer_external_links.source_metadata)
    returning id into v_id;
    return v_id;
end;
$$;

-- Open an import job, idempotent on (org_id, idempotency_key). A retry of the
-- same upload returns the existing job rather than duplicating it.
create or replace function app.customer_import_begin(
    p_org_id             uuid,
    p_source_kind        public.customer_source_kind,
    p_source_connection_id uuid,
    p_dry_run            boolean,
    p_idempotency_key    text,
    p_actor              uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    insert into public.customer_import_jobs
        (org_id, source_connection_id, source_kind, idempotency_key, dry_run, status, started_at, created_by)
    values
        (p_org_id, p_source_connection_id, p_source_kind, p_idempotency_key,
         coalesce(p_dry_run, false), 'running', now(), p_actor)
    on conflict (org_id, idempotency_key) do nothing
    returning id into v_id;

    if v_id is null then
        select id into v_id from public.customer_import_jobs
         where org_id = p_org_id and idempotency_key = p_idempotency_key;
    end if;
    return v_id;
end;
$$;

-- Record a per-row outcome (imported/matched/duplicate/invalid/skipped).
-- Never stores the raw row; only the diagnostic.
create or replace function app.customer_import_record_row(
    p_job_id      uuid,
    p_org_id      uuid,
    p_row_number  integer,
    p_action      public.customer_import_row_action,
    p_matched_customer_id uuid,
    p_external_id text,
    p_error       text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.customer_import_rows
        (job_id, org_id, row_number, action, matched_customer_id, external_id, error)
    values
        (p_job_id, p_org_id, p_row_number, p_action, p_matched_customer_id, p_external_id, p_error)
    on conflict (job_id, row_number) do nothing;
end;
$$;

-- Close the job. Callers pass the tallies they observed; the definer stores
-- them and marks the state accordingly.
create or replace function app.customer_import_finish(
    p_job_id       uuid,
    p_org_id       uuid,
    p_total        integer,
    p_imported     integer,
    p_matched      integer,
    p_duplicate    integer,
    p_invalid      integer,
    p_skipped      integer,
    p_unknown_consent integer,
    p_error        text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_status public.customer_import_status;
begin
    if p_error is not null then
        v_status := 'failed';
    elsif coalesce(p_invalid, 0) > 0 and coalesce(p_imported, 0) + coalesce(p_matched, 0) > 0 then
        v_status := 'partial';
    else
        v_status := 'succeeded';
    end if;

    update public.customer_import_jobs
       set status = v_status,
           total_rows = coalesce(p_total, 0),
           imported_count = coalesce(p_imported, 0),
           matched_count = coalesce(p_matched, 0),
           duplicate_count = coalesce(p_duplicate, 0),
           invalid_count = coalesce(p_invalid, 0),
           skipped_count = coalesce(p_skipped, 0),
           unknown_consent_count = coalesce(p_unknown_consent, 0),
           error = p_error,
           finished_at = now()
     where id = p_job_id and org_id = p_org_id;
end;
$$;

-- --------------------------------------------------------- grants ----------

do $$
declare
    fn text;
begin
    foreach fn in array array[
        'app.customer_upsert_by_phone(uuid, text, text, smallint, text, text, text, text, smallint, text)',
        'app.customer_external_link(uuid, uuid, public.customer_source_kind, uuid, text, jsonb)',
        'app.customer_import_begin(uuid, public.customer_source_kind, uuid, boolean, text, uuid)',
        'app.customer_import_record_row(uuid, uuid, integer, public.customer_import_row_action, uuid, text, text)',
        'app.customer_import_finish(uuid, uuid, integer, integer, integer, integer, integer, integer, integer, text)'
    ]
    loop
        execute format('revoke all on function %s from public, anon, authenticated;', fn);
        execute format('grant execute on function %s to service_role;', fn);
    end loop;
end $$;
