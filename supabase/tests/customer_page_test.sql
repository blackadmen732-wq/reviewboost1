-- Customer Page tests.
--
-- The rules under test: a draft is private until it is published, a page
-- cannot be published pointing at an upload that never finished, a location's
-- page overrides its organization's, and no part of any of it is chosen from
-- "the caller's first membership".
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

select plan(33);

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

-- `service_role` deliberately cannot read this table: it reaches assets only
-- through the RPCs. The suite needs its own definer-scoped lookup rather than
-- a grant that would weaken what is being tested.
create or replace function tests.asset_id(p_path text) returns uuid
language sql security definer set search_path = '' as $$
    select id from public.customer_page_assets where storage_path = p_path;
$$;

grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

-- ------------------------------------------------------------- fixtures -----

select tests.reset_role();

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
    ('00000000-c901-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'owner@page.test', 'x', now(), now()),
    ('00000000-c901-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'member@page.test', 'x', now(), now()),
    ('00000000-c901-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'rival@page.test', 'x', now(), now());

insert into public.organizations (id, name, slug, status)
values
    ('00000000-c901-0000-0000-000000000001', 'Page Co', 'page-co', 'active'),
    ('00000000-c901-0000-0000-000000000002', 'Rival Co', 'page-rival', 'active');

-- These businesses pay. The entitlement is written explicitly because signing
-- up no longer grants service: a new organization is suspended until a
-- verified Stripe subscription says otherwise, and a fixture that relied on
-- the old free default would be testing a door this product does not have.
update public.entitlement_snapshots
   set plan_id = 'pro', status = 'active', source = 'test:paid'
 where org_id in ('00000000-c901-0000-0000-000000000001',
                  '00000000-c901-0000-0000-000000000002');

insert into public.organization_members (org_id, user_id, role, status)
values
    ('00000000-c901-0000-0000-000000000001', '00000000-c901-0000-0000-0000000000a1', 'owner', 'active'),
    ('00000000-c901-0000-0000-000000000001', '00000000-c901-0000-0000-0000000000a2', 'member', 'active'),
    ('00000000-c901-0000-0000-000000000002', '00000000-c901-0000-0000-0000000000a3', 'owner', 'active');

insert into public.locations (id, org_id, name, google_review_url, status)
values
    ('00000000-c901-0000-0000-000000000011', '00000000-c901-0000-0000-000000000001',
     'Page Main', 'https://g.page/r/page/review', 'active'),
    ('00000000-c901-0000-0000-000000000012', '00000000-c901-0000-0000-000000000002',
     'Rival Main', 'https://g.page/r/rival/review', 'active');

insert into public.review_stands (id, org_id, location_id, public_token_hash, public_token_prefix, status, public_token_key_version)
values ('00000000-c901-0000-0000-000000000021', '00000000-c901-0000-0000-000000000001',
        '00000000-c901-0000-0000-000000000011', 'page-token-hash', 'page0001', 'active', 1);

-- ============================================================
-- 1. A DRAFT IS PRIVATE
-- ============================================================

select tests.set_actor('00000000-c901-0000-0000-0000000000a1');

select lives_ok(
    $$select public.rpc_customer_page_save_draft(
        '00000000-c901-0000-0000-000000000001', null,
        '{"templateId":"bold","tagline":"Thanks for visiting"}'::jsonb)$$,
    'an owner may save a draft');

select tests.set_service_role();
select is(
    app.resolve_customer_page('00000000-c901-0000-0000-000000000001',
                              '00000000-c901-0000-0000-000000000011'),
    null,
    'an unpublished draft is invisible to the public flow');

select is(
    (select customer_page from app.resolve_public_stand('page-token-hash')),
    null,
    'the stand resolves with no page while the draft is unpublished');

-- A business with no published page still takes ratings. The page is a look,
-- not a precondition for having customers.
select is(
    (select count(*)::int from app.resolve_public_stand('page-token-hash')),
    1,
    'a Tag whose business has not designed a page still works');

-- ============================================================
-- 2. PUBLISHING IS WHAT MAKES IT PUBLIC
-- ============================================================

select tests.set_actor('00000000-c901-0000-0000-0000000000a1');
select is(
    (select public.rpc_customer_page_publish('00000000-c901-0000-0000-000000000001', null)),
    1,
    'publishing returns version 1');

select tests.set_service_role();
select is(
    app.resolve_customer_page('00000000-c901-0000-0000-000000000001',
                              '00000000-c901-0000-0000-000000000011') ->> 'tagline',
    'Thanks for visiting',
    'the published page is what the public flow reads');

select is(
    (select customer_page ->> 'templateId' from app.resolve_public_stand('page-token-hash')),
    'bold',
    'the page arrives in the same row as the destination — one round trip');

-- Editing after publishing changes the draft only.
select tests.set_actor('00000000-c901-0000-0000-0000000000a1');
select lives_ok(
    $$select public.rpc_customer_page_save_draft(
        '00000000-c901-0000-0000-000000000001', null,
        '{"templateId":"minimal","tagline":"Half-finished edit"}'::jsonb)$$,
    'an owner may keep editing after publishing');

select tests.set_service_role();
select is(
    app.resolve_customer_page('00000000-c901-0000-0000-000000000001',
                              '00000000-c901-0000-0000-000000000011') ->> 'tagline',
    'Thanks for visiting',
    'a half-finished edit does not reach customers');

select tests.set_actor('00000000-c901-0000-0000-0000000000a1');
select is(
    (select public.rpc_customer_page_publish('00000000-c901-0000-0000-000000000001', null)),
    2,
    'the version increases with each publish');

select tests.set_service_role();
select is(
    app.resolve_customer_page('00000000-c901-0000-0000-000000000001',
                              '00000000-c901-0000-0000-000000000011') ->> 'tagline',
    'Half-finished edit',
    'publishing again is what makes the edit live');

-- ============================================================
-- 3. UNPUBLISHING KEEPS THE WORK
-- ============================================================

select tests.set_actor('00000000-c901-0000-0000-0000000000a1');
select lives_ok(
    $$select public.rpc_customer_page_unpublish('00000000-c901-0000-0000-000000000001', null)$$,
    'an owner may take the page down');

select tests.set_service_role();
select is(
    app.resolve_customer_page('00000000-c901-0000-0000-000000000001',
                              '00000000-c901-0000-0000-000000000011'),
    null,
    'an unpublished page is gone from the public flow');

select tests.reset_role();
select is(
    (select draft ->> 'tagline' from public.customer_page_profiles
      where org_id = '00000000-c901-0000-0000-000000000001' and scope = 'organization'),
    'Half-finished edit',
    'taking the page down does not throw away the owner''s work');

-- ============================================================
-- 4. AN UPLOAD THAT NEVER FINISHED CANNOT BE PUBLISHED
-- ============================================================

select tests.set_actor('00000000-c901-0000-0000-0000000000a1');

select lives_ok(
    $$select public.rpc_customer_page_asset_begin(
        '00000000-c901-0000-0000-000000000001', 'hero',
        'org/00000000-c901-0000-0000-000000000001/hero-1.png', 'image/png')$$,
    'an owner may start an upload');

select tests.reset_role();
update public.customer_page_profiles
   set draft = jsonb_build_object(
        'templateId', 'classic',
        'heroAssetId', tests.asset_id('org/00000000-c901-0000-0000-000000000001/hero-1.png')::text)
 where org_id = '00000000-c901-0000-0000-000000000001' and scope = 'organization';

select tests.set_actor('00000000-c901-0000-0000-0000000000a1');
select throws_ok(
    $$select public.rpc_customer_page_publish('00000000-c901-0000-0000-000000000001', null)$$,
    'P0001',
    'asset_not_ready',
    'a page cannot be published pointing at an upload that never finished');

select tests.set_service_role();
select lives_ok(
    $$select public.rpc_customer_page_asset_confirm(
        tests.asset_id('org/00000000-c901-0000-0000-000000000001/hero-1.png'),
        '00000000-c901-0000-0000-000000000001',
        'https://assets.reviewboost.test/hero-1.png',
        4096)$$,
    'the server confirms the upload once the bytes are really there');

select tests.set_actor('00000000-c901-0000-0000-0000000000a1');
select lives_ok(
    $$select public.rpc_customer_page_publish('00000000-c901-0000-0000-000000000001', null)$$,
    'a confirmed upload can be published');

select tests.set_service_role();
select is(
    app.resolve_customer_page('00000000-c901-0000-0000-000000000001',
                              '00000000-c901-0000-0000-000000000011') ->> 'heroUrl',
    'https://assets.reviewboost.test/hero-1.png',
    'the published page carries the resolved URL, not an id to look up later');

-- The live page is a snapshot: deleting the asset row cannot change what a
-- customer is currently being shown.
select tests.reset_role();
delete from public.customer_page_assets
 where storage_path = 'org/00000000-c901-0000-0000-000000000001/hero-1.png';

select tests.set_service_role();
select is(
    app.resolve_customer_page('00000000-c901-0000-0000-000000000001',
                              '00000000-c901-0000-0000-000000000011') ->> 'heroUrl',
    'https://assets.reviewboost.test/hero-1.png',
    'a live page does not change because an asset row did');

-- ============================================================
-- 5. A LOCATION OVERRIDES ITS ORGANIZATION
-- ============================================================

select tests.set_actor('00000000-c901-0000-0000-0000000000a1');
select lives_ok(
    $$select public.rpc_customer_page_save_draft(
        '00000000-c901-0000-0000-000000000001',
        '00000000-c901-0000-0000-000000000011',
        '{"templateId":"minimal","tagline":"This shop only"}'::jsonb)$$,
    'an owner may design one place differently');
select lives_ok(
    $$select public.rpc_customer_page_publish(
        '00000000-c901-0000-0000-000000000001',
        '00000000-c901-0000-0000-000000000011')$$,
    'the location page can be published on its own');

select tests.set_service_role();
select is(
    app.resolve_customer_page('00000000-c901-0000-0000-000000000001',
                              '00000000-c901-0000-0000-000000000011') ->> 'tagline',
    'This shop only',
    'the location''s own page wins over the organization''s');

-- ============================================================
-- 6. WHO MAY EDIT — AND WHOSE BUSINESS
-- ============================================================

select tests.set_actor('00000000-c901-0000-0000-0000000000a2');
select throws_ok(
    $$select public.rpc_customer_page_save_draft(
        '00000000-c901-0000-0000-000000000001', null, '{"tagline":"member edit"}'::jsonb)$$,
    'P0001',
    'not_found_or_forbidden',
    'a plain member cannot redesign the business''s page');

select tests.set_actor('00000000-c901-0000-0000-0000000000a3');
select throws_ok(
    $$select public.rpc_customer_page_save_draft(
        '00000000-c901-0000-0000-000000000001', null, '{"tagline":"stolen"}'::jsonb)$$,
    'P0001',
    'not_found_or_forbidden',
    'another business''s owner cannot touch this page');

-- Naming your own organization with someone else's location is still refused:
-- the location has to belong to the organization you named.
select tests.set_actor('00000000-c901-0000-0000-0000000000a3');
select throws_ok(
    $$select public.rpc_customer_page_save_draft(
        '00000000-c901-0000-0000-000000000002',
        '00000000-c901-0000-0000-000000000011',
        '{"tagline":"cross"}'::jsonb)$$,
    'P0001',
    'not_found_or_forbidden',
    'a location from another business cannot be edited by naming your own org');

-- ============================================================
-- 7. WHAT A PAGE MAY CONTAIN
-- ============================================================

select tests.set_actor('00000000-c901-0000-0000-0000000000a1');

select throws_ok(
    $$select public.rpc_customer_page_save_draft(
        '00000000-c901-0000-0000-000000000001', null,
        '{"templateId":"casino"}'::jsonb)$$,
    'invalid_page_template',
    'a template that was never approved cannot be saved');

select throws_ok(
    $$select public.rpc_customer_page_save_draft(
        '00000000-c901-0000-0000-000000000001', null,
        '{"script":"<script>alert(1)</script>"}'::jsonb)$$,
    'unknown_page_field',
    'an unsupported field is refused, not stored and silently ignored');

select throws_ok(
    $$select public.rpc_customer_page_save_draft(
        '00000000-c901-0000-0000-000000000001', null,
        format('{"tagline":"%s"}', repeat('x', 121))::jsonb)$$,
    'invalid_page_tagline',
    'a tagline longer than the page can show is refused at the write');

-- ============================================================ the bucket ===
-- Created by migration, not only by config.toml, so a hosted project has it.
reset role;

select is(
    (select public from storage.buckets where id = 'customer-page'),
    true,
    'the customer-page bucket exists and serves published photos publicly');

select is(
    (select file_size_limit from storage.buckets where id = 'customer-page'),
    5242880::bigint,
    'storage itself refuses a photo over 5 MiB');

-- A set, not a list: the order carries no meaning, and the local stack's
-- config.toml seeding rewrites it after migrations run.
select set_eq(
    $$select unnest(allowed_mime_types) from storage.buckets where id = 'customer-page'$$,
    array['image/jpeg', 'image/png', 'image/webp'],
    'storage itself refuses anything but JPEG, PNG and WebP');

select is_empty(
    $$select policyname from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
         and (roles && array['anon', 'authenticated', 'public']::name[])$$,
    'no storage policy lets a browser write objects directly; uploads need a signed URL');

select * from finish();
rollback;
