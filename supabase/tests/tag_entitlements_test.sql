-- Atomic Tag entitlement enforcement.
--
-- Proves that the database, not the owner UI, is authoritative for Tag caps.
-- The entitlement row is the serialization lock, so concurrent create paths
-- cannot both pass a stale pre-check. This is pre-billing infrastructure only:
-- no Stripe, trial clock, or SMS allowance is created here.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

select plan(20);

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

create or replace function tests.entitlement_ciphertext() returns text
language sql immutable as $$
    select 'v1:ABCDEFGHIJKLMNOP:QRSTUVWXYZabcdefghijklmn:opqrstuvwxyzABCDEFGHIJKLMNOPQR';
$$;

grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

-- ------------------------------------------------------------- schema -----

select has_table('public', 'entitlement_snapshots', 'entitlement snapshot table exists');

select ok(
    not has_table_privilege('authenticated', 'public.entitlement_snapshots', 'INSERT'),
    'authenticated clients cannot mint entitlement snapshots');

-- ------------------------------------------------------------ fixtures ----

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
    ('71000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'tag-ent-owner@test.com', '', now(), now());

insert into public.organizations (id, name, slug)
values ('72000000-0000-0000-0000-000000000001', 'Tag Entitlement Org', 'tag-entitlement-org');

insert into public.organization_members (org_id, user_id, role, status)
values ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 'owner', 'active');

insert into public.locations (id, org_id, name)
values ('73000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', 'Main');

-- Organization INSERT trigger must create an honest trialing snapshot. No paid
-- Starter fallback and no implied selected plan.
select results_eq(
    $$ select status || ':' || coalesce(plan_id, 'NULL')
         from public.entitlement_snapshots
        where org_id = '72000000-0000-0000-0000-000000000001' $$,
    array['trialing:NULL']::text[],
    'new organizations start trialing with no silently assumed paid plan');

-- --------------------------------------------------------- limit mapping --

select is(app.entitlement_tag_limit(null, 'trialing'), 1, 'trial allows one Tag');
select is(app.entitlement_tag_limit('starter', 'active'), 3, 'Starter allows three Tags');
select is(app.entitlement_tag_limit('growth', 'active'), 8, 'Growth allows eight Tags');
select is(app.entitlement_tag_limit('pro', 'active'), 25, 'Pro allows twenty-five Tags');
select is(app.entitlement_tag_limit('starter', 'past_due'), 0, 'past_due allows no new Tags');
select is(app.entitlement_tag_limit('starter', 'cancelled'), 0, 'cancelled allows no new Tags');
select is(app.entitlement_tag_limit('starter', 'suspended'), 0, 'suspended allows no new Tags');

-- ------------------------------------------------------------- trial cap --

select tests.set_actor('71000000-0000-0000-0000-000000000001');

select lives_ok(
    $$ select public.rpc_create_stand(
        '72000000-0000-0000-0000-000000000001',
        '73000000-0000-0000-0000-000000000001',
        'Trial Tag 1',
        'tag-ent-hash-000000000000000000000000000001',
        'tent0001',
        1::smallint,
        'tag-ent-req-0001',
        tests.entitlement_ciphertext(),
        1::smallint) $$,
    'trial can create its first Tag');

select throws_ok(
    $$ select public.rpc_create_stand(
        '72000000-0000-0000-0000-000000000001',
        '73000000-0000-0000-0000-000000000001',
        'Trial Tag 2',
        'tag-ent-hash-000000000000000000000000000002',
        'tent0002',
        1::smallint,
        'tag-ent-req-0002',
        tests.entitlement_ciphertext(),
        1::smallint) $$,
    'P0001',
    'tag_limit_reached',
    'trial cannot bypass the one-Tag cap by calling the RPC directly');

-- ----------------------------------------------------------- paid limits --

select tests.set_service();
update public.entitlement_snapshots
   set plan_id = 'starter', status = 'active', source = 'test', updated_at = now()
 where org_id = '72000000-0000-0000-0000-000000000001';
select tests.set_actor('71000000-0000-0000-0000-000000000001');

select lives_ok(
    $$ select public.rpc_create_stand(
        '72000000-0000-0000-0000-000000000001',
        '73000000-0000-0000-0000-000000000001',
        'Starter Tag 2',
        'tag-ent-hash-000000000000000000000000000003',
        'tent0003',
        1::smallint,
        'tag-ent-req-0003',
        tests.entitlement_ciphertext(),
        1::smallint) $$,
    'Starter can create Tag two');

select lives_ok(
    $$ select public.rpc_create_stand(
        '72000000-0000-0000-0000-000000000001',
        '73000000-0000-0000-0000-000000000001',
        'Starter Tag 3',
        'tag-ent-hash-000000000000000000000000000004',
        'tent0004',
        1::smallint,
        'tag-ent-req-0004',
        tests.entitlement_ciphertext(),
        1::smallint) $$,
    'Starter can create Tag three');

select throws_ok(
    $$ select public.rpc_create_stand(
        '72000000-0000-0000-0000-000000000001',
        '73000000-0000-0000-0000-000000000001',
        'Starter Tag 4',
        'tag-ent-hash-000000000000000000000000000005',
        'tent0005',
        1::smallint,
        'tag-ent-req-0005',
        tests.entitlement_ciphertext(),
        1::smallint) $$,
    'P0001',
    'tag_limit_reached',
    'Starter N+1 fails inside the create transaction');

-- Paused Tags still consume a slot; only retired Tags free one.
select tests.set_service();
update public.review_stands
   set status = 'paused'
 where public_token_hash = 'tag-ent-hash-000000000000000000000000000003';
select tests.set_actor('71000000-0000-0000-0000-000000000001');

select throws_ok(
    $$ select public.rpc_create_stand(
        '72000000-0000-0000-0000-000000000001',
        '73000000-0000-0000-0000-000000000001',
        'Paused Does Not Free Slot',
        'tag-ent-hash-000000000000000000000000000006',
        'tent0006',
        1::smallint,
        'tag-ent-req-0006',
        tests.entitlement_ciphertext(),
        1::smallint) $$,
    'P0001',
    'tag_limit_reached',
    'paused Tag still counts toward the cap');

select tests.set_service();
update public.review_stands
   set status = 'retired'
 where public_token_hash = 'tag-ent-hash-000000000000000000000000000003';
select tests.set_actor('71000000-0000-0000-0000-000000000001');

select lives_ok(
    $$ select public.rpc_create_stand(
        '72000000-0000-0000-0000-000000000001',
        '73000000-0000-0000-0000-000000000001',
        'Retired Frees Slot',
        'tag-ent-hash-000000000000000000000000000007',
        'tent0007',
        1::smallint,
        'tag-ent-req-0007',
        tests.entitlement_ciphertext(),
        1::smallint) $$,
    'retiring a Tag frees its slot');

-- ---------------------------------------------------- suspended / missing --

select tests.set_service();
update public.entitlement_snapshots
   set status = 'suspended', source = 'test', updated_at = now()
 where org_id = '72000000-0000-0000-0000-000000000001';
select tests.set_actor('71000000-0000-0000-0000-000000000001');

select throws_ok(
    $$ select public.rpc_create_stand(
        '72000000-0000-0000-0000-000000000001',
        '73000000-0000-0000-0000-000000000001',
        'Suspended Tag',
        'tag-ent-hash-000000000000000000000000000008',
        'tent0008',
        1::smallint,
        'tag-ent-req-0008',
        tests.entitlement_ciphertext(),
        1::smallint) $$,
    'P0001',
    'entitlement_inactive',
    'suspended organization cannot create a Tag');

select tests.set_service();
delete from public.entitlement_snapshots
 where org_id = '72000000-0000-0000-0000-000000000001';
select tests.set_actor('71000000-0000-0000-0000-000000000001');

select throws_ok(
    $$ select public.rpc_create_stand(
        '72000000-0000-0000-0000-000000000001',
        '73000000-0000-0000-0000-000000000001',
        'Missing Entitlement Tag',
        'tag-ent-hash-000000000000000000000000000009',
        'tent0009',
        1::smallint,
        'tag-ent-req-0009',
        tests.entitlement_ciphertext(),
        1::smallint) $$,
    'P0001',
    'entitlement_missing',
    'missing entitlement fails closed instead of becoming Starter/active');

-- ------------------------------------------------------ NFC after rotate --
-- Restore the snapshot so rotation test is independent of the missing-row case.
select tests.set_service();
insert into public.entitlement_snapshots (org_id, plan_id, status, source)
values ('72000000-0000-0000-0000-000000000001', 'starter', 'active', 'test');

update public.review_stands
   set nfc_provisioned_at = now(),
       nfc_provisioned_by = '71000000-0000-0000-0000-000000000001'
 where public_token_hash = 'tag-ent-hash-000000000000000000000000000001';

select tests.set_actor('71000000-0000-0000-0000-000000000001');

select lives_ok(
    $$ select public.rpc_rotate_stand_token(
        (select id from public.review_stands
          where public_token_hash = 'tag-ent-hash-000000000000000000000000000001'),
        '72000000-0000-0000-0000-000000000001',
        'tag-ent-hash-rotated-000000000000000000000001',
        'tentrot1',
        1::smallint,
        'tag-ent-rotate-req',
        tests.entitlement_ciphertext(),
        1::smallint) $$,
    'owner can rotate the Tag token');

select results_eq(
    $$ select (nfc_provisioned_at is null and nfc_provisioned_by is null)
         from public.review_stands
        where public_token_hash = 'tag-ent-hash-rotated-000000000000000000000001' $$,
    array[true],
    'token rotation invalidates server-side NFC provisioning state');

select * from finish();
rollback;
