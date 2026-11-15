-- A retired Tag that comes back counts against the plan.
--
-- Creating a Tag is capped by the plan. Before 20261115000100, bringing a
-- retired Tag back was not: retire one, create one, reactivate the first, and a
-- Starter business (3 Tags) served customers from 4, then 5, then any number.
-- These cases run as the signed-in owner, the way the attack would.
--
-- Cases 1, 2, 3, 10 and 11 fail against the previous `rpc_update_stand`.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

-- ------------------------------------------------------------- helpers ------

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql as $$
begin
    perform set_config('role', 'authenticated', true);
    perform set_config(
        'request.jwt.claims',
        json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
        true);
end $$;

create or replace function pg_temp.as_postgres() returns void
language plpgsql as $$
begin
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.tag_status(p_id uuid) returns text
language sql as $$
    select status::text from public.review_stands where id = p_id;
$$;

create or replace function pg_temp.tags_holding_a_slot(p_org uuid) returns integer
language sql as $$
    select count(*)::integer from public.review_stands
     where org_id = p_org and status <> 'retired';
$$;

-- ------------------------------------------------------------- fixtures -----

select pg_temp.as_postgres();

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('00000000-7ac0-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'owner@tagcap.test', 'x', now(), now());

-- A: Starter, paid (3 Tags). B: Starter, cancelled (0). C: never subscribed (1, for setup).
insert into public.organizations (id, name, slug, status)
values
    ('00000000-7ac0-0000-0000-000000000001', 'Paid Starter', 'tagcap-paid', 'active'),
    ('00000000-7ac0-0000-0000-000000000002', 'Cancelled',    'tagcap-cancelled', 'active'),
    ('00000000-7ac0-0000-0000-000000000003', 'New Business', 'tagcap-new', 'active');

insert into public.organization_members (org_id, user_id, role, status)
select o, '00000000-7ac0-0000-0000-0000000000a1', 'owner', 'active'
  from unnest(array['00000000-7ac0-0000-0000-000000000001',
                    '00000000-7ac0-0000-0000-000000000002',
                    '00000000-7ac0-0000-0000-000000000003']::uuid[]) as o;

update public.entitlement_snapshots
   set plan_id = 'starter', status = 'active', source = 'test:tag-cap'
 where org_id = '00000000-7ac0-0000-0000-000000000001';
update public.entitlement_snapshots
   set plan_id = 'starter', status = 'cancelled', source = 'test:tag-cap'
 where org_id = '00000000-7ac0-0000-0000-000000000002';

insert into public.locations (id, org_id, name, google_review_url, status)
values
    ('00000000-7ac0-0000-0000-000000000011', '00000000-7ac0-0000-0000-000000000001',
     'A Main', 'https://g.page/r/tagcapa/review', 'active'),
    ('00000000-7ac0-0000-0000-000000000012', '00000000-7ac0-0000-0000-000000000002',
     'B Main', 'https://g.page/r/tagcapb/review', 'active'),
    ('00000000-7ac0-0000-0000-000000000013', '00000000-7ac0-0000-0000-000000000003',
     'C Main', 'https://g.page/r/tagcapc/review', 'active');

-- A holds its 3 slots, plus one retired Tag. B and C each have a retired Tag.
insert into public.review_stands
    (id, org_id, location_id, public_token_hash, public_token_prefix, status, public_token_key_version)
values
    ('00000000-7ac0-0000-0000-0000000000a1', '00000000-7ac0-0000-0000-000000000001',
     '00000000-7ac0-0000-0000-000000000011', 'tagcap-hash-a1', 'tca00001', 'active', 1),
    ('00000000-7ac0-0000-0000-0000000000a2', '00000000-7ac0-0000-0000-000000000001',
     '00000000-7ac0-0000-0000-000000000011', 'tagcap-hash-a2', 'tca00002', 'active', 1),
    ('00000000-7ac0-0000-0000-0000000000a3', '00000000-7ac0-0000-0000-000000000001',
     '00000000-7ac0-0000-0000-000000000011', 'tagcap-hash-a3', 'tca00003', 'active', 1),
    ('00000000-7ac0-0000-0000-0000000000a4', '00000000-7ac0-0000-0000-000000000001',
     '00000000-7ac0-0000-0000-000000000011', 'tagcap-hash-a4', 'tca00004', 'retired', 1),
    ('00000000-7ac0-0000-0000-0000000000b1', '00000000-7ac0-0000-0000-000000000002',
     '00000000-7ac0-0000-0000-000000000012', 'tagcap-hash-b1', 'tcb00001', 'retired', 1),
    ('00000000-7ac0-0000-0000-0000000000b2', '00000000-7ac0-0000-0000-000000000002',
     '00000000-7ac0-0000-0000-000000000012', 'tagcap-hash-b2', 'tcb00002', 'active', 1),
    ('00000000-7ac0-0000-0000-0000000000c1', '00000000-7ac0-0000-0000-000000000003',
     '00000000-7ac0-0000-0000-000000000013', 'tagcap-hash-c1', 'tcc00001', 'retired', 1);

select pg_temp.act_as('00000000-7ac0-0000-0000-0000000000a1');

-- ----------------------------------------------- at the limit: refused ------

-- 1
select throws_ok(
    $$select public.rpc_update_stand('00000000-7ac0-0000-0000-0000000000a4', null, 'active')$$,
    'P0001', 'tag_limit_reached',
    'a retired Tag cannot come back while the plan''s 3 slots are full');

-- 2
select is(pg_temp.tag_status('00000000-7ac0-0000-0000-0000000000a4'), 'retired',
    'and it stays retired');

-- 3
select throws_ok(
    $$select public.rpc_update_stand('00000000-7ac0-0000-0000-0000000000a4', null, 'paused')$$,
    'P0001', 'tag_limit_reached',
    'coming back paused also takes a slot, so it is refused too');

-- -------------------------------------- changes that add nothing: allowed ---

-- 4
select lives_ok(
    $$select public.rpc_update_stand('00000000-7ac0-0000-0000-0000000000a4', 'Old counter', null)$$,
    'a retired Tag can still be renamed');

-- 5
select lives_ok(
    $$select public.rpc_update_stand('00000000-7ac0-0000-0000-0000000000a1', null, 'paused')$$,
    'pausing an active Tag at the limit is allowed');

-- 6
select lives_ok(
    $$select public.rpc_update_stand('00000000-7ac0-0000-0000-0000000000a1', null, 'active')$$,
    'and resuming it is allowed: a paused Tag already holds its slot');

-- -------------------------------------------- a free slot: allowed ----------

-- 7
select lives_ok(
    $$select public.rpc_update_stand('00000000-7ac0-0000-0000-0000000000a3', null, 'retired')$$,
    'retiring a Tag frees a slot');

-- 8
select lives_ok(
    $$select public.rpc_update_stand('00000000-7ac0-0000-0000-0000000000a4', null, 'active')$$,
    'so a retired Tag can come back into it');

-- 9
select is(pg_temp.tags_holding_a_slot('00000000-7ac0-0000-0000-000000000001'), 3,
    'the business is back at exactly its 3 Tags');

-- 10
select throws_ok(
    $$select public.rpc_update_stand('00000000-7ac0-0000-0000-0000000000a3', null, 'active')$$,
    'P0001', 'tag_limit_reached',
    'and the Tag it swapped out cannot come back as a fourth');

-- ------------------------------------------------ plan state ----------------

-- 11
select throws_ok(
    $$select public.rpc_update_stand('00000000-7ac0-0000-0000-0000000000b1', null, 'active')$$,
    'P0001', 'entitlement_inactive',
    'a cancelled business cannot bring a retired Tag back');

-- 12
select lives_ok(
    $$select public.rpc_update_stand('00000000-7ac0-0000-0000-0000000000b2', null, 'retired')$$,
    'but it can still retire one');

-- 13
select lives_ok(
    $$select public.rpc_update_stand('00000000-7ac0-0000-0000-0000000000c1', null, 'active')$$,
    'a business setting up before paying gets its one Tag back, as creating would allow');

-- 14
select is(pg_temp.tags_holding_a_slot('00000000-7ac0-0000-0000-000000000003'), 1,
    'and only that one');

select pg_temp.as_postgres();

select * from finish();

rollback;
