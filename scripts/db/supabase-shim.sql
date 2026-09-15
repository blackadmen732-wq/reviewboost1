-- Everything Supabase provides that the migrations reference, and nothing more.
-- Kept deliberately thin: if a migration starts needing something beyond this,
-- that is a real new platform dependency and should show up as a diff here.

create schema if not exists extensions;
create schema if not exists auth;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;
grant usage on schema extensions to anon, authenticated, service_role;

-- Stand-in for Supabase Auth's user table: only the columns migrations touch.
-- Only the columns the migrations and the pgTAP suites actually reference. The
-- real table has many more; adding them here without a caller would be
-- inventing a dependency this project does not have.
create table if not exists auth.users (
  id                  uuid primary key default extensions.gen_random_uuid(),
  instance_id         uuid,
  aud                 varchar(255),
  role                varchar(255),
  email               varchar(255),
  encrypted_password  varchar(255),
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Supabase reads the verified JWT from a GUC, and accepts both shapes: the
-- whole claim set as JSON in `request.jwt.claims`, or one claim at a time in
-- `request.jwt.claim.<name>`. Both are reproduced because the repository uses
-- both -- the pgTAP suites set the JSON object, the SQL suites under scripts/db
-- set the single claim -- and a shim that understood only one would report
-- "authentication required" for half the tests and look like a product bug.
create or replace function auth.uid() returns uuid
language sql stable as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$fn$;

create or replace function auth.role() returns text
language sql stable as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  )
$fn$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
grant select on auth.users to service_role;
