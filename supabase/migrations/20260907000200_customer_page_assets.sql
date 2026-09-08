-- ReviewBoost Customer Page V2 — asset metadata
--
-- Photos and logos live on Supabase Storage (or an equivalent object store)
-- outside Postgres. This table records the *metadata* every upload needs to
-- be usable safely by the public flow: what kind of asset it is, who owns
-- it, whether processing has finished, and what public URLs (already
-- content-hashed) serve the responsive variants.
--
-- WHAT IS AND IS NOT HERE
-- -----------------------
-- Here: opaque asset ids, owner scope (org / optional location), asset kind
-- (hero / logo), the source object path (in a *private* bucket), the
-- published public paths for a set of responsive variants, dimensions after
-- decoding, byte size, content-type, sha256 of source bytes, an actor and
-- timestamps.
--
-- Not here: image binaries, EXIF, GPS, camera model, embedded thumbnails,
-- private bucket credentials, org names, or anything else identifying the
-- tenant. Public URLs are opaque content-hashed paths; they carry no
-- customer-visible tenant identity and are safe to expose from the anonymous
-- customer page.
--
-- WHY UPLOAD-THEN-FINALIZE
-- ------------------------
-- The upload flow is:
--   1. Owner calls `rpc_customer_page_create_asset_upload` → gets back an
--      opaque asset id and a *signed URL* to a private bucket path.
--      Row is created in state `pending`.
--   2. Client uploads bytes directly to storage.
--   3. Owner calls `rpc_customer_page_finalize_asset` with the asset id.
--      Application code verifies the decoded image, rejects malformed or
--      bomb-shaped inputs, strips EXIF/GPS/metadata, normalizes
--      orientation, and produces responsive derivatives with
--      content-hashed public paths. The row is then moved to `ready` and
--      the derivative metadata is written.
--
-- The row stays `pending` if the client never uploads or the finalize step
-- fails; a periodic sweep may delete stale pending rows (and their storage
-- objects), but that is orchestration outside this migration.

create type public.customer_page_asset_kind as enum (
    'hero',
    'logo'
);

create type public.customer_page_asset_state as enum (
    'pending',    -- created, awaiting upload
    'processing', -- finalize started, derivatives not yet written
    'ready',      -- derivatives written, safe for publish
    'failed',     -- finalize failed (see failure_reason); do not publish
    'quarantined' -- explicitly held back (moderation, abuse); do not publish
);

create table public.customer_page_assets (
    id                   uuid primary key default gen_random_uuid(),
    org_id               uuid not null references public.organizations (id) on delete cascade,
    location_id          uuid,

    kind                 public.customer_page_asset_kind not null,
    state                public.customer_page_asset_state not null default 'pending',

    -- Source bytes live in a PRIVATE bucket at this path. Never exposed to
    -- the public customer page. Includes content hash so the same upload
    -- cannot be replayed against a different logical asset.
    source_object_path   text,
    source_content_type  text,
    source_bytes         bigint check (source_bytes is null or source_bytes >= 0),
    source_sha256        text,

    -- After finalize. `variants` is a JSONB array of
    --   { width, height, path, contentType, bytes }
    -- entries with opaque content-hashed public paths. The public flow
    -- assembles a srcset from these.
    width                integer check (width is null or width between 1 and 20000),
    height               integer check (height is null or height between 1 and 20000),
    variants             jsonb not null default '[]'::jsonb,

    failure_reason       text,

    created_by           uuid references auth.users (id) on delete set null,
    finalized_by         uuid references auth.users (id) on delete set null,
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now(),
    finalized_at         timestamptz,

    -- Location override must belong to the same org (belt-and-braces on
    -- top of RLS).
    constraint customer_page_assets_location_fk
        foreign key (location_id, org_id)
        references public.locations (id, org_id)
        on delete cascade,

    -- `ready` implies we have variants and dimensions. This is what the
    -- publish RPC checks against so a broken asset cannot ship.
    constraint customer_page_assets_ready_shape
        check (
            state <> 'ready'
            or (
                jsonb_typeof(variants) = 'array'
                and jsonb_array_length(variants) > 0
                and width is not null
                and height is not null
            )
        )
);

create index customer_page_assets_org_kind_state_idx
    on public.customer_page_assets (org_id, kind, state, created_at desc);

-- One reservation per source path so a replay cannot attach another
-- logical asset to the same private object.
create unique index customer_page_assets_source_path_key
    on public.customer_page_assets (source_object_path)
    where source_object_path is not null;

create trigger customer_page_assets_touch
    before update on public.customer_page_assets
    for each row execute function app.touch_updated_at();

alter table public.customer_page_assets enable row level security;

create policy customer_page_assets_select on public.customer_page_assets
    for select
    to authenticated
    using (app.is_org_member(org_id));

revoke insert, update, delete on public.customer_page_assets from anon, authenticated;
grant select on public.customer_page_assets to authenticated;
