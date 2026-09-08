-- Customer Page V2 — close High authz / asset-scope holes
--
-- Additive follow-up to 20260907000100–00300 (not on main). Two defects:
--
-- 1. `customer_page_profiles_select` used `app.is_org_member`, so a viewer or
--    member denied by `rpc_customer_page_get` could still SELECT unpublished
--    drafts via the Data API. Restrict SELECT to owner/admin.
--
-- 2. Publish (and the public resolver) accepted any ready asset in the org,
--    including a location-scoped image attached to another location or to an
--    organization-wide profile. Org-scoped assets (`location_id IS NULL`)
--    remain reusable; location-scoped assets may only attach to that same
--    location.
--
-- Also require each finalize variant to carry positive integer dimensions, a
-- supported content type, and a non-negative integer byte count before the
-- row can become `ready`.

-- --------------------------------------------- helpers (private schema) ---

-- Org-scoped assets may attach to any profile in the same org.
-- Location-scoped assets may only attach to that same location, never to
-- an organization-wide profile (`p_profile_location_id IS NULL`).
create or replace function app.customer_page_asset_matches_profile(
    p_asset_location_id   uuid,
    p_profile_location_id uuid
)
returns boolean
language sql
immutable
set search_path = ''
as $$
    select p_asset_location_id is null
        or p_asset_location_id is not distinct from p_profile_location_id;
$$;

-- True when `p_variants` is a non-empty array of objects that are safe to
-- mark ready: public path, positive integer size, supported type, bytes.
create or replace function app.customer_page_variants_ok(p_variants jsonb)
returns boolean
language sql
stable
set search_path = ''
as $$
    select jsonb_typeof(p_variants) = 'array'
        and jsonb_array_length(p_variants) > 0
        and not exists (
            select 1
              from jsonb_array_elements(p_variants) as elem
             where jsonb_typeof(elem.value) is distinct from 'object'
                or coalesce(elem.value ->> 'path', '') = ''
                or position('..' in coalesce(elem.value ->> 'path', '')) > 0
                or (elem.value ->> 'path') !~ '^customer-page/public/'
                or jsonb_typeof(elem.value -> 'width') is distinct from 'number'
                or (elem.value ->> 'width') !~ '^[0-9]+$'
                or (elem.value ->> 'width')::integer < 1
                or (elem.value ->> 'width')::integer > 20000
                or jsonb_typeof(elem.value -> 'height') is distinct from 'number'
                or (elem.value ->> 'height') !~ '^[0-9]+$'
                or (elem.value ->> 'height')::integer < 1
                or (elem.value ->> 'height')::integer > 20000
                or coalesce(elem.value ->> 'contentType', '')
                   not in ('image/jpeg', 'image/png', 'image/webp')
                or jsonb_typeof(elem.value -> 'bytes') is distinct from 'number'
                or (elem.value ->> 'bytes') !~ '^[0-9]+$'
                or (elem.value ->> 'bytes')::bigint < 0
        );
$$;

revoke all on function app.customer_page_asset_matches_profile(uuid, uuid)
    from public, anon, authenticated;
revoke all on function app.customer_page_variants_ok(jsonb)
    from public, anon, authenticated;

-- --------------------------------------------- profile SELECT (owner) ----

drop policy if exists customer_page_profiles_select on public.customer_page_profiles;

create policy customer_page_profiles_select on public.customer_page_profiles
    for select
    to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

-- --------------------------------------------- publish (asset scope) -----

create or replace function public.rpc_customer_page_publish(
    p_org_id      uuid,
    p_location_id uuid default null
)
returns table (
    id                uuid,
    published         jsonb,
    published_version integer,
    published_at      timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor      uuid := app.customer_page_require_editor(p_org_id);
    v_profile    record;
    v_snapshot   jsonb;
    v_hero_asset uuid;
    v_logo_asset uuid;
    v_new_ver    integer;
begin
    if p_location_id is not null then
        select * into v_profile
          from public.customer_page_profiles
         where org_id = p_org_id
           and scope = 'location'
           and location_id = p_location_id
         for update;
    else
        select * into v_profile
          from public.customer_page_profiles
         where org_id = p_org_id
           and scope = 'organization'
         for update;
    end if;

    if v_profile.id is null then
        raise exception 'no draft to publish' using errcode = 'P0002';
    end if;

    v_snapshot := app.customer_page_sanitize_draft(v_profile.draft);

    begin
        v_hero_asset := nullif(v_snapshot #>> '{hero,assetId}', '')::uuid;
        v_logo_asset := nullif(v_snapshot #>> '{logo,assetId}', '')::uuid;
    exception when invalid_text_representation then
        raise exception 'invalid_draft' using errcode = '22023';
    end;

    if v_hero_asset is not null then
        perform 1
          from public.customer_page_assets a
         where a.id = v_hero_asset
           and a.org_id = p_org_id
           and a.kind = 'hero'
           and a.state = 'ready'
           and app.customer_page_asset_matches_profile(a.location_id, p_location_id);
        if not found then
            raise exception 'hero_asset_not_ready' using errcode = '22023';
        end if;
    end if;

    if v_logo_asset is not null then
        perform 1
          from public.customer_page_assets a
         where a.id = v_logo_asset
           and a.org_id = p_org_id
           and a.kind = 'logo'
           and a.state = 'ready'
           and app.customer_page_asset_matches_profile(a.location_id, p_location_id);
        if not found then
            raise exception 'logo_asset_not_ready' using errcode = '22023';
        end if;
    end if;

    v_new_ver := v_profile.published_version + 1;

    update public.customer_page_profiles cp
       set published         = v_snapshot,
           published_version = v_new_ver,
           published_by      = v_actor,
           published_at      = now()
     where cp.id = v_profile.id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (p_org_id, v_actor, 'user', 'customer_page.published',
         'customer_page_profile', v_profile.id::text,
         jsonb_build_object(
             'scope', v_profile.scope::text,
             'location_id', v_profile.location_id,
             'published_version', v_new_ver
         ));

    return query
    select v_profile.id, v_snapshot, v_new_ver, now();
end;
$$;

-- --------------------------------------------- finalize (variant meta) ---

create or replace function public.rpc_customer_page_finalize_asset(
    p_org_id       uuid,
    p_asset_id     uuid,
    p_width        integer,
    p_height       integer,
    p_source_bytes bigint,
    p_source_sha256 text,
    p_variants     jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_rows  integer;
begin
    if v_actor is not null then
        raise exception 'forbidden' using errcode = '42501';
    end if;

    if not app.customer_page_variants_ok(p_variants) then
        raise exception 'invalid_variants' using errcode = '22023';
    end if;

    if p_width is null or p_width < 1
       or p_height is null or p_height < 1
       or p_width > 20000 or p_height > 20000 then
        raise exception 'invalid_dimensions' using errcode = '22023';
    end if;

    if p_source_bytes is not null and p_source_bytes < 0 then
        raise exception 'invalid_dimensions' using errcode = '22023';
    end if;

    if p_source_sha256 is not null
       and p_source_sha256 !~* '^[0-9a-f]{64}$' then
        raise exception 'invalid_source_hash' using errcode = '22023';
    end if;

    update public.customer_page_assets
       set state          = 'ready',
           width          = p_width,
           height         = p_height,
           source_bytes   = p_source_bytes,
           source_sha256  = p_source_sha256,
           variants       = p_variants,
           finalized_by   = null,
           finalized_at   = now()
     where id = p_asset_id
       and org_id = p_org_id
       and state in ('pending','processing');
    get diagnostics v_rows = row_count;

    if v_rows = 0 then
        raise exception 'asset_not_found_or_not_pending' using errcode = '42704';
    end if;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (p_org_id, null, 'system', 'customer_page.asset_finalized',
         'customer_page_asset', p_asset_id::text,
         jsonb_build_object('width', p_width, 'height', p_height));
end;
$$;

-- --------------------------------------------- public resolver (scope) ---

create or replace function app.resolve_public_customer_page(
    p_org_id      uuid,
    p_location_id uuid
)
returns table (
    scope             public.customer_page_scope,
    published         jsonb,
    published_version integer,
    hero_variants     jsonb,
    hero_width        integer,
    hero_height       integer,
    logo_variants     jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_profile        record;
    v_hero_id        uuid;
    v_logo_id        uuid;
    v_hero_variants  jsonb    := '[]'::jsonb;
    v_hero_width     integer;
    v_hero_height    integer;
    v_logo_variants  jsonb    := '[]'::jsonb;
begin
    select p.* into v_profile
      from public.customer_page_profiles p
     where p.org_id = p_org_id
       and p.scope = 'location'
       and p.location_id = p_location_id
       and p.published is not null
       and p.published_version > 0;

    if v_profile.id is null then
        select p.* into v_profile
          from public.customer_page_profiles p
         where p.org_id = p_org_id
           and p.scope = 'organization'
           and p.published is not null
           and p.published_version > 0;
    end if;

    if v_profile.id is null then
        return;
    end if;

    begin
        v_hero_id := nullif(v_profile.published #>> '{hero,assetId}', '')::uuid;
    exception when invalid_text_representation then
        v_hero_id := null;
    end;
    begin
        v_logo_id := nullif(v_profile.published #>> '{logo,assetId}', '')::uuid;
    exception when invalid_text_representation then
        v_logo_id := null;
    end;

    if v_hero_id is not null then
        select a.variants, a.width, a.height
          into v_hero_variants, v_hero_width, v_hero_height
          from public.customer_page_assets a
         where a.id = v_hero_id
           and a.org_id = p_org_id
           and a.kind = 'hero'
           and a.state = 'ready'
           and app.customer_page_asset_matches_profile(a.location_id, v_profile.location_id);
    end if;

    if v_logo_id is not null then
        select a.variants
          into v_logo_variants
          from public.customer_page_assets a
         where a.id = v_logo_id
           and a.org_id = p_org_id
           and a.kind = 'logo'
           and a.state = 'ready'
           and app.customer_page_asset_matches_profile(a.location_id, v_profile.location_id);
    end if;

    return query
    select v_profile.scope,
           jsonb_set(
               jsonb_set(
                   v_profile.published,
                   '{hero}',
                   coalesce(v_profile.published -> 'hero', '{}'::jsonb) - 'assetId'
               ),
               '{logo}',
               coalesce(v_profile.published -> 'logo', '{}'::jsonb) - 'assetId'
           ),
           v_profile.published_version,
           coalesce(v_hero_variants, '[]'::jsonb),
           v_hero_width,
           v_hero_height,
           coalesce(v_logo_variants, '[]'::jsonb);
end;
$$;
