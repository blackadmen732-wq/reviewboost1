-- Deleting an account: who may, and whether it actually removes anything.
--
-- The interesting assertion is the last one. `rpc_delete_organization` issues a
-- single `delete from public.organizations` and relies on every tenant table
-- carrying `org_id ... on delete cascade` to reach the rest. That claim is only
-- as good as the schema, and the schema grows. So rather than listing tables
-- this test asks the catalog for every table with an `org_id` column and
-- insists none of them still holds a row for the deleted business — which means
-- a table added next year with the wrong foreign key fails here rather than
-- silently retaining a phone number after someone asked for it to be gone.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

select plan(25);

create or replace function tests.set_actor(p_user_id uuid) returns void
language plpgsql as $$
begin
    perform set_config('role', 'authenticated', true);
    perform set_config(
        'request.jwt.claims',
        json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
        true);
end $$;

create or replace function tests.set_anonymous() returns void
language plpgsql as $$
begin
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end $$;

create or replace function tests.set_claimless() returns void
language plpgsql as $$
begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function tests.reset_role() returns void
language plpgsql as $$
begin
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
end $$;

grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

select tests.reset_role();

-- ------------------------------------------------------------- seeding ----

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
    ('00000000-1701-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'owner@del.test', 'x', now(), now()),
    ('00000000-1701-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'admin@del.test', 'x', now(), now()),
    ('00000000-1701-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'stranger@del.test', 'x', now(), now());

insert into public.organizations (id, name, slug, status)
values
    ('00000000-1701-0000-0000-000000000001', 'Doomed Diner', 'del-doomed', 'active'),
    ('00000000-1701-0000-0000-000000000002', 'Bystander Cafe', 'del-bystander', 'active');

insert into public.organization_members (org_id, user_id, role, status)
values
    ('00000000-1701-0000-0000-000000000001', '00000000-1701-0000-0000-0000000000a1', 'owner', 'active'),
    ('00000000-1701-0000-0000-000000000001', '00000000-1701-0000-0000-0000000000a2', 'admin', 'active'),
    ('00000000-1701-0000-0000-000000000002', '00000000-1701-0000-0000-0000000000a3', 'owner', 'active');

insert into public.locations (id, org_id, name, google_review_url, status)
values
    ('00000000-1701-0000-0000-000000000011', '00000000-1701-0000-0000-000000000001',
     'Doomed Main', 'https://g.page/r/doomed/review', 'active'),
    ('00000000-1701-0000-0000-000000000012', '00000000-1701-0000-0000-000000000002',
     'Bystander Main', 'https://g.page/r/bystander/review', 'active');

insert into public.review_stands (id, org_id, location_id, public_token_hash, public_token_prefix)
values
    ('00000000-1701-0000-0000-000000000021', '00000000-1701-0000-0000-000000000001',
     '00000000-1701-0000-0000-000000000011', 'del-hash-doomed', 'dldm'),
    ('00000000-1701-0000-0000-000000000022', '00000000-1701-0000-0000-000000000002',
     '00000000-1701-0000-0000-000000000012', 'del-hash-bystander', 'dlby');

insert into public.public_review_sessions
    (id, org_id, location_id, stand_id, session_token_hash, locale, expires_at)
values
    ('00000000-1701-0000-0000-000000000031', '00000000-1701-0000-0000-000000000001',
     '00000000-1701-0000-0000-000000000011', '00000000-1701-0000-0000-000000000021',
     'del-session-doomed', 'en', now() + interval '1 hour');

insert into public.customer_responses
    (id, org_id, location_id, stand_id, session_id, response_token_hash, rating)
values
    ('00000000-1701-0000-0000-000000000041', '00000000-1701-0000-0000-000000000001',
     '00000000-1701-0000-0000-000000000011', '00000000-1701-0000-0000-000000000021',
     '00000000-1701-0000-0000-000000000031', 'del-response-doomed', 5);

-- ------------------------------------------------------- who may not ------

select tests.set_actor('00000000-1701-0000-0000-0000000000a3');

select throws_ok(
    $$ select public.rpc_delete_organization(
           '00000000-1701-0000-0000-000000000001', 'Doomed Diner') $$,
    'P0001',
    'not_found_or_forbidden',
    'another business''s owner cannot delete this one, and is not told it exists');

select tests.set_actor('00000000-1701-0000-0000-0000000000a2');

select throws_ok(
    $$ select public.rpc_delete_organization(
           '00000000-1701-0000-0000-000000000001', 'Doomed Diner') $$,
    'P0001',
    'not_found_or_forbidden',
    'an admin runs the business but cannot end it');

-- Two different refusals for two different callers, and the distinction is
-- the point. A signed-out visitor never reaches the function body: `anon` has
-- no execute grant, so PostgreSQL stops the call at the door. A caller holding
-- the `authenticated` role but no subject claim does reach it, and the
-- `auth.uid() is null` guard is what stops that one. Asserting only the second
-- would leave the grant untested, and the grant is the stronger of the two.
select tests.set_anonymous();

select throws_ok(
    $$ select public.rpc_delete_organization(
           '00000000-1701-0000-0000-000000000001', 'Doomed Diner') $$,
    '42501',
    'permission denied for function rpc_delete_organization',
    'a signed-out visitor cannot even call it');

select tests.set_claimless();

select throws_ok(
    $$ select public.rpc_delete_organization(
           '00000000-1701-0000-0000-000000000001', 'Doomed Diner') $$,
    '42501',
    'authentication required',
    'the authenticated role without a subject is refused inside the function');

select tests.reset_role();

-- --------------------------------------------- the confirmation matters ---

select tests.set_actor('00000000-1701-0000-0000-0000000000a1');

select throws_ok(
    $$ select public.rpc_delete_organization(
           '00000000-1701-0000-0000-000000000001', 'Bystander Cafe') $$,
    'P0001',
    'confirmation_mismatch',
    'the owner typing some other business name deletes nothing');

select throws_ok(
    $$ select public.rpc_delete_organization(
           '00000000-1701-0000-0000-000000000001', null) $$,
    'P0001',
    'confirmation_mismatch',
    'a missing confirmation is a mismatch, not a bypass');

select ok(
    exists (select 1 from public.organizations
             where id = '00000000-1701-0000-0000-000000000001'),
    'four refused attempts later the business is still there');

-- ------------------------------------- the check that runs before Stripe ---
-- rpc_delete_organization_check gives the route the same refusals before it
-- cancels a subscription, and deletes nothing.

select throws_ok(
    $$ select public.rpc_delete_organization_check(
           '00000000-1701-0000-0000-000000000001', 'Bystander Cafe') $$,
    'P0001',
    'confirmation_mismatch',
    'the pre-check refuses the wrong name, so the route never reaches Stripe');

select lives_ok(
    $$ select public.rpc_delete_organization_check(
           '00000000-1701-0000-0000-000000000001', '  doomed DINER ') $$,
    'the pre-check accepts what the deletion accepts');

select ok(
    exists (select 1 from public.organizations
             where id = '00000000-1701-0000-0000-000000000001'),
    'a passing pre-check deletes nothing');

select tests.set_actor('00000000-1701-0000-0000-0000000000a2');

select throws_ok(
    $$ select public.rpc_delete_organization_check(
           '00000000-1701-0000-0000-000000000001', 'Doomed Diner') $$,
    'P0001',
    'not_found_or_forbidden',
    'the pre-check refuses an admin, like the deletion');

select tests.set_actor('00000000-1701-0000-0000-0000000000a3');

select throws_ok(
    $$ select public.rpc_delete_organization_check(
           '00000000-1701-0000-0000-000000000001', 'Doomed Diner') $$,
    'P0001',
    'not_found_or_forbidden',
    'the pre-check refuses another business''s owner, like the deletion');

-- The Stripe ids are for the service role only, through `public` so the Data
-- API can reach them.
select throws_ok(
    $$ select * from public.rpc_billing_refs_for_org('00000000-1701-0000-0000-000000000001') $$,
    '42501',
    'permission denied for function rpc_billing_refs_for_org',
    'a signed-in user cannot read anyone''s Stripe ids');

select tests.reset_role();
set local role service_role;

select lives_ok(
    $$ select * from public.rpc_billing_refs_for_org('00000000-1701-0000-0000-000000000001') $$,
    'the service role reads the Stripe ids through public');

select tests.reset_role();
select tests.set_actor('00000000-1701-0000-0000-0000000000a1');

select lives_ok(
    $$ select public.rpc_delete_organization(
           '00000000-1701-0000-0000-000000000001', '  doomed DINER ') $$,
    'case and surrounding space do not matter: the check is for deliberateness');

-- ------------------------------------------------------------ the result --

select tests.reset_role();

select ok(
    not exists (select 1 from public.organizations
                 where id = '00000000-1701-0000-0000-000000000001'),
    'the organization row is gone, not flagged closed');

select ok(
    not exists (select 1 from public.customer_responses
                 where id = '00000000-1701-0000-0000-000000000041'),
    'the ratings went with it');

select ok(
    not exists (select 1 from public.review_stands
                 where id = '00000000-1701-0000-0000-000000000021'),
    'the Tags went with it');

select ok(
    not exists (select 1 from public.organization_members
                 where org_id = '00000000-1701-0000-0000-000000000001'),
    'so did every membership, including the admin who could not do this');

-- The neighbour is the control. A delete that takes the wrong tenant with it
-- is the failure this whole codebase's RLS design exists to prevent, and it
-- would be invisible in any test that only looked at the deleted business.
select ok(
    exists (select 1 from public.organizations
             where id = '00000000-1701-0000-0000-000000000002'),
    'the business next door is untouched');

select ok(
    exists (select 1 from public.review_stands
             where id = '00000000-1701-0000-0000-000000000022'),
    'and so are its Tags');

-- ------------------------------------------------------------- tombstone --

select is(
    (select removed->>'ratings' from public.account_deletions
      where org_id = '00000000-1701-0000-0000-000000000001'),
    '1',
    'the tombstone counted the ratings before they went');

select is(
    (select actor_user_id from public.account_deletions
      where org_id = '00000000-1701-0000-0000-000000000001'),
    '00000000-1701-0000-0000-0000000000a1'::uuid,
    'and recorded who asked');

-- ------------------------------------------------- the cascade, in full ---

-- Asked of the catalog rather than of a list someone maintains, so that a
-- table added later with the wrong foreign key fails here instead of quietly
-- retaining a phone number after somebody asked for it to be gone.
--
-- This is a loop rather than one clever select on purpose. The first version
-- put `query_to_xml(format('select count(*) ... from public.%I', table_name))`
-- in the select list beside a `where column_name = 'org_id'` filter, and
-- PostgreSQL evaluated the function against tables the filter was supposed to
-- have excluded — it errored on `sms_phone_optout`, which has no org_id at
-- all. SQL does not promise that a WHERE clause runs before the select list.
-- A loop does.
create or replace function tests.tables_still_holding(p_org_id uuid)
returns text
language plpgsql as $$
declare
    r       record;
    n       bigint;
    holding text[] := '{}';
begin
    for r in
        select c.relname
          from pg_class c
          join pg_namespace ns on ns.oid = c.relnamespace
          join pg_attribute a on a.attrelid = c.oid
         where ns.nspname = 'public'
           and c.relkind = 'r'
           and a.attname = 'org_id'
           and not a.attisdropped
           -- The tombstone's whole purpose is to outlive the row it names.
           and c.relname <> 'account_deletions'
         order by c.relname
    loop
        execute format('select count(*) from public.%I where org_id = $1', r.relname)
           into n
          using p_org_id;
        if n > 0 then
            holding := holding || format('%s(%s)', r.relname, n);
        end if;
    end loop;

    return array_to_string(holding, ', ');
end $$;

select is(
    tests.tables_still_holding('00000000-1701-0000-0000-000000000001'),
    '',
    'no table in the schema still holds a row for the deleted business');

-- The same sweep against the neighbour proves the sweep can actually see
-- rows. Without this, a sweep that silently looked at nothing would pass.
select isnt(
    tests.tables_still_holding('00000000-1701-0000-0000-000000000002'),
    '',
    'and the sweep is looking: the business next door still has rows');

select * from finish();

rollback;
