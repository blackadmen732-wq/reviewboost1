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
