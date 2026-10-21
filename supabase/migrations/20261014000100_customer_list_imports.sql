-- Customer lists: bringing in a list the business already keeps (a Google
-- Sheet first; a file upload can use the same path later).
--
-- WHAT THIS ADDS
-- --------------
-- An import is one owner action: "bring in the people on this list". Each
-- row with a usable phone number becomes (or updates) a phone-keyed contact in
-- `customers`, with a source profile saying it came from that kind of list.
-- Importing the same kind of list again updates those profiles instead of
-- adding a second copy. Removing an import takes back what it added.
--
-- WHAT IT DELIBERATELY DOES NOT DO
-- --------------------------------
-- Nothing here records consent, creates a Text Request, or reserves or grants
-- credit. A list makes people findable; whether they may be texted is still
-- decided only by the consent ledger and `app.sms_can_send`
-- (docs/connections/07: "An imported phone number is not consent").
--
-- No Google credential is stored. The browser reads the sheet with a
-- short-lived token the owner grants for that one file, sends us the rows, and
-- throws the token away. We keep the sheet's title (the owner's own label) and
-- a keyed digest of its id, so a re-import of the same sheet is recognised
-- without keeping the id itself.
--
-- Writes go only through SECURITY DEFINER `app.customer_list_*` functions,
-- reached by the service role through `public.rpc_customer_list_*` wrappers
-- after the route has authenticated the user and resolved the organization.

-- ====================================================== source kinds =====

alter table public.customer_source_profiles
    drop constraint customer_source_profiles_source_kind_check;
alter table public.customer_source_profiles
    add constraint customer_source_profiles_source_kind_check
        check (source_kind in ('manual', 'csv', 'google_sheets', 'integration'));

-- ============================================================ imports =====

create table public.customer_list_imports (
    id                 uuid primary key default gen_random_uuid(),
    org_id             uuid not null references public.organizations (id) on delete cascade,
    source             text not null check (source in ('google_sheets', 'csv')),
    -- The list's own name as the owner sees it ("Customers 2026"). Display only.
    source_label       text check (source_label is null or char_length(source_label) between 1 and 120),
    -- Keyed digest of the provider's file id. Recognises a re-import of the
    -- same sheet; the id itself is not kept.
    source_ref_digest  text check (source_ref_digest is null or char_length(source_ref_digest) between 16 and 128),
    -- Row counts only. Never names or numbers.
    rows_received      integer not null check (rows_received between 0 and 2000),
    rows_unusable      integer not null default 0 check (rows_unusable >= 0),
    created_count      integer not null default 0 check (created_count >= 0),
    updated_count      integer not null default 0 check (updated_count >= 0),
    unchanged_count    integer not null default 0 check (unchanged_count >= 0),
    status             text not null default 'active' check (status in ('active', 'removed')),
    created_by         uuid references auth.users (id) on delete set null,
    created_at         timestamptz not null default now(),
    removed_at         timestamptz,
    constraint customer_list_imports_id_org_key unique (id, org_id)
);

create index customer_list_imports_org_idx on public.customer_list_imports (org_id, created_at desc);

-- Which import last wrote a list profile, so removing an import can take back
-- exactly what it brought in.
alter table public.customer_source_profiles
    add column list_import_id uuid references public.customer_list_imports (id) on delete set null;

-- One profile per contact per kind of list: a second import of a sheet
-- updates the first one's profiles rather than stacking duplicates.
create unique index customer_source_profiles_one_per_list_kind
    on public.customer_source_profiles (customer_id, source_kind)
    where connection_id is null;

create index customer_source_profiles_list_import_idx
    on public.customer_source_profiles (list_import_id)
    where list_import_id is not null;

alter table public.customer_list_imports enable row level security;

-- Owners and admins see their own organization's imports, as with
-- connections. Nobody else reads them, and no client role writes.
create policy customer_list_imports_select_admin on public.customer_list_imports
    for select to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

revoke all on public.customer_list_imports from anon, authenticated;
grant select on public.customer_list_imports to authenticated;
grant all on public.customer_list_imports to service_role;

-- ========================================================= functions =====

-- The caller (resolved from the session by the route) must be an active
-- owner or admin of the organization. Checked again here, so a bug in a route
-- cannot write into a business the user does not run.
create or replace function app.customer_list_require_admin(p_org_id uuid, p_actor uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if p_actor is null or not exists (
        select 1 from public.organization_members m
         where m.org_id = p_org_id
           and m.user_id = p_actor
           and m.status = 'active'
           and m.role in ('owner', 'admin')
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0002';
    end if;
end;
$$;

-- Bring in one list. `p_rows` is a JSON array of already-normalised rows:
--   { phone_hash, phone_encrypted, phone_key_version, phone_last_four,
--     name_encrypted, name_digest }
-- Rows repeating a phone number count once (the first one wins), so a list
-- with a number twice cannot flip a name back and forth.
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

        -- A contact's display name is filled from a list only when it has
        -- none: a name from the business's own system is not overwritten by
        -- a spreadsheet.
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
                display_name_encrypted = coalesce(cu.display_name_encrypted, excluded.display_name_encrypted),
                updated_at = now()
        returning cu.id, (xmax = 0) into v_customer, v_inserted;

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
               set name_encrypted = v_name_enc,
                   name_digest = v_digest,
                   list_import_id = v_import,
                   last_synced_at = now(),
                   status = 'active'
             where p.id = v_profile.id;
        end if;

        update public.customers cu
           set names_differ = (
               select count(distinct p.name_digest) > 1
                 from public.customer_source_profiles p
                where p.customer_id = cu.id and p.status = 'active' and p.name_digest is not null)
         where cu.id = v_customer;
    end loop;

    update public.customer_list_imports i
       set created_count = v_created, updated_count = v_updated, unchanged_count = v_unchanged
     where i.id = v_import;

    return query select v_import, v_created, v_updated, v_unchanged;
end;
$$;

-- Take back an import. Its profiles go; a contact that nothing else knows
-- about (no other source, no visit) goes with them. Contacts that also came
-- from somewhere else stay, minus this list's name for them. Idempotent.
create or replace function app.customer_list_remove(p_org_id uuid, p_actor uuid, p_import_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_import  public.customer_list_imports%rowtype;
    v_ids     uuid[];
    v_removed integer := 0;
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

    with gone as (
        delete from public.customer_source_profiles p
         where p.list_import_id = p_import_id and p.org_id = p_org_id
        returning p.customer_id
    )
    select coalesce(array_agg(distinct customer_id), '{}') into v_ids from gone;

    with orphaned as (
        delete from public.customers cu
         where cu.id = any (v_ids)
           and cu.org_id = p_org_id
           and not exists (select 1 from public.customer_source_profiles p where p.customer_id = cu.id)
           and not exists (select 1 from public.customer_visits v where v.customer_id = cu.id)
        returning cu.id
    )
    select count(*) into v_removed from orphaned;

    update public.customers cu
       set names_differ = (
           select count(distinct p.name_digest) > 1
             from public.customer_source_profiles p
            where p.customer_id = cu.id and p.status = 'active' and p.name_digest is not null)
     where cu.id = any (v_ids);

    update public.customer_list_imports i
       set status = 'removed', removed_at = now()
     where i.id = p_import_id;

    return v_removed;
end;
$$;

-- =========================================================== wrappers =====

create or replace function public.rpc_customer_list_import(
    p_org_id uuid, p_actor uuid, p_source text, p_label text, p_ref_digest text,
    p_rows_received integer, p_rows_unusable integer, p_rows jsonb)
returns table (import_id uuid, created_count integer, updated_count integer, unchanged_count integer)
language sql security definer set search_path = ''
as $$ select * from app.customer_list_import(p_org_id, p_actor, p_source, p_label, p_ref_digest, p_rows_received, p_rows_unusable, p_rows); $$;

create or replace function public.rpc_customer_list_remove(p_org_id uuid, p_actor uuid, p_import_id uuid)
returns integer
language sql security definer set search_path = ''
as $$ select app.customer_list_remove(p_org_id, p_actor, p_import_id); $$;

revoke all on function app.customer_list_require_admin(uuid, uuid) from public, anon, authenticated;
revoke all on function app.customer_list_import(uuid, uuid, text, text, text, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function app.customer_list_remove(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_customer_list_import(uuid, uuid, text, text, text, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.rpc_customer_list_remove(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.rpc_customer_list_import(uuid, uuid, text, text, text, integer, integer, jsonb) to service_role;
grant execute on function public.rpc_customer_list_remove(uuid, uuid, uuid) to service_role;
