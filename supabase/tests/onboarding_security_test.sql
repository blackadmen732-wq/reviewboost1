-- Onboarding security regression tests.
--
-- Proves that public.rpc_create_organization is a SECURITY DEFINER wrapper over
-- the PRIVATE app.create_organization_with_first_stand, so an authenticated
-- caller can complete onboarding without any direct access to the app schema.
-- Guards the regression fixed by
-- 20260901213000_restore_rpc_create_organization_definer, where the wrapper had
-- been recreated as SECURITY INVOKER and onboarding failed with 42501.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

select plan(14);

-- ------------------------------------------------------------- fixtures ----

create or replace function tests.set_actor(p_user_id uuid) returns void
language plpgsql as $$
begin
    perform set_config('role', 'authenticated', true);
    perform set_config(
        'request.jwt.claims',
        json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
        true);
end $$;

create or replace function tests.set_service() returns void
language plpgsql as $$
begin
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
end $$;

grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

-- Two brand-new owners, each with zero existing organizations.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
    ('11110000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'onb-owner-a@test.com', '', now(), now()),
    ('11110000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'onb-owner-b@test.com', '', now(), now());

-- ============================================================
-- 1. Wrapper is SECURITY DEFINER (the core of the fix)
-- ============================================================

select results_eq(
    $$ select prosecdef from pg_proc
       where oid = 'public.rpc_create_organization(text, text, text, text, text, text, text, text, text, smallint, text, text, smallint)'::regprocedure $$,
    array[true],
    'public.rpc_create_organization is SECURITY DEFINER');

-- ============================================================
-- 2-3. Wrapper grants: anon no, authenticated yes
-- ============================================================

select ok(
    not has_function_privilege('anon',
        'public.rpc_create_organization(text, text, text, text, text, text, text, text, text, smallint, text, text, smallint)', 'EXECUTE'),
    'anon cannot execute public.rpc_create_organization');

select ok(
    has_function_privilege('authenticated',
        'public.rpc_create_organization(text, text, text, text, text, text, text, text, text, smallint, text, text, smallint)', 'EXECUTE'),
    'authenticated can execute public.rpc_create_organization');

-- ============================================================
-- 4-6. Private app.* function stays private
-- ============================================================

select ok(
    not has_function_privilege('authenticated',
        'app.create_organization_with_first_stand(text, text, text, text, text, text, text, text, text, smallint, text, text, smallint)', 'EXECUTE'),
    'authenticated cannot directly execute the private app function');

select ok(
    not has_function_privilege('anon',
        'app.create_organization_with_first_stand(text, text, text, text, text, text, text, text, text, smallint, text, text, smallint)', 'EXECUTE'),
    'anon cannot directly execute the private app function');

select ok(
    not has_function_privilege('public',
        'app.create_organization_with_first_stand(text, text, text, text, text, text, text, text, text, smallint, text, text, smallint)', 'EXECUTE'),
    'PUBLIC cannot directly execute the private app function');

-- ============================================================
-- 7. No cross-tenant weakening: app schema stays closed to anon
-- ============================================================

select ok(
    not has_schema_privilege('anon', 'app', 'USAGE'),
    'anon still has no USAGE on the app schema');

-- ============================================================
-- 8-12. A real authenticated onboarding call is atomic
-- ============================================================

select tests.set_actor('11110000-0000-0000-0000-000000000001');

select lives_ok(
    $$ select public.rpc_create_organization(
        'Onboarding Cafe', 'onb-cafe-a', 'UTC', 'en', 'Onb Main',
        'https://g.page/r/onbcafe/review', 'onb-hash-a', 'onbpfxa', 'Onb Stand',
        1::smallint, 'onb-req-a', 'v1:enc-onb-token-a', 1::smallint) $$,
    'authenticated onboarding call succeeds via the SECURITY DEFINER wrapper');

select tests.set_service();

select results_eq(
    $$ select count(*)::integer from public.organizations where slug = 'onb-cafe-a' $$,
    array[1],
    'onboarding created the organization');

select results_eq(
    $$ select count(*)::integer
       from public.organization_members m
       join public.organizations o on o.id = m.org_id
       where o.slug = 'onb-cafe-a'
         and m.user_id = '11110000-0000-0000-0000-000000000001'
         and m.role = 'owner' and m.status = 'active' $$,
    array[1],
    'onboarding created an owner membership for the caller');

select results_eq(
    $$ select count(*)::integer
       from public.locations l
       join public.organizations o on o.id = l.org_id
       where o.slug = 'onb-cafe-a' and l.name = 'Onb Main' $$,
    array[1],
    'onboarding created the first location');

select results_eq(
    $$ select count(*)::integer
       from public.review_stands s
       join public.organizations o on o.id = s.org_id
       where o.slug = 'onb-cafe-a' and s.label = 'Onb Stand' $$,
    array[1],
    'onboarding created the first stand');

-- ============================================================
-- 13-14. Skipping the Google review URL works ("I will do this later")
-- ============================================================

select tests.set_actor('11110000-0000-0000-0000-000000000002');

select lives_ok(
    $$ select public.rpc_create_organization(
        'Skip Google Cafe', 'onb-cafe-b', 'UTC', 'en', 'Skip Main',
        null, 'onb-hash-b', 'onbpfxb', 'Skip Stand',
        1::smallint, 'onb-req-b', 'v1:enc-onb-token-b', 1::smallint) $$,
    'onboarding succeeds when the Google review URL is skipped (null)');

select tests.set_service();

select results_eq(
    $$ select l.google_review_url is null
       from public.locations l
       join public.organizations o on o.id = l.org_id
       where o.slug = 'onb-cafe-b' and l.name = 'Skip Main' $$,
    array[true],
    'a skipped Google review URL is stored as null');

select * from finish();

rollback;
