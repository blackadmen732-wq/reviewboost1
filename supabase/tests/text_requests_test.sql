-- Text Requests backend tests.
--
-- Exercises the durable SMS foundation the way the earlier suites exercise the
-- customer flow: real roles performing real operations, and the forbidden ones
-- failing. Covers tenant isolation and RLS, the consent ledger and projection,
-- the suppression pre-send gate, STOP/START, the request state machine, the
-- quota ledger (including double-spend), the schedule → dispatch → settle
-- lifecycle, the outbox lease, webhook dedupe, and the single-in-flight guard.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

select plan(49);

-- ------------------------------------------------------------- fixtures ----

create or replace function tests.set_actor(p_user_id uuid) returns void
language plpgsql as $$
begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end $$;

create or replace function tests.set_anonymous() returns void
language plpgsql as $$
begin
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end $$;

create or replace function tests.set_service() returns void
language plpgsql as $$
begin
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
end $$;

grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
    ('7b000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tr-owner@test.com', '', now(), now()),
    ('7b000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tr-admin@test.com', '', now(), now()),
    ('7b000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tr-member@test.com', '', now(), now()),
    ('7b000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tr-outsider@test.com', '', now(), now());

insert into public.organizations (id, name, slug)
values
    ('7c000000-0000-0000-0000-00000000000a', 'TR Org A', 'tr-org-a'),
    ('7c000000-0000-0000-0000-00000000000b', 'TR Org B', 'tr-org-b');

insert into public.organization_members (org_id, user_id, role, status)
values
    ('7c000000-0000-0000-0000-00000000000a', '7b000000-0000-0000-0000-000000000001', 'owner', 'active'),
    ('7c000000-0000-0000-0000-00000000000a', '7b000000-0000-0000-0000-000000000002', 'admin', 'active'),
    ('7c000000-0000-0000-0000-00000000000a', '7b000000-0000-0000-0000-000000000003', 'member', 'active'),
    ('7c000000-0000-0000-0000-00000000000b', '7b000000-0000-0000-0000-000000000004', 'owner', 'active');

insert into public.locations (id, org_id, name, timezone)
values ('7d000000-0000-0000-0000-00000000000a', '7c000000-0000-0000-0000-00000000000a', 'TR Location', 'UTC');

insert into public.review_stands (id, org_id, location_id, public_token_hash, public_token_prefix, label)
values ('7e000000-0000-0000-0000-00000000000a', '7c000000-0000-0000-0000-00000000000a',
        '7d000000-0000-0000-0000-00000000000a', 'trstandhash0000000000000000000000', 'trstand1', 'TR Stand');

-- Convenience constants as 64-char keyed-digest stand-ins.
-- PH1 = repeat('1',64), PH2 = repeat('2',64)

-- ============================================================ RLS ==========

-- Seed one request as the service (postgres) so client roles have something to
-- (fail to) read.
select tests.set_service();
insert into public.text_requests
    (id, org_id, location_id, stand_id, recipient_phone_hash, message_encrypted,
     encoding, unit_count, segments, dedupe_key)
values
    ('7f000000-0000-0000-0000-00000000000a', '7c000000-0000-0000-0000-00000000000a',
     '7d000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a',
     repeat('1', 64), 'v1:enc', 'gsm7', 40, 1, 'seed-dedupe-a');

-- anon holds no table privilege at all (defence in depth beneath RLS): the
-- anonymous customer never touches these tables.
select is(has_table_privilege('anon', 'public.text_requests', 'SELECT'), false,
    'anon has no SELECT privilege on text_requests');

select tests.set_actor('7b000000-0000-0000-0000-000000000003'); -- member of A
select is(
    (select count(*)::integer from public.text_requests where org_id = '7c000000-0000-0000-0000-00000000000a'),
    1, 'a member of the org can read its text_requests');

select tests.set_actor('7b000000-0000-0000-0000-000000000004'); -- outsider (org B)
select is(
    (select count(*)::integer from public.text_requests),
    0, 'an outsider sees none of another org''s text_requests');

-- Consent is owner/admin only.
select tests.set_service();
select app.sms_record_consent('7c000000-0000-0000-0000-00000000000a', repeat('1', 64),
    'v1:enc', 1::smallint, '1111', 'review_request', 'opted_in', 'owner_import', null, '{}'::jsonb, now());

select tests.set_actor('7b000000-0000-0000-0000-000000000003'); -- member
select is(
    (select count(*)::integer from public.sms_consent_state),
    0, 'a member cannot read consent state');

select tests.set_actor('7b000000-0000-0000-0000-000000000001'); -- owner
select is(
    (select count(*)::integer from public.sms_consent_state where org_id = '7c000000-0000-0000-0000-00000000000a'),
    1, 'an owner can read consent state');

-- No client role may insert a text_request directly.
select tests.set_actor('7b000000-0000-0000-0000-000000000001');
select throws_ok(
    $$ insert into public.text_requests
        (org_id, location_id, stand_id, recipient_phone_hash, message_encrypted, encoding, unit_count, segments, dedupe_key)
       values ('7c000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-00000000000a',
               '7e000000-0000-0000-0000-00000000000a', repeat('9',64), 'v1:x', 'gsm7', 1, 1, 'x') $$,
    '42501', NULL,
    'no client role may insert a text_request directly');

-- ==================================================== consent ledger =======

select tests.set_service();

select is(
    app.sms_current_consent('7c000000-0000-0000-0000-00000000000a', repeat('1',64), 'review_request'),
    'opted_in'::public.sms_consent_status, 'recorded consent is reflected in the projection');

select is(
    app.sms_current_consent('7c000000-0000-0000-0000-00000000000a', repeat('7',64), 'review_request'),
    'unknown'::public.sms_consent_status, 'an unknown number defaults to unknown, never opted-in');

-- Append-only: a new status appends an event and updates the projection.
select app.sms_record_consent('7c000000-0000-0000-0000-00000000000a', repeat('1',64),
    null, 1::smallint, null, 'review_request', 'opted_out', 'reply_stop', null, '{}'::jsonb, now());
select is(
    (select count(*)::integer from public.sms_consent_events
      where org_id = '7c000000-0000-0000-0000-00000000000a' and phone_hash = repeat('1',64)),
    2, 'consent history is appended, not overwritten');
select is(
    app.sms_current_consent('7c000000-0000-0000-0000-00000000000a', repeat('1',64), 'review_request'),
    'opted_out'::public.sms_consent_status, 'the projection tracks the latest event');

-- Duplicate identical signal does not append.
select is(
    (select appended from app.sms_record_consent('7c000000-0000-0000-0000-00000000000a', repeat('1',64),
        null, 1::smallint, null, 'review_request', 'opted_out', 'reply_stop', null, '{}'::jsonb, now())),
    false, 'an exact-duplicate consent signal is not appended');

-- ================================================ suppression + gate =======

-- Re-opt-in PH1 for gate tests.
select app.sms_record_consent('7c000000-0000-0000-0000-00000000000a', repeat('1',64),
    null, 1::smallint, null, 'review_request', 'opted_in', 'owner_import', null, '{}'::jsonb, now());

select is(
    (select allowed from app.sms_can_send('7c000000-0000-0000-0000-00000000000a', repeat('1',64), 'review_request')),
    true, 'opted-in and unsuppressed is allowed to send');

select is(
    (select allowed from app.sms_can_send('7c000000-0000-0000-0000-00000000000a', repeat('7',64), 'review_request')),
    false, 'a number with no consent is blocked');
select is(
    (select reason from app.sms_can_send('7c000000-0000-0000-0000-00000000000a', repeat('7',64), 'review_request')),
    'no_consent', 'the block reason for missing consent is no_consent');

select app.sms_add_suppression('7c000000-0000-0000-0000-00000000000a', repeat('1',64), 'review_request', 'opt_out', null, '{}'::jsonb);
select is(
    (select allowed from app.sms_can_send('7c000000-0000-0000-0000-00000000000a', repeat('1',64), 'review_request')),
    false, 'an active suppression blocks an otherwise opted-in number');
select is(
    (select reason from app.sms_can_send('7c000000-0000-0000-0000-00000000000a', repeat('1',64), 'review_request')),
    'opt_out', 'the block reason names the suppression');

select app.sms_remove_suppression('7c000000-0000-0000-0000-00000000000a', repeat('1',64), 'review_request', 'opt_out');
select is(
    (select allowed from app.sms_can_send('7c000000-0000-0000-0000-00000000000a', repeat('1',64), 'review_request')),
    true, 'removing the suppression restores the ability to send');

-- ===================================================== STOP / START ========

-- Inbound STOP opts out everywhere the number is known and suppresses.
select app.sms_apply_inbound_keyword(repeat('1',64), 'stop', '{}'::jsonb);
select is(
    app.sms_current_consent('7c000000-0000-0000-0000-00000000000a', repeat('1',64), 'review_request'),
    'opted_out'::public.sms_consent_status, 'inbound STOP opts the number out');
select is(
    (select allowed from app.sms_can_send('7c000000-0000-0000-0000-00000000000a', repeat('1',64), 'review_request')),
    false, 'inbound STOP blocks future sends');

-- Inbound START restores permission and clears the stop suppression.
select app.sms_apply_inbound_keyword(repeat('1',64), 'start', '{}'::jsonb);
select is(
    app.sms_current_consent('7c000000-0000-0000-0000-00000000000a', repeat('1',64), 'review_request'),
    'opted_in'::public.sms_consent_status, 'inbound START re-opts-in');
select is(
    (select allowed from app.sms_can_send('7c000000-0000-0000-0000-00000000000a', repeat('1',64), 'review_request')),
    true, 'inbound START restores the ability to send');

-- HELP never changes consent.
select app.sms_apply_inbound_keyword(repeat('1',64), 'help', '{}'::jsonb);
select is(
    app.sms_current_consent('7c000000-0000-0000-0000-00000000000a', repeat('1',64), 'review_request'),
    'opted_in'::public.sms_consent_status, 'inbound HELP leaves consent unchanged');

-- ================================================= state machine ==========

select ok(app.sms_request_transition_allowed('scheduled', 'queued'), 'scheduled -> queued is allowed');
select ok(not app.sms_request_transition_allowed('delivered', 'sending'), 'delivered -> sending is rejected');
select ok(not app.sms_request_transition_allowed('cancelled', 'queued'), 'cancelled is terminal');

-- ======================================================== quota ============

select app.sms_quota_allocate('7c000000-0000-0000-0000-00000000000a', 10, 'alloc-1', null, null);
select is(app.sms_quota_available('7c000000-0000-0000-0000-00000000000a'), 10::bigint, 'allocation increases available quota');

select is(
    (select reserved from app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000a', 3, 'resv-1', null)),
    true, 'a reservation within budget succeeds');
select is(app.sms_quota_available('7c000000-0000-0000-0000-00000000000a'), 7::bigint, 'a reservation reduces available quota');

-- Idempotent: same correlation key does not double-count.
select app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000a', 3, 'resv-1', null);
select is(app.sms_quota_available('7c000000-0000-0000-0000-00000000000a'), 7::bigint, 'a repeated reservation key does not double-spend');

-- Over-budget reservation is refused (no double-spend).
select is(
    (select reserved from app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000a', 100, 'resv-big', null)),
    false, 'a reservation beyond available quota is refused');
select is(app.sms_quota_available('7c000000-0000-0000-0000-00000000000a'), 7::bigint, 'a refused reservation leaves quota untouched');

-- ================================================= schedule pipeline =======

select app.sms_quota_allocate('7c000000-0000-0000-0000-00000000000a', 100, 'alloc-2', null, null);

select is(
    (select created from app.sms_schedule_request(
        '7c000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a',
        repeat('2',64), 'v1:enc', 1::smallint, '2222', 'v1:msg', 1::smallint, 'gsm7', 40, 1, 7500, 'USD',
        'UTC', now(), 'sched-dedupe-1', '7b000000-0000-0000-0000-000000000001', 'req-1')),
    true, 'scheduling creates a request');

select is(
    (select count(*)::integer from public.sms_outbox
      where org_id = '7c000000-0000-0000-0000-00000000000a'
        and topic = 'sms.dispatch' and idempotency_key like 'dispatch:%'),
    1, 'scheduling enqueues exactly one dispatch job');

-- Dedupe: same key returns the existing request and enqueues nothing new.
select is(
    (select created from app.sms_schedule_request(
        '7c000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a',
        repeat('2',64), 'v1:enc', 1::smallint, '2222', 'v1:msg', 1::smallint, 'gsm7', 40, 1, 7500, 'USD',
        'UTC', now(), 'sched-dedupe-1', '7b000000-0000-0000-0000-000000000001', 'req-1b')),
    false, 'a duplicate dedupe key returns the existing request');
select is(
    (select count(*)::integer from public.sms_outbox
      where org_id = '7c000000-0000-0000-0000-00000000000a' and topic = 'sms.dispatch'),
    1, 'a duplicate schedule does not enqueue a second job');

-- ==================================================== dispatch lifecycle ===

-- Recipient PH2 needs consent for the send to pass the gate.
select app.sms_record_consent('7c000000-0000-0000-0000-00000000000a', repeat('2',64),
    'v1:enc', 1::smallint, '2222', 'review_request', 'opted_in', 'owner_import', null, '{}'::jsonb, now());

select is(
    (select outcome from app.sms_begin_dispatch(
        (select id from public.text_requests where dedupe_key = 'sched-dedupe-1'),
        '7c000000-0000-0000-0000-00000000000a', 'fake')),
    'sending', 'begin_dispatch on an opted-in recipient enters sending');

select is(
    (select status::text from public.text_requests where dedupe_key = 'sched-dedupe-1'),
    'sending', 'the request is now sending');

-- Settle as submitted → request submitted, quota consumed.
select is(
    app.sms_settle_attempt(
        (select id from public.sms_delivery_attempts a
          join public.text_requests tr on tr.id = a.request_id where tr.dedupe_key = 'sched-dedupe-1' order by a.attempt_number desc limit 1),
        '7c000000-0000-0000-0000-00000000000a', 'submitted', 'fake_msg_1', null, '{}'::jsonb),
    'submitted', 'settling submitted returns submitted');
select is(
    (select status::text from public.text_requests where dedupe_key = 'sched-dedupe-1'),
    'submitted', 'the request is now submitted');

-- A delivery receipt resolves it to delivered.
select is(
    app.sms_apply_delivery_status('fake', 'fake_msg_1', 'delivered', null),
    'delivered', 'a delivery receipt marks the request delivered');
select is(
    (select status::text from public.text_requests where dedupe_key = 'sched-dedupe-1'),
    'delivered', 'the request reaches the terminal delivered state');

-- Suppressed at the gate: a recipient with no consent releases its reservation.
select app.sms_schedule_request(
    '7c000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a',
    repeat('8',64), 'v1:enc', 1::smallint, '8888', 'v1:msg', 1::smallint, 'gsm7', 40, 1, 7500, 'USD',
    'UTC', now(), 'sched-dedupe-supp', '7b000000-0000-0000-0000-000000000001', 'req-supp');
select is(
    (select outcome from app.sms_begin_dispatch(
        (select id from public.text_requests where dedupe_key = 'sched-dedupe-supp'),
        '7c000000-0000-0000-0000-00000000000a', 'fake')),
    'suppressed', 'a recipient with no consent is suppressed at the final gate');
select is(
    (select status::text from public.text_requests where dedupe_key = 'sched-dedupe-supp'),
    'suppressed', 'the suppressed request is terminal');

-- ======================================================= outbox ============

-- A fresh job to exercise the lease.
insert into public.sms_outbox (org_id, topic, idempotency_key, payload)
values ('7c000000-0000-0000-0000-00000000000a', 'sms.dispatch', 'outbox-test-1', '{}'::jsonb);

select is(
    (select count(*)::integer from app.sms_outbox_claim('worker-a', 10, 60) where idempotency_key = 'outbox-test-1'),
    1, 'a worker claims the pending job');
select is(
    (select count(*)::integer from app.sms_outbox_claim('worker-b', 10, 60) where idempotency_key = 'outbox-test-1'),
    0, 'a second worker cannot claim the leased job');

-- =================================================== webhook inbox =========

select is(
    (select inserted from app.sms_webhook_receive('fake', 'evt-1', 'evt-1', 'status', true, '{}'::jsonb, 'v1:enc')),
    true, 'a new webhook event is inserted');
select is(
    (select inserted from app.sms_webhook_receive('fake', 'evt-1', 'evt-1', 'status', true, '{}'::jsonb, 'v1:enc')),
    false, 'a duplicate webhook event is a harmless no-op');
select is(
    (select count(*)::integer from public.sms_webhook_inbox where provider = 'fake' and dedupe_key = 'evt-1'),
    1, 'a duplicate webhook does not create a second row');

-- ============================================ single in-flight guard =======

-- Schedule a guard request and open one attempt on it (PH2 is opted in), then
-- prove a second concurrent in-flight attempt is refused by the partial unique
-- index — the duplicate-send guard.
select app.sms_schedule_request(
    '7c000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a',
    repeat('2',64), 'v1:enc', 1::smallint, '2222', 'v1:msg', 1::smallint, 'gsm7', 40, 1, 7500, 'USD',
    'UTC', now(), 'sched-dedupe-guard', '7b000000-0000-0000-0000-000000000001', 'req-guard');
select app.sms_begin_dispatch(
    (select id from public.text_requests where dedupe_key = 'sched-dedupe-guard'),
    '7c000000-0000-0000-0000-00000000000a', 'fake');

select throws_ok(
    $$ insert into public.sms_delivery_attempts (org_id, request_id, attempt_number, provider, status)
       select '7c000000-0000-0000-0000-00000000000a',
              (select id from public.text_requests where dedupe_key = 'sched-dedupe-guard'),
              99, 'fake', 'created' $$,
    '23505', NULL,
    'a second in-flight attempt for one request is rejected by the unique guard');

select * from finish();
rollback;
