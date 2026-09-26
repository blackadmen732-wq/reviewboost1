-- Tag routing invariants: the Tag is dumb, ReviewBoost is the routing layer.
--
-- A printed QR code or an NFC chip carries `/q/{token}` and nothing else. The
-- token's digest finds a review_stands row; the organization, the location,
-- the published Customer Page and the destination are all read at that moment.
-- Everything here proves one consequence of that: an owner can change what a
-- Tag leads to as often as they like, and the Tag in the field never changes.
--
-- Each owner action runs as `authenticated` with a JWT claim, as PostgREST
-- issues it; each public resolution runs as `service_role`, as the server does.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

select plan(49);

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

grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

-- ------------------------------------------------------------- fixtures -----

select tests.reset_role();

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
    ('00000000-e701-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'owner@route.test', 'x', now(), now()),
    ('00000000-e701-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'member@route.test', 'x', now(), now()),
    ('00000000-e701-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'rival@route.test', 'x', now(), now());

insert into public.organizations (id, name, slug, status)
values
    ('00000000-e701-0000-0000-000000000001', 'Route Cafe', 'route-cafe', 'active'),
    ('00000000-e701-0000-0000-000000000002', 'Rival Diner', 'rival-diner', 'active');

update public.entitlement_snapshots
   set plan_id = 'pro', status = 'active', source = 'test:paid'
 where org_id in ('00000000-e701-0000-0000-000000000001',
                  '00000000-e701-0000-0000-000000000002');

insert into public.organization_members (org_id, user_id, role, status)
values
    ('00000000-e701-0000-0000-000000000001', '00000000-e701-0000-0000-0000000000a1', 'owner', 'active'),
    ('00000000-e701-0000-0000-000000000001', '00000000-e701-0000-0000-0000000000a2', 'member', 'active'),
    ('00000000-e701-0000-0000-000000000002', '00000000-e701-0000-0000-0000000000b1', 'owner', 'active');

insert into public.locations (id, org_id, name, google_review_url, status)
values
    ('00000000-e701-0000-0000-000000000011', '00000000-e701-0000-0000-000000000001',
     'Route Main', 'https://search.google.com/local/writereview?placeid=ChIJRouteMain0001', 'active'),
    ('00000000-e701-0000-0000-000000000012', '00000000-e701-0000-0000-000000000001',
     'Route Harbour', 'https://g.page/r/RouteHarbour/review', 'active'),
    ('00000000-e701-0000-0000-000000000021', '00000000-e701-0000-0000-000000000002',
     'Rival Main', 'https://g.page/r/RivalMain/review', 'active');

-- One Tag, as it would be after being printed and programmed.
insert into public.review_stands
    (id, org_id, location_id, public_token_hash, public_token_prefix, status,
     public_token_key_version, public_token_encrypted, token_encryption_key_version,
     nfc_provisioned_at)
values
    ('00000000-e701-0000-0000-000000000031', '00000000-e701-0000-0000-000000000001',
     '00000000-e701-0000-0000-000000000011', 'route-tag-hash', 'routepfx', 'active',
     1, 'v1:AAAAAAAAAAAA:BBBBBBBBBBBB:CCCCCCCCCCCC', 1, now() - interval '3 days');

-- What is physically on the Tag, captured once. Every later check compares
-- against this: if it moved, a printed code or a programmed chip would be dead.
create temporary table printed as
select public_token_hash, public_token_prefix, public_token_encrypted,
       token_rotated_at, nfc_provisioned_at
  from public.review_stands
 where id = '00000000-e701-0000-0000-000000000031';
grant select on printed to public;

create or replace function tests.tag_unchanged() returns boolean
language sql as $$
    select s.public_token_hash = p.public_token_hash
       and s.public_token_prefix = p.public_token_prefix
       and s.public_token_encrypted is not distinct from p.public_token_encrypted
       and s.token_rotated_at is not distinct from p.token_rotated_at
       and s.nfc_provisioned_at is not distinct from p.nfc_provisioned_at
      from public.review_stands s, printed p
     where s.id = '00000000-e701-0000-0000-000000000031';
$$;

create or replace function tests.resolved_url() returns text
language sql security definer as $$
    select destination_url from app.resolve_public_stand('route-tag-hash');
$$;

grant execute on all functions in schema tests to public;

-- ============================================================
-- 1. THE SAME TAG, A NEW GOOGLE LINK
-- ============================================================

select tests.set_service_role();
select is(
    (select destination_url from public.rpc_public_resolve_stand('route-tag-hash')),
    'https://search.google.com/local/writereview?placeid=ChIJRouteMain0001',
    'the Tag resolves to its location''s destination');

select tests.set_actor('00000000-e701-0000-0000-0000000000a1');
select lives_ok(
    $$select public.rpc_update_location_destination(
        '00000000-e701-0000-0000-000000000001', '00000000-e701-0000-0000-000000000011',
        'google', 'https://search.google.com/local/writereview?placeid=ChIJRouteMainNEW02')$$,
    'the owner changes the Google review link');

select tests.set_service_role();
select is(
    (select destination_url from public.rpc_public_resolve_stand('route-tag-hash')),
    'https://search.google.com/local/writereview?placeid=ChIJRouteMainNEW02',
    'the old physical Tag URL now opens the new destination, on the very next scan');
select tests.reset_role();
select ok(tests.tag_unchanged(),
    'changing the destination changed nothing printed or programmed on the Tag');

-- The destination is never stored on the Tag's own row.
select hasnt_column('public', 'review_stands', 'destination_url',
    'a Tag row carries no destination of its own');
select hasnt_column('public', 'review_stands', 'google_review_url',
    'a Tag row carries no Google link of its own');

-- ============================================================
-- 2. THE SAME TAG, A NEW CUSTOMER PAGE
-- ============================================================

select tests.set_actor('00000000-e701-0000-0000-0000000000a1');
select lives_ok(
    $$select public.rpc_customer_page_save_draft(
        '00000000-e701-0000-0000-000000000001', null, '{"templateId":"classic","tagline":"First page"}'::jsonb)$$,
    'the owner saves a Customer Page draft');
select lives_ok(
    $$select public.rpc_customer_page_publish('00000000-e701-0000-0000-000000000001', null)$$,
    'and publishes it');

select tests.set_service_role();
select is(
    (select customer_page ->> 'tagline' from public.rpc_public_resolve_stand('route-tag-hash')),
    'First page',
    'the Tag shows the published page');

select tests.set_actor('00000000-e701-0000-0000-0000000000a1');
select lives_ok(
    $$select public.rpc_customer_page_save_draft(
        '00000000-e701-0000-0000-000000000001', null, '{"templateId":"bold","tagline":"Second page"}'::jsonb)$$,
    'the owner edits the page again');

select tests.set_service_role();
select is(
    (select customer_page ->> 'tagline' from public.rpc_public_resolve_stand('route-tag-hash')),
    'First page',
    'an unpublished draft never reaches the Tag');

select tests.set_actor('00000000-e701-0000-0000-0000000000a1');
select lives_ok(
    $$select public.rpc_customer_page_publish('00000000-e701-0000-0000-000000000001', null)$$,
    'and publishes the new version');

select tests.set_service_role();
select is(
    (select customer_page ->> 'tagline' from public.rpc_public_resolve_stand('route-tag-hash')),
    'Second page',
    'the old physical Tag now shows the new Customer Page');
select is(
    (select destination_url from public.rpc_public_resolve_stand('route-tag-hash')),
    'https://search.google.com/local/writereview?placeid=ChIJRouteMainNEW02',
    'and the page change left the destination alone');
select tests.reset_role();
select ok(tests.tag_unchanged(),
    'publishing a Customer Page changed nothing printed or programmed on the Tag');

-- ============================================================
-- 3. THE SAME TAG, MOVED OR RENAMED
-- ============================================================

select tests.set_actor('00000000-e701-0000-0000-0000000000a1');
select lives_ok(
    $$select public.rpc_update_stand('00000000-e701-0000-0000-000000000031', 'Front till', null)$$,
    'the owner renames the Tag');
select tests.reset_role();
select ok(tests.tag_unchanged(), 'renaming the Tag changed nothing printed on it');

-- Moving a Tag to the other location of the same business.
update public.review_stands
   set location_id = '00000000-e701-0000-0000-000000000012'
 where id = '00000000-e701-0000-0000-000000000031';
select tests.set_service_role();
select is(
    (select destination_url from public.rpc_public_resolve_stand('route-tag-hash')),
    'https://g.page/r/RouteHarbour/review',
    'a Tag moved to another location opens that location''s destination');
select tests.reset_role();
select ok(tests.tag_unchanged(), 'moving the Tag changed nothing printed on it');

-- Pausing and resuming: closed while paused, the same Tag again after.
select tests.set_actor('00000000-e701-0000-0000-0000000000a1');
select lives_ok(
    $$select public.rpc_update_stand('00000000-e701-0000-0000-000000000031', null, 'paused')$$,
    'the owner pauses the Tag');
select tests.set_service_role();
select is(
    (select count(*)::int from public.rpc_public_resolve_stand('route-tag-hash')),
    0,
    'a paused Tag resolves to nothing');
select tests.set_actor('00000000-e701-0000-0000-0000000000a1');
select lives_ok(
    $$select public.rpc_update_stand('00000000-e701-0000-0000-000000000031', null, 'active')$$,
    'and resumes it');
select tests.set_service_role();
select is(
    (select count(*)::int from public.rpc_public_resolve_stand('route-tag-hash')),
    1,
    'the resumed Tag opens again with the same printed URL');
select tests.reset_role();
select ok(tests.tag_unchanged(), 'pausing and resuming changed nothing printed on the Tag');

-- ============================================================
-- 4. THE TAG'S IDENTITY CHANGES ONLY BY EXPLICIT ROTATION
-- ============================================================

select tests.reset_role();
select throws_ok(
    $$update public.review_stands set public_token_hash = 'sneaky'
       where id = '00000000-e701-0000-0000-000000000031'$$,
    'P0001', 'tag_identity_immutable',
    'no write path can change a Tag''s token as a side effect');
select throws_ok(
    $$update public.review_stands set public_token_prefix = 'sneakypx'
       where id = '00000000-e701-0000-0000-000000000031'$$,
    'P0001', 'tag_identity_immutable',
    'nor its printed prefix');
select throws_ok(
    $$update public.review_stands set public_token_encrypted = 'v1:DDDDDDDDDDDD:EEEEEEEEEEEE:FFFFFFFFFFFF'
       where id = '00000000-e701-0000-0000-000000000031'$$,
    'P0001', 'tag_identity_immutable',
    'nor the reprint copy, which would print a code for a different token');
select throws_ok(
    $$update public.review_stands set public_token_hash = 'sneaky', public_token_key_version = 1
       where id = '00000000-e701-0000-0000-000000000031'$$,
    'P0001', 'tag_identity_immutable',
    'a "re-digest" that does not move to a newer key is refused');

-- Rotating the digest key re-hashes the same token: allowed, and the printed
-- URL is the same URL.
select tests.set_service_role();
select ok(
    (select public.rpc_upgrade_stand_token_digest('route-tag-hash', 'route-tag-hash-v2', 2::smallint)),
    'a digest-key upgrade of the same token is allowed');
select is(
    (select stand_id from public.rpc_public_resolve_stand('route-tag-hash-v2')),
    '00000000-e701-0000-0000-000000000031'::uuid,
    'and the Tag keeps resolving after it');
select tests.reset_role();
select is(
    (select public_token_prefix from public.review_stands where id = '00000000-e701-0000-0000-000000000031'),
    'routepfx',
    'a digest-key upgrade leaves the printed token alone');

-- ============================================================
-- 5. ANOTHER ORGANIZATION CANNOT CHANGE WHAT THE TAG RESOLVES TO
-- ============================================================

select tests.set_actor('00000000-e701-0000-0000-0000000000b1');
select throws_ok(
    $$select public.rpc_update_location_destination(
        '00000000-e701-0000-0000-000000000001', '00000000-e701-0000-0000-000000000012',
        'google', 'https://g.page/r/Hijacked/review')$$,
    'P0001', 'not_found_or_forbidden',
    'a rival owner naming the victim organization is refused');
select throws_ok(
    $$select public.rpc_update_location_destination(
        '00000000-e701-0000-0000-000000000002', '00000000-e701-0000-0000-000000000012',
        'google', 'https://g.page/r/Hijacked/review')$$,
    'P0001', 'not_found_or_forbidden',
    'a rival owner naming their own organization and the victim''s location is refused');
select throws_ok(
    $$select public.rpc_customer_page_publish('00000000-e701-0000-0000-000000000001', null)$$,
    'P0001', 'not_found_or_forbidden',
    'a rival owner cannot publish the victim''s Customer Page');
select throws_ok(
    $$select public.rpc_rotate_stand_token(
        '00000000-e701-0000-0000-000000000031', '00000000-e701-0000-0000-000000000001',
        'rival-hash', 'rivalpfx', 1::smallint, null,
        'v1:AAAAAAAAAAAA:BBBBBBBBBBBB:CCCCCCCCCCCC', 1::smallint)$$,
    'P0001', 'not_found_or_forbidden',
    'a rival owner cannot rotate (and so kill) the victim''s Tag');
select throws_ok(
    $$update public.review_stands set location_id = '00000000-e701-0000-0000-000000000021'
       where id = '00000000-e701-0000-0000-000000000031'$$,
    '42501', null,
    'a signed-in user cannot re-point a Tag by writing to it directly');

select tests.set_actor('00000000-e701-0000-0000-0000000000a2');
select throws_ok(
    $$select public.rpc_update_location_destination(
        '00000000-e701-0000-0000-000000000001', '00000000-e701-0000-0000-000000000012',
        'google', 'https://g.page/r/MemberEdit/review')$$,
    'P0001', 'not_found_or_forbidden',
    'a member of the business (not owner or admin) cannot change a destination');

select tests.set_service_role();
select is(
    (select destination_url from public.rpc_public_resolve_stand('route-tag-hash-v2')),
    'https://g.page/r/RouteHarbour/review',
    'after every refused attempt the Tag still opens its own business''s destination');

-- Opening a Tag needs no account; changing one does.
select ok(not has_function_privilege('anon', 'public.rpc_update_location_destination(uuid, uuid, text, text)', 'execute'),
    'an anonymous caller cannot change a destination');
select ok(not has_function_privilege('anon', 'public.rpc_rotate_stand_token(uuid, uuid, text, text, smallint, text, text, smallint)', 'execute'),
    'an anonymous caller cannot rotate a Tag');
select ok(not has_function_privilege('anon', 'public.rpc_public_resolve_stand(text, text)', 'execute'),
    'resolution runs only on the server, behind its rate limits, never straight from a browser');

-- ============================================================
-- 6. INVALID AND UNAPPROVED DESTINATIONS FAIL CLOSED
-- ============================================================

select tests.set_actor('00000000-e701-0000-0000-0000000000a1');
select throws_ok(
    $$select public.rpc_update_location_destination(
        '00000000-e701-0000-0000-000000000001', '00000000-e701-0000-0000-000000000012',
        'google', 'https://www.google.com/maps/place/Route+Harbour')$$,
    'P0001', 'invalid_destination_url',
    'a Google Maps listing is not a review link and is refused');
select throws_ok(
    $$select public.rpc_update_location_destination(
        '00000000-e701-0000-0000-000000000001', '00000000-e701-0000-0000-000000000012',
        'google', 'https://maps.app.goo.gl/abc123')$$,
    'P0001', 'invalid_destination_url',
    'an opaque short link, which anyone could re-point, is refused');
select throws_ok(
    $$select public.rpc_update_location_destination(
        '00000000-e701-0000-0000-000000000001', '00000000-e701-0000-0000-000000000012',
        'google', 'https://evil.example/local/writereview?placeid=ChIJ')$$,
    'P0001', 'invalid_destination_url',
    'a non-Google host is refused');
select throws_ok(
    $$select public.rpc_update_location_destination(
        '00000000-e701-0000-0000-000000000001', '00000000-e701-0000-0000-000000000012',
        'yelp', 'https://www.yelp.com/writeareview/biz/route')$$,
    'P0001', 'unknown_destination_provider',
    'an unapproved provider is refused');

select tests.set_service_role();
select is(
    (select destination_url from public.rpc_public_resolve_stand('route-tag-hash-v2')),
    'https://g.page/r/RouteHarbour/review',
    'every refused write left the working destination in place');

-- Legacy links saved before this rule keep their Tags working, and can be
-- renamed around, but cannot be re-saved as another non-review link.
select tests.reset_role();
alter table public.locations disable trigger locations_writereview_destination;
update public.locations
   set destination_provider = 'google',
       destination_url = 'https://www.google.com/maps/place/Legacy+Listing',
       google_review_url = 'https://www.google.com/maps/place/Legacy+Listing'
 where id = '00000000-e701-0000-0000-000000000012';
alter table public.locations enable trigger locations_writereview_destination;

select tests.set_service_role();
select is(
    (select destination_url from public.rpc_public_resolve_stand('route-tag-hash-v2')),
    'https://www.google.com/maps/place/Legacy+Listing',
    'a destination saved before the rule still resolves: no Tag goes dark');
select tests.reset_role();
select lives_ok(
    $$update public.locations set name = 'Route Harbour (renamed)'
       where id = '00000000-e701-0000-0000-000000000012'$$,
    'a location with a legacy link can still be edited');
select throws_ok(
    $$update public.locations set google_review_url = 'https://www.google.com/maps/place/Other'
       where id = '00000000-e701-0000-0000-000000000012'$$,
    'P0001', 'invalid_destination_url',
    'but a new non-review link cannot be saved through the legacy column either');

select * from finish();
rollback;
