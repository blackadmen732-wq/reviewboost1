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
create table if not exists auth.users (
  id                  uuid primary key default extensions.gen_random_uuid(),
  email               text,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- Supabase reads the verified JWT from a GUC. Tests set request.jwt.claim.sub
-- to impersonate a user, which is how the real function behaves.
create or replace function auth.uid() returns uuid
language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;

create or replace function auth.role() returns text
language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$fn$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
grant select on auth.users to service_role;
