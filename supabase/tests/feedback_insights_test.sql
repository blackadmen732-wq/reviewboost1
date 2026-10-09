-- Feedback → Insights: the read-only aggregation, attacked and counted.
--
-- The function runs as the caller under row level security. These tests do
-- not take that on trust: another business's owner asks for this business's
-- ratings, this business's owner smuggles in another business's location, a
-- removed member and a signed-in stranger ask, a signed-out visitor and the
-- service role try to call it at all — and PostgreSQL must refuse or return
-- nothing every time. Then the arithmetic: boundaries are inclusive at the
-- start and exclusive at the end, and every rating lands in exactly one bucket.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

select plan(31);

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

-- One customer, one session, one rating, at an exact instant.
create or replace function tests.add_rating(
    p_org uuid, p_location uuid, p_stand uuid, p_rating smallint, p_at timestamptz
) returns void
language plpgsql as $$
declare
    v_session uuid := gen_random_uuid();
begin
    insert into public.public_review_sessions
        (id, org_id, location_id, stand_id, session_token_hash, locale, expires_at, created_at)
    values
        (v_session, p_org, p_location, p_stand, 'insights-session-' || v_session, 'en',
         p_at + interval '1 hour', p_at);

    insert into public.customer_responses
        (org_id, location_id, stand_id, session_id, response_token_hash, rating, submitted_at)
    values
        (p_org, p_location, p_stand, v_session, 'insights-response-' || v_session, p_rating, p_at);
end $$;

grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

select tests.reset_role();

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
    ('00000000-2609-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'owner@insights.test', 'x', now(), now()),
    ('00000000-2609-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'viewer@insights.test', 'x', now(), now()),
    ('00000000-2609-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'removed@insights.test', 'x', now(), now()),
    ('00000000-2609-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'theirs@insights.test', 'x', now(), now()),
    ('00000000-2609-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'stranger@insights.test', 'x', now(), now());

insert into public.organizations (id, name, slug, status)
values
    ('00000000-2609-0000-0000-000000000001', 'Insights Mine', 'insights-mine', 'active'),
    ('00000000-2609-0000-0000-000000000002', 'Insights Theirs', 'insights-theirs', 'active');

insert into public.organization_members (org_id, user_id, role, status)
values
    ('00000000-2609-0000-0000-000000000001', '00000000-2609-0000-0000-0000000000a1', 'owner', 'active'),
    ('00000000-2609-0000-0000-000000000001', '00000000-2609-0000-0000-0000000000a2', 'viewer', 'active'),
    ('00000000-2609-0000-0000-000000000001', '00000000-2609-0000-0000-0000000000a3', 'member', 'removed'),
    ('00000000-2609-0000-0000-000000000002', '00000000-2609-0000-0000-0000000000b1', 'owner', 'active');

-- Mine has two places; theirs has one.
insert into public.locations (id, org_id, name, google_review_url, status)
values
    ('00000000-2609-0000-0000-000000000011', '00000000-2609-0000-0000-000000000001',
     'Downtown', 'https://g.page/r/insights-downtown/review', 'active'),
    ('00000000-2609-0000-0000-000000000012', '00000000-2609-0000-0000-000000000001',
     'Coral Springs', 'https://g.page/r/insights-coral/review', 'active'),
    ('00000000-2609-0000-0000-000000000021', '00000000-2609-0000-0000-000000000002',
     'Theirs Main', 'https://g.page/r/insights-theirs/review', 'active');

insert into public.review_stands (id, org_id, location_id, public_token_hash, public_token_prefix)
values
    ('00000000-2609-0000-0000-000000000111', '00000000-2609-0000-0000-000000000001',
     '00000000-2609-0000-0000-000000000011', 'insights-stand-downtown', 'insdown1'),
    ('00000000-2609-0000-0000-000000000112', '00000000-2609-0000-0000-000000000001',
     '00000000-2609-0000-0000-000000000012', 'insights-stand-coral', 'inscora1'),
    ('00000000-2609-0000-0000-000000000121', '00000000-2609-0000-0000-000000000002',
     '00000000-2609-0000-0000-000000000021', 'insights-stand-theirs', 'insthei1');

-- Boundaries used below: 1 Sep, 8 Sep, 15 Sep (UTC). Bucket 1 is the first
-- week, bucket 2 the second; 15 Sep itself is outside.
--
-- Downtown
select tests.add_rating('00000000-2609-0000-0000-000000000001', '00000000-2609-0000-0000-000000000011',
    '00000000-2609-0000-0000-000000000111', 5::smallint, '2026-09-01 00:00:00+00');  -- first instant: in
select tests.add_rating('00000000-2609-0000-0000-000000000001', '00000000-2609-0000-0000-000000000011',
    '00000000-2609-0000-0000-000000000111', 4::smallint, '2026-09-03 12:00:00+00');
select tests.add_rating('00000000-2609-0000-0000-000000000001', '00000000-2609-0000-0000-000000000011',
    '00000000-2609-0000-0000-000000000111', 4::smallint, '2026-09-07 23:59:59+00');  -- last second of bucket 1
select tests.add_rating('00000000-2609-0000-0000-000000000001', '00000000-2609-0000-0000-000000000011',
    '00000000-2609-0000-0000-000000000111', 1::smallint, '2026-09-08 00:00:00+00');  -- opens bucket 2
select tests.add_rating('00000000-2609-0000-0000-000000000001', '00000000-2609-0000-0000-000000000011',
    '00000000-2609-0000-0000-000000000111', 5::smallint, '2026-09-12 09:00:00+00');
select tests.add_rating('00000000-2609-0000-0000-000000000001', '00000000-2609-0000-0000-000000000011',
    '00000000-2609-0000-0000-000000000111', 2::smallint, '2026-09-15 00:00:00+00');  -- last boundary: out
select tests.add_rating('00000000-2609-0000-0000-000000000001', '00000000-2609-0000-0000-000000000011',
    '00000000-2609-0000-0000-000000000111', 3::smallint, '2026-08-31 23:59:59+00');  -- before: out
-- Coral Springs
select tests.add_rating('00000000-2609-0000-0000-000000000001', '00000000-2609-0000-0000-000000000012',
    '00000000-2609-0000-0000-000000000112', 3::smallint, '2026-09-02 10:00:00+00');
select tests.add_rating('00000000-2609-0000-0000-000000000001', '00000000-2609-0000-0000-000000000012',
    '00000000-2609-0000-0000-000000000112', 3::smallint, '2026-09-09 10:00:00+00');
-- Theirs: four ones in the same week, which must never reach Mine.
select tests.add_rating('00000000-2609-0000-0000-000000000002', '00000000-2609-0000-0000-000000000021',
    '00000000-2609-0000-0000-000000000121', 1::smallint, at)
  from unnest(array['2026-09-02 08:00+00', '2026-09-03 08:00+00',
                    '2026-09-04 08:00+00', '2026-09-05 08:00+00']::timestamptz[]) as at;

-- ============================================================
-- 1. WHAT THE FUNCTION IS
-- ============================================================

select ok(
    (select not prosecdef from pg_proc
      where oid = 'public.rpc_feedback_insights(uuid, timestamptz[], uuid)'::regprocedure),
    'runs as the caller (SECURITY INVOKER), so row level security applies');
select is(
    (select provolatile::text from pg_proc
      where oid = 'public.rpc_feedback_insights(uuid, timestamptz[], uuid)'::regprocedure),
    's', 'is STABLE: it reads and never writes');
select ok(
    (select proconfig @> array['search_path=""'] from pg_proc
      where oid = 'public.rpc_feedback_insights(uuid, timestamptz[], uuid)'::regprocedure),
    'pins an empty search_path');
select ok(has_function_privilege('authenticated',
    'public.rpc_feedback_insights(uuid, timestamptz[], uuid)', 'execute'),
    'a signed-in member may call it');
select ok(not has_function_privilege('anon',
    'public.rpc_feedback_insights(uuid, timestamptz[], uuid)', 'execute'),
    'a signed-out visitor may not');
select ok(not has_function_privilege('service_role',
    'public.rpc_feedback_insights(uuid, timestamptz[], uuid)', 'execute'),
    'the service role, which bypasses row level security, may not either');

-- ============================================================
-- 2. THE OWNER'S OWN NUMBERS
-- ============================================================

select tests.set_actor('00000000-2609-0000-0000-0000000000a1');

select results_eq(
    $$ select bucket, rating::int, responses::int
         from public.rpc_feedback_insights(
             '00000000-2609-0000-0000-000000000001',
             array['2026-09-01 00:00+00', '2026-09-08 00:00+00', '2026-09-15 00:00+00']::timestamptz[]) $$,
    $$ values (1, 3, 1), (1, 4, 2), (1, 5, 1), (2, 1, 1), (2, 3, 1), (2, 5, 1) $$,
    'counts every rating of every star value, by explicit bucket, across both places');

select is(
    (select sum(responses)::int
       from public.rpc_feedback_insights(
           '00000000-2609-0000-0000-000000000001',
           array['2026-09-01 00:00+00', '2026-09-15 00:00+00']::timestamptz[])),
    7, 'the first boundary is inclusive and the last exclusive: 7 of the 9 ratings');

select is(
    (select sum(responses)::int
       from public.rpc_feedback_insights(
           '00000000-2609-0000-0000-000000000001',
           array['2026-09-07 23:59:59+00', '2026-09-08 00:00+00']::timestamptz[])),
    1, 'a rating one second before a boundary belongs to the bucket before it');

select results_eq(
    $$ select bucket, rating::int, responses::int
         from public.rpc_feedback_insights(
             '00000000-2609-0000-0000-000000000001',
             array['2026-09-01 00:00+00', '2026-09-08 00:00+00', '2026-09-15 00:00+00']::timestamptz[],
             '00000000-2609-0000-0000-000000000011') $$,
    $$ values (1, 4, 2), (1, 5, 1), (2, 1, 1), (2, 5, 1) $$,
    'one location: Downtown alone');

select results_eq(
    $$ select bucket, rating::int, responses::int
         from public.rpc_feedback_insights(
             '00000000-2609-0000-0000-000000000001',
             array['2026-09-01 00:00+00', '2026-09-08 00:00+00', '2026-09-15 00:00+00']::timestamptz[],
             '00000000-2609-0000-0000-000000000012') $$,
    $$ values (1, 3, 1), (2, 3, 1) $$,
    'one location: Coral Springs alone');

select is(
    (select count(*)::int
       from public.rpc_feedback_insights(
           '00000000-2609-0000-0000-000000000001',
           array['2026-10-01 00:00+00', '2026-10-08 00:00+00']::timestamptz[])),
    0, 'a period with no ratings returns no rows, not an error');

-- ============================================================
-- 3. ANOTHER BUSINESS'S RATINGS ARE NEVER COUNTED
-- ============================================================

select is(
    (select count(*)::int
       from public.rpc_feedback_insights(
           '00000000-2609-0000-0000-000000000002',
           array['2026-09-01 00:00+00', '2026-09-15 00:00+00']::timestamptz[])),
    0, 'an owner asking for another business''s ratings gets nothing');

select is(
    (select count(*)::int
       from public.rpc_feedback_insights(
           '00000000-2609-0000-0000-000000000001',
           array['2026-09-01 00:00+00', '2026-09-15 00:00+00']::timestamptz[],
           '00000000-2609-0000-0000-000000000021')),
    0, 'another business''s location, passed with your own business, matches nothing');

select is(
    (select count(*)::int
       from public.rpc_feedback_insights(
           '00000000-2609-0000-0000-000000000002',
           array['2026-09-01 00:00+00', '2026-09-15 00:00+00']::timestamptz[],
           '00000000-2609-0000-0000-000000000021')),
    0, 'another business''s id and location together still return nothing');

select tests.set_actor('00000000-2609-0000-0000-0000000000b1');

select is(
    (select count(*)::int
       from public.rpc_feedback_insights(
           '00000000-2609-0000-0000-000000000001',
           array['2026-09-01 00:00+00', '2026-09-15 00:00+00']::timestamptz[])),
    0, 'the other owner cannot count this business either');

select results_eq(
    $$ select bucket, rating::int, responses::int
         from public.rpc_feedback_insights(
             '00000000-2609-0000-0000-000000000002',
             array['2026-09-01 00:00+00', '2026-09-15 00:00+00']::timestamptz[]) $$,
    $$ values (1, 1, 4) $$,
    'and sees exactly their own, none of Mine mixed in');

-- ============================================================
-- 4. EVERY ROLE THAT CAN READ FEEDBACK CAN READ INSIGHTS; NOBODY ELSE
-- ============================================================

select tests.set_actor('00000000-2609-0000-0000-0000000000a2');

select is(
    (select sum(responses)::int
       from public.rpc_feedback_insights(
           '00000000-2609-0000-0000-000000000001',
           array['2026-09-01 00:00+00', '2026-09-15 00:00+00']::timestamptz[])),
    7, 'a viewer sees the same numbers as the owner');

select tests.set_actor('00000000-2609-0000-0000-0000000000a3');

select is(
    (select count(*)::int
       from public.rpc_feedback_insights(
           '00000000-2609-0000-0000-000000000001',
           array['2026-09-01 00:00+00', '2026-09-15 00:00+00']::timestamptz[])),
    0, 'a removed member sees nothing');

select tests.set_actor('00000000-2609-0000-0000-0000000000c1');

select is(
    (select count(*)::int
       from public.rpc_feedback_insights(
           '00000000-2609-0000-0000-000000000001',
           array['2026-09-01 00:00+00', '2026-09-15 00:00+00']::timestamptz[])),
    0, 'a signed-in stranger sees nothing');

select tests.set_anonymous();

select throws_ok(
    $$ select * from public.rpc_feedback_insights(
           '00000000-2609-0000-0000-000000000001',
           array['2026-09-01 00:00+00', '2026-09-15 00:00+00']::timestamptz[]) $$,
    '42501', null, 'a signed-out visitor cannot call it');

select tests.set_service_role();

select throws_ok(
    $$ select * from public.rpc_feedback_insights(
           '00000000-2609-0000-0000-000000000001',
           array['2026-09-01 00:00+00', '2026-09-15 00:00+00']::timestamptz[]) $$,
    '42501', null, 'the service role cannot call it');

-- ============================================================
-- 5. BOUNDARIES ARE VALIDATED, NOT GUESSED
-- ============================================================

select tests.set_actor('00000000-2609-0000-0000-0000000000a1');

select throws_ok(
    $$ select * from public.rpc_feedback_insights(
           '00000000-2609-0000-0000-000000000001',
           array['2026-09-08 00:00+00', '2026-09-01 00:00+00']::timestamptz[]) $$,
    '22023', 'p_bounds must be strictly ascending', 'refuses boundaries out of order');

select throws_ok(
    $$ select * from public.rpc_feedback_insights(
           '00000000-2609-0000-0000-000000000001',
           array['2026-09-01 00:00+00', '2026-09-01 00:00+00']::timestamptz[]) $$,
    '22023', 'p_bounds must be strictly ascending', 'refuses a zero-length bucket');

select throws_ok(
    $$ select * from public.rpc_feedback_insights(
           '00000000-2609-0000-0000-000000000001',
           array['2026-09-01 00:00+00']::timestamptz[]) $$,
    '22023', 'p_bounds must hold between 2 and 64 boundaries', 'refuses a single boundary');

select throws_ok(
    $$ select * from public.rpc_feedback_insights(
           '00000000-2609-0000-0000-000000000001', null) $$,
    '22023', 'p_bounds must hold between 2 and 64 boundaries', 'refuses no boundaries');

select throws_ok(
    $$ select * from public.rpc_feedback_insights(
           '00000000-2609-0000-0000-000000000001',
           array(select '2026-01-01 00:00+00'::timestamptz + make_interval(days => n)
                   from generate_series(0, 64) as n)) $$,
    '22023', 'p_bounds must hold between 2 and 64 boundaries', 'refuses 65 boundaries');

select throws_ok(
    $$ select * from public.rpc_feedback_insights(
           '00000000-2609-0000-0000-000000000001',
           array['2026-09-01 00:00+00', null, '2026-09-15 00:00+00']::timestamptz[]) $$,
    '22023', 'p_bounds must not contain nulls', 'refuses a missing boundary');

select throws_ok(
    $$ select * from public.rpc_feedback_insights(
           '00000000-2609-0000-0000-000000000001',
           array['2025-01-01 00:00+00', '2026-09-15 00:00+00']::timestamptz[]) $$,
    '22023', 'p_bounds may span at most 400 days', 'refuses an unbounded history scan');

select throws_ok(
    $$ select * from public.rpc_feedback_insights(
           null,
           array['2026-09-01 00:00+00', '2026-09-15 00:00+00']::timestamptz[]) $$,
    '22023', 'p_org_id is required', 'refuses a missing organization');

-- ============================================================
-- 6. READING NEVER CHANGES ANYTHING
-- ============================================================

select tests.reset_role();

select is(
    (select count(*)::int from public.customer_responses
      where org_id in ('00000000-2609-0000-0000-000000000001', '00000000-2609-0000-0000-000000000002')),
    13, 'all thirteen fixture ratings are still there, untouched');

select * from finish();
rollback;
