-- Cross-tenant isolation on everything this program added.
--
-- Every table added for destinations, entitlements, the Customer Page, billing
-- and SMS credit is attacked here from three directions: another business's
-- owner, a signed-out visitor, and a member trying to write a table that is
-- supposed to be read-only to them.
--
-- A test that asserts a policy exists proves nothing. These perform the read
-- and the write.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

select plan(30);

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

create or replace function tests.reset_role() returns void
language plpgsql as $$
begin
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
end $$;

grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

select tests.reset_role();

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
    ('00000000-1501-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'mine@iso.test', 'x', now(), now()),
    ('00000000-1501-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'theirs@iso.test', 'x', now(), now());

insert into public.organizations (id, name, slug, status)
values
    ('00000000-1501-0000-0000-000000000001', 'Mine', 'iso-mine', 'active'),
    ('00000000-1501-0000-0000-000000000002', 'Theirs', 'iso-theirs', 'active');

insert into public.organization_members (org_id, user_id, role, status)
values
    ('00000000-1501-0000-0000-000000000001', '00000000-1501-0000-0000-0000000000a1', 'owner', 'active'),
    ('00000000-1501-0000-0000-000000000002', '00000000-1501-0000-0000-0000000000a2', 'owner', 'active');

insert into public.locations (id, org_id, name, google_review_url, status)
values
    ('00000000-1501-0000-0000-000000000011', '00000000-1501-0000-0000-000000000001',
     'Mine Main', 'https://g.page/r/mine/review', 'active'),
    ('00000000-1501-0000-0000-000000000012', '00000000-1501-0000-0000-000000000002',
     'Theirs Main', 'https://g.page/r/theirs/review', 'active');

-- Their business has everything: a plan, a subscription, credit, a page.
update public.entitlement_snapshots
   set plan_id = 'pro', status = 'active', source = 'isolation-test'
 where org_id = '00000000-1501-0000-0000-000000000002';

insert into public.billing_customers (org_id, stripe_customer_id)
values ('00000000-1501-0000-0000-000000000002', 'cus_theirsISO1');

insert into public.billing_subscriptions
    (org_id, stripe_subscription_id, plan_id, stripe_status, last_event_at, last_event_id)
values ('00000000-1501-0000-0000-000000000002', 'sub_theirsISO1', 'pro', 'active', now(), 'evt_iso');

select app.sms_grant_credits('00000000-1501-0000-0000-000000000002', 'purchased', 500,
    'purchase', 'pi_theirs_iso', null, null);

insert into public.customer_page_profiles (org_id, scope, draft, published, published_version, published_at)
values ('00000000-1501-0000-0000-000000000002', 'organization',
        '{"tagline":"their draft"}'::jsonb, '{"tagline":"their page"}'::jsonb, 1, now());

insert into public.customer_page_assets (org_id, kind, status, storage_path, content_type, public_url, confirmed_at)
values ('00000000-1501-0000-0000-000000000002', 'hero', 'ready',
        'org/theirs/hero.png', 'image/png', 'https://assets.test/theirs.png', now());

insert into public.stripe_webhook_events (id, type, payload, event_created)
values ('evt_isolation1', 'invoice.paid', '{"secret":"their billing"}'::jsonb, now());

-- ============================================================
-- 1. ANOTHER BUSINESS'S OWNER SEES NOTHING
-- ============================================================

select tests.set_actor('00000000-1501-0000-0000-0000000000a1');

select is((select count(*)::int from public.entitlement_snapshots
            where org_id = '00000000-1501-0000-0000-000000000002'),
          0, 'another business''s plan is invisible');
select is((select count(*)::int from public.billing_subscriptions
            where org_id = '00000000-1501-0000-0000-000000000002'),
          0, 'another business''s subscription is invisible');
select is((select count(*)::int from public.sms_credit_grants
            where org_id = '00000000-1501-0000-0000-000000000002'),
          0, 'another business''s SMS credit is invisible');
select is((select count(*)::int from public.customer_page_profiles
            where org_id = '00000000-1501-0000-0000-000000000002'),
          0, 'another business''s Customer Page is invisible');
select is((select count(*)::int from public.customer_page_assets
            where org_id = '00000000-1501-0000-0000-000000000002'),
          0, 'another business''s uploaded images are invisible');
select is((select count(*)::int from public.destination_selections
            where org_id = '00000000-1501-0000-0000-000000000002'),
          0, 'another business''s customer activity is invisible');
select is((select count(*)::int from public.locations
            where org_id = '00000000-1501-0000-0000-000000000002'),
          0, 'another business''s locations — and their destinations — are invisible');

-- Their own is visible, so the tests above are not passing because everything
-- is empty.
select is((select count(*)::int from public.entitlement_snapshots
            where org_id = '00000000-1501-0000-0000-000000000001'),
          1, 'a business can read its own plan');
select is((select count(*)::int from public.locations
            where org_id = '00000000-1501-0000-0000-000000000001'),
          1, 'a business can read its own locations');

-- The balance function is asked about someone else's organization directly.
select is((select total from public.rpc_sms_balance('00000000-1501-0000-0000-000000000002')),
          0::bigint,
          'asking for another business''s balance by id returns nothing, not their balance');

-- ============================================================
-- 2. A SIGNED-OUT VISITOR SEES NOTHING
-- ============================================================

select tests.set_anonymous();

select throws_ok('select 1 from public.entitlement_snapshots',
    '42501', null, 'anon cannot read plans');
select throws_ok('select 1 from public.billing_subscriptions',
    '42501', null, 'anon cannot read subscriptions');
select throws_ok('select 1 from public.billing_customers',
    '42501', null, 'anon cannot read Stripe customer ids');
select throws_ok('select 1 from public.stripe_webhook_events',
    '42501', null, 'anon cannot read raw billing webhooks');
select throws_ok('select 1 from public.sms_credit_grants',
    '42501', null, 'anon cannot read SMS credit');
select throws_ok('select 1 from public.sms_reservation_slices',
    '42501', null, 'anon cannot read reservations');
select throws_ok('select 1 from public.customer_page_profiles',
    '42501', null, 'anon cannot read Customer Pages, including drafts');
select throws_ok('select 1 from public.customer_page_assets',
    '42501', null, 'anon cannot enumerate uploaded images');
select throws_ok('select 1 from public.destination_selections',
    '42501', null, 'anon cannot read customer activity');

-- ============================================================
-- 3. NOBODY WRITES MONEY OR ENTITLEMENT FROM A BROWSER
-- ============================================================

select tests.set_actor('00000000-1501-0000-0000-0000000000a1');

select throws_ok(
    $$update public.entitlement_snapshots set status = 'active', plan_id = 'pro'
       where org_id = '00000000-1501-0000-0000-000000000001'$$,
    '42501', null,
    'an owner cannot upgrade their own plan by writing the table');

select throws_ok(
    $$insert into public.sms_credit_grants (org_id, source, segments, origin_kind, origin_id)
      values ('00000000-1501-0000-0000-000000000001', 'purchased', 100000, 'manual', 'free-credit')$$,
    '42501', null,
    'an owner cannot grant themselves SMS credit');

select throws_ok(
    $$update public.billing_subscriptions set stripe_status = 'active'
       where org_id = '00000000-1501-0000-0000-000000000001'$$,
    '42501', null,
    'an owner cannot mark their own subscription active');

select throws_ok(
    $$insert into public.stripe_webhook_events (id, type, payload, event_created)
      values ('evt_forged1', 'invoice.paid', '{}'::jsonb, now())$$,
    '42501', null,
    'an owner cannot forge a billing event');

select throws_ok(
    $$update public.customer_page_profiles set published = '{"tagline":"hijacked"}'::jsonb
       where org_id = '00000000-1501-0000-0000-000000000002'$$,
    '42501', null,
    'nobody publishes to another business''s page by writing the table');

select throws_ok(
    $$update public.customer_page_assets set status = 'ready',
             public_url = 'https://evil.example/x.png', confirmed_at = now()
       where org_id = '00000000-1501-0000-0000-000000000002'$$,
    '42501', null,
    'an upload cannot be marked ready from a browser');

-- ============================================================
-- 4. THE RPCs REFUSE THE SAME THINGS
-- ============================================================

select throws_ok(
    $$select public.rpc_update_location_destination(
        '00000000-1501-0000-0000-000000000002',
        '00000000-1501-0000-0000-000000000012',
        'google', 'https://g.page/r/hijack/review')$$,
    'P0001', 'not_found_or_forbidden',
    'the destination write refuses another business''s location');

select throws_ok(
    $$select public.rpc_customer_page_save_draft(
        '00000000-1501-0000-0000-000000000002', null, '{"tagline":"x"}'::jsonb)$$,
    'P0001', 'not_found_or_forbidden',
    'the page write refuses another business');

select throws_ok(
    $$select public.rpc_create_stand(
        '00000000-1501-0000-0000-000000000002',
        '00000000-1501-0000-0000-000000000012',
        'Theirs', 'iso-tag-hash', 'iso00001', 1::smallint, 'req-iso',
        'v1:aXYtaXNv:Y3QtaXNvLXBhZGRpbmc=:dGFnLWlzbw==', 1::smallint)$$,
    'P0001', 'not_found_or_forbidden',
    'Tag creation refuses another business');

select throws_ok(
    $$select public.rpc_create_location('00000000-1501-0000-0000-000000000002', 'Theirs Second')$$,
    'P0001', 'not_found_or_forbidden',
    'location creation refuses another business');

-- And the service-role-only money RPCs are not reachable from a browser at all.
select throws_ok(
    $$select public.rpc_billing_apply_invoice_paid(
        '00000000-1501-0000-0000-000000000001', 'in_forged', 'pro', now(), now() + interval '30 days', 12900)$$,
    '42501', null,
    'an owner cannot mint themselves a month of SMS');

select * from finish();
rollback;
