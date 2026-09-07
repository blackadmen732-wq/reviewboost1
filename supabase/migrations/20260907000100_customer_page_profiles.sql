-- ReviewBoost Customer Page V2 — profile schema
--
-- One additive migration. It adds the storage that Customer Page V2 needs
-- (the branded page a customer sees between the tap and the Google handoff)
-- and it introduces nothing else: no changes to any existing table, no
-- change to any existing RPC. Rolling back is disabling the V2 feature
-- flags, not reverting SQL.
--
-- THE DRAFT / PUBLISH MODEL
-- -------------------------
-- Owners edit a `draft` column. Publish takes a snapshot of the draft into
-- a `published` column together with a monotonically-increasing
-- `published_version`. The public flow only ever reads from `published`.
-- A half-edited page therefore cannot appear to customers, and reverting
-- is one PATCH away.
--
-- The `published` snapshot is a JSONB blob, deliberately immutable except
-- via `publish`, so downstream cleanup (e.g. deleting a template) cannot
-- silently rewrite a page that customers are already seeing.
--
-- SCOPE
-- -----
-- A profile is owned by an *organization*. Locations may optionally have
-- an override — the public resolver prefers a location profile if one
-- exists and is published, and falls back to the organization profile, and
-- then to a Minimal built-in fallback if neither is published. Stands do
-- not carry design settings; a stand is a physical object, not a brand.
--
-- Photo binaries are not stored here. Only opaque asset ids referring to
-- rows in `customer_page_assets` (added by the companion migration). The
-- rendering pipeline lives outside Postgres for two reasons: image
-- processing is slow and would sit in the customer's tap latency budget,
-- and a raw image is a security surface that a database is a bad place
-- for.

-- ------------------------------------------------------ template ids ------

-- Exactly the six approved looks. A future template requires a migration,
-- which is the point: the approved list is code, not a runtime input, so a
-- misconfigured owner cannot ship an unapproved brand.
create type public.customer_page_template as enum (
    'signature',
    'modern',
    'bold',
    'editorial',
    'classic',
    'minimal'
);

create type public.customer_page_scope as enum (
    'organization',
    'location'
);

-- ---------------------------------------------------- profiles table ------

create table public.customer_page_profiles (
    id                       uuid primary key default gen_random_uuid(),
    org_id                   uuid not null references public.organizations (id) on delete cascade,

    -- Exactly one of these is set, enforced below. A location profile is an
    -- override; an organization profile is the fallback for every location
    -- that has none.
    scope                    public.customer_page_scope not null,
    location_id              uuid,

    -- The composer version records which set of allowed knobs the draft was
    -- edited under, so an editor can offer to migrate an old draft rather
    -- than silently reinterpret a field that changed meaning.
    composer_version         smallint not null default 1 check (composer_version >= 1),

    -- Draft (mutable). Never read by the public flow.
    -- Shape (see docs/backend/CUSTOMER_PAGE_V2.md):
    --   { templateId, hero: {assetId?, focalX, focalY, zoom}, logo: {assetId?} }
    -- All keys optional so a fresh draft is `{}`.
    draft                    jsonb not null default '{}'::jsonb,
    draft_updated_by         uuid references auth.users (id) on delete set null,
    draft_updated_at         timestamptz not null default now(),

    -- Published snapshot (immutable except via publish RPC). Read by the
    -- public flow. Shape mirrors `draft` plus asset public paths already
    -- resolved.
    published                jsonb,
    published_version        integer not null default 0 check (published_version >= 0),
    published_by             uuid references auth.users (id) on delete set null,
    published_at             timestamptz,

    created_at               timestamptz not null default now(),
    updated_at               timestamptz not null default now(),

    -- Organization profile: one per org, no location.
    -- Location profile: one per (org, location), location is required.
    constraint customer_page_profiles_scope_shape
        check (
            (scope = 'organization' and location_id is null)
            or
            (scope = 'location' and location_id is not null)
        ),

    -- Location override must belong to the same org (defence in depth on
    -- top of RLS: even a bug in a policy cannot let a location be pinned
    -- to another org's profile).
    constraint customer_page_profiles_location_fk
        foreign key (location_id, org_id)
        references public.locations (id, org_id)
        on delete cascade,

    -- If publish has ever run, we have a snapshot and metadata; if it has
    -- not, we have none of the three.
    constraint customer_page_profiles_publish_shape
        check (
            (published_version = 0 and published is null and published_at is null)
            or
            (published_version > 0 and published is not null and published_at is not null)
        )
);

-- One organization default; one override per location. Enforced with
-- partial unique indexes so `location_id` may be null without collisions.
create unique index customer_page_profiles_org_scope_key
    on public.customer_page_profiles (org_id)
    where scope = 'organization';

create unique index customer_page_profiles_location_scope_key
    on public.customer_page_profiles (org_id, location_id)
    where scope = 'location';

create index customer_page_profiles_org_updated_idx
    on public.customer_page_profiles (org_id, updated_at desc);

create trigger customer_page_profiles_touch
    before update on public.customer_page_profiles
    for each row execute function app.touch_updated_at();

-- ------------------------------------------------ row level security ------

alter table public.customer_page_profiles enable row level security;

-- Read is org-scoped. RLS is doing the isolation; the handler does not need
-- to remember a WHERE clause, and a bug in a handler cannot let one org
-- read another's profile.
create policy customer_page_profiles_select on public.customer_page_profiles
    for select
    to authenticated
    using (app.is_org_member(org_id));

-- No direct INSERT/UPDATE/DELETE from any client role. Every mutation goes
-- through a SECURITY DEFINER RPC that validates the draft shape, checks the
-- caller's role, and writes the audit event. The service role and the
-- database owner remain able to write, which is what the RPCs use.
revoke insert, update, delete on public.customer_page_profiles from anon, authenticated;

grant select on public.customer_page_profiles to authenticated;
