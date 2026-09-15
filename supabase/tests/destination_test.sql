-- Destination tests: ReviewBoost owns the door.
--
-- The product promise under test is one sentence: changing where a Tag leads
-- must never change the Tag. Every assertion below performs the real operation
-- as the real role — the owner write runs as `authenticated` with a JWT claim,
-- exactly as PostgREST would issue it, so a missing grant or a missing
-- membership check fails here rather than in production.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

select plan(37);

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
    ('00000000-d001-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'owner@door.test', 'x', now(), now()),
    ('00000000-d001-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'member@door.test', 'x', now(), now()),
    ('00000000-d001-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'rival@door.test', 'x', now(), now());

insert into public.organizations (id, name, slug, status)
values
    ('00000000-d001-0000-0000-000000000001', 'Door Cafe', 'door-cafe', 'active'),
    ('00000000-d001-0000-0000-000000000002', 'Rival Cafe', 'rival-cafe', 'active');

-- These businesses pay. The entitlement is written explicitly because signing
-- up no longer grants service: a new organization is suspended until a
-- verified Stripe subscription says otherwise, and a fixture that relied on
-- the old free default would be testing a door this product does not have.
update public.entitlement_snapshots
   set plan_id = 'pro', status = 'active', source = 'test:paid'
 where org_id in ('00000000-d001-0000-0000-000000000001',
                  '00000000-d001-0000-0000-000000000002');

insert into public.organization_members (org_id, user_id, role, status)
values
    ('00000000-d001-0000-0000-000000000001', '00000000-d001-0000-0000-0000000000a1', 'owner', 'active'),
    ('00000000-d001-0000-0000-000000000001', '00000000-d001-0000-0000-0000000000a2', 'member', 'active'),
    ('00000000-d001-0000-0000-000000000002', '00000000-d001-0000-0000-0000000000a3', 'owner', 'active');

insert into public.locations (id, org_id, name, google_review_url, status)
values
    ('00000000-d001-0000-0000-000000000011', '00000000-d001-0000-0000-000000000001',
     'Door Cafe Main', 'https://g.page/r/door-a/review', 'active'),
    ('00000000-d001-0000-0000-000000000012', '00000000-d001-0000-0000-000000000002',
     'Rival Main', 'https://g.page/r/rival/review', 'active');

-- A location with no destination at all: the closed-door case.
insert into public.locations (id, org_id, name, status)
values ('00000000-d001-0000-0000-000000000013', '00000000-d001-0000-0000-000000000001',
        'Door Cafe Unconfigured', 'active');

insert into public.review_stands (id, org_id, location_id, public_token_hash, public_token_prefix, status, public_token_key_version)
values
    ('00000000-d001-0000-0000-000000000021', '00000000-d001-0000-0000-000000000001',
     '00000000-d001-0000-0000-000000000011', 'door-token-hash', 'door0001', 'active', 1),
    ('00000000-d001-0000-0000-000000000022', '00000000-d001-0000-0000-000000000001',
     '00000000-d001-0000-0000-000000000013', 'unconfigured-hash', 'door0002', 'active', 1);

-- ============================================================
-- 1. SHAPE
-- ============================================================

select has_column('public', 'locations', 'destination_provider',
    'locations carries the destination provider');
select has_column('public', 'locations', 'destination_url',
    'locations carries the destination URL');
select has_table('public', 'destination_selections',
    'the click table is now named for what it records');
select has_column('public', 'destination_selections', 'provider',
    'a selection records which provider the customer was handed to');
select hasnt_table('public', 'google_review_clicks',
    'nothing in the schema still says "google click"');

-- ============================================================
-- 2. THE COMPATIBILITY WINDOW
-- ============================================================

-- A location written through the legacy Google column still has a working
-- door, because the canonical fields follow it.
select is(
    (select destination_provider from public.locations
      where id = '00000000-d001-0000-0000-000000000011'),
    'google',
    'a legacy google_review_url yields a google destination provider');
select is(
    (select destination_url from public.locations
      where id = '00000000-d001-0000-0000-000000000011'),
    'https://g.page/r/door-a/review',
    'a legacy google_review_url yields the same destination URL');
select is(
    (select destination_provider from public.locations
      where id = '00000000-d001-0000-0000-000000000013'),
    null,
    'a location with no Google URL has no destination');

-- ============================================================
-- 3. FAIL CLOSED ON THE URL
-- ============================================================

select ok(public._validate_destination_url('google', 'https://g.page/r/abc/review'),
    'a valid Google URL passes for the google provider');
select ok(not public._validate_destination_url('yelp', 'https://www.yelp.com/biz/abc'),
    'an unknown provider is refused even with a plausible URL');
select ok(not public._validate_destination_url('google', 'http://g.page/r/abc/review'),
    'plain HTTP is refused');
select ok(not public._validate_destination_url('google', 'https://user:pw@g.page/r/abc/review'),
    'a credential-bearing URL is refused');
select ok(not public._validate_destination_url('google', 'https://g.page:8443/r/abc/review'),
    'a URL with a port is refused');
select ok(not public._validate_destination_url('google', 'https://evil.example.com/redirect?to=g.page'),
    'a host outside the provider allowlist is refused');
select ok(not public._validate_destination_url(null, 'https://g.page/r/abc/review'),
    'a null provider is refused');

-- The database refuses a bad destination even when the write bypasses every
-- RPC, which is the only version of this guarantee worth having.
select throws_ok(
    $$update public.locations
         set destination_provider = 'google',
             destination_url = 'https://evil.example.com/steal'
       where id = '00000000-d001-0000-0000-000000000011'$$,
    '23514',
    null,
    'a direct UPDATE cannot store a destination outside the allowlist');

select throws_ok(
    $$update public.locations
         set destination_provider = 'google',
             destination_url = null
       where id = '00000000-d001-0000-0000-000000000011'$$,
    '23514',
    null,
    'a direct UPDATE cannot store a half-configured destination');

-- ============================================================
-- 4. THE RESOLVER
-- ============================================================

select tests.set_service_role();

select is(
    (select destination_url from app.resolve_public_stand('door-token-hash')),
    'https://g.page/r/door-a/review',
    'the resolver returns the canonical destination for an active stand');
select is(
    (select destination_provider from app.resolve_public_stand('door-token-hash')),
    'google',
    'the resolver returns the destination provider');
select is(
    (select count(*)::int from app.resolve_public_stand('no-such-token')),
    0,
    'an unknown token resolves to nothing');

-- ============================================================
-- 5. THE DOOR CLOSES WITHOUT A DESTINATION
-- ============================================================

select is(
    (select outcome from public.rpc_public_create_session(
        'unconfigured-hash', 'door-idem-s1', 'door-req-s1', 'door-sess-1',
        'en', 'door-client', 86400, 86400, true, null, null)),
    'created',
    'a session can still start at a stand whose door is unconfigured');

select is(
    (select outcome from public.rpc_public_submit_response(
        'unconfigured-hash', 'door-idem-r1', 'door-req-r1', 'door-sess-1',
        'door-resp-1', 4::smallint, null, 1::smallint, 86400, null, null, null)),
    'created',
    'the rating is still saved when no destination is configured');

select is(
    (select outcome from public.rpc_public_record_destination_selection(
        'unconfigured-hash', 'door-idem-d1', 'door-req-d1', 'door-sess-1',
        'door-resp-1', 86400, null, null, null)),
    'unknown_stand',
    'a selection against an unconfigured door is refused as a dead link');

-- ============================================================
-- 6. THE SELECTION RECORDS THE PROVIDER
-- ============================================================

select is(
    (select outcome from public.rpc_public_create_session(
        'door-token-hash', 'door-idem-s2', 'door-req-s2', 'door-sess-2',
        'en', 'door-client', 86400, 86400, true, null, null)),
    'created',
    'a session starts at a configured stand');
select is(
    (select outcome from public.rpc_public_submit_response(
        'door-token-hash', 'door-idem-r2', 'door-req-r2', 'door-sess-2',
        'door-resp-2', 1::smallint, null, 1::smallint, 86400, null, null, null)),
    'created',
    'a one-star rating is saved like any other');
select is(
    (select outcome from public.rpc_public_record_destination_selection(
        'door-token-hash', 'door-idem-d2', 'door-req-d2', 'door-sess-2',
        'door-resp-2', 86400, null, null, null)),
    'created',
    'a one-star customer is handed to the same destination as any other');
select tests.reset_role();
select is(
    (select provider from public.destination_selections ds
      join public.customer_responses r on r.id = ds.response_id
     where r.response_token_hash = 'door-resp-2'),
    'google',
    'the selection records the provider in force at that moment');

-- ============================================================
-- 7. THE OWNER WRITE — AND THE TAG THAT DOES NOT CHANGE
-- ============================================================

select tests.set_actor('00000000-d001-0000-0000-0000000000a1');

select lives_ok(
    $$select public.rpc_update_location_destination(
        '00000000-d001-0000-0000-000000000001',
        '00000000-d001-0000-0000-000000000011',
        'google',
        'https://search.google.com/local/writereview?placeid=NEWPLACE')$$,
    'an owner may point their location at a new destination');

select tests.set_service_role();

select is(
    (select destination_url from app.resolve_public_stand('door-token-hash')),
    'https://search.google.com/local/writereview?placeid=NEWPLACE',
    'the very next scan of the SAME token resolves to the new destination');

select tests.reset_role();

select is(
    (select public_token_hash from public.review_stands
      where id = '00000000-d001-0000-0000-000000000021'),
    'door-token-hash',
    'the Tag token is untouched — no reprint, no reprogram');

select is(
    (select google_review_url from public.locations
      where id = '00000000-d001-0000-0000-000000000011'),
    'https://search.google.com/local/writereview?placeid=NEWPLACE',
    'the compatibility column is kept in step during the migration window');

select is(
    (select count(*)::int from public.audit_events
      where org_id = '00000000-d001-0000-0000-000000000001'
        and action = 'location.destination_updated'),
    1,
    'the destination change is audited');

-- ============================================================
-- 8. WHO MAY WRITE IT
-- ============================================================

select tests.set_actor('00000000-d001-0000-0000-0000000000a3');
select throws_ok(
    $$select public.rpc_update_location_destination(
        '00000000-d001-0000-0000-000000000002',
        '00000000-d001-0000-0000-000000000011',
        'google',
        'https://g.page/r/stolen/review')$$,
    'P0001',
    'not_found_or_forbidden',
    'another tenant cannot repoint this business''s door, even naming their own org');

select tests.set_actor('00000000-d001-0000-0000-0000000000a2');
select throws_ok(
    $$select public.rpc_update_location_destination(
        '00000000-d001-0000-0000-000000000001',
        '00000000-d001-0000-0000-000000000011',
        'google',
        'https://g.page/r/member-write/review')$$,
    'P0001',
    'not_found_or_forbidden',
    'a plain member cannot change where the business''s Tags lead');

select tests.set_actor('00000000-d001-0000-0000-0000000000a1');
select throws_ok(
    $$select public.rpc_update_location_destination(
        '00000000-d001-0000-0000-000000000001',
        '00000000-d001-0000-0000-000000000011',
        'yelp',
        'https://www.yelp.com/biz/door-cafe')$$,
    'P0001',
    'unknown_destination_provider',
    'an owner cannot enable a provider V1 does not support');

select throws_ok(
    $$select public.rpc_update_location_destination(
        '00000000-d001-0000-0000-000000000001',
        '00000000-d001-0000-0000-000000000011',
        'google',
        'https://evil.example.com/redirect')$$,
    'P0001',
    'invalid_destination_url',
    'an owner cannot turn their Tags into an open redirect');

select tests.reset_role();
select is(
    (select destination_url from public.locations
      where id = '00000000-d001-0000-0000-000000000011'),
    'https://search.google.com/local/writereview?placeid=NEWPLACE',
    'none of the refused writes changed the stored destination');

select * from finish();
rollback;
