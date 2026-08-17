-- Token rotation tests.
--
-- Every test performs the actual operation as the actual role. Privilege tests
-- run as service_role — not postgres — so they prove the grants exist, not
-- just that a superuser can do everything.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

select plan(18);

-- ------------------------------------------------------------- helpers ------

create or replace function tests.set_service_role() returns void
language plpgsql as $$
begin
    perform set_config('role', 'service_role', true);
end $$;

create or replace function tests.reset_role() returns void
language plpgsql as $$
begin
    perform set_config('role', 'postgres', true);
end $$;

grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

-- ------------------------------------------------------------- fixtures -----

select tests.reset_role();

insert into public.organizations (id, name, slug, status)
values ('00000000-a010-0000-0000-000000000001', 'Rotation Org', 'rotation-org', 'active');

insert into public.locations (id, org_id, name, google_review_url, status)
values ('00000000-a010-0000-0000-000000000002', '00000000-a010-0000-0000-000000000001',
        'Rotation Location', 'https://g.page/r/rotation/review', 'active');

insert into public.review_stands (id, org_id, location_id, public_token_hash, public_token_prefix, status, public_token_key_version)
values ('00000000-a010-0000-0000-000000000003', '00000000-a010-0000-0000-000000000001',
        '00000000-a010-0000-0000-000000000002', 'rot-current-hash', 'a010pfx1', 'active', 2);

-- ============================================================
-- TASK 1: PRIVILEGE EXECUTION — service_role through full chain
-- ============================================================

select tests.set_service_role();

-- 1. create_session: wrapper → app function chain works as service_role
select is(
    (select outcome from public.rpc_public_create_session(
        'rot-current-hash', 'rot-idem-cs-1', 'rot-req-cs-1', 'rot-sess-hash-1',
        'en', 'rot-client-1', 86400, 86400, true, null, null)),
    'created',
    'service_role executes rpc_public_create_session through the full chain');

-- 2. submit_response: wrapper → app function chain works as service_role
select is(
    (select outcome from public.rpc_public_submit_response(
        'rot-current-hash', 'rot-idem-sr-1', 'rot-req-sr-1', 'rot-sess-hash-1',
        'rot-resp-hash-1', 3::smallint, null, 1::smallint, 86400, null, null, null)),
    'created',
    'service_role executes rpc_public_submit_response through the full chain');

-- 3. record_google_click: wrapper → app function chain works as service_role
select is(
    (select outcome from public.rpc_public_record_google_click(
        'rot-current-hash', 'rot-idem-gc-1', 'rot-req-gc-1', 'rot-sess-hash-1',
        'rot-resp-hash-1', 86400, null, null, null)),
    'created',
    'service_role executes rpc_public_record_google_click through the full chain');

-- 4. submit_team_praise: wrapper → app function chain works as service_role
select is(
    (select outcome from public.rpc_public_submit_team_praise(
        'rot-current-hash', 'rot-idem-tp-1', 'rot-req-tp-1', 'rot-sess-hash-1',
        'rot-resp-hash-1', '00000000-a010-0000-0000-000000000099'::uuid,
        'v1:enc-name', null, 1::smallint, 86400, null, null, null, null)),
    'created',
    'service_role executes rpc_public_submit_team_praise through the full chain');

-- ============================================================
-- TASK 1: PRIVILEGE — anon cannot execute wrappers
-- ============================================================

select tests.reset_role();
select set_config('role', 'anon', true);

-- 5. anon blocked from create_session
select throws_ok(
    $$ select * from public.rpc_public_create_session(
        'rot-current-hash', 'rot-idem-anon', 'rot-req-anon', 'anon-sess',
        'en', 'anon-client', 86400, 86400, true, null, null) $$,
    '42501', null,
    'anon cannot execute rpc_public_create_session');

-- ============================================================
-- TASK 2: SESSION TOKEN FALLBACK — previous key lookup
-- ============================================================

select tests.reset_role();

-- Create a session with old-key hash so we can look it up with previous fallback.
insert into public.public_review_sessions
    (id, org_id, location_id, stand_id, session_token_hash, locale, expires_at)
values ('00000000-a010-0000-0000-000000000010',
        '00000000-a010-0000-0000-000000000001',
        '00000000-a010-0000-0000-000000000002',
        '00000000-a010-0000-0000-000000000003',
        'old-key-sess-hash', 'en', now() + interval '1 hour');

select tests.set_service_role();

-- 6. submit_response finds session via p_previous_session_token_hash
select is(
    (select outcome from public.rpc_public_submit_response(
        'rot-current-hash', 'rot-idem-sr-prev', 'rot-req-sr-prev',
        'new-key-sess-hash',
        'rot-resp-hash-prev', 4::smallint, null, 1::smallint, 86400, null,
        null,
        'old-key-sess-hash')),
    'created',
    'submit_response finds session via previous session token hash');

-- ============================================================
-- TASK 2: RESPONSE TOKEN FALLBACK — previous key lookup
-- ============================================================

select tests.reset_role();

-- Create session and response with old-key hashes
insert into public.public_review_sessions
    (id, org_id, location_id, stand_id, session_token_hash, locale, expires_at)
values ('00000000-a010-0000-0000-000000000011',
        '00000000-a010-0000-0000-000000000001',
        '00000000-a010-0000-0000-000000000002',
        '00000000-a010-0000-0000-000000000003',
        'old-key-sess-hash-2', 'en', now() + interval '1 hour');

insert into public.customer_responses
    (id, org_id, location_id, stand_id, session_id, response_token_hash, rating)
values ('00000000-a010-0000-0000-000000000012',
        '00000000-a010-0000-0000-000000000001',
        '00000000-a010-0000-0000-000000000002',
        '00000000-a010-0000-0000-000000000003',
        '00000000-a010-0000-0000-000000000011',
        'old-key-resp-hash', 3);

select tests.set_service_role();

-- 7. record_google_click finds response via previous hashes
select is(
    (select outcome from public.rpc_public_record_google_click(
        'rot-current-hash', 'rot-idem-gc-prev', 'rot-req-gc-prev',
        'new-key-sess-hash-2', 'new-key-resp-hash', 86400,
        null,
        'old-key-sess-hash-2',
        'old-key-resp-hash')),
    'created',
    'record_google_click finds response via previous session+response hashes');

-- 8. submit_team_praise finds response via previous hashes
select is(
    (select outcome from public.rpc_public_submit_team_praise(
        'rot-current-hash', 'rot-idem-tp-prev', 'rot-req-tp-prev',
        'new-key-sess-hash-2', 'new-key-resp-hash',
        '00000000-a010-0000-0000-000000000098'::uuid,
        'v1:enc-prev-name', null, 1::smallint, 86400, null,
        null,
        'old-key-sess-hash-2',
        'old-key-resp-hash')),
    'created',
    'submit_team_praise finds response via previous session+response hashes');

-- ============================================================
-- TASK 3: IDEMPOTENCY SCOPE — stable across rotation
-- ============================================================

-- 9. Second stand resolves via previous hash. Creating a session with the same
-- idempotency key but a different token hash (simulating rotation) must replay,
-- not duplicate, because scope is now stand_id.

select tests.reset_role();

-- A second stand resolvable by either hash.
insert into public.review_stands
    (id, org_id, location_id, public_token_hash, public_token_prefix, status, public_token_key_version)
values ('00000000-a010-0000-0000-000000000004',
        '00000000-a010-0000-0000-000000000001',
        '00000000-a010-0000-0000-000000000002',
        'rot-new-hash-2', 'a010pfx2', 'active', 2);

select tests.set_service_role();

-- First call resolves via current hash
select is(
    (select outcome from public.rpc_public_create_session(
        'rot-new-hash-2', 'rot-idem-scope', 'rot-req-scope', 'rot-sess-scope',
        'en', 'rot-client-scope', 86400, 86400, false, 'v1:scope-body', null)),
    'created',
    'first create_session with current hash succeeds');

-- Simulate: stand digest upgraded, so token hash changes but stand_id is the same.
-- The second call uses the same idempotency key — scope_key is stand_id, so replay.
select tests.reset_role();
update public.review_stands
   set public_token_hash = 'rot-upgraded-hash-2'
 where id = '00000000-a010-0000-0000-000000000004';
select tests.set_service_role();

-- 10. Retry with upgraded hash → same stand_id → replay
select is(
    (select outcome from public.rpc_public_create_session(
        'rot-upgraded-hash-2', 'rot-idem-scope', 'rot-req-scope', 'rot-sess-scope-2',
        'en', 'rot-client-scope', 86400, 86400, false, null, 'rot-new-hash-2')),
    'replay',
    'retry after stand digest upgrade replays because scope_key is stand_id');

-- ============================================================
-- TASK 3: OLD SCOPE KEY BACKWARD COMPAT
-- ============================================================

select tests.reset_role();

-- A third stand for backward-compat testing.
insert into public.review_stands
    (id, org_id, location_id, public_token_hash, public_token_prefix, status, public_token_key_version)
values ('00000000-a010-0000-0000-000000000005',
        '00000000-a010-0000-0000-000000000001',
        '00000000-a010-0000-0000-000000000002',
        'rot-compat-hash', 'a010pfx3', 'active', 1);

-- Manually insert a completed idempotency record with old scope pattern (token hash).
insert into public.idempotency_records
    (org_id, operation, scope_key, idempotency_key, request_hash, state, response_status,
     response_body_encrypted, completed_at, expires_at)
values ('00000000-a010-0000-0000-000000000001', 'session', 'rot-compat-hash',
        'rot-idem-compat', 'rot-req-compat', 'completed', 201::smallint,
        'v1:compat-body', now(), now() + interval '1 hour');

select tests.set_service_role();

-- 11. New-scope claim finds old-scope completed record → replay
select is(
    (select outcome from public.rpc_public_create_session(
        'rot-compat-hash', 'rot-idem-compat', 'rot-req-compat', 'rot-sess-compat',
        'en', 'rot-client-compat', 86400, 86400, false, null, null)),
    'replay',
    'new scope_key (stand_id) finds old scope_key (token_hash) completed record');

-- 12. Old-scope record with different request_hash → conflict
select tests.reset_role();

insert into public.review_stands
    (id, org_id, location_id, public_token_hash, public_token_prefix, status, public_token_key_version)
values ('00000000-a010-0000-0000-000000000006',
        '00000000-a010-0000-0000-000000000001',
        '00000000-a010-0000-0000-000000000002',
        'rot-conflict-hash', 'a010pfx4', 'active', 1);

insert into public.idempotency_records
    (org_id, operation, scope_key, idempotency_key, request_hash, state, response_status,
     response_body_encrypted, completed_at, expires_at)
values ('00000000-a010-0000-0000-000000000001', 'session', 'rot-conflict-hash',
        'rot-idem-conflict', 'rot-req-OLD', 'completed', 201::smallint,
        null, now(), now() + interval '1 hour');

select tests.set_service_role();

select is(
    (select outcome from public.rpc_public_create_session(
        'rot-conflict-hash', 'rot-idem-conflict', 'rot-req-NEW', 'rot-sess-conflict',
        'en', 'rot-client-conflict', 86400, 86400, false, null, null)),
    'conflict',
    'old-scope record with different request_hash returns conflict');

-- ============================================================
-- TASK 3: FULL ROTATION LIFECYCLE
-- ============================================================

-- Simulates the complete customer journey across a key rotation:
-- 1. Create session with old key hash
-- 2. "Rotate" the stand's hash (simulating digest upgrade)
-- 3. Submit response with new key + previous-key session lookup
-- 4. Record Google click with previous-key lookup
-- 5. Submit team praise with previous-key lookup
-- 6. Retry each operation → no duplicates

select tests.reset_role();

insert into public.review_stands
    (id, org_id, location_id, public_token_hash, public_token_prefix, status, public_token_key_version)
values ('00000000-a010-0000-0000-000000000007',
        '00000000-a010-0000-0000-000000000001',
        '00000000-a010-0000-0000-000000000002',
        'lifecycle-old-hash', 'a010pfx5', 'active', 1);

select tests.set_service_role();

-- 13. Step 1: create session before rotation
select is(
    (select outcome from public.rpc_public_create_session(
        'lifecycle-old-hash', 'lifecycle-cs', 'lifecycle-req-cs', 'lifecycle-sess',
        'en', 'lifecycle-client', 86400, 86400, true, null, null)),
    'created',
    'lifecycle: session created with old hash');

-- Simulate rotation: stand upgraded to new hash
select tests.reset_role();
update public.review_stands
   set public_token_hash = 'lifecycle-new-hash', public_token_key_version = 2
 where id = '00000000-a010-0000-0000-000000000007';
select tests.set_service_role();

-- 14. Step 2: submit response after rotation — finds session via previous hash
select is(
    (select outcome from public.rpc_public_submit_response(
        'lifecycle-new-hash', 'lifecycle-sr', 'lifecycle-req-sr',
        'lifecycle-sess-newkey',
        'lifecycle-resp', 5::smallint, null, 1::smallint, 86400, null,
        'lifecycle-old-hash',
        'lifecycle-sess')),
    'created',
    'lifecycle: response submitted after rotation using previous session hash');

-- 15. Step 3: record Google click with previous-key lookups
select is(
    (select outcome from public.rpc_public_record_google_click(
        'lifecycle-new-hash', 'lifecycle-gc', 'lifecycle-req-gc',
        'lifecycle-sess-newkey', 'lifecycle-resp-newkey', 86400,
        'lifecycle-old-hash',
        'lifecycle-sess',
        'lifecycle-resp')),
    'created',
    'lifecycle: Google click recorded using previous hashes');

-- 16. Step 4: submit team praise with previous-key lookups
select is(
    (select outcome from public.rpc_public_submit_team_praise(
        'lifecycle-new-hash', 'lifecycle-tp', 'lifecycle-req-tp',
        'lifecycle-sess-newkey', 'lifecycle-resp-newkey',
        '00000000-a010-0000-0000-000000000097'::uuid,
        'v1:enc-lifecycle-name', null, 1::smallint, 86400, null,
        'lifecycle-old-hash',
        'lifecycle-sess',
        'lifecycle-resp')),
    'created',
    'lifecycle: team praise submitted using previous hashes');

-- 17. Step 5: retry create session → replay (same stand_id scope)
select is(
    (select outcome from public.rpc_public_create_session(
        'lifecycle-new-hash', 'lifecycle-cs', 'lifecycle-req-cs', 'lifecycle-sess-retry',
        'en', 'lifecycle-client', 86400, 86400, false, null, 'lifecycle-old-hash')),
    'replay',
    'lifecycle: create session retry after rotation replays');

-- 18. Verify no duplicate data created
select tests.reset_role();

select results_eq(
    $$ select count(*)::integer from public.public_review_sessions
       where stand_id = '00000000-a010-0000-0000-000000000007' $$,
    array[1],
    'lifecycle: exactly one session exists after retry');

-- ============================================================

select * from finish();

rollback;
