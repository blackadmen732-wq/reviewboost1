-- Entitlement tests: what a business may do, and who decides.
--
-- The rules under test are product rules, not implementation details. There is
-- no free plan; a missing entitlement is a closed door, not a generous default;
-- caps are counted by the database, so an HTTP pre-check cannot be bypassed;
-- and payment state opens and closes the public door without deleting anything.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

select plan(48);

-- ------------------------------------------------------------- helpers ------

create or replace function tests.set_actor(p_user_id uuid) returns void
language plpgsql as $$
begin
    perform set_config('role', 'authenticated', true);
    perform set_config(
        'request.jwt.claims',
        json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
        true);
end $$;

create or replace function tests.set_service_role() returns void
language plpgsql as $$
begin
    perform set_config('role', 'service_role', true);
    perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function tests.reset_role() returns void
language plpgsql as $$
begin
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
end $$;

-- A ciphertext in the exact envelope `encrypt()` writes.
create or replace function tests.envelope(p_seed text) returns text
language sql immutable as $$
    select 'v1:' || encode(convert_to('iv-' || p_seed, 'UTF8'), 'base64')
              || ':' || encode(convert_to('ct-' || p_seed || '-padding', 'UTF8'), 'base64')
              || ':' || encode(convert_to('tag-' || p_seed, 'UTF8'), 'base64');
$$;

grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

-- ------------------------------------------------------------- fixtures -----

select tests.reset_role();

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
    ('00000000-e001-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'owner@ent.test', 'x', now(), now()),
    ('00000000-e001-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'member@ent.test', 'x', now(), now());

insert into public.organizations (id, name, slug, status)
values
    ('00000000-e001-0000-0000-000000000001', 'Trial Co', 'trial-co', 'active'),
    ('00000000-e001-0000-0000-000000000002', 'Starter Co', 'starter-co', 'active'),
    ('00000000-e001-0000-0000-000000000003', 'Lapsed Co', 'lapsed-co', 'active');

insert into public.organization_members (org_id, user_id, role, status)
values
    ('00000000-e001-0000-0000-000000000001', '00000000-e001-0000-0000-0000000000a1', 'owner', 'active'),
    ('00000000-e001-0000-0000-000000000001', '00000000-e001-0000-0000-0000000000a2', 'member', 'active'),
    ('00000000-e001-0000-0000-000000000002', '00000000-e001-0000-0000-0000000000a1', 'owner', 'active'),
    ('00000000-e001-0000-0000-000000000003', '00000000-e001-0000-0000-0000000000a1', 'owner', 'active');

-- A trial is something Stripe starts: a chosen plan, a card, and an end date.
-- Signing up grants none of it, so a test that wants a trialing business has
-- to start one — which is the contract, not a workaround for it.
update public.entitlement_snapshots
   set plan_id = 'starter', status = 'trialing',
       trial_ends_at = now() + interval '7 days', source = 'test:trial'
 where org_id in ('00000000-e001-0000-0000-000000000001',
                  '00000000-e001-0000-0000-000000000003');

insert into public.locations (id, org_id, name, google_review_url, status)
values
    ('00000000-e001-0000-0000-000000000011', '00000000-e001-0000-0000-000000000001',
     'Trial Main', 'https://g.page/r/trial/review', 'active'),
    ('00000000-e001-0000-0000-000000000012', '00000000-e001-0000-0000-000000000002',
     'Starter Main', 'https://g.page/r/starter/review', 'active'),
    ('00000000-e001-0000-0000-000000000013', '00000000-e001-0000-0000-000000000003',
     'Lapsed Main', 'https://g.page/r/lapsed/review', 'active');

insert into public.review_stands (id, org_id, location_id, public_token_hash, public_token_prefix, status, public_token_key_version)
values ('00000000-e001-0000-0000-000000000021', '00000000-e001-0000-0000-000000000003',
        '00000000-e001-0000-0000-000000000013', 'lapsed-token-hash', 'ent00001', 'active', 1);

-- ============================================================
-- 1. EVERY ORGANIZATION HAS AN ANSWER, AND IT IS NOT "FREE"
-- ============================================================

-- Starter Co has not been touched by the fixture above: it is an organization
-- exactly as creating one leaves it.
select is(
    (select status from public.entitlement_snapshots
      where org_id = '00000000-e001-0000-0000-000000000002'),
    'suspended',
    'a new organization serves nobody until it has been through checkout');

select is(
    (select plan_id from public.entitlement_snapshots
      where org_id = '00000000-e001-0000-0000-000000000002'),
    null,
    'a new organization is NOT given a paid plan it never chose');

select throws_ok(
    $$update public.entitlement_snapshots
         set status = 'trialing', trial_ends_at = null
       where org_id = '00000000-e001-0000-0000-000000000002'$$,
    '23514',
    null,
    'a trial with no end is the free plan this product does not have');

select is(
    (select count(*)::int from public.entitlement_snapshots
      where org_id in ('00000000-e001-0000-0000-000000000001',
                       '00000000-e001-0000-0000-000000000002',
                       '00000000-e001-0000-0000-000000000003')),
    3,
    'entitlement state is created in the same transaction as the organization');

select throws_ok(
    $$insert into public.entitlement_snapshots (org_id, plan_id, status, source)
      values ('00000000-e001-0000-0000-000000000001', null, 'active', 'test')
      on conflict (org_id) do update set plan_id = null, status = 'active'$$,
    '23514',
    null,
    'a paid status cannot exist without a plan');

-- ============================================================
-- 2. THE LOCKED LIMITS
-- ============================================================

select is(app.entitlement_tag_limit(null, 'trialing'), 1, 'trial: 1 Tag');
select is(app.entitlement_tag_limit('starter', 'active'), 3, 'Starter: 3 Tags');
select is(app.entitlement_tag_limit('growth', 'active'), 8, 'Growth: 8 Tags');
select is(app.entitlement_tag_limit('pro', 'active'), 25, 'Pro: 25 Tags');
select is(app.entitlement_location_limit(null, 'trialing'), 1, 'trial: 1 location');
select is(app.entitlement_location_limit('starter', 'active'), 1, 'Starter: 1 location');
select is(app.entitlement_location_limit('growth', 'active'), 2, 'Growth: 2 locations');
select is(app.entitlement_location_limit('pro', 'active'), 5, 'Pro: 5 locations');
select is(app.entitlement_monthly_sms('starter'), 150, 'Starter: 150 monthly SMS segments');
select is(app.entitlement_monthly_sms('growth'), 500, 'Growth: 500 monthly SMS segments');
select is(app.entitlement_monthly_sms('pro'), 1500, 'Pro: 1500 monthly SMS segments');
select is(app.entitlement_monthly_sms(null), 0, 'a trial gets no SMS at all');

-- An unknown plan is worth nothing, rather than defaulting to the cheapest
-- paid tier. "Not Starter" is the whole point.
select is(app.entitlement_tag_limit('enterprise', 'active'), 0, 'an unknown plan grants no Tags');
select is(app.entitlement_tag_limit('starter', 'cancelled'), 0, 'a cancelled Starter grants no new Tags');
select is(app.entitlement_tag_limit('starter', 'suspended'), 0, 'a suspended Starter grants no new Tags');
select is(app.entitlement_tag_limit('starter', 'past_due'), 0, 'a past-due Starter grants no new Tags');
select is(app.entitlement_location_limit(null, null), 0, 'no entitlement grants nothing');

-- ============================================================
-- 3. THE CAP IS COUNTED BY THE DATABASE
-- ============================================================

select tests.set_actor('00000000-e001-0000-0000-0000000000a1');

select lives_ok(
    $$select public.rpc_create_stand(
        '00000000-e001-0000-0000-000000000001',
        '00000000-e001-0000-0000-000000000011',
        'Counter', 'trial-tag-hash-1', 'trl00001', 1::smallint, 'req-1',
        tests.envelope('trial-1'), 1::smallint)$$,
    'a trialing business may create its one Tag');

select throws_ok(
    $$select public.rpc_create_stand(
        '00000000-e001-0000-0000-000000000001',
        '00000000-e001-0000-0000-000000000011',
        'Second', 'trial-tag-hash-2', 'trl00002', 1::smallint, 'req-2',
        tests.envelope('trial-2'), 1::smallint)$$,
    'P0001',
    'tag_limit_reached',
    'the second Tag on a one-Tag trial is refused by the database, not by a form');

select throws_ok(
    $$select public.rpc_create_location(
        '00000000-e001-0000-0000-000000000001', 'Second Shop')$$,
    'P0001',
    'location_limit_reached',
    'a trial cannot open a second location');

-- ============================================================
-- 4. THE CIPHERTEXT IS PART OF CREATION, NOT A FOLLOW-UP
-- ============================================================

select tests.reset_role();
update public.entitlement_snapshots
   set plan_id = 'pro', status = 'active', source = 'test'
 where org_id = '00000000-e001-0000-0000-000000000002';
select tests.set_actor('00000000-e001-0000-0000-0000000000a1');

select throws_ok(
    $$select public.rpc_create_stand(
        '00000000-e001-0000-0000-000000000002',
        '00000000-e001-0000-0000-000000000012',
        'No cipher', 'starter-tag-hash-x', 'str0000x', 1::smallint, 'req-x',
        null, 1::smallint)$$,
    'P0001',
    'ciphertext_required',
    'a Tag with no recoverable token cannot be created');

select throws_ok(
    $$select public.rpc_create_stand(
        '00000000-e001-0000-0000-000000000002',
        '00000000-e001-0000-0000-000000000012',
        'Bad cipher', 'starter-tag-hash-y', 'str0000y', 1::smallint, 'req-y',
        'not-an-envelope', 1::smallint)$$,
    'P0001',
    'ciphertext_required',
    'a Tag whose stored ciphertext is not the encrypt() envelope cannot be created');

select tests.reset_role();
select is(
    (select count(*)::int from public.review_stands
      where org_id = '00000000-e001-0000-0000-000000000002'),
    0,
    'neither refused create left a half-made Tag behind');

select tests.set_actor('00000000-e001-0000-0000-0000000000a1');
select lives_ok(
    $$select public.rpc_create_stand(
        '00000000-e001-0000-0000-000000000002',
        '00000000-e001-0000-0000-000000000012',
        'Good', 'starter-tag-hash-1', 'str00001', 1::smallint, 'req-ok',
        tests.envelope('starter-1'), 1::smallint)$$,
    'a Tag created with its ciphertext succeeds');

select tests.reset_role();
select isnt(
    (select public_token_encrypted from public.review_stands
      where public_token_hash = 'starter-tag-hash-1'),
    null,
    'the reprint material is stored in the same statement as the Tag');

-- ============================================================
-- 5. WHO MAY CREATE
-- ============================================================

select tests.set_actor('00000000-e001-0000-0000-0000000000a2');
select throws_ok(
    $$select public.rpc_create_stand(
        '00000000-e001-0000-0000-000000000001',
        '00000000-e001-0000-0000-000000000011',
        'Member Tag', 'member-tag-hash', 'mem00001', 1::smallint, 'req-m',
        tests.envelope('member'), 1::smallint)$$,
    'P0001',
    'not_found_or_forbidden',
    'a plain member cannot create a Tag');

select throws_ok(
    $$select public.rpc_create_location('00000000-e001-0000-0000-000000000002', 'Elsewhere')$$,
    'P0001',
    'not_found_or_forbidden',
    'a non-member cannot create a location in another business');

-- ============================================================
-- 6. PAYMENT OPENS AND CLOSES THE DOOR — AND DELETES NOTHING
-- ============================================================

select tests.set_service_role();
select is(
    (select count(*)::int from app.resolve_public_stand('lapsed-token-hash')),
    1,
    'a trialing business''s Tag resolves');

-- An ended trial stops opening the door on the clock alone, whether or not
-- anything has swept it. A day of grace first, because Stripe's own
-- "the trial converted" event does not always arrive in the same second.
select tests.reset_role();
update public.entitlement_snapshots
   set trial_ends_at = now() - interval '2 days'
 where org_id = '00000000-e001-0000-0000-000000000003';

select tests.set_service_role();
select is(
    (select count(*)::int from app.resolve_public_stand('lapsed-token-hash')),
    0,
    'a trial that ended two days ago opens nothing, swept or not');

select tests.reset_role();
select is(
    public.rpc_entitlements_expire_trials(),
    1,
    'the sweeper makes the stored status say what the clock already decided');

select is(
    (select status from public.entitlement_snapshots
      where org_id = '00000000-e001-0000-0000-000000000003'),
    'suspended',
    'and an owner reading their billing screen sees the same answer');

select tests.reset_role();
update public.entitlement_snapshots
   set plan_id = 'starter', status = 'suspended', source = 'test'
 where org_id = '00000000-e001-0000-0000-000000000003';

select tests.set_service_role();
select is(
    (select count(*)::int from app.resolve_public_stand('lapsed-token-hash')),
    0,
    'a suspended business''s Tag becomes the same dead link as an unknown token');

select tests.reset_role();
select is(
    (select public_token_hash from public.review_stands
      where id = '00000000-e001-0000-0000-000000000021'),
    'lapsed-token-hash',
    'suspension does not touch the Tag, its token, or its printed code');
select is(
    (select count(*)::int from public.locations
      where org_id = '00000000-e001-0000-0000-000000000003'),
    1,
    'suspension deletes no locations');

update public.entitlement_snapshots
   set status = 'active', source = 'test'
 where org_id = '00000000-e001-0000-0000-000000000003';

select tests.set_service_role();
select is(
    (select count(*)::int from app.resolve_public_stand('lapsed-token-hash')),
    1,
    'paying again reopens the SAME physical Tag — no reprint, no new chip');

-- past_due is a grace period: the door stays open, but nothing new is created.
select tests.reset_role();
update public.entitlement_snapshots
   set status = 'past_due', source = 'test'
 where org_id = '00000000-e001-0000-0000-000000000003';

select tests.set_service_role();
select is(
    (select count(*)::int from app.resolve_public_stand('lapsed-token-hash')),
    1,
    'a failed card does not cost a business its reviews on the same day');

select tests.set_actor('00000000-e001-0000-0000-0000000000a1');
select throws_ok(
    $$select public.rpc_create_stand(
        '00000000-e001-0000-0000-000000000003',
        '00000000-e001-0000-0000-000000000013',
        'While past due', 'pastdue-hash', 'pas00001', 1::smallint, 'req-p',
        tests.envelope('pastdue'), 1::smallint)$$,
    'P0001',
    'entitlement_inactive',
    'a past-due business creates nothing new while it is past due');

-- ============================================================
-- 7. NO ENTITLEMENT IS A CLOSED DOOR
-- ============================================================

select tests.reset_role();
delete from public.entitlement_snapshots
 where org_id = '00000000-e001-0000-0000-000000000003';

select tests.set_service_role();
select is(
    (select count(*)::int from app.resolve_public_stand('lapsed-token-hash')),
    0,
    'an organization with no entitlement row serves nobody');

select tests.set_actor('00000000-e001-0000-0000-0000000000a1');
select throws_ok(
    $$select public.rpc_create_stand(
        '00000000-e001-0000-0000-000000000003',
        '00000000-e001-0000-0000-000000000013',
        'No entitlement', 'noent-hash', 'noe00001', 1::smallint, 'req-n',
        tests.envelope('noent'), 1::smallint)$$,
    'P0001',
    'entitlement_missing',
    'a missing entitlement is refused, never treated as unlimited');

-- ============================================================
-- 8. ROTATION MARKS THE CHIP AS NEEDING A REWRITE
-- ============================================================

select tests.reset_role();
insert into public.entitlement_snapshots (org_id, plan_id, status, source)
values ('00000000-e001-0000-0000-000000000003', 'pro', 'active', 'test');
update public.review_stands
   set nfc_provisioned_at = now(),
       nfc_provisioned_by = '00000000-e001-0000-0000-0000000000a1'
 where id = '00000000-e001-0000-0000-000000000021';

select tests.set_actor('00000000-e001-0000-0000-0000000000a1');
select lives_ok(
    $$select public.rpc_rotate_stand_token(
        '00000000-e001-0000-0000-000000000021',
        '00000000-e001-0000-0000-000000000003',
        'rotated-hash', 'rot00001', 2::smallint, 'req-rot',
        tests.envelope('rotated'), 1::smallint)$$,
    'an owner may rotate a Tag''s token');

select tests.reset_role();
select is(
    (select nfc_provisioned_at from public.review_stands
      where id = '00000000-e001-0000-0000-000000000021'),
    null,
    'rotation clears NFC provisioning — the chip now leads nowhere and says so');

select tests.set_actor('00000000-e001-0000-0000-0000000000a1');
select throws_ok(
    $$select public.rpc_rotate_stand_token(
        '00000000-e001-0000-0000-000000000021',
        '00000000-e001-0000-0000-000000000003',
        'rotated-again-hash', 'rot00002', 2::smallint, 'req-rot2',
        'not-an-envelope', 1::smallint)$$,
    'P0001',
    'ciphertext_required',
    'a rotation cannot leave a live Tag nobody can reprint');

select tests.reset_role();
select is(
    (select public_token_hash from public.review_stands
      where id = '00000000-e001-0000-0000-000000000021'),
    'rotated-hash',
    'the refused rotation changed nothing');

select * from finish();
rollback;
