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
--   176 assertions in this file.

begin;

create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

select plan(176);

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

-- A fixed-offset IANA zone in which it is currently ~midday, so begin_dispatch's
-- quiet-hours recheck ([09:00,20:00) local) always permits a send regardless of
-- the wall-clock hour the suite runs at. Etc/GMT signs are inverted.
create or replace function tests.noon_zone() returns text
language sql stable as $$
    select case
        when (12 - extract(hour from now())::int) = 0 then 'UTC'
        when (12 - extract(hour from now())::int) > 0
            then 'Etc/GMT-' || (12 - extract(hour from now())::int)::text
        else 'Etc/GMT+' || abs(12 - extract(hour from now())::int)::text
    end;
$$;

-- A fixed-offset zone in which it is currently ~03:00, inside quiet hours, so
-- begin_dispatch defers. The offset is kept within the representable Etc/GMT
-- range [-12, +14] by shifting a full day when needed (local hour is unchanged).
create or replace function tests.night_zone() returns text
language sql stable as $$
    with o as (
        select case
            when (3 - extract(hour from now())::int) < -12
                then (3 - extract(hour from now())::int) + 24
            else (3 - extract(hour from now())::int)
        end as off
    )
    select case
        when off = 0 then 'UTC'
        when off > 0 then 'Etc/GMT-' || off::text
        else 'Etc/GMT+' || abs(off)::text
    end
    from o;
$$;

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

-- STOP before any consent row (PH3): a number we have never texted still becomes
-- opted out at the phone level, a later owner opt-in cannot override it, and only
-- the customer's own START clears it. Retried STOP is idempotent.
select app.sms_apply_inbound_keyword(repeat('3',64), 'stop', '{}'::jsonb);
select is(
    (select allowed from app.sms_can_send('7c000000-0000-0000-0000-00000000000a', repeat('3',64), 'review_request')),
    false, 'a STOP before any consent row still blocks (phone-level opt-out)');

select app.sms_record_consent('7c000000-0000-0000-0000-00000000000a', repeat('3',64),
    'v1:enc', 1::smallint, '3333', 'review_request', 'opted_in', 'owner_import', null, '{}'::jsonb, now());
select is(
    (select allowed from app.sms_can_send('7c000000-0000-0000-0000-00000000000a', repeat('3',64), 'review_request')),
    false, 'a later owner opt-in does not override the customer''s earlier STOP');

select app.sms_apply_inbound_keyword(repeat('3',64), 'start', '{}'::jsonb);
select is(
    (select allowed from app.sms_can_send('7c000000-0000-0000-0000-00000000000a', repeat('3',64), 'review_request')),
    true, 'the customer''s own START reverses the STOP and restores sending');

-- Retried/concurrent inbound STOP is idempotent: applying it twice leaves a
-- single phone-level opt-out row (concurrent processing is serialized by the
-- record path; a provider retry does not accumulate state).
select app.sms_apply_inbound_keyword(repeat('3',64), 'stop', '{}'::jsonb);
select app.sms_apply_inbound_keyword(repeat('3',64), 'stop', '{}'::jsonb);
select is(
    (select count(*)::integer from public.sms_phone_optout where phone_hash = repeat('3',64)),
    1, 'a retried inbound STOP is idempotent (one phone-level opt-out row)');

-- ================================================= state machine ==========

select ok(app.sms_request_transition_allowed('scheduled', 'queued'), 'scheduled -> queued is allowed');
select ok(not app.sms_request_transition_allowed('delivered', 'sending'), 'delivered -> sending is rejected');
select ok(not app.sms_request_transition_allowed('cancelled', 'queued'), 'cancelled is terminal');

-- ======================================================== quota ============

select app.sms_quota_allocate('7c000000-0000-0000-0000-00000000000a', 10, 'alloc-001', null, null);
select is(app.sms_quota_available('7c000000-0000-0000-0000-00000000000a'), 10::bigint, 'allocation increases available quota');

select is(
    (select reserved from app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000a', 3, 'resv-0001', null)),
    true, 'a reservation within budget succeeds');
select is(app.sms_quota_available('7c000000-0000-0000-0000-00000000000a'), 7::bigint, 'a reservation reduces available quota');

-- Idempotent: same correlation key does not double-count.
select app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000a', 3, 'resv-0001', null);
select is(app.sms_quota_available('7c000000-0000-0000-0000-00000000000a'), 7::bigint, 'a repeated reservation key does not double-spend');

-- Over-budget reservation is refused (no double-spend).
select is(
    (select reserved from app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000a', 100, 'resv-big', null)),
    false, 'a reservation beyond available quota is refused');
select is(app.sms_quota_available('7c000000-0000-0000-0000-00000000000a'), 7::bigint, 'a refused reservation leaves quota untouched');

-- Expired allocations are not spendable. Org B allocates a grant that has
-- already lapsed; it must contribute nothing to available quota and a
-- reservation against it must be refused.
select app.sms_quota_allocate('7c000000-0000-0000-0000-00000000000b', 5, 'alloc-exp1', now() - interval '1 hour', null);
select is(app.sms_quota_available('7c000000-0000-0000-0000-00000000000b'), 0::bigint,
    'an already-expired allocation contributes no available quota');
select is(
    (select reserved from app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000b', 1, 'resv-exp1', null)),
    false, 'a reservation against only-expired quota is refused');

-- ================================================= schedule pipeline =======

select app.sms_quota_allocate('7c000000-0000-0000-0000-00000000000a', 100, 'alloc-002', null, null);

select is(
    (select created from app.sms_schedule_request(
        '7c000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a',
        repeat('2',64), 'v1:enc', 1::smallint, '2222', 'v1:msg', 1::smallint, 'gsm7', 40, 1, 7500, 'USD',
        tests.noon_zone(), now(), 'sched-dedupe-1', '7b000000-0000-0000-0000-000000000001', 'req-1')),
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
        (select a.id from public.sms_delivery_attempts a
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

-- Quiet-hours defer: a due job whose recipient is currently inside quiet hours
-- is deferred to the next window rather than sent, and no attempt is opened.
select app.sms_record_consent('7c000000-0000-0000-0000-00000000000a', repeat('5',64),
    'v1:enc', 1::smallint, '5555', 'review_request', 'opted_in', 'owner_import', null, '{}'::jsonb, now());
select app.sms_schedule_request(
    '7c000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a',
    repeat('5',64), 'v1:enc', 1::smallint, '5555', 'v1:msg', 1::smallint, 'gsm7', 40, 1, 7500, 'USD',
    tests.night_zone(), now(), 'sched-dedupe-night', '7b000000-0000-0000-0000-000000000001', 'req-night');
select is(
    (select outcome from app.sms_begin_dispatch(
        (select id from public.text_requests where dedupe_key = 'sched-dedupe-night'),
        '7c000000-0000-0000-0000-00000000000a', 'fake')),
    'deferred', 'a send in the recipient''s quiet hours is deferred, not sent');
select is(
    (select status::text from public.text_requests where dedupe_key = 'sched-dedupe-night'),
    'scheduled', 'a deferred request stays scheduled with no attempt opened');

-- Stranded-'sending' recovery: a request whose worker died mid-send (status
-- stuck at sending, attempt never settled) is parked as provider_unknown on the
-- next claim, never re-sent and never left stuck forever.
select app.sms_record_consent('7c000000-0000-0000-0000-00000000000a', repeat('6',64),
    'v1:enc', 1::smallint, '6666', 'review_request', 'opted_in', 'owner_import', null, '{}'::jsonb, now());
select app.sms_schedule_request(
    '7c000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a',
    repeat('6',64), 'v1:enc', 1::smallint, '6666', 'v1:msg', 1::smallint, 'gsm7', 40, 1, 7500, 'USD',
    tests.noon_zone(), now(), 'sched-dedupe-recover', '7b000000-0000-0000-0000-000000000001', 'req-recover');
-- First claim opens the attempt and moves it to sending.
select app.sms_begin_dispatch(
    (select id from public.text_requests where dedupe_key = 'sched-dedupe-recover'),
    '7c000000-0000-0000-0000-00000000000a', 'fake');
-- A later claim (the prior worker never settled) recovers it.
select is(
    (select outcome from app.sms_begin_dispatch(
        (select id from public.text_requests where dedupe_key = 'sched-dedupe-recover'),
        '7c000000-0000-0000-0000-00000000000a', 'fake')),
    'recovered_unknown', 'a stranded sending request is recovered, not lost');
select is(
    (select status::text from public.text_requests where dedupe_key = 'sched-dedupe-recover'),
    'provider_unknown', 'the recovered request becomes provider_unknown for reconciliation');

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

-- First receipt inserts the event.
select is(
    (select inserted from app.sms_webhook_receive('fake', 'evt-0001', 'evt-0001', 'status', true, '{}'::jsonb, 'v1:enc')),
    true, 'a new webhook event is inserted');

-- Settle it as processed, then a retry of an ALREADY-PROCESSED event is a
-- harmless no-op (inserted=false). A retry of an unprocessed/failed event, by
-- contrast, is intentionally reclaimed for reprocessing — that is the durable
-- webhook recovery path, so only a fully-processed event is a true duplicate.
select app.sms_webhook_settle(
    (select id from public.sms_webhook_inbox where provider = 'fake' and dedupe_key = 'evt-0001'),
    'processed', null, null);
select is(
    (select inserted from app.sms_webhook_receive('fake', 'evt-0001', 'evt-0001', 'status', true, '{}'::jsonb, 'v1:enc')),
    false, 'a retry of an already-processed webhook is a harmless no-op');
select is(
    (select count(*)::integer from public.sms_webhook_inbox where provider = 'fake' and dedupe_key = 'evt-0001'),
    1, 'a duplicate webhook does not create a second row');

-- ============================================ single in-flight guard =======

-- Schedule a guard request and open one attempt on it, then prove a second
-- concurrent in-flight attempt is refused by the partial unique index — the
-- duplicate-send guard. Uses a fresh recipient (PH4) that is opted in and has no
-- recent_send suppression, so begin_dispatch actually opens an attempt.
select app.sms_record_consent('7c000000-0000-0000-0000-00000000000a', repeat('4',64),
    'v1:enc', 1::smallint, '4444', 'review_request', 'opted_in', 'owner_import', null, '{}'::jsonb, now());
select app.sms_schedule_request(
    '7c000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a',
    repeat('4',64), 'v1:enc', 1::smallint, '4444', 'v1:msg', 1::smallint, 'gsm7', 40, 1, 7500, 'USD',
    tests.noon_zone(), now(), 'sched-dedupe-guard', '7b000000-0000-0000-0000-000000000001', 'req-guard');
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

-- ================================ transition table fixes ==================

-- sending → queued is now allowed (429 retryable).
select ok(app.sms_request_transition_allowed('sending', 'queued'),
    'sending -> queued is allowed (retryable 429)');

-- provider_unknown → queued is now blocked (duplicate-send footgun).
select ok(not app.sms_request_transition_allowed('provider_unknown', 'queued'),
    'provider_unknown -> queued is blocked (duplicate-send risk)');

-- failed → queued is now blocked.
select ok(not app.sms_request_transition_allowed('failed', 'queued'),
    'failed -> queued is blocked (create new request instead)');

-- queued → failed is allowed (outbox retry budget exhausted).
select ok(app.sms_request_transition_allowed('queued', 'failed'),
    'queued -> failed is allowed (exhausted outbox retries)');

-- ================================ settle_attempt retryable ================

-- Schedule a request, begin dispatch, then settle as retryable. The attempt
-- should be failed, the request should be back at queued, and quota stays
-- reserved (not released).
select app.sms_record_consent('7c000000-0000-0000-0000-00000000000a', repeat('a',64),
    'v1:enc', 1::smallint, '0101', 'review_request', 'opted_in', 'owner_import', null, '{}'::jsonb, now());
select app.sms_schedule_request(
    '7c000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a',
    repeat('a',64), 'v1:enc', 1::smallint, '0101', 'v1:msg', 1::smallint, 'gsm7', 40, 1, 7500, 'USD',
    tests.noon_zone(), now(), 'sched-dedupe-retryable', '7b000000-0000-0000-0000-000000000001', 'req-retryable');

select app.sms_begin_dispatch(
    (select id from public.text_requests where dedupe_key = 'sched-dedupe-retryable'),
    '7c000000-0000-0000-0000-00000000000a', 'fake');

select is(
    app.sms_settle_attempt(
        (select a.id from public.sms_delivery_attempts a
          join public.text_requests tr on tr.id = a.request_id
         where tr.dedupe_key = 'sched-dedupe-retryable'
         order by a.attempt_number desc limit 1),
        '7c000000-0000-0000-0000-00000000000a', 'retryable', null, 'rate_limited', '{}'::jsonb),
    'retryable', 'settling retryable returns retryable');

select is(
    (select status::text from public.text_requests where dedupe_key = 'sched-dedupe-retryable'),
    'queued', 'retryable moves request back to queued for retry');

select is(
    (select a.status::text from public.sms_delivery_attempts a
      join public.text_requests tr on tr.id = a.request_id
     where tr.dedupe_key = 'sched-dedupe-retryable'
     order by a.attempt_number desc limit 1),
    'failed', 'retryable attempt is marked failed');

-- ================================ credit expiry fixes ====================

-- Use Org B for isolated quota tests. Clear any existing Org B balance state.
delete from public.sms_quota_ledger where org_id = '7c000000-0000-0000-0000-00000000000b';
delete from public.sms_quota_balance where org_id = '7c000000-0000-0000-0000-00000000000b';

-- Test: allocate 100, consume 60, expire → available must be 0 (not -60).
-- Then allocate 100 again → available must be 100 (not 40).
select app.sms_quota_allocate('7c000000-0000-0000-0000-00000000000b', 100, 'expiry-alloc-1',
    null, null);

-- Simulate consumption of 60 credits. We need to reserve first, then consume.
select app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000b', 60, 'expiry-resv-1', null);
select app.sms_quota_consume('7c000000-0000-0000-0000-00000000000b', 60, 'expiry-cons-1', null);

-- Mark the allocation as expired retroactively. We set expires_at after
-- reserve/consume so that reserve's internal apply_expirations call doesn't
-- fire before the usage entries exist.
update public.sms_quota_ledger
   set expires_at = now() - interval '1 second'
 where org_id = '7c000000-0000-0000-0000-00000000000b'
   and kind = 'allocation' and correlation_key = 'expiry-alloc-1';

-- Now expire. The fixed function should expire only the remaining 40, not 100.
select is(
    app.sms_quota_apply_expirations('7c000000-0000-0000-0000-00000000000b'),
    1, 'one allocation expired');

-- Check the expiration ledger entry is for the remaining 40, not the original 100.
select is(
    (select amount from public.sms_quota_ledger
     where org_id = '7c000000-0000-0000-0000-00000000000b' and kind = 'expiration' limit 1),
    40::bigint, 'expiry amount is remaining 40, not original 100');

-- Balance: allocated should be 60 (100 - 40 expired), consumed 60, available 0.
select is(
    (select allocated from public.sms_quota_balance where org_id = '7c000000-0000-0000-0000-00000000000b'),
    60::bigint, 'allocated = 100 - 40 expired = 60');

select is(
    app.sms_quota_available('7c000000-0000-0000-0000-00000000000b'),
    0::bigint, 'available = 0 after expiry (allocated 60 - consumed 60)');

-- Now allocate 100 more → available must be 100.
select app.sms_quota_allocate('7c000000-0000-0000-0000-00000000000b', 100, 'expiry-alloc-2', null, null);
select is(
    app.sms_quota_available('7c000000-0000-0000-0000-00000000000b'),
    100::bigint, 'after new allocation: available = 100, not 40 (the bug)');

-- ================================ overlapping grants ======================

-- Two grants, both expire. Each should expire only its own unused remainder.
delete from public.sms_quota_ledger where org_id = '7c000000-0000-0000-0000-00000000000b';
delete from public.sms_quota_balance where org_id = '7c000000-0000-0000-0000-00000000000b';

-- Grant A: 50 credits. Consume 20 against it.
select app.sms_quota_allocate('7c000000-0000-0000-0000-00000000000b', 50, 'overlap-alloc-a',
    null, null);
select app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000b', 20, 'overlap-resv-a', null);
select app.sms_quota_consume('7c000000-0000-0000-0000-00000000000b', 20, 'overlap-cons-a', null);

-- Grant B: 30 credits. Consume 10 against it.
select app.sms_quota_allocate('7c000000-0000-0000-0000-00000000000b', 30, 'overlap-alloc-b',
    null, null);
select app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000b', 10, 'overlap-resv-b', null);
select app.sms_quota_consume('7c000000-0000-0000-0000-00000000000b', 10, 'overlap-cons-b', null);

-- Space allocations into distinct effective_at windows. FIFO attribution
-- (effective_at, id) no longer needs this, but keeping the order explicit
-- documents which grant is oldest.
update public.sms_quota_ledger set effective_at = now() - interval '10 seconds'
 where org_id = '7c000000-0000-0000-0000-00000000000b'
   and kind = 'allocation' and correlation_key = 'overlap-alloc-a';
update public.sms_quota_ledger set effective_at = now() - interval '8 seconds'
 where org_id = '7c000000-0000-0000-0000-00000000000b'
   and kind = 'reservation' and correlation_key = 'overlap-resv-a';
update public.sms_quota_ledger set effective_at = now() - interval '5 seconds'
 where org_id = '7c000000-0000-0000-0000-00000000000b'
   and kind = 'allocation' and correlation_key = 'overlap-alloc-b';
update public.sms_quota_ledger set effective_at = now() - interval '3 seconds'
 where org_id = '7c000000-0000-0000-0000-00000000000b'
   and kind = 'reservation' and correlation_key = 'overlap-resv-b';
update public.sms_quota_ledger
   set expires_at = now() - interval '2 seconds'
 where org_id = '7c000000-0000-0000-0000-00000000000b'
   and kind = 'allocation' and correlation_key = 'overlap-alloc-a';
update public.sms_quota_ledger
   set expires_at = now() - interval '1 second'
 where org_id = '7c000000-0000-0000-0000-00000000000b'
   and kind = 'allocation' and correlation_key = 'overlap-alloc-b';

-- Both expire: A expires 30 (50-20), B expires 20 (30-10).
select is(
    app.sms_quota_apply_expirations('7c000000-0000-0000-0000-00000000000b'),
    2, 'two overlapping allocations expired');

select is(
    app.sms_quota_available('7c000000-0000-0000-0000-00000000000b'),
    0::bigint, 'overlapping grants: available = 0 after both expire');

-- Balance projection: allocated = 80 - 50 expired = 30, consumed = 30.
select is(
    (select allocated from public.sms_quota_balance where org_id = '7c000000-0000-0000-0000-00000000000b'),
    30::bigint, 'overlapping grants: allocated projection after expiry');

-- ================================ reserve across expiry ===================

delete from public.sms_quota_ledger where org_id = '7c000000-0000-0000-0000-00000000000b';
delete from public.sms_quota_balance where org_id = '7c000000-0000-0000-0000-00000000000b';

-- Allocate 50 (expired) + 50 (fresh). Reserve 30. Only fresh quota is spendable.
select app.sms_quota_allocate('7c000000-0000-0000-0000-00000000000b', 50, 'race-alloc-expired',
    now() - interval '1 second', null);
select app.sms_quota_allocate('7c000000-0000-0000-0000-00000000000b', 50, 'race-alloc-fresh', null, null);

-- The reservation sweeps expirations first, then checks availability.
select is(
    (select reserved from app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000b', 30, 'race-resv-1', null)),
    true, 'reservation against fresh quota succeeds after expired is swept');

select is(
    app.sms_quota_available('7c000000-0000-0000-0000-00000000000b'),
    20::bigint, 'available = 50 fresh - 30 reserved = 20');

-- A reservation beyond the remaining should fail.
select is(
    (select reserved from app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000b', 25, 'race-resv-too-big', null)),
    false, 'reservation beyond fresh available is refused');

-- ================================ refund after expiry =====================

delete from public.sms_quota_ledger where org_id = '7c000000-0000-0000-0000-00000000000b';
delete from public.sms_quota_balance where org_id = '7c000000-0000-0000-0000-00000000000b';

-- Allocate 50, consume 50, expire the grant, then refund 10. A provider refund
-- of an expired grant must not resurrect spendable credits (double-send footgun).
select app.sms_quota_allocate('7c000000-0000-0000-0000-00000000000b', 50, 'refund-alloc-1',
    null, null);
select app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000b', 50, 'refund-resv-1', null);
select app.sms_quota_consume('7c000000-0000-0000-0000-00000000000b', 50, 'refund-cons-1', null);

-- Mark expired retroactively after consumption exists.
update public.sms_quota_ledger
   set expires_at = now() - interval '1 second'
 where org_id = '7c000000-0000-0000-0000-00000000000b'
   and kind = 'allocation' and correlation_key = 'refund-alloc-1';

-- Expire: all 50 consumed, so remaining is 0. A zero-amount marker is recorded.
select app.sms_quota_apply_expirations('7c000000-0000-0000-0000-00000000000b');

-- Refund 10 after expiry.
select app.sms_quota_refund('7c000000-0000-0000-0000-00000000000b', 10, 'refund-ref-1', null);

-- consumed drops from 50 to 40, but the grant already lapsed: residual unused
-- must expire too. available stays 0 (not 10).
select is(
    app.sms_quota_available('7c000000-0000-0000-0000-00000000000b'),
    0::bigint, 'refund after expiry does not resurrect expired-grant credits');

select is(
    (select reserved from app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000b', 1, 'refund-resv-illegal', null)),
    false, 'refunded expired credits cannot be reserved again');

select is(
    (select count(*)::integer from public.sms_quota_ledger
      where org_id = '7c000000-0000-0000-0000-00000000000b' and kind = 'consumption'),
    1, 'refund after expiry does not double-consume the original send');

-- ================================ replay ledger = balance =================

-- The ledger is the source of truth. Replay all entries and verify the balance
-- projection matches.
select is(
    (select b.allocated - b.reserved - b.consumed
       from public.sms_quota_balance b
      where b.org_id = '7c000000-0000-0000-0000-00000000000b'),
    (select
        coalesce(sum(case when kind = 'allocation' then amount else 0 end), 0)
      - coalesce(sum(case when kind = 'expiration' then amount else 0 end), 0)
      - coalesce(sum(case when kind = 'reservation' then amount else 0 end), 0)
      + coalesce(sum(case when kind = 'release' then amount else 0 end), 0)
      + coalesce(sum(case when kind = 'refund' then amount else 0 end), 0)
     from public.sms_quota_ledger
     where org_id = '7c000000-0000-0000-0000-00000000000b')::bigint,
    'replayed ledger matches balance projection for Org B');

-- ===================== expired credits must not revive after release =====

-- A live grant still returns capacity when a reservation is released.
delete from public.sms_quota_ledger where org_id = '7c000000-0000-0000-0000-00000000000b';
delete from public.sms_quota_balance where org_id = '7c000000-0000-0000-0000-00000000000b';

select app.sms_quota_allocate('7c000000-0000-0000-0000-00000000000b', 50, 'live-rel-alloc', null, null);
select app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000b', 30, 'live-rel-resv', null);
select app.sms_quota_release('7c000000-0000-0000-0000-00000000000b', 30, 'live-rel-resv', null);
select is(
    app.sms_quota_available('7c000000-0000-0000-0000-00000000000b'),
    50::bigint, 'release of a live grant restores available quota');

-- Reserve against a grant, expire the unused remainder, then release.
-- The reserved 30 was attributed to the expired grant and must not become
-- spendable (that would fund a duplicate send).
delete from public.sms_quota_ledger where org_id = '7c000000-0000-0000-0000-00000000000b';
delete from public.sms_quota_balance where org_id = '7c000000-0000-0000-0000-00000000000b';

select app.sms_quota_allocate('7c000000-0000-0000-0000-00000000000b', 50, 'rel-exp-alloc', null, null);
select app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000b', 30, 'rel-exp-resv', null);
update public.sms_quota_ledger
   set expires_at = now() - interval '1 second'
 where org_id = '7c000000-0000-0000-0000-00000000000b'
   and kind = 'allocation' and correlation_key = 'rel-exp-alloc';
select app.sms_quota_apply_expirations('7c000000-0000-0000-0000-00000000000b');
select app.sms_quota_release('7c000000-0000-0000-0000-00000000000b', 30, 'rel-exp-resv', null);

select is(
    app.sms_quota_available('7c000000-0000-0000-0000-00000000000b'),
    0::bigint, 'release after expiry does not resurrect expired-grant credits');

select is(
    (select allocated from public.sms_quota_balance
      where org_id = '7c000000-0000-0000-0000-00000000000b'),
    0::bigint, 'release after expiry expires the residual reserved amount');

select is(
    (select reserved from app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000b', 10, 'rel-exp-illegal', null)),
    false, 'released expired credits cannot fund another send');

select is(
    (select count(*)::integer from public.sms_quota_ledger
      where org_id = '7c000000-0000-0000-0000-00000000000b' and kind = 'consumption'),
    0, 'expiry then release never consumes (no duplicate send)');

select app.sms_quota_allocate('7c000000-0000-0000-0000-00000000000b', 20, 'rel-exp-fresh', null, null);
select is(
    (select reserved from app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000b', 10, 'rel-exp-fresh-resv', null)),
    true, 'a later non-expired allocation remains spendable');

-- ======================== SENTINEL H5: second refund residual =============

-- Two failed deliveries against one expired grant. A singleton residual key
-- plus ON CONFLICT DO NOTHING dropped leftover #2: available() stayed 0 while
-- reserve spent allocated-reserved-consumed (Refund2 → reserve(10)=true;
-- grant20 + refund2 → reserve(25)=true). Residual must be additive.
delete from public.sms_quota_ledger where org_id = '7c000000-0000-0000-0000-00000000000b';
delete from public.sms_quota_balance where org_id = '7c000000-0000-0000-0000-00000000000b';

select app.sms_quota_allocate('7c000000-0000-0000-0000-00000000000b', 20, 'h5-alloc-1', null, null);
select app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000b', 10, 'h5-resv-1', null);
select app.sms_quota_consume('7c000000-0000-0000-0000-00000000000b', 10, 'h5-cons-1', null);
select app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000b', 10, 'h5-resv-2', null);
select app.sms_quota_consume('7c000000-0000-0000-0000-00000000000b', 10, 'h5-cons-2', null);
update public.sms_quota_ledger
   set expires_at = now() - interval '1 second'
 where org_id = '7c000000-0000-0000-0000-00000000000b'
   and kind = 'allocation' and correlation_key = 'h5-alloc-1';
select app.sms_quota_apply_expirations('7c000000-0000-0000-0000-00000000000b');
select app.sms_quota_refund('7c000000-0000-0000-0000-00000000000b', 10, 'h5-ref-1', null);
select app.sms_quota_refund('7c000000-0000-0000-0000-00000000000b', 10, 'h5-ref-2', null);

select is(
    app.sms_quota_available('7c000000-0000-0000-0000-00000000000b'),
    0::bigint, 'H5: available stays 0 after two refund residuals on one expired grant');

select is(
    (select reserved from app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000b', 10, 'h5-illegal-10', null)),
    false, 'H5: Refund2 → reserve(10) must not reopen expired leftovers');

select is(
    (select allocated from public.sms_quota_balance
      where org_id = '7c000000-0000-0000-0000-00000000000b'),
    0::bigint, 'H5: additive residual retires the expired grant in the projection');

select is(
    (select amount from public.sms_quota_ledger
      where org_id = '7c000000-0000-0000-0000-00000000000b'
        and kind = 'expiration'
        and correlation_key = 'expire:' || (
            select id::text from public.sms_quota_ledger
             where org_id = '7c000000-0000-0000-0000-00000000000b'
               and kind = 'allocation' and correlation_key = 'h5-alloc-1')
            || ':residual'),
    20::bigint, 'H5: residual ledger is additive across two refunds, not DO NOTHING');

select is(
    app.sms_quota_available('7c000000-0000-0000-0000-00000000000b'),
    (select b.allocated - b.reserved - b.consumed
       from public.sms_quota_balance b
      where b.org_id = '7c000000-0000-0000-0000-00000000000b'),
    'H5: available() and the post-sweep reserve gate share the same projection');

select app.sms_quota_allocate('7c000000-0000-0000-0000-00000000000b', 20, 'h5-alloc-fresh', null, null);

select is(
    app.sms_quota_available('7c000000-0000-0000-0000-00000000000b'),
    20::bigint, 'H5: a later live grant of 20 is the only spendable quota');

select is(
    (select reserved from app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000b', 25, 'h5-illegal-25', null)),
    false, 'H5: grant20 + refund2 → reserve(25) must not spend expired leftovers');

select is(
    app.sms_quota_available('7c000000-0000-0000-0000-00000000000b'),
    20::bigint, 'H5: refused reserve(25) leaves the live grant untouched');

select is(
    (select reserved from app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000b', 20, 'h5-live-20', null)),
    true, 'H5: the later live grant remains fully spendable');

-- ================================ receipt-before-SID lifecycle ============

-- Prove the race: terminal webhook arrives before attempt exists, then after the
-- attempt is settled the same webhook applies exactly once.

-- 1. A delivery receipt arrives for a provider_message_id that has no attempt yet.
select is(
    app.sms_apply_delivery_status('fake', 'fake_receipt_early', 'delivered', null),
    'no_matching_attempt', 'receipt before SID returns no_matching_attempt');

-- 2. Now create the request and settle the attempt with that SID.
select app.sms_record_consent('7c000000-0000-0000-0000-00000000000a', repeat('b',64),
    'v1:enc', 1::smallint, '0202', 'review_request', 'opted_in', 'owner_import', null, '{}'::jsonb, now());
select app.sms_schedule_request(
    '7c000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a',
    repeat('b',64), 'v1:enc', 1::smallint, '0202', 'v1:msg', 1::smallint, 'gsm7', 40, 1, 7500, 'USD',
    tests.noon_zone(), now(), 'sched-dedupe-early-rcpt', '7b000000-0000-0000-0000-000000000001', 'req-early-rcpt');

select app.sms_begin_dispatch(
    (select id from public.text_requests where dedupe_key = 'sched-dedupe-early-rcpt'),
    '7c000000-0000-0000-0000-00000000000a', 'fake');

-- Settle the attempt as submitted with the same SID.
select app.sms_settle_attempt(
    (select a.id from public.sms_delivery_attempts a
      join public.text_requests tr on tr.id = a.request_id
     where tr.dedupe_key = 'sched-dedupe-early-rcpt'
     order by a.attempt_number desc limit 1),
    '7c000000-0000-0000-0000-00000000000a', 'submitted', 'fake_receipt_early', null, '{}'::jsonb);

select is(
    (select status::text from public.text_requests where dedupe_key = 'sched-dedupe-early-rcpt'),
    'submitted', 'request is submitted after settling with SID');

-- 3. Now replay the same delivery receipt — it should apply exactly once.
select is(
    app.sms_apply_delivery_status('fake', 'fake_receipt_early', 'delivered', null),
    'delivered', 'replayed receipt after SID resolves to delivered');

select is(
    (select status::text from public.text_requests where dedupe_key = 'sched-dedupe-early-rcpt'),
    'delivered', 'request reaches delivered after receipt replay');

-- 4. A second replay of the same receipt is idempotent (already delivered).
select is(
    app.sms_apply_delivery_status('fake', 'fake_receipt_early', 'delivered', null),
    'ignored', 'second replay of same receipt is ignored (already delivered)');

-- ================================ equal-timestamp FIFO expiry ==============

-- Two grants created in one transaction share now(). Inclusive timestamp
-- windows would attribute the same 30 reserved credits to both grants and
-- expire only 40 (leaving 30 spendable). FIFO (effective_at, id) expires 70.
delete from public.sms_quota_ledger where org_id = '7c000000-0000-0000-0000-00000000000b';
delete from public.sms_quota_balance where org_id = '7c000000-0000-0000-0000-00000000000b';

select app.sms_quota_allocate('7c000000-0000-0000-0000-00000000000b', 50, 'fifo-alloc-a',
    null, null);
select app.sms_quota_allocate('7c000000-0000-0000-0000-00000000000b', 50, 'fifo-alloc-b',
    null, null);
select app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000b', 30, 'fifo-resv-1', null);

-- Force identical effective_at so the old window query would overlap completely.
update public.sms_quota_ledger
   set effective_at = timestamptz '2026-01-01 00:00:00+00'
 where org_id = '7c000000-0000-0000-0000-00000000000b'
   and kind in ('allocation', 'reservation');
update public.sms_quota_ledger
   set expires_at = now() - interval '1 second'
 where org_id = '7c000000-0000-0000-0000-00000000000b'
   and kind = 'allocation';

-- Pre-sweep read path must use the same FIFO remainder (70 unswept unused).
select is(
    app.sms_quota_available('7c000000-0000-0000-0000-00000000000b'),
    0::bigint, 'equal-timestamp grants: available is 0 before the sweep');

select is(
    app.sms_quota_apply_expirations('7c000000-0000-0000-0000-00000000000b'),
    2, 'equal-timestamp grants: both allocations expired');

select is(
    (select coalesce(sum(amount), 0)::bigint from public.sms_quota_ledger
      where org_id = '7c000000-0000-0000-0000-00000000000b' and kind = 'expiration'),
    70::bigint, 'equal-timestamp grants: expire 70 (100-30), not 40 from double-attribution');

select is(
    app.sms_quota_available('7c000000-0000-0000-0000-00000000000b'),
    0::bigint, 'equal-timestamp grants: available is 0 after sweep');

select is(
    (select allocated from public.sms_quota_balance where org_id = '7c000000-0000-0000-0000-00000000000b'),
    30::bigint, 'equal-timestamp grants: allocated projection is the reserved remainder');

-- ===================== expired grant must not be FIFO prior capacity =====

-- Unused grant A expires fully, then grant B takes a reservation and expires.
-- prior_capacity must not still count A: that makes B look unused, expires B
-- in full, and leaves reserved credits against allocated=0 (negative available).
delete from public.sms_quota_ledger where org_id = '7c000000-0000-0000-0000-00000000000b';
delete from public.sms_quota_balance where org_id = '7c000000-0000-0000-0000-00000000000b';

select app.sms_quota_allocate('7c000000-0000-0000-0000-00000000000b', 100, 'ghost-fifo-a',
    null, null);
-- A must be strictly older than B. Equal now() plus UUID order can hide the
-- ghost-capacity case when B sorts first.
update public.sms_quota_ledger
   set expires_at = now() - interval '1 second',
       effective_at = now() - interval '10 seconds'
 where org_id = '7c000000-0000-0000-0000-00000000000b'
   and kind = 'allocation' and correlation_key = 'ghost-fifo-a';
select app.sms_quota_apply_expirations('7c000000-0000-0000-0000-00000000000b');

select is(
    (select allocated from public.sms_quota_balance where org_id = '7c000000-0000-0000-0000-00000000000b'),
    0::bigint, 'unused expired grant A leaves allocated at 0');

select app.sms_quota_allocate('7c000000-0000-0000-0000-00000000000b', 50, 'ghost-fifo-b',
    null, null);
select is(
    (select reserved from app.sms_quota_reserve('7c000000-0000-0000-0000-00000000000b', 30, 'ghost-fifo-resv-b', null)),
    true, 'reservation against grant B succeeds after unused A expired');

select is(
    app.sms_quota_fifo_used(
        '7c000000-0000-0000-0000-00000000000b',
        (select id from public.sms_quota_ledger
          where org_id = '7c000000-0000-0000-0000-00000000000b'
            and kind = 'allocation' and correlation_key = 'ghost-fifo-b')),
    30::bigint,
    'expired grant A is not prior_capacity: B is charged the 30 reserved');

update public.sms_quota_ledger
   set expires_at = now() - interval '1 second'
 where org_id = '7c000000-0000-0000-0000-00000000000b'
   and kind = 'allocation' and correlation_key = 'ghost-fifo-b';

select ok(
    app.sms_quota_available('7c000000-0000-0000-0000-00000000000b') >= 0,
    'available cannot go negative while B is expired but unswept');

select is(
    app.sms_quota_available('7c000000-0000-0000-0000-00000000000b'),
    0::bigint, 'unswept B expires only its unused 20; reserved 30 stay covered');

select is(
    app.sms_quota_apply_expirations('7c000000-0000-0000-0000-00000000000b'),
    1, 'grant B is swept once');

select is(
    (select amount from public.sms_quota_ledger
      where org_id = '7c000000-0000-0000-0000-00000000000b'
        and kind = 'expiration'
        and correlation_key = 'expire:' || (
            select id::text from public.sms_quota_ledger
             where org_id = '7c000000-0000-0000-0000-00000000000b'
               and kind = 'allocation' and correlation_key = 'ghost-fifo-b')),
    20::bigint, 'grant B expires unused 20, not the full 50');

select is(
    (select allocated from public.sms_quota_balance where org_id = '7c000000-0000-0000-0000-00000000000b'),
    30::bigint, 'after B expires, allocated covers the outstanding reservation');

select is(
    app.sms_quota_available('7c000000-0000-0000-0000-00000000000b'),
    0::bigint, 'after B expires, available is 0 not negative');

-- ================================ atomic receipt replay after settle ======

-- Park a terminal receipt, then settle the attempt with that SID. Replay must
-- run inside settle — the request becomes delivered without a second webhook.
select is(
    (select inserted from app.sms_webhook_receive(
        'fake', 'evt-atomic-sid', 'evt-atomic-sid', 'status', true, '{}'::jsonb, 'v1:enc')),
    true, 'atomic-replay webhook is inserted');

select is(
    app.sms_apply_or_park_delivery_status(
        (select id from public.sms_webhook_inbox where provider = 'fake' and dedupe_key = 'evt-atomic-sid'),
        'fake', 'fake_atomic_sid', 'delivered', null),
    'no_matching_attempt', 'parked receipt before SID returns no_matching_attempt');

select is(
    (select status::text from public.sms_webhook_inbox
      where provider = 'fake' and dedupe_key = 'evt-atomic-sid'),
    'received', 'parked receipt stays received for internal replay');

select is(
    (select pending_terminal from public.sms_webhook_inbox
      where provider = 'fake' and dedupe_key = 'evt-atomic-sid'),
    'delivered', 'parked receipt stores the terminal status by SID');

select app.sms_record_consent('7c000000-0000-0000-0000-00000000000a', repeat('c',64),
    'v1:enc', 1::smallint, '0303', 'review_request', 'opted_in', 'owner_import', null, '{}'::jsonb, now());
select app.sms_schedule_request(
    '7c000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a',
    repeat('c',64), 'v1:enc', 1::smallint, '0303', 'v1:msg', 1::smallint, 'gsm7', 40, 1, 7500, 'USD',
    tests.noon_zone(), now(), 'sched-dedupe-atomic-rcpt', '7b000000-0000-0000-0000-000000000001', 'req-atomic-rcpt');

select app.sms_begin_dispatch(
    (select id from public.text_requests where dedupe_key = 'sched-dedupe-atomic-rcpt'),
    '7c000000-0000-0000-0000-00000000000a', 'fake');

select app.sms_settle_attempt(
    (select a.id from public.sms_delivery_attempts a
      join public.text_requests tr on tr.id = a.request_id
     where tr.dedupe_key = 'sched-dedupe-atomic-rcpt'
     order by a.attempt_number desc limit 1),
    '7c000000-0000-0000-0000-00000000000a', 'submitted', 'fake_atomic_sid', null, '{}'::jsonb);

select is(
    (select status::text from public.text_requests where dedupe_key = 'sched-dedupe-atomic-rcpt'),
    'delivered', 'settle with SID atomically applies the parked delivered receipt');

select is(
    (select status::text from public.sms_webhook_inbox
      where provider = 'fake' and dedupe_key = 'evt-atomic-sid'),
    'processed', 'parked inbox row is processed by settle replay');

select is(
    (select pending_terminal from public.sms_webhook_inbox
      where provider = 'fake' and dedupe_key = 'evt-atomic-sid'),
    null, 'pending terminal is cleared after internal replay');

-- ================================ dead-letter releases queued quota =======

-- Retryable settle leaves the request queued with reservation. Exhausting the
-- outbox must fail the request and release credits in the same transaction.
select app.sms_record_consent('7c000000-0000-0000-0000-00000000000a', repeat('d',64),
    'v1:enc', 1::smallint, '0404', 'review_request', 'opted_in', 'owner_import', null, '{}'::jsonb, now());
select app.sms_schedule_request(
    '7c000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a',
    repeat('d',64), 'v1:enc', 1::smallint, '0404', 'v1:msg', 1::smallint, 'gsm7', 40, 1, 7500, 'USD',
    tests.noon_zone(), now(), 'sched-dedupe-deadletter', '7b000000-0000-0000-0000-000000000001', 'req-deadletter');

update public.sms_outbox
   set max_attempts = 1
 where request_id = (select id from public.text_requests where dedupe_key = 'sched-dedupe-deadletter');

-- Keep this claim isolated from earlier leftover pending jobs.
update public.sms_outbox
   set available_at = now() + interval '1 hour'
 where status in ('pending', 'leased')
   and request_id is distinct from (
       select id from public.text_requests where dedupe_key = 'sched-dedupe-deadletter');

select app.sms_outbox_claim('worker-dl', 10, 60);

select app.sms_begin_dispatch(
    (select id from public.text_requests where dedupe_key = 'sched-dedupe-deadletter'),
    '7c000000-0000-0000-0000-00000000000a', 'fake');

select app.sms_settle_attempt(
    (select a.id from public.sms_delivery_attempts a
      join public.text_requests tr on tr.id = a.request_id
     where tr.dedupe_key = 'sched-dedupe-deadletter'
     order by a.attempt_number desc limit 1),
    '7c000000-0000-0000-0000-00000000000a', 'retryable', null, 'rate_limited', '{}'::jsonb);

select is(
    (select status::text from public.text_requests where dedupe_key = 'sched-dedupe-deadletter'),
    'queued', 'retryable before exhaust leaves the request queued');

select is(
    app.sms_outbox_fail(
        (select id from public.sms_outbox
          where request_id = (select id from public.text_requests where dedupe_key = 'sched-dedupe-deadletter')),
        'worker-dl', 'retryable: rate_limited', 30)::text,
    'dead_letter', 'final retryable fail_outbox dead-letters the job');

select is(
    (select status::text from public.text_requests where dedupe_key = 'sched-dedupe-deadletter'),
    'failed', 'dead-letter fails the queued request');

select is(
    (select count(*)::integer from public.sms_quota_ledger
      where org_id = '7c000000-0000-0000-0000-00000000000a'
        and kind = 'release'
        and correlation_key = 'req:' || (select id from public.text_requests where dedupe_key = 'sched-dedupe-deadletter')::text),
    1, 'dead-letter releases the queued reservation');

-- A retryable fail before the budget is exhausted must NOT fail the request.
select app.sms_record_consent('7c000000-0000-0000-0000-00000000000a', repeat('e',64),
    'v1:enc', 1::smallint, '0505', 'review_request', 'opted_in', 'owner_import', null, '{}'::jsonb, now());
select app.sms_schedule_request(
    '7c000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a',
    repeat('e',64), 'v1:enc', 1::smallint, '0505', 'v1:msg', 1::smallint, 'gsm7', 40, 1, 7500, 'USD',
    tests.noon_zone(), now(), 'sched-dedupe-retry-ok', '7b000000-0000-0000-0000-000000000001', 'req-retry-ok');

update public.sms_outbox
   set available_at = now() + interval '1 hour'
 where status in ('pending', 'leased')
   and request_id is distinct from (
       select id from public.text_requests where dedupe_key = 'sched-dedupe-retry-ok');

select app.sms_outbox_claim('worker-rt', 10, 60);
select app.sms_begin_dispatch(
    (select id from public.text_requests where dedupe_key = 'sched-dedupe-retry-ok'),
    '7c000000-0000-0000-0000-00000000000a', 'fake');
select app.sms_settle_attempt(
    (select a.id from public.sms_delivery_attempts a
      join public.text_requests tr on tr.id = a.request_id
     where tr.dedupe_key = 'sched-dedupe-retry-ok'
     order by a.attempt_number desc limit 1),
    '7c000000-0000-0000-0000-00000000000a', 'retryable', null, 'rate_limited', '{}'::jsonb);

select is(
    app.sms_outbox_fail(
        (select id from public.sms_outbox
          where request_id = (select id from public.text_requests where dedupe_key = 'sched-dedupe-retry-ok')),
        'worker-rt', 'retryable: rate_limited', 30)::text,
    'pending', 'retryable fail_outbox before max_attempts requeues the job');

select is(
    (select status::text from public.text_requests where dedupe_key = 'sched-dedupe-retry-ok'),
    'queued', 'request stays queued while outbox retries remain');

select is(
    (select count(*)::integer from public.sms_quota_ledger
      where kind = 'release'
        and correlation_key = 'req:' || (select id from public.text_requests where dedupe_key = 'sched-dedupe-retry-ok')::text),
    0, 'reservation is kept while retries remain');

-- Dead-letter while sending (unknown whether the provider was reached): park,
-- do not release.
select app.sms_record_consent('7c000000-0000-0000-0000-00000000000a', repeat('f',64),
    'v1:enc', 1::smallint, '0606', 'review_request', 'opted_in', 'owner_import', null, '{}'::jsonb, now());
select app.sms_schedule_request(
    '7c000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a',
    repeat('f',64), 'v1:enc', 1::smallint, '0606', 'v1:msg', 1::smallint, 'gsm7', 40, 1, 7500, 'USD',
    tests.noon_zone(), now(), 'sched-dedupe-dl-sending', '7b000000-0000-0000-0000-000000000001', 'req-dl-sending');

update public.sms_outbox
   set max_attempts = 1
 where request_id = (select id from public.text_requests where dedupe_key = 'sched-dedupe-dl-sending');

update public.sms_outbox
   set available_at = now() + interval '1 hour'
 where status in ('pending', 'leased')
   and request_id is distinct from (
       select id from public.text_requests where dedupe_key = 'sched-dedupe-dl-sending');

select app.sms_outbox_claim('worker-ds', 10, 60);
select app.sms_begin_dispatch(
    (select id from public.text_requests where dedupe_key = 'sched-dedupe-dl-sending'),
    '7c000000-0000-0000-0000-00000000000a', 'fake');

select is(
    app.sms_outbox_fail(
        (select id from public.sms_outbox
          where request_id = (select id from public.text_requests where dedupe_key = 'sched-dedupe-dl-sending')),
        'worker-ds', 'infra_timeout', 30)::text,
    'dead_letter', 'fail_outbox while sending dead-letters the job');

select is(
    (select status::text from public.text_requests where dedupe_key = 'sched-dedupe-dl-sending'),
    'provider_unknown', 'dead-letter while sending parks as provider_unknown');

select is(
    (select count(*)::integer from public.sms_quota_ledger
      where kind = 'release'
        and correlation_key = 'req:' || (select id from public.text_requests where dedupe_key = 'sched-dedupe-dl-sending')::text),
    0, 'sending dead-letter keeps the reservation for reconciliation');

select is(
    (select count(*)::integer from public.sms_outbox
      where topic = 'sms.reconcile'
        and request_id = (select id from public.text_requests where dedupe_key = 'sched-dedupe-dl-sending')),
    1, 'sending dead-letter enqueues a reconcile job');

-- ====================== provider_unknown / parked-SID reconcile ==========

-- Timeout-after-accept: settle without a SID, park a terminal receipt by SID,
-- then attach the looked-up SID. Replay runs in the same transaction.
select app.sms_record_consent('7c000000-0000-0000-0000-00000000000a', repeat('g',64),
    'v1:enc', 1::smallint, '0707', 'review_request', 'opted_in', 'owner_import', null, '{}'::jsonb, now());
select app.sms_schedule_request(
    '7c000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a',
    repeat('g',64), 'v1:enc', 1::smallint, '0707', 'v1:msg', 1::smallint, 'gsm7', 40, 1, 7500, 'USD',
    tests.noon_zone(), now(), 'sched-dedupe-reconcile-sid', '7b000000-0000-0000-0000-000000000001', 'req-reconcile-sid');

select app.sms_begin_dispatch(
    (select id from public.text_requests where dedupe_key = 'sched-dedupe-reconcile-sid'),
    '7c000000-0000-0000-0000-00000000000a', 'fake');

select app.sms_settle_attempt(
    (select a.id from public.sms_delivery_attempts a
      join public.text_requests tr on tr.id = a.request_id
     where tr.dedupe_key = 'sched-dedupe-reconcile-sid'
     order by a.attempt_number desc limit 1),
    '7c000000-0000-0000-0000-00000000000a', 'provider_unknown', null, 'timeout', '{}'::jsonb);

select is(
    (select status::text from public.text_requests where dedupe_key = 'sched-dedupe-reconcile-sid'),
    'provider_unknown', 'timeout settle parks the request as provider_unknown');

select is(
    (select count(*)::integer from public.sms_quota_ledger
      where kind = 'release'
        and correlation_key = 'req:' || (select id from public.text_requests where dedupe_key = 'sched-dedupe-reconcile-sid')::text),
    0, 'provider_unknown keeps the reservation until reconcile');

select is(
    (select count(*)::integer from public.sms_outbox
      where topic = 'sms.reconcile'
        and request_id = (select id from public.text_requests where dedupe_key = 'sched-dedupe-reconcile-sid')),
    1, 'provider_unknown enqueues a durable reconcile job');

select ok(
    (select available_at > now() + interval '20 seconds'
       from public.sms_outbox
      where topic = 'sms.reconcile'
        and request_id = (select id from public.text_requests where dedupe_key = 'sched-dedupe-reconcile-sid')),
    'reconcile job is delayed so a same-tick empty list cannot release');

update public.sms_outbox
   set available_at = now() + interval '1 hour'
 where topic = 'sms.dispatch' and status in ('pending', 'leased');

select is(
    (select count(*)::integer from app.sms_outbox_claim('worker-no-rec', 10, 60, 'sms.dispatch')),
    0, 'dispatch claim does not pick sms.reconcile jobs');

select is(
    (select inserted from app.sms_webhook_receive(
        'fake', 'evt-timeout-sid', 'evt-timeout-sid', 'status', true, '{}'::jsonb, 'v1:enc')),
    true, 'timeout-after-accept webhook is inserted');

select is(
    app.sms_apply_or_park_delivery_status(
        (select id from public.sms_webhook_inbox where provider = 'fake' and dedupe_key = 'evt-timeout-sid'),
        'fake', 'fake_timeout_sid', 'delivered', null),
    'no_matching_attempt', 'receipt parked by SID while attempt has no SID');

select is(
    app.sms_reconcile_attach_sid(
        (select a.id from public.sms_delivery_attempts a
          join public.text_requests tr on tr.id = a.request_id
         where tr.dedupe_key = 'sched-dedupe-reconcile-sid'
         order by a.attempt_number desc limit 1),
        '7c000000-0000-0000-0000-00000000000a', 'fake_timeout_sid', null, null),
    'delivered', 'attach SID replays the parked delivered receipt');

select is(
    (select status::text from public.text_requests where dedupe_key = 'sched-dedupe-reconcile-sid'),
    'delivered', 'timeout-after-accept request is delivered after SID attach');

select is(
    (select count(*)::integer from public.sms_quota_ledger
      where kind = 'consumption'
        and correlation_key = 'req:' || (select id from public.text_requests where dedupe_key = 'sched-dedupe-reconcile-sid')::text),
    1, 'attach SID consumes the reserved quota once');

select is(
    (select status::text from public.sms_webhook_inbox
      where provider = 'fake' and dedupe_key = 'evt-timeout-sid'),
    'processed', 'parked receipt is processed by reconcile attach');

select is(
    app.sms_reconcile_attach_sid(
        (select a.id from public.sms_delivery_attempts a
          join public.text_requests tr on tr.id = a.request_id
         where tr.dedupe_key = 'sched-dedupe-reconcile-sid'
         order by a.attempt_number desc limit 1),
        '7c000000-0000-0000-0000-00000000000a', 'fake_timeout_sid', null, null),
    'delivered', 'attach SID is idempotent after delivery');

-- Same-body residual: a singleton exact-body Twilio hit can be another
-- request's SID. Attach must refuse a SID already bound to a different attempt
-- before consume or terminal replay (else A can deliver and B is consumed).
select app.sms_record_consent('7c000000-0000-0000-0000-00000000000a', repeat('j',64),
    'v1:enc', 1::smallint, '1212', 'review_request', 'opted_in', 'owner_import', null, '{}'::jsonb, now());
select app.sms_schedule_request(
    '7c000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a',
    repeat('j',64), 'v1:enc', 1::smallint, '1212', 'v1:msg', 1::smallint, 'gsm7', 40, 1, 7500, 'USD',
    tests.noon_zone(), now(), 'sched-dedupe-samebody-a', '7b000000-0000-0000-0000-000000000001', 'req-samebody-a');
select app.sms_begin_dispatch(
    (select id from public.text_requests where dedupe_key = 'sched-dedupe-samebody-a'),
    '7c000000-0000-0000-0000-00000000000a', 'fake');
select app.sms_settle_attempt(
    (select a.id from public.sms_delivery_attempts a
      join public.text_requests tr on tr.id = a.request_id
     where tr.dedupe_key = 'sched-dedupe-samebody-a'
     order by a.attempt_number desc limit 1),
    '7c000000-0000-0000-0000-00000000000a', 'submitted', 'fake_samebody_sid', null, '{}'::jsonb);

select app.sms_record_consent('7c000000-0000-0000-0000-00000000000a', repeat('k',64),
    'v1:enc', 1::smallint, '1313', 'review_request', 'opted_in', 'owner_import', null, '{}'::jsonb, now());
select app.sms_schedule_request(
    '7c000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a',
    repeat('k',64), 'v1:enc', 1::smallint, '1313', 'v1:msg', 1::smallint, 'gsm7', 40, 1, 7500, 'USD',
    tests.noon_zone(), now(), 'sched-dedupe-samebody-b', '7b000000-0000-0000-0000-000000000001', 'req-samebody-b');
select app.sms_begin_dispatch(
    (select id from public.text_requests where dedupe_key = 'sched-dedupe-samebody-b'),
    '7c000000-0000-0000-0000-00000000000a', 'fake');
select app.sms_settle_attempt(
    (select a.id from public.sms_delivery_attempts a
      join public.text_requests tr on tr.id = a.request_id
     where tr.dedupe_key = 'sched-dedupe-samebody-b'
     order by a.attempt_number desc limit 1),
    '7c000000-0000-0000-0000-00000000000a', 'provider_unknown', null, 'timeout', '{}'::jsonb);

select is(
    app.sms_reconcile_attach_sid(
        (select a.id from public.sms_delivery_attempts a
          join public.text_requests tr on tr.id = a.request_id
         where tr.dedupe_key = 'sched-dedupe-samebody-b'
         order by a.attempt_number desc limit 1),
        '7c000000-0000-0000-0000-00000000000a', 'fake_samebody_sid', 'delivered', null),
    'sid_conflict', 'same-body lookup must not attach another request''s SID');

select is(
    (select status::text from public.text_requests where dedupe_key = 'sched-dedupe-samebody-b'),
    'provider_unknown', 'victim request stays provider_unknown after SID conflict');

select is(
    (select status::text from public.text_requests where dedupe_key = 'sched-dedupe-samebody-a'),
    'submitted', 'owner of the SID is unchanged');

select is(
    (select count(*)::integer from public.sms_quota_ledger
      where kind = 'consumption'
        and correlation_key = 'req:' || (select id from public.text_requests where dedupe_key = 'sched-dedupe-samebody-b')::text),
    0, 'SID conflict does not consume the victim reservation');

select is(
    (select count(*)::integer from public.sms_quota_ledger
      where kind = 'release'
        and correlation_key = 'req:' || (select id from public.text_requests where dedupe_key = 'sched-dedupe-samebody-b')::text),
    0, 'SID conflict keeps the victim reservation (no fail+release)');

-- Concurrent SID residual: two provider_unknown attempts, neither has a SID
-- yet. Sequential first-attach wins; the unique (provider, SID) claim must
-- reject a second bind without consume. The exists() check alone is racy.
select ok(
    exists (
        select 1 from pg_class c
         where c.relname = 'sms_delivery_attempts_provider_sid_uidx'
           and c.relkind = 'i'),
    'unique SID claim index exists');

select ok(
    (select i.indisunique
       from pg_index i
       join pg_class c on c.oid = i.indexrelid
      where c.relname = 'sms_delivery_attempts_provider_sid_uidx'),
    'SID claim index is unique');

select app.sms_record_consent('7c000000-0000-0000-0000-00000000000a', repeat('m',64),
    'v1:enc', 1::smallint, '1414', 'review_request', 'opted_in', 'owner_import', null, '{}'::jsonb, now());
select app.sms_schedule_request(
    '7c000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a',
    repeat('m',64), 'v1:enc', 1::smallint, '1414', 'v1:msg', 1::smallint, 'gsm7', 40, 1, 7500, 'USD',
    tests.noon_zone(), now(), 'sched-dedupe-race-a', '7b000000-0000-0000-0000-000000000001', 'req-race-a');
select app.sms_begin_dispatch(
    (select id from public.text_requests where dedupe_key = 'sched-dedupe-race-a'),
    '7c000000-0000-0000-0000-00000000000a', 'fake');
select app.sms_settle_attempt(
    (select a.id from public.sms_delivery_attempts a
      join public.text_requests tr on tr.id = a.request_id
     where tr.dedupe_key = 'sched-dedupe-race-a'
     order by a.attempt_number desc limit 1),
    '7c000000-0000-0000-0000-00000000000a', 'provider_unknown', null, 'timeout', '{}'::jsonb);

select app.sms_record_consent('7c000000-0000-0000-0000-00000000000a', repeat('n',64),
    'v1:enc', 1::smallint, '1515', 'review_request', 'opted_in', 'owner_import', null, '{}'::jsonb, now());
select app.sms_schedule_request(
    '7c000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a',
    repeat('n',64), 'v1:enc', 1::smallint, '1515', 'v1:msg', 1::smallint, 'gsm7', 40, 1, 7500, 'USD',
    tests.noon_zone(), now(), 'sched-dedupe-race-b', '7b000000-0000-0000-0000-000000000001', 'req-race-b');
select app.sms_begin_dispatch(
    (select id from public.text_requests where dedupe_key = 'sched-dedupe-race-b'),
    '7c000000-0000-0000-0000-00000000000a', 'fake');
select app.sms_settle_attempt(
    (select a.id from public.sms_delivery_attempts a
      join public.text_requests tr on tr.id = a.request_id
     where tr.dedupe_key = 'sched-dedupe-race-b'
     order by a.attempt_number desc limit 1),
    '7c000000-0000-0000-0000-00000000000a', 'provider_unknown', null, 'timeout', '{}'::jsonb);

select is(
    app.sms_reconcile_attach_sid(
        (select a.id from public.sms_delivery_attempts a
          join public.text_requests tr on tr.id = a.request_id
         where tr.dedupe_key = 'sched-dedupe-race-a'
         order by a.attempt_number desc limit 1),
        '7c000000-0000-0000-0000-00000000000a', 'fake_race_sid', null, null),
    'submitted', 'first of two null-SID unknowns may claim the SID');

select is(
    app.sms_reconcile_attach_sid(
        (select a.id from public.sms_delivery_attempts a
          join public.text_requests tr on tr.id = a.request_id
         where tr.dedupe_key = 'sched-dedupe-race-b'
         order by a.attempt_number desc limit 1),
        '7c000000-0000-0000-0000-00000000000a', 'fake_race_sid', 'delivered', null),
    'sid_conflict', 'second null-SID unknown cannot claim the same SID');

select is(
    (select status::text from public.text_requests where dedupe_key = 'sched-dedupe-race-a'),
    'submitted', 'first racer keeps the SID');

select is(
    (select status::text from public.text_requests where dedupe_key = 'sched-dedupe-race-b'),
    'provider_unknown', 'second racer stays provider_unknown');

select is(
    (select count(*)::integer from public.sms_quota_ledger
      where kind = 'consumption'
        and correlation_key = 'req:' || (select id from public.text_requests where dedupe_key = 'sched-dedupe-race-b')::text),
    0, 'losing claim does not consume');

select is(
    (select count(*)::integer from public.sms_quota_ledger
      where kind = 'consumption'
        and correlation_key = 'req:' || (select id from public.text_requests where dedupe_key = 'sched-dedupe-race-a')::text),
    1, 'winning claim consumes exactly once');

select throws_ok(
    $$ update public.sms_delivery_attempts a
          set provider_message_id = 'fake_race_sid'
        where a.id = (
            select a2.id from public.sms_delivery_attempts a2
              join public.text_requests tr on tr.id = a2.request_id
             where tr.dedupe_key = 'sched-dedupe-race-b'
             order by a2.attempt_number desc limit 1) $$,
    '23505', NULL,
    'unique SID index rejects a second claim of the same provider id');

-- 09000200 REPLACE'd attach_sid after 08000600 and dropped unique_violation.
-- Sequential exists() still returns sid_conflict; the race does not — it
-- raises 23505 unless the handler is restored. Force that path in-process:
-- a BEFORE UPDATE trigger commits the SID onto the sibling row after
-- exists() has passed, so the UPDATE hits unique_violation.
select ok(
    pg_get_functiondef(
        'app.sms_reconcile_attach_sid(uuid, uuid, text, text, text)'::regprocedure)
        ~ 'unique_violation',
    'attach_sid maps unique_violation after later CREATE OR REPLACE');

select app.sms_record_consent('7c000000-0000-0000-0000-00000000000a', repeat('o',64),
    'v1:enc', 1::smallint, '1616', 'review_request', 'opted_in', 'owner_import', null, '{}'::jsonb, now());
select app.sms_schedule_request(
    '7c000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a',
    repeat('o',64), 'v1:enc', 1::smallint, '1616', 'v1:msg', 1::smallint, 'gsm7', 40, 1, 7500, 'USD',
    tests.noon_zone(), now(), 'sched-dedupe-uv-a', '7b000000-0000-0000-0000-000000000001', 'req-uv-a');
select app.sms_begin_dispatch(
    (select id from public.text_requests where dedupe_key = 'sched-dedupe-uv-a'),
    '7c000000-0000-0000-0000-00000000000a', 'fake');
select app.sms_settle_attempt(
    (select a.id from public.sms_delivery_attempts a
      join public.text_requests tr on tr.id = a.request_id
     where tr.dedupe_key = 'sched-dedupe-uv-a'
     order by a.attempt_number desc limit 1),
    '7c000000-0000-0000-0000-00000000000a', 'provider_unknown', null, 'timeout', '{}'::jsonb);

select app.sms_record_consent('7c000000-0000-0000-0000-00000000000a', repeat('p',64),
    'v1:enc', 1::smallint, '1717', 'review_request', 'opted_in', 'owner_import', null, '{}'::jsonb, now());
select app.sms_schedule_request(
    '7c000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a',
    repeat('p',64), 'v1:enc', 1::smallint, '1717', 'v1:msg', 1::smallint, 'gsm7', 40, 1, 7500, 'USD',
    tests.noon_zone(), now(), 'sched-dedupe-uv-b', '7b000000-0000-0000-0000-000000000001', 'req-uv-b');
select app.sms_begin_dispatch(
    (select id from public.text_requests where dedupe_key = 'sched-dedupe-uv-b'),
    '7c000000-0000-0000-0000-00000000000a', 'fake');
select app.sms_settle_attempt(
    (select a.id from public.sms_delivery_attempts a
      join public.text_requests tr on tr.id = a.request_id
     where tr.dedupe_key = 'sched-dedupe-uv-b'
     order by a.attempt_number desc limit 1),
    '7c000000-0000-0000-0000-00000000000a', 'provider_unknown', null, 'timeout', '{}'::jsonb);

select set_config('tests.uv_winner_attempt_id',
    (select a.id::text from public.sms_delivery_attempts a
      join public.text_requests tr on tr.id = a.request_id
     where tr.dedupe_key = 'sched-dedupe-uv-a'
     order by a.attempt_number desc limit 1), true);
select set_config('tests.uv_loser_attempt_id',
    (select a.id::text from public.sms_delivery_attempts a
      join public.text_requests tr on tr.id = a.request_id
     where tr.dedupe_key = 'sched-dedupe-uv-b'
     order by a.attempt_number desc limit 1), true);

create or replace function tests.force_attach_unique_violation()
returns trigger
language plpgsql
as $$
begin
    if NEW.provider_message_id is not distinct from 'fake_uv_handler_sid'
       and OLD.provider_message_id is null
       and NEW.id::text is not distinct from current_setting('tests.uv_loser_attempt_id', true) then
        update public.sms_delivery_attempts a
           set provider_message_id = NEW.provider_message_id
         where a.id = current_setting('tests.uv_winner_attempt_id')::uuid;
    end if;
    return NEW;
end;
$$;

create trigger tests_force_attach_unique_violation
    before update on public.sms_delivery_attempts
    for each row
    execute function tests.force_attach_unique_violation();

select is(
    app.sms_reconcile_attach_sid(
        current_setting('tests.uv_loser_attempt_id')::uuid,
        '7c000000-0000-0000-0000-00000000000a', 'fake_uv_handler_sid', 'delivered', null),
    'sid_conflict',
    'unique_violation inside attach_sid returns sid_conflict not SQLSTATE 23505');

select is(
    (select status::text from public.text_requests where dedupe_key = 'sched-dedupe-uv-b'),
    'provider_unknown', 'unique_violation loser stays provider_unknown');

select is(
    (select count(*)::integer from public.sms_quota_ledger
      where kind = 'consumption'
        and correlation_key = 'req:' || (select id from public.text_requests where dedupe_key = 'sched-dedupe-uv-b')::text),
    0, 'unique_violation loser does not consume');

drop trigger tests_force_attach_unique_violation on public.sms_delivery_attempts;

select is(
    app.sms_reconcile_attach_sid(
        current_setting('tests.uv_winner_attempt_id')::uuid,
        '7c000000-0000-0000-0000-00000000000a', 'fake_uv_handler_sid', null, null),
    'submitted', 'winning claim after unique_violation still attaches');

select is(
    (select status::text from public.text_requests where dedupe_key = 'sched-dedupe-uv-a'),
    'submitted', 'unique_violation winner is submitted');

select is(
    (select count(*)::integer from public.sms_quota_ledger
      where kind = 'consumption'
        and correlation_key in (
            'req:' || (select id from public.text_requests where dedupe_key = 'sched-dedupe-uv-a')::text,
            'req:' || (select id from public.text_requests where dedupe_key = 'sched-dedupe-uv-b')::text)),
    1, 'unique_violation race consumes exactly once');

-- Confirmed not-sent: fail+release.
select app.sms_record_consent('7c000000-0000-0000-0000-00000000000a', repeat('h',64),
    'v1:enc', 1::smallint, '0808', 'review_request', 'opted_in', 'owner_import', null, '{}'::jsonb, now());
select app.sms_schedule_request(
    '7c000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a',
    repeat('h',64), 'v1:enc', 1::smallint, '0808', 'v1:msg', 1::smallint, 'gsm7', 40, 1, 7500, 'USD',
    tests.noon_zone(), now(), 'sched-dedupe-reconcile-miss', '7b000000-0000-0000-0000-000000000001', 'req-reconcile-miss');

select app.sms_begin_dispatch(
    (select id from public.text_requests where dedupe_key = 'sched-dedupe-reconcile-miss'),
    '7c000000-0000-0000-0000-00000000000a', 'fake');
select app.sms_settle_attempt(
    (select a.id from public.sms_delivery_attempts a
      join public.text_requests tr on tr.id = a.request_id
     where tr.dedupe_key = 'sched-dedupe-reconcile-miss'
     order by a.attempt_number desc limit 1),
    '7c000000-0000-0000-0000-00000000000a', 'provider_unknown', null, 'timeout', '{}'::jsonb);

select is(
    app.sms_reconcile_fail_release(
        (select id from public.text_requests where dedupe_key = 'sched-dedupe-reconcile-miss'),
        '7c000000-0000-0000-0000-00000000000a', 'provider_not_found'),
    'failed', 'lookup not_found fails the request');

select is(
    (select count(*)::integer from public.sms_quota_ledger
      where kind = 'release'
        and correlation_key = 'req:' || (select id from public.text_requests where dedupe_key = 'sched-dedupe-reconcile-miss')::text),
    1, 'lookup not_found releases the reservation');

select is(
    (select outcome from app.sms_reconcile_prepare(
        (select id from public.text_requests where dedupe_key = 'sched-dedupe-reconcile-miss'),
        '7c000000-0000-0000-0000-00000000000a')),
    'already_failed', 'prepare is a no-op after fail+release');

-- Reconcile outbox budget exhausted: fail+release, never re-send.
select app.sms_record_consent('7c000000-0000-0000-0000-00000000000a', repeat('i',64),
    'v1:enc', 1::smallint, '0909', 'review_request', 'opted_in', 'owner_import', null, '{}'::jsonb, now());
select app.sms_schedule_request(
    '7c000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a',
    repeat('i',64), 'v1:enc', 1::smallint, '0909', 'v1:msg', 1::smallint, 'gsm7', 40, 1, 7500, 'USD',
    tests.noon_zone(), now(), 'sched-dedupe-reconcile-dl', '7b000000-0000-0000-0000-000000000001', 'req-reconcile-dl');

select app.sms_begin_dispatch(
    (select id from public.text_requests where dedupe_key = 'sched-dedupe-reconcile-dl'),
    '7c000000-0000-0000-0000-00000000000a', 'fake');
select app.sms_settle_attempt(
    (select a.id from public.sms_delivery_attempts a
      join public.text_requests tr on tr.id = a.request_id
     where tr.dedupe_key = 'sched-dedupe-reconcile-dl'
     order by a.attempt_number desc limit 1),
    '7c000000-0000-0000-0000-00000000000a', 'provider_unknown', null, 'timeout', '{}'::jsonb);

update public.sms_outbox
   set max_attempts = 1, available_at = now()
 where topic = 'sms.reconcile'
   and request_id = (select id from public.text_requests where dedupe_key = 'sched-dedupe-reconcile-dl');

update public.sms_outbox
   set available_at = now() + interval '1 hour'
 where status in ('pending', 'leased')
   and (topic is distinct from 'sms.reconcile'
        or request_id is distinct from (
            select id from public.text_requests where dedupe_key = 'sched-dedupe-reconcile-dl'));

select is(
    (select count(*)::integer from app.sms_outbox_claim('worker-rec-dl', 10, 60, 'sms.reconcile')
      where request_id = (select id from public.text_requests where dedupe_key = 'sched-dedupe-reconcile-dl')),
    1, 'reconcile topic claims the provider_unknown job');

select is(
    app.sms_outbox_fail(
        (select id from public.sms_outbox
          where topic = 'sms.reconcile'
            and request_id = (select id from public.text_requests where dedupe_key = 'sched-dedupe-reconcile-dl')),
        'worker-rec-dl', 'lookup_unknown: timeout', 30)::text,
    'dead_letter', 'exhausted reconcile job dead-letters');

select is(
    (select status::text from public.text_requests where dedupe_key = 'sched-dedupe-reconcile-dl'),
    'failed', 'reconcile dead-letter fails the unknown request');

select is(
    (select count(*)::integer from public.sms_quota_ledger
      where kind = 'release'
        and correlation_key = 'req:' || (select id from public.text_requests where dedupe_key = 'sched-dedupe-reconcile-dl')::text),
    1, 'reconcile dead-letter releases the reservation');

-- ================================ webhook inbox replay ====================

-- Verify that a webhook inbox row left in 'received' (not 'processed') is
-- reclaimable by sms_webhook_receive (inserted=true).
select is(
    (select inserted from app.sms_webhook_receive('fake', 'evt-replay-1', 'evt-replay-1', 'status', true, '{}'::jsonb, 'v1:enc')),
    true, 'first webhook receive inserts the event');

-- Settle as received (simulating unmatched receipt).
select app.sms_webhook_settle(
    (select id from public.sms_webhook_inbox where provider = 'fake' and dedupe_key = 'evt-replay-1'),
    'received', null, 'unmatched_receipt');

-- A provider retry reclaims it (inserted=true because status is not 'processed').
select is(
    (select inserted from app.sms_webhook_receive('fake', 'evt-replay-1', 'evt-replay-1', 'status', true, '{}'::jsonb, 'v1:enc')),
    true, 'retry of unprocessed webhook is reclaimed for reprocessing');

-- Settle as processed.
select app.sms_webhook_settle(
    (select id from public.sms_webhook_inbox where provider = 'fake' and dedupe_key = 'evt-replay-1'),
    'processed', null, null);

-- Now a retry is a true duplicate.
select is(
    (select inserted from app.sms_webhook_receive('fake', 'evt-replay-1', 'evt-replay-1', 'status', true, '{}'::jsonb, 'v1:enc')),
    false, 'retry of processed webhook is a harmless no-op');

select * from finish();
rollback;
