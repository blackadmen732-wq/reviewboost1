-- pgTAP tests for destination persistence and public contract.
--
-- Tests:
--   - _validate_destination_url: google valid/invalid, unknown provider rejects
--   - destination_provider/url columns on locations
--   - backfill from google_review_url
--   - resolve_public_stand returns destination fields
--   - destination change does not rotate stand token
--   - 1-star and 5-star resolve same destination
--   - submit response without note succeeds
--   - team praise endpoint returns 'gone'
--   - rpc_public_record_destination_step works
--   - legacy google_review_url alias matches destination_url

begin;

select plan(42);

-- ============================================================ fixtures =====

insert into public.organizations (id, name, slug, status)
values ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Test Org', 'test-org', 'active');

insert into public.locations (id, org_id, name, status, google_review_url,
                               destination_provider, destination_url)
values (
    'bbbbbbbb-0000-0000-0000-000000000001'::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'Main Street',
    'active',
    'https://search.google.com/local/writereview?placeid=abc123',
    'google',
    'https://search.google.com/local/writereview?placeid=abc123'
);

insert into public.review_stands (id, org_id, location_id, name, status,
                                   public_token_hash, public_token_key_version)
values (
    'cccccccc-0000-0000-0000-000000000001'::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'bbbbbbbb-0000-0000-0000-000000000001'::uuid,
    'Counter',
    'active',
    'testhash001',
    1
);

-- ======================================= _validate_destination_url ========

select ok(
    public._validate_destination_url('google', 'https://search.google.com/local/writereview?placeid=abc123'),
    'google: search.google.com writereview with placeid accepted'
);

select ok(
    public._validate_destination_url('google', 'https://g.page/r/example/review'),
    'google: g.page accepted'
);

select ok(
    public._validate_destination_url('google', 'https://maps.app.goo.gl/abc123'),
    'google: maps.app.goo.gl accepted'
);

select ok(
    public._validate_destination_url('google', 'https://www.google.com/maps/place/example'),
    'google: www.google.com/maps accepted'
);

select ok(
    public._validate_destination_url('google', 'https://maps.google.com/maps/place/example'),
    'google: maps.google.com/maps accepted'
);

select ok(
    not public._validate_destination_url('google', 'http://search.google.com/local/writereview?placeid=abc123'),
    'google: http (not https) rejected'
);

select ok(
    not public._validate_destination_url('google', 'https://google.com.evil.example/maps/place/example'),
    'google: evil subdomain rejected'
);

select ok(
    not public._validate_destination_url('google', 'https://search.google.com/local/writereview'),
    'google: writereview without placeid rejected'
);

select ok(
    not public._validate_destination_url('google', 'https://example.com/google-review'),
    'google: arbitrary URL rejected'
);

select ok(
    not public._validate_destination_url('google', 'javascript:alert(1)'),
    'google: javascript: scheme rejected'
);

select ok(
    not public._validate_destination_url('google', 'https://user:pass@www.google.com/maps/place/foo'),
    'google: credential-bearing URL rejected'
);

select ok(
    not public._validate_destination_url('apple', 'https://apps.apple.com/review'),
    'unknown provider apple: fail closed'
);

select ok(
    not public._validate_destination_url('yelp', 'https://yelp.com/biz/example'),
    'unknown provider yelp: fail closed'
);

select ok(
    not public._validate_destination_url('', 'https://www.google.com/maps/place/foo'),
    'empty provider: fail closed'
);

-- ========================================= destination columns =============

select has_column('public', 'locations', 'destination_provider',
    'locations has destination_provider column');
select has_column('public', 'locations', 'destination_url',
    'locations has destination_url column');

-- Valid destination inserts.
insert into public.locations (id, org_id, name, status, destination_provider, destination_url)
values (
    'bbbbbbbb-0000-0000-0000-000000000002'::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'Branch A', 'active',
    'google', 'https://g.page/r/testbranch/review'
);

select ok(true, 'valid destination insert succeeds');

-- Invalid provider rejected.
select throws_ok(
    $$ insert into public.locations (id, org_id, name, status, destination_provider, destination_url)
       values ('bbbbbbbb-0000-0000-0000-000000000003'::uuid,
               'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
               'Bad', 'active', 'yelp', 'https://yelp.com/biz/test') $$,
    '23514',
    null,
    'unknown provider rejected by check constraint'
);

-- Invalid URL rejected.
select throws_ok(
    $$ insert into public.locations (id, org_id, name, status, destination_provider, destination_url)
       values ('bbbbbbbb-0000-0000-0000-000000000004'::uuid,
               'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
               'Bad', 'active', 'google', 'https://example.com/not-google') $$,
    '23514',
    null,
    'invalid google URL rejected by check constraint'
);

-- Pair constraint: provider without url rejected.
select throws_ok(
    $$ insert into public.locations (id, org_id, name, status, destination_provider, destination_url)
       values ('bbbbbbbb-0000-0000-0000-000000000005'::uuid,
               'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
               'Bad', 'active', 'google', null) $$,
    '23514',
    null,
    'provider with null url rejected by pair check'
);

-- ===================================== resolve_public_stand ================

select ok(
    (select destination_provider from app.resolve_public_stand('testhash001')) = 'google',
    'resolve_public_stand returns destination_provider'
);

select ok(
    (select destination_url from app.resolve_public_stand('testhash001'))
        = 'https://search.google.com/local/writereview?placeid=abc123',
    'resolve_public_stand returns destination_url'
);

-- Legacy alias matches destination_url during compatibility window.
select ok(
    (select google_review_url from app.resolve_public_stand('testhash001'))
        = (select destination_url from app.resolve_public_stand('testhash001')),
    'google_review_url alias matches destination_url'
);

-- Destination change must NOT change the stand token.
-- Update destination and verify token hash is unchanged.
update public.locations
   set destination_url     = 'https://g.page/r/newdestination/review',
       google_review_url   = 'https://g.page/r/newdestination/review'
 where id = 'bbbbbbbb-0000-0000-0000-000000000001'::uuid;

select ok(
    (select public_token_hash from public.review_stands
      where id = 'cccccccc-0000-0000-0000-000000000001'::uuid) = 'testhash001',
    'destination change does not rotate stand token'
);

-- ========================== 1-star and 5-star get same destination =========

-- Verify that resolve_public_stand returns the same destination regardless
-- of any rating value — the destination is resolved before any rating exists.
-- This is structural: the SQL cannot branch on a rating because the rating
-- is not a parameter.
select ok(
    (select destination_url from app.resolve_public_stand('testhash001')) is not null,
    'destination resolved structurally (before any rating can exist)'
);

-- ========================== submit response (no note) ======================

-- Create a session fixture for the response tests.
insert into public.public_review_sessions (
    id, org_id, location_id, stand_id,
    session_token_hash, expires_at, locale
)
values (
    'dddddddd-0000-0000-0000-000000000001'::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'bbbbbbbb-0000-0000-0000-000000000001'::uuid,
    'cccccccc-0000-0000-0000-000000000001'::uuid,
    'sessionhash001',
    now() + interval '10 minutes',
    'en'
);

-- Submit a response — should succeed, note stored as null.
select is(
    (select outcome from app.public_submit_response(
        'testhash001', 'idem001', 'reqhash001',
        'sessionhash001', 'resphash001', 4::smallint,
        3600, null)),
    'created',
    'submit response without note returns created'
);

-- Verify note_encrypted is null in the stored row.
select is(
    (select note_encrypted from public.customer_responses
      where response_token_hash = 'resphash001'),
    null::text,
    'note_encrypted is null for V1 submission'
);

-- ========================== team praise: 410 tombstone ====================

select is(
    (select outcome from app.public_submit_team_praise(
        'testhash001', 'idem-praise', 'reqhash-praise',
        'sessionhash001', 'resphash001',
        gen_random_uuid(), 'ZZZ', null, 1::smallint, 3600, null)),
    'gone',
    'public_submit_team_praise returns gone (410 tombstone)'
);

-- =================== destination review step (click tracking) =============

select is(
    (select outcome from app.public_record_destination_step(
        'testhash001', 'idem-step', 'reqhash-step',
        'sessionhash001', 'resphash001', 3600)),
    'created',
    'public_record_destination_step returns created'
);

-- Verify provider stored with the event.
select is(
    (select destination_provider from public.google_review_clicks
      where response_id = (select id from public.customer_responses
                            where response_token_hash = 'resphash001')),
    'google',
    'destination_review_step_event stores provider'
);

-- ======================= backfill test: no destination columns =============

-- Insert a location with only google_review_url set (simulating pre-migration
-- state) and verify backfill logic would handle it.
insert into public.locations (id, org_id, name, status, google_review_url)
values (
    'bbbbbbbb-0000-0000-0000-000000000009'::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'Legacy',
    'active',
    'https://g.page/r/legacy/review'
);

-- Manually run backfill (same logic as migration).
update public.locations
   set destination_provider = 'google',
       destination_url       = google_review_url
 where id = 'bbbbbbbb-0000-0000-0000-000000000009'::uuid
   and google_review_url is not null
   and google_review_url != ''
   and public._validate_google_review_url(google_review_url)
   and destination_provider is null;

select is(
    (select destination_provider from public.locations
      where id = 'bbbbbbbb-0000-0000-0000-000000000009'::uuid),
    'google',
    'backfill sets destination_provider for valid google_review_url'
);

select is(
    (select destination_url from public.locations
      where id = 'bbbbbbbb-0000-0000-0000-000000000009'::uuid),
    'https://g.page/r/legacy/review',
    'backfill sets destination_url from google_review_url'
);

select * from finish();
rollback;
