-- ReviewBoost Customer Page V2 — RPC surface
--
-- Every mutation goes through a SECURITY DEFINER function that:
--   1. requires an authenticated user (`auth.uid()`);
--   2. requires that user to hold `owner` or `admin` in the target org;
--   3. validates the input shape (draft JSON, template id, actor);
--   4. writes an append-only audit event.
--
-- Handlers never issue direct INSERT/UPDATE/DELETE to `customer_page_*` —
-- the table grants block that, so a forgotten role check in a handler
-- cannot become an authorization bypass.
--
-- The public resolver is a separate SECURITY DEFINER function that runs
-- from the anonymous flow. It only ever reads the `published` column and
-- returns the safe presentation subset — draft data structurally cannot
-- leak from it.

-- --------------------------------------------- helpers (private schema) ---

-- Bounds the size of any JSONB we accept from an owner. A megabyte of JSON
-- is not a customer page; it is an attempt to fill the database. The limit
-- is much larger than any legitimate draft but small enough that a mistake
-- is caught before it becomes a page.
create or replace function app.customer_page_draft_ok(p_draft jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
    select p_draft is not null
        and jsonb_typeof(p_draft) = 'object'
        and octet_length(p_draft::text) <= 65536;
$$;

-- Turns the mutable draft into the publish snapshot. Deliberately narrow:
-- it copies only the keys the public flow is contractually allowed to see,
-- so a stray composer-internal field cannot escape onto a customer page
-- through publish, and a future migration that adds a private key does not
-- accidentally publish it.
create or replace function app.customer_page_sanitize_draft(p_draft jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
    v_template text;
    v_hero     jsonb;
    v_logo     jsonb;
    v_hero_id  text;
    v_logo_id  text;
    v_focal_x  numeric;
    v_focal_y  numeric;
    v_zoom     numeric;
begin
    if not app.customer_page_draft_ok(p_draft) then
        raise exception 'invalid_draft' using errcode = '22023';
    end if;

    v_template := coalesce(p_draft ->> 'templateId', 'minimal');
    if v_template not in ('signature','modern','bold','editorial','classic','minimal') then
        raise exception 'invalid_template' using errcode = '22023';
    end if;

    v_hero := p_draft -> 'hero';
    if v_hero is null or v_hero = 'null'::jsonb then
        v_hero := '{}'::jsonb;
    elsif jsonb_typeof(v_hero) is distinct from 'object' then
        raise exception 'invalid_draft' using errcode = '22023';
    end if;

    v_logo := p_draft -> 'logo';
    if v_logo is null or v_logo = 'null'::jsonb then
        v_logo := '{}'::jsonb;
    elsif jsonb_typeof(v_logo) is distinct from 'object' then
        raise exception 'invalid_draft' using errcode = '22023';
    end if;

    v_hero_id := nullif(v_hero ->> 'assetId', '');
    v_logo_id := nullif(v_logo ->> 'assetId', '');
    if v_hero_id is not null
       and v_hero_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'invalid_draft' using errcode = '22023';
    end if;
    if v_logo_id is not null
       and v_logo_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'invalid_draft' using errcode = '22023';
    end if;

    begin
        v_focal_x := coalesce((v_hero ->> 'focalX')::numeric, 0.5);
        v_focal_y := coalesce((v_hero ->> 'focalY')::numeric, 0.5);
        v_zoom    := coalesce((v_hero ->> 'zoom')::numeric, 1.0);
    exception when invalid_text_representation then
        raise exception 'invalid_draft' using errcode = '22023';
    end;

    v_focal_x := least(greatest(v_focal_x, 0), 1);
    v_focal_y := least(greatest(v_focal_y, 0), 1);
    v_zoom    := least(greatest(v_zoom, 1.0), 1.5);

    return jsonb_build_object(
        'templateId', v_template,
        'hero', jsonb_build_object(
            'assetId', v_hero_id,
            'focalX',  v_focal_x,
            'focalY',  v_focal_y,
            'zoom',    v_zoom
        ),
        'logo', jsonb_build_object(
            'assetId', v_logo_id
        )
    );
end;
$$;

-- Role gate. Editing a customer page is a brand-level decision, so
-- deliberately owner/admin only (a viewer or a member cannot edit).
create or replace function app.customer_page_require_editor(p_org_id uuid)
returns uuid
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
    if not app.has_org_role(p_org_id, array['owner','admin']::public.member_role[]) then
        raise exception 'forbidden' using errcode = '42501';
    end if;
    return v_actor;
end;
$$;

-- ------------------------------------------- get profile (owner) ---------

/**
 * Owner view of a profile.
 *
 * Returns the draft and the published snapshot together with the
 * publish metadata. If no row exists, returns an empty draft — the editor
 * treats "no row" and "empty draft" identically.
 */
create or replace function public.rpc_customer_page_get(
    p_org_id      uuid,
    p_location_id uuid default null
)
returns table (
    id                 uuid,
    scope              public.customer_page_scope,
    location_id        uuid,
    composer_version   smallint,
    draft              jsonb,
    draft_updated_at   timestamptz,
    published          jsonb,
    published_version  integer,
    published_at       timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := app.customer_page_require_editor(p_org_id);
begin
    if p_location_id is not null then
        -- Verify the location belongs to this org — RLS on `locations`
        -- would filter it away, but this function runs as definer, so we
        -- ask explicitly. A cross-tenant location id resolves to no row.
        perform 1
          from public.locations l
         where l.id = p_location_id
           and l.org_id = p_org_id;
        if not found then
            raise exception 'location not found' using errcode = '42704';
        end if;

        return query
        select p.id, p.scope, p.location_id, p.composer_version,
               p.draft, p.draft_updated_at,
               p.published, p.published_version, p.published_at
          from public.customer_page_profiles p
         where p.org_id = p_org_id
           and p.scope = 'location'
           and p.location_id = p_location_id;
    else
        return query
        select p.id, p.scope, p.location_id, p.composer_version,
               p.draft, p.draft_updated_at,
               p.published, p.published_version, p.published_at
          from public.customer_page_profiles p
         where p.org_id = p_org_id
           and p.scope = 'organization';
    end if;
end;
$$;

-- ----------------------------------------- patch draft (owner) -----------

/**
 * Upsert an owner-scoped or location-scoped draft.
 *
 * The publish snapshot is untouched. Publishing is a separate call, so a
 * "save as I go" editor cannot accidentally ship half a page.
 */
create or replace function public.rpc_customer_page_patch_draft(
    p_org_id            uuid,
    p_location_id       uuid,
    p_draft             jsonb,
    p_composer_version  smallint default 1
)
returns table (id uuid, draft jsonb, draft_updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor    uuid := app.customer_page_require_editor(p_org_id);
    v_scope    public.customer_page_scope;
    v_id       uuid;
    v_out_draft jsonb;
    v_out_at    timestamptz;
begin
    if not app.customer_page_draft_ok(p_draft) then
        raise exception 'invalid_draft' using errcode = '22023';
    end if;

    -- The template id in the draft is validated here even though it is
    -- also validated on publish — surfaces the error immediately in the
    -- editor rather than at ship time.
    if p_draft ? 'templateId'
       and (p_draft ->> 'templateId') not in
           ('signature','modern','bold','editorial','classic','minimal') then
        raise exception 'invalid_template' using errcode = '22023';
    end if;

    -- Reject malformed nested objects and asset ids at save time so the
    -- editor does not discover them only at publish.
    if (p_draft ? 'hero' and jsonb_typeof(p_draft -> 'hero') is distinct from 'object')
       or (p_draft ? 'logo' and jsonb_typeof(p_draft -> 'logo') is distinct from 'object') then
        raise exception 'invalid_draft' using errcode = '22023';
    end if;
    if nullif(p_draft #>> '{hero,assetId}', '') is not null
       and (p_draft #>> '{hero,assetId}')
           !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'invalid_draft' using errcode = '22023';
    end if;
    if nullif(p_draft #>> '{logo,assetId}', '') is not null
       and (p_draft #>> '{logo,assetId}')
           !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'invalid_draft' using errcode = '22023';
    end if;

    if p_location_id is not null then
        v_scope := 'location';
        perform 1
          from public.locations l
         where l.id = p_location_id and l.org_id = p_org_id;
        if not found then
            raise exception 'location not found' using errcode = '42704';
        end if;
    else
        v_scope := 'organization';
    end if;

    -- Two distinct partial unique indexes, so update-then-insert rather
    -- than a single ON CONFLICT clause. Concurrent inserts still collide
    -- on the partial unique index; the FOR UPDATE keeps the second call
    -- honest by locking the row it finds.
    if v_scope = 'organization' then
        update public.customer_page_profiles p
           set draft            = p_draft,
               draft_updated_by = v_actor,
               draft_updated_at = now(),
               composer_version = greatest(p.composer_version, coalesce(p_composer_version, 1))
         where p.org_id = p_org_id
           and p.scope = 'organization'
        returning p.id, p.draft, p.draft_updated_at
          into v_id, v_out_draft, v_out_at;
    else
        update public.customer_page_profiles p
           set draft            = p_draft,
               draft_updated_by = v_actor,
               draft_updated_at = now(),
               composer_version = greatest(p.composer_version, coalesce(p_composer_version, 1))
         where p.org_id = p_org_id
           and p.scope = 'location'
           and p.location_id = p_location_id
        returning p.id, p.draft, p.draft_updated_at
          into v_id, v_out_draft, v_out_at;
    end if;

    if v_id is null then
        begin
            insert into public.customer_page_profiles as p
                (org_id, scope, location_id, composer_version,
                 draft, draft_updated_by, draft_updated_at)
            values
                (p_org_id, v_scope, p_location_id, coalesce(p_composer_version, 1),
                 p_draft, v_actor, now())
            returning p.id, p.draft, p.draft_updated_at
              into v_id, v_out_draft, v_out_at;
        exception when unique_violation then
            -- A concurrent first-insert won the partial unique index.
            -- Lock and update that row so the second caller still saves.
            if v_scope = 'organization' then
                update public.customer_page_profiles p
                   set draft            = p_draft,
                       draft_updated_by = v_actor,
                       draft_updated_at = now(),
                       composer_version = greatest(p.composer_version, coalesce(p_composer_version, 1))
                 where p.org_id = p_org_id
                   and p.scope = 'organization'
                returning p.id, p.draft, p.draft_updated_at
                  into v_id, v_out_draft, v_out_at;
            else
                update public.customer_page_profiles p
                   set draft            = p_draft,
                       draft_updated_by = v_actor,
                       draft_updated_at = now(),
                       composer_version = greatest(p.composer_version, coalesce(p_composer_version, 1))
                 where p.org_id = p_org_id
                   and p.scope = 'location'
                   and p.location_id = p_location_id
                returning p.id, p.draft, p.draft_updated_at
                  into v_id, v_out_draft, v_out_at;
            end if;
        end;
    end if;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (p_org_id, v_actor, 'user', 'customer_page.draft_patched',
         'customer_page_profile', v_id::text,
         jsonb_build_object('scope', v_scope::text, 'location_id', p_location_id));

    return query select v_id, v_out_draft, v_out_at;
end;
$$;

-- ----------------------------------------- publish (owner) ---------------

/**
 * Atomically publish the draft.
 *
 * validate draft → sanitize public config → increment published_version →
 * write published snapshot → audit. Everything runs in one statement's
 * transaction so a customer cannot land between the two writes.
 *
 * Rejects if any asset referenced in the draft is not `ready` or does not
 * belong to this org: a broken or foreign asset must not become the
 * business's public face.
 */
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

    -- Verify referenced assets. `assetId` may be missing (unset) — that is
    -- valid; a page can publish without a hero, in which case the template
    -- falls back to a deterministic look.
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
           and a.state = 'ready';
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
           and a.state = 'ready';
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

-- --------------------------------- create/finalize asset upload ----------

/**
 * Reserve an asset id and record the intended source path.
 *
 * The signed upload URL itself is minted by the application against the
 * private bucket — this RPC only records the intent so that a later
 * finalize call can be tied back to a legitimate reservation.
 */
create or replace function public.rpc_customer_page_create_asset_upload(
    p_org_id             uuid,
    p_location_id        uuid,
    p_kind               public.customer_page_asset_kind,
    p_source_object_path text,
    p_source_content_type text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := app.customer_page_require_editor(p_org_id);
    v_id    uuid;
begin
    if p_location_id is not null then
        perform 1
          from public.locations l
         where l.id = p_location_id and l.org_id = p_org_id;
        if not found then
            raise exception 'location not found' using errcode = '42704';
        end if;
    end if;

    if p_source_content_type not in
        ('image/jpeg','image/png','image/webp') then
        raise exception 'unsupported_content_type' using errcode = '22023';
    end if;

    -- Opaque, tenant-free path. Reject traversal, absolute paths, and
    -- anything that is not the reserved prefix the application writes.
    if p_source_object_path is null
       or position('..' in p_source_object_path) > 0
       or p_source_object_path !~ '^customer-page/source/[a-zA-Z0-9]{2}/[a-zA-Z0-9._-]+\.(jpg|jpeg|png|webp)$' then
        raise exception 'invalid_source_path' using errcode = '22023';
    end if;

    insert into public.customer_page_assets
        (org_id, location_id, kind, state,
         source_object_path, source_content_type, created_by)
    values
        (p_org_id, p_location_id, p_kind, 'pending',
         p_source_object_path, p_source_content_type, v_actor)
    returning id into v_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (p_org_id, v_actor, 'user', 'customer_page.asset_upload_created',
         'customer_page_asset', v_id::text,
         jsonb_build_object('kind', p_kind::text, 'location_id', p_location_id));

    return v_id;
end;
$$;

/**
 * Move an asset to `ready` after out-of-band processing has produced
 * derivative variants. Called by the application, never by a browser.
 */
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
    -- EXECUTE is granted to service_role only. A user JWT must never
    -- finalize: the numbers (dimensions, sha256, variants) are produced
    -- by the application after decoding the image, and a browser cannot
    -- attest them honestly. Fail closed if a user subject is present.
    if v_actor is not null then
        raise exception 'forbidden' using errcode = '42501';
    end if;

    if jsonb_typeof(p_variants) is distinct from 'array'
       or jsonb_array_length(p_variants) = 0 then
        raise exception 'no_variants' using errcode = '22023';
    end if;

    if exists (
        select 1
          from jsonb_array_elements(p_variants) as elem
         where jsonb_typeof(elem.value) is distinct from 'object'
            or coalesce(elem.value ->> 'path', '') = ''
            or position('..' in coalesce(elem.value ->> 'path', '')) > 0
            or (elem.value ->> 'path') !~ '^customer-page/public/'
    ) then
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

-- ----------------------------- public resolver (anonymous flow) ----------

/**
 * Return the *published* presentation for a stand's location, or for its
 * org as a fallback. Returns no row if neither has published — the caller
 * uses a built-in Minimal fallback in that case.
 *
 * Read-only, callable only through the service-role RPC surface. Never
 * touches drafts. Returns the published presentation with asset ids
 * stripped; variants are resolved server-side so the anonymous page
 * never learns internal asset identifiers.
 */
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
    -- Prefer the location override if it has ever been published.
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

    -- Invalid stored ids must not crash the public flow; treat them as unset.
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
           and a.state = 'ready';
    end if;

    if v_logo_id is not null then
        select a.variants
          into v_logo_variants
          from public.customer_page_assets a
         where a.id = v_logo_id
           and a.org_id = p_org_id
           and a.kind = 'logo'
           and a.state = 'ready';
    end if;

    -- Strip asset ids from the payload the public flow sees. Resolution
    -- already happened above; the anonymous page must not learn them.
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

-- ------------------------------------------- rpc surface + grants --------

-- Public schema wrappers so PostgREST exposes them; owner RPCs are called by
-- the browser/mobile app carrying an authenticated Supabase token.
create or replace function public.rpc_customer_page_resolve_public(
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
language sql
stable
security invoker
set search_path = ''
as $$
    select * from app.resolve_public_customer_page(p_org_id, p_location_id);
$$;

-- Lock down execute grants. The owner RPCs are callable by any signed-in
-- user, but their own guard rejects anyone who is not an org owner/admin;
-- the public resolver is service-role only.
revoke all on function app.customer_page_require_editor(uuid) from public, anon, authenticated;
revoke all on function app.customer_page_draft_ok(jsonb) from public, anon, authenticated;
revoke all on function app.customer_page_sanitize_draft(jsonb) from public, anon, authenticated;
revoke all on function app.resolve_public_customer_page(uuid, uuid) from public, anon, authenticated;
grant execute on function app.resolve_public_customer_page(uuid, uuid) to service_role;

revoke all on function public.rpc_customer_page_get(uuid, uuid) from public, anon;
grant execute on function public.rpc_customer_page_get(uuid, uuid) to authenticated;

revoke all on function public.rpc_customer_page_patch_draft(uuid, uuid, jsonb, smallint) from public, anon;
grant execute on function public.rpc_customer_page_patch_draft(uuid, uuid, jsonb, smallint) to authenticated;

revoke all on function public.rpc_customer_page_publish(uuid, uuid) from public, anon;
grant execute on function public.rpc_customer_page_publish(uuid, uuid) to authenticated;

revoke all on function public.rpc_customer_page_create_asset_upload(uuid, uuid, public.customer_page_asset_kind, text, text)
    from public, anon;
grant execute on function public.rpc_customer_page_create_asset_upload(uuid, uuid, public.customer_page_asset_kind, text, text)
    to authenticated;

-- Finalize is application-only: it takes numbers the browser cannot verify
-- honestly (decoded width/height, source bytes, sha256, variants). Service
-- role.
revoke all on function public.rpc_customer_page_finalize_asset(uuid, uuid, integer, integer, bigint, text, jsonb)
    from public, anon, authenticated;
grant execute on function public.rpc_customer_page_finalize_asset(uuid, uuid, integer, integer, bigint, text, jsonb)
    to service_role;

revoke all on function public.rpc_customer_page_resolve_public(uuid, uuid) from public, anon, authenticated;
grant execute on function public.rpc_customer_page_resolve_public(uuid, uuid) to service_role;

-- Verification: service-role-only functions must actually be executable by
-- service_role. A missing grant here 503s finalize and the public resolver.
do $$
declare
    missing text;
begin
    select string_agg(signature, ', ')
      into missing
      from (
        values
          ('app.resolve_public_customer_page(uuid, uuid)'),
          ('public.rpc_customer_page_resolve_public(uuid, uuid)'),
          ('public.rpc_customer_page_finalize_asset(uuid, uuid, integer, integer, bigint, text, jsonb)')
      ) as required(signature)
     where not has_function_privilege('service_role', signature, 'EXECUTE');

    if missing is not null then
        raise exception 'service_role cannot execute: %', missing;
    end if;

    if has_function_privilege('authenticated', 'public.rpc_customer_page_finalize_asset(uuid, uuid, integer, integer, bigint, text, jsonb)', 'EXECUTE')
       or has_function_privilege('anon', 'public.rpc_customer_page_finalize_asset(uuid, uuid, integer, integer, bigint, text, jsonb)', 'EXECUTE')
       or has_function_privilege('authenticated', 'public.rpc_customer_page_resolve_public(uuid, uuid)', 'EXECUTE')
       or has_function_privilege('anon', 'public.rpc_customer_page_resolve_public(uuid, uuid)', 'EXECUTE') then
        raise exception 'customer page service-role RPCs leaked to client roles';
    end if;
end $$;
