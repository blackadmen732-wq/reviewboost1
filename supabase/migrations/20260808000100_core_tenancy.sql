-- ReviewBoost core tenancy
--
-- Organizations, membership, locations, stands. Forward-only: once applied,
-- this file is never edited — a change that runs on a fresh database and not on
-- an existing one silently diverges environments.
--
-- NAMING
-- ------
-- Database is snake_case; the API maps to camelCase DTOs. Rows are never
-- exposed directly, so a column rename is a migration, not a breaking API
-- change.
--
-- WHY NOT `FORCE ROW LEVEL SECURITY`
-- ----------------------------------
-- The legacy schema forces it on every tenant table. That advice came from
-- direct PostgreSQL and does not transfer here.
--
-- Under Supabase these tables are owned by `postgres`, and the Data API
-- connects as `anon` or `authenticated` — neither is the owner, so plain ENABLE
-- already applies to every client request. FORCE would additionally subject
-- `postgres` to the policies, which breaks every SECURITY DEFINER function,
-- because the definer *is* `postgres`: the function would be subject to the
-- policy it exists to satisfy and would silently write nothing.
--
-- Anonymous customers get no table access at all. Every public write goes
-- through a narrow definer function in the private `app` schema.

create extension if not exists pgcrypto with schema extensions;

-- Private. Nothing here is reachable through the Data API: PostgREST only
-- exposes schemas it is configured for, and `app` is not one of them.
create schema if not exists app;
revoke all on schema app from public, anon, authenticated;

-- ------------------------------------------------------------ enums -------

create type public.organization_status as enum ('active', 'suspended', 'closed');
create type public.member_role as enum ('owner', 'admin', 'member', 'viewer');
create type public.member_status as enum ('invited', 'active', 'suspended', 'removed');
create type public.location_status as enum ('active', 'paused', 'closed');
create type public.stand_type as enum ('printable_qr', 'physical_nfc');
create type public.stand_status as enum ('active', 'paused', 'retired');

-- ---------------------------------------------------------- profiles ------

-- Display metadata only. No password material, no provider tokens — Supabase
-- Auth owns credentials and this table must never become a second copy of them.
create table public.profiles (
    id           uuid primary key references auth.users (id) on delete cascade,
    display_name text check (char_length(display_name) between 1 and 120),
    avatar_url   text,
    locale       text not null default 'en' check (locale ~ '^[a-z]{2}(-[A-Za-z0-9]{2,8})?$'),
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

-- ----------------------------------------------------- organizations ------

create table public.organizations (
    id               uuid primary key default gen_random_uuid(),
    name             text not null check (char_length(name) between 1 and 160),
    slug             text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$'),
    status           public.organization_status not null default 'active',
    timezone         text not null default 'UTC',
    default_locale   text not null default 'en' check (default_locale ~ '^[a-z]{2}(-[A-Za-z0-9]{2,8})?$'),
    -- Uppercase ISO-4217. Money is never a float anywhere in this system; this
    -- records which minor unit integers are counted in.
    default_currency char(3) not null default 'USD' check (default_currency ~ '^[A-Z]{3}$'),
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    -- Closure is a status change. Nothing is hard-deleted while dependent
    -- business history exists.
    closed_at        timestamptz
);

create index organizations_status_idx on public.organizations (status) where status = 'active';

-- ------------------------------------------------ organization members ----

create table public.organization_members (
    id         uuid primary key default gen_random_uuid(),
    org_id     uuid not null references public.organizations (id) on delete cascade,
    user_id    uuid not null references auth.users (id) on delete cascade,
    role       public.member_role not null default 'viewer',
    -- Only 'active' grants access. Every policy checks this, never mere
    -- existence of a row.
    status     public.member_status not null default 'invited',
    joined_at  timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint organization_members_org_user_key unique (org_id, user_id)
);

-- The hot path for every RLS check on every tenant table.
create index organization_members_user_active_idx
    on public.organization_members (user_id, org_id)
    where status = 'active';

create index organization_members_org_idx on public.organization_members (org_id, status);

-- --------------------------------------------------------- locations ------

create table public.locations (
    id                uuid primary key default gen_random_uuid(),
    org_id            uuid not null references public.organizations (id) on delete cascade,
    name              text not null check (char_length(name) between 1 and 160),
    status            public.location_status not null default 'active',

    address_line_1    text,
    address_line_2    text,
    city              text,
    region            text,
    postal_code       text,
    -- Uppercase ISO-3166 alpha-2.
    country_code      char(2) check (country_code ~ '^[A-Z]{2}$'),

    timezone          text not null default 'UTC',
    default_locale    text not null default 'en' check (default_locale ~ '^[a-z]{2}(-[A-Za-z0-9]{2,8})?$'),
    currency          char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),

    -- Optional at registration, and required before a stand can be activated.
    -- Validated in the application against an allowlist of Google hosts: this
    -- value is handed to a customer's browser, so an unvalidated one turns the
    -- business's own printed QR code into an open redirect.
    google_review_url text check (google_review_url is null or google_review_url ~ '^https://'),

    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),

    -- Carries org_id so child tables can reference (id, org_id) and the
    -- database refuses a cross-organization link even if the code asks for one.
    constraint locations_id_org_key unique (id, org_id)
);

create index locations_org_created_idx on public.locations (org_id, created_at desc);
create index locations_org_active_idx on public.locations (org_id) where status = 'active';

-- ----------------------------------------------------- review stands ------

create table public.review_stands (
    id                 uuid primary key default gen_random_uuid(),
    org_id             uuid not null references public.organizations (id) on delete cascade,
    location_id        uuid not null,

    -- The public token is never stored in clear. `public_token_hash` is a keyed
    -- digest computed by the application; `public_token_prefix` is a short
    -- non-secret fragment that lets an owner recognise a stand in a list
    -- without the token being recoverable from the row.
    public_token_hash  text not null unique,
    public_token_prefix text not null check (char_length(public_token_prefix) between 4 and 12),

    label              text not null default 'Front Desk' check (char_length(label) between 1 and 80),
    stand_type         public.stand_type not null default 'printable_qr',
    hardware_reference text,
    status             public.stand_status not null default 'active',

    activated_at       timestamptz,
    last_opened_at     timestamptz,
    token_rotated_at   timestamptz,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),

    -- There is deliberately no review_threshold column, and there never will
    -- be. Every rating receives the same Google opportunity, so there is
    -- nothing for a threshold to decide.

    constraint review_stands_id_org_key unique (id, org_id),
    constraint review_stands_location_fk
        foreign key (location_id, org_id) references public.locations (id, org_id) on delete cascade
);

create index review_stands_org_location_idx on public.review_stands (org_id, location_id, created_at desc);
create index review_stands_active_idx on public.review_stands (org_id) where status = 'active';

-- ------------------------------------------------------ audit events ------

-- Append-only administrative and security evidence. Normal users never update
-- or delete these; the policies in the RLS migration grant select only.
create table public.audit_events (
    id          bigint generated always as identity primary key,
    org_id      uuid references public.organizations (id) on delete cascade,
    actor_user_id uuid references auth.users (id) on delete set null,
    actor_type  text not null default 'user' check (actor_type in ('user', 'system', 'service')),
    action      text not null check (char_length(action) between 1 and 120),
    target_type text,
    target_id   text,
    request_id  text,
    -- Safe metadata only. Never a decrypted note, a customer name, a token, or
    -- any secret value.
    metadata    jsonb not null default '{}'::jsonb,
    created_at  timestamptz not null default now()
);

create index audit_events_org_time_idx on public.audit_events (org_id, created_at desc);

-- --------------------------------------------------------- updated_at -----

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
    for each row execute function app.touch_updated_at();
create trigger organizations_touch before update on public.organizations
    for each row execute function app.touch_updated_at();
create trigger organization_members_touch before update on public.organization_members
    for each row execute function app.touch_updated_at();
create trigger locations_touch before update on public.locations
    for each row execute function app.touch_updated_at();
create trigger review_stands_touch before update on public.review_stands
    for each row execute function app.touch_updated_at();
