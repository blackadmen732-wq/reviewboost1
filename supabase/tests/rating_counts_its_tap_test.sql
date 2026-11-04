-- A rating counts its own tap (20261104000200_rating_counts_its_tap).
--
-- A session the user-agent check did not count (counts_as_scan = false) that
-- then receives a rating was a person after all. Home must not read
-- "0 taps · 1 rated".
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

insert into public.organizations (id, name, slug, status)
values ('00000000-7a90-0000-0000-000000000001', 'Tap Co', 'tap-co', 'active');

insert into public.locations (id, org_id, name)
values ('00000000-7a90-0000-0000-000000000011', '00000000-7a90-0000-0000-000000000001', 'Front');

insert into public.review_stands (id, org_id, location_id, public_token_hash, public_token_prefix, label)
values ('00000000-7a90-0000-0000-000000000021', '00000000-7a90-0000-0000-000000000001',
        '00000000-7a90-0000-0000-000000000011', 'tap-test-hash-1', 'taptest1', 'Counter');

-- One session the user-agent check did not count, one it did.
insert into public.public_review_sessions
    (id, org_id, location_id, stand_id, session_token_hash, locale, expires_at, counts_as_scan)
values
    ('00000000-7a90-0000-0000-000000000031', '00000000-7a90-0000-0000-000000000001',
     '00000000-7a90-0000-0000-000000000011', '00000000-7a90-0000-0000-000000000021',
     'tap-session-uncounted', 'en', now() + interval '1 hour', false),
    ('00000000-7a90-0000-0000-000000000032', '00000000-7a90-0000-0000-000000000001',
     '00000000-7a90-0000-0000-000000000011', '00000000-7a90-0000-0000-000000000021',
     'tap-session-counted', 'en', now() + interval '1 hour', true);

select is((select last_opened_at from public.review_stands where id = '00000000-7a90-0000-0000-000000000021'),
          null, 'the Tag starts unused');

-- A rating on the session that was not counted.
insert into public.customer_responses (org_id, location_id, stand_id, session_id, response_token_hash, rating)
values ('00000000-7a90-0000-0000-000000000001', '00000000-7a90-0000-0000-000000000011',
        '00000000-7a90-0000-0000-000000000021', '00000000-7a90-0000-0000-000000000031',
        'tap-response-1', 4);

select ok((select counts_as_scan from public.public_review_sessions where id = '00000000-7a90-0000-0000-000000000031'),
          'a rating makes its uncounted session count as a tap');
select isnt((select last_opened_at from public.review_stands where id = '00000000-7a90-0000-0000-000000000021'),
            null, 'and marks its Tag as used');

-- Home's numbers: taps can no longer be fewer than ratings.
select is((select count(*)::int from public.public_review_sessions
            where org_id = '00000000-7a90-0000-0000-000000000001' and counts_as_scan),
          2, 'both sessions now count as taps');
select cmp_ok(
    (select count(*)::int from public.public_review_sessions
      where org_id = '00000000-7a90-0000-0000-000000000001' and counts_as_scan),
    '>=',
    (select count(*)::int from public.customer_responses
      where org_id = '00000000-7a90-0000-0000-000000000001'),
    'taps are never fewer than ratings');

-- A rating on a session already counted changes nothing.
insert into public.customer_responses (org_id, location_id, stand_id, session_id, response_token_hash, rating)
values ('00000000-7a90-0000-0000-000000000001', '00000000-7a90-0000-0000-000000000011',
        '00000000-7a90-0000-0000-000000000021', '00000000-7a90-0000-0000-000000000032',
        'tap-response-2', 5);
select is((select count(*)::int from public.public_review_sessions
            where org_id = '00000000-7a90-0000-0000-000000000001' and counts_as_scan),
          2, 'an already-counted session is not counted twice');

select is(
    (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.proname = 'rating_counts_its_tap'),
    false, 'the trigger runs with the caller''s rights, adding nothing privileged');

select * from finish();

rollback;
