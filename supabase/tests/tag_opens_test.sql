-- Tag opens: a session remembers whether a person opened the Tag.
--
-- Home counts taps from these rows, so the tests make real sessions through
-- the real function, as the role that calls it in production, and then read
-- them back as owners of this business and of another one.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

select plan(8);

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
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
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
    ('00000000-2611-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'owner@opens.test', 'x', now(), now()),
    ('00000000-2611-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'theirs@opens.test', 'x', now(), now());

insert into public.organizations (id, name, slug, status)
values
    ('00000000-2611-0000-0000-000000000001', 'Opens Mine', 'opens-mine', 'active'),
    ('00000000-2611-0000-0000-000000000002', 'Opens Theirs', 'opens-theirs', 'active');

-- Paying businesses: a new organization is closed until Stripe says otherwise.
update public.entitlement_snapshots
   set plan_id = 'pro', status = 'active', source = 'test:paid'
 where org_id in ('00000000-2611-0000-0000-000000000001', '00000000-2611-0000-0000-000000000002');

insert into public.organization_members (org_id, user_id, role, status)
values
    ('00000000-2611-0000-0000-000000000001', '00000000-2611-0000-0000-0000000000a1', 'owner', 'active'),
    ('00000000-2611-0000-0000-000000000002', '00000000-2611-0000-0000-0000000000b1', 'owner', 'active');

insert into public.locations (id, org_id, name, google_review_url, status)
values
    ('00000000-2611-0000-0000-000000000011', '00000000-2611-0000-0000-000000000001',
     'Opens Main', 'https://g.page/r/opens-main/review', 'active'),
    ('00000000-2611-0000-0000-000000000021', '00000000-2611-0000-0000-000000000002',
     'Opens Theirs Main', 'https://g.page/r/opens-theirs/review', 'active');

insert into public.review_stands (id, org_id, location_id, public_token_hash, public_token_prefix, status, public_token_key_version)
values
    ('00000000-2611-0000-0000-000000000111', '00000000-2611-0000-0000-000000000001',
     '00000000-2611-0000-0000-000000000011', 'opens-mine-hash', 'opn1pfx1', 'active', 2),
    ('00000000-2611-0000-0000-000000000211', '00000000-2611-0000-0000-000000000002',
     '00000000-2611-0000-0000-000000000021', 'opens-theirs-hash', 'opn2pfx1', 'active', 2);

-- ---------------------------------------------------------------- tests -----

-- 1. Older rows, made before this column existed, were all star taps.
select col_default_is('public', 'public_review_sessions', 'counts_as_scan', 'true',
    'a session made before opens were counted counts as one');

select tests.set_service_role();

-- 2–3. A person opens the Tag: counted, and the Tag says it was used.
select is(
    (select outcome from public.rpc_public_create_session(
        'opens-mine-hash', 'opens-idem-person', 'opens-req-person', 'opens-sess-person',
        'en', 'opens-client-person', 86400, 86400, true, null, null)),
    'created',
    'a person opening the Tag starts a session');

select tests.reset_role();

select ok(
    (select counts_as_scan from public.public_review_sessions
      where session_token_hash = 'opens-sess-person'),
    'a person''s open is kept as one to count');

-- 4. A link preview or crawler: the session exists (it may still rate), but
--    it is not an open and does not move "last used".
select tests.set_service_role();

select is(
    (select outcome from public.rpc_public_create_session(
        'opens-mine-hash', 'opens-idem-bot', 'opens-req-bot', 'opens-sess-bot',
        'en', 'opens-client-bot', 86400, 86400, false, null, null)),
    'created',
    'a crawler still gets a session');

select tests.reset_role();

select is(
    (select counts_as_scan from public.public_review_sessions
      where session_token_hash = 'opens-sess-bot'),
    false,
    'a crawler''s session is not counted as an open');

-- 5. Replaying the same request is the same open, not a second one.
select tests.set_service_role();

select is(
    (select outcome from public.rpc_public_create_session(
        'opens-mine-hash', 'opens-idem-person', 'opens-req-person', 'opens-sess-person-again',
        'en', 'opens-client-person', 86400, 86400, true, null, null)),
    'replay',
    'a reload with the same key does not open the Tag twice');

-- 6–7. What an owner can count: their own business's opens, and nobody else's.
select tests.reset_role();

select tests.set_actor('00000000-2611-0000-0000-0000000000a1');

select is(
    (select count(*)::int from public.public_review_sessions
      where org_id = '00000000-2611-0000-0000-000000000001' and counts_as_scan),
    1,
    'the owner counts one open: the person, not the crawler, not the replay');

select tests.reset_role();
select tests.set_actor('00000000-2611-0000-0000-0000000000b1');

select is(
    (select count(*)::int from public.public_review_sessions
      where org_id = '00000000-2611-0000-0000-000000000001'),
    0,
    'another business cannot count these opens');

select * from finish();

rollback;
