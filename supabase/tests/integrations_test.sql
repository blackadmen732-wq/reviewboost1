-- Connections foundation tests.
--
-- Real roles doing real things: owners reading their own connection, members
-- and other businesses seeing nothing, clients unable to write or reach the
-- definer functions, and the lifecycle, sync, inbox and customer pipeline
-- holding their invariants under replays, races and illegal moves.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

select plan(99);

create or replace function tests.set_actor(p_user_id uuid) returns void
language plpgsql as $$
begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end $$;

create or replace function tests.set_service() returns void
language plpgsql as $$
begin
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
end $$;

grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

-- ------------------------------------------------------------- fixtures ----

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
    ('9b000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ig-owner@test.com', '', now(), now()),
    ('9b000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ig-member@test.com', '', now(), now()),
    ('9b000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ig-outsider@test.com', '', now(), now());

insert into public.organizations (id, name, slug)
values
    ('9c000000-0000-0000-0000-00000000000a', 'IG Org A', 'ig-org-a'),
    ('9c000000-0000-0000-0000-00000000000b', 'IG Org B', 'ig-org-b');

insert into public.organization_members (org_id, user_id, role, status)
values
    ('9c000000-0000-0000-0000-00000000000a', '9b000000-0000-0000-0000-000000000001', 'owner', 'active'),
    ('9c000000-0000-0000-0000-00000000000a', '9b000000-0000-0000-0000-000000000002', 'member', 'active'),
    ('9c000000-0000-0000-0000-00000000000b', '9b000000-0000-0000-0000-000000000003', 'owner', 'active');

insert into public.locations (id, org_id, name, timezone)
values
    ('9d000000-0000-0000-0000-00000000000a', '9c000000-0000-0000-0000-00000000000a', 'High Street', 'UTC'),
    ('9d000000-0000-0000-0000-00000000000b', '9c000000-0000-0000-0000-00000000000b', 'Other Place', 'UTC');

-- ===================================================== privileges =========

select is_empty(
    $$ select table_name from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('anon', 'authenticated')
          and table_name in ('integration_credentials', 'integration_oauth_states',
                             'integration_inbox', 'integration_sync_checkpoints') $$,
    'credentials, OAuth states, the inbox and checkpoints are invisible to every client role');

select is_empty(
    $$ select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'authenticated'
          and table_name like any (array['integration%', 'customer_source_profiles', 'customer_visits', 'customers'])
          and privilege_type <> 'SELECT' $$,
    'no client role may write any connection, customer or visit table');

select is_empty(
    $$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'app') and p.proname like '%integration%'
          and (has_function_privilege('authenticated', p.oid, 'execute')
               or has_function_privilege('anon', p.oid, 'execute')) $$,
    'no client role may execute any integration function');

select results_eq(
    $$ select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relrowsecurity
          and c.relname in ('integration_connections', 'integration_location_mappings',
                            'integration_connection_events', 'integration_credentials',
                            'integration_oauth_states', 'integration_inbox', 'integration_sync_runs',
                            'integration_sync_checkpoints', 'integration_record_issues',
                            'customers', 'customer_source_profiles', 'customer_visits') $$,
    $$ values (12) $$,
    'row level security is on for all twelve new tables');

-- ===================================================== OAuth state ========

select tests.set_service();

select lives_ok(
    $$ select app.integration_oauth_state_create(repeat('s', 64), '9c000000-0000-0000-0000-00000000000a',
        '9b000000-0000-0000-0000-000000000001', 'fake', 'payments', array['scope.read'], null, null, 600) $$,
    'an OAuth state is stored for the owner');

select throws_ok(
    $$ select * from app.integration_oauth_state_consume(repeat('s', 64), '9b000000-0000-0000-0000-000000000003') $$,
    'P0001', 'oauth_state_invalid',
    'another user cannot use someone else''s OAuth state');

select is(
    (select org_id from app.integration_oauth_state_consume(repeat('s', 64), '9b000000-0000-0000-0000-000000000001')),
    '9c000000-0000-0000-0000-00000000000a'::uuid,
    'the owner consumes their state and gets their own organization back');

select throws_ok(
    $$ select * from app.integration_oauth_state_consume(repeat('s', 64), '9b000000-0000-0000-0000-000000000001') $$,
    'P0001', 'oauth_state_invalid',
    'a state works once');

select app.integration_oauth_state_create(repeat('x', 64), '9c000000-0000-0000-0000-00000000000a',
    '9b000000-0000-0000-0000-000000000001', 'fake', 'payments', array['scope.read'], null, null, 600);
update public.integration_oauth_states set expires_at = now() - interval '1 second'
 where state_digest = repeat('x', 64);
select throws_ok(
    $$ select * from app.integration_oauth_state_consume(repeat('x', 64), '9b000000-0000-0000-0000-000000000001') $$,
    'P0001', 'oauth_state_invalid',
    'an expired state is refused');

select throws_ok(
    $$ select app.integration_oauth_state_create(repeat('y', 64), '9c000000-0000-0000-0000-00000000000a',
        '9b000000-0000-0000-0000-000000000001', 'fake', 'payments', '{}', null,
        '00000000-0000-0000-0000-000000000099', 600) $$,
    'P0002', 'not_found_or_forbidden',
    'a reconnect state must name a live connection of this organization');

-- ===================================================== creation ===========

create temporary table conn (id uuid, state text) on commit drop;
grant all on conn to public;

insert into conn
select connection_id, state::text from app.integration_connection_create(
    '9c000000-0000-0000-0000-00000000000a', 'fake', 'payments', 'MERCHANT-1', 'Corner Cafe LLC',
    array['scope.read'], true, '9b000000-0000-0000-0000-000000000001',
    1::smallint, 'v1:access', 'v1:refresh', now() + interval '30 days', null);

select is((select state from conn), 'connecting', 'a new connection starts in connecting');

select is(
    (select count(*)::int from public.integration_credentials where connection_id = (select id from conn)),
    1, 'its credentials are stored with it');

select is(
    (select count(*)::int from public.audit_events
      where target_id = (select id::text from conn) and action = 'integration.connected'),
    1, 'connecting is written to the audit log');

select throws_ok(
    $$ select * from app.integration_connection_create(
        '9c000000-0000-0000-0000-00000000000b', 'fake', 'payments', 'MERCHANT-1', 'Corner Cafe LLC',
        array['scope.read'], true, '9b000000-0000-0000-0000-000000000003',
        1::smallint, 'v1:a', null, null, null) $$,
    'P0001', 'account_already_connected',
    'one provider account cannot feed a second business');

select throws_ok(
    $$ select * from app.integration_connection_create(
        '9c000000-0000-0000-0000-00000000000a', 'fake', 'payments', 'MERCHANT-2', 'Other',
        array['scope.read'], true, '9b000000-0000-0000-0000-000000000001',
        1::smallint, 'v1:a', null, null, null) $$,
    'P0001', 'connection_exists',
    'a business has one live connection per provider');

select throws_ok(
    $$ insert into public.integration_connections (org_id, provider_id, workflow_id, external_account_id, state)
       values ('9c000000-0000-0000-0000-00000000000b', 'fake', 'payments', 'MERCHANT-1', 'active') $$,
    '23505', NULL,
    'the unique index refuses the same account in two live connections even without the function');

-- ===================================================== RLS ================

select tests.set_actor('9b000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.integration_connections), 1,
    'the owner sees their connection');
select is((select count(*)::int from public.integration_connection_events), 1,
    'and its history');

select tests.set_actor('9b000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.integration_connections), 0,
    'a member sees no connections');

select tests.set_actor('9b000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.integration_connections), 0,
    'another business sees no connections');

select throws_ok(
    $$ select * from public.integration_credentials $$,
    '42501', NULL,
    'a signed-in user cannot read credentials at all');

select throws_ok(
    $$ update public.integration_connections set state = 'active' $$,
    '42501', NULL,
    'a signed-in user cannot change a connection''s state directly');

select throws_ok(
    $$ select app.integration_set_state((select id from conn), '9c000000-0000-0000-0000-00000000000a', 'active', 'x', null) $$,
    '42501', NULL,
    'a signed-in user cannot call the state function');

select tests.set_service();

-- ===================================================== lifecycle ==========

select throws_ok(
    $$ select app.integration_set_state((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        'reauth_required', 'test', null) $$,
    'P0001', 'connection_state_invalid',
    'connecting cannot jump to reauth_required');

select throws_ok(
    $$ select app.integration_set_state((select id from conn), '9c000000-0000-0000-0000-00000000000b',
        'disconnecting', 'test', null) $$,
    'P0002', 'not_found_or_forbidden',
    'another organization cannot move this connection');

select is(
    app.integration_set_state((select id from conn), '9c000000-0000-0000-0000-00000000000a', 'connecting', 'noop', null),
    'connecting'::public.integration_state,
    'moving to the current state is a no-op');

select is(
    (select count(*)::int from public.integration_connection_events where connection_id = (select id from conn)),
    1, 'and writes no history row');

select throws_ok(
    $$ select * from app.integration_enqueue_run((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        'manual', 'payments', 'k1', null, null) $$,
    'P0001', 'connection_state_invalid',
    'nothing syncs before the connection is active');

-- ===================================================== configuration =====

select throws_ok(
    $$ select app.integration_save_configuration((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        '[{"externalLocationId":"L1","locationId":"9d000000-0000-0000-0000-00000000000b"}]'::jsonb, null) $$,
    'P0001', 'configuration_invalid',
    'another business''s location cannot be mapped');

select throws_ok(
    $$ select app.integration_save_configuration((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        '[{"externalLocationId":"L1","locationId":"9d000000-0000-0000-0000-00000000000a"},
          {"externalLocationId":"L2","locationId":"9d000000-0000-0000-0000-00000000000a"}]'::jsonb, null) $$,
    'P0001', 'configuration_invalid',
    'one ReviewBoost location cannot be mapped twice');

select throws_ok(
    $$ select app.integration_save_configuration((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        '[]'::jsonb, null) $$,
    'P0001', 'configuration_invalid',
    'at least one location must be mapped');

select is(
    app.integration_save_configuration((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        '[{"externalLocationId":"L1","externalLocationName":"High St","externalTimezone":"UTC","locationId":"9d000000-0000-0000-0000-00000000000a"}]'::jsonb,
        '9b000000-0000-0000-0000-000000000001'),
    2, 'saving a mapping bumps the configuration version');

select throws_ok(
    $$ select * from app.integration_activate((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        null, array['payments'], 30) $$,
    'P0001', 'test_required',
    'a connection cannot be turned on without a passing test');

select throws_ok(
    $$ select app.integration_record_test((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        1, true, '{}'::jsonb) $$,
    'P0001', 'configuration_changed',
    'a test of an older configuration is refused');

select app.integration_record_test((select id from conn), '9c000000-0000-0000-0000-00000000000a',
    2, true, '{"usable": 3}'::jsonb);

-- A configuration change after the test invalidates it.
select app.integration_save_configuration((select id from conn), '9c000000-0000-0000-0000-00000000000a',
    '[{"externalLocationId":"L1","locationId":"9d000000-0000-0000-0000-00000000000a"}]'::jsonb, null);

select throws_ok(
    $$ select * from app.integration_activate((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        null, array['payments'], 30) $$,
    'P0001', 'test_required',
    'changing the configuration after a test requires a new test');

select app.integration_record_test((select id from conn), '9c000000-0000-0000-0000-00000000000a',
    3, true, '{"usable": 3}'::jsonb);

select is(
    (select count(*)::int from app.integration_activate((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        '9b000000-0000-0000-0000-000000000001', array['customers', 'payments'], 30)),
    2, 'activating queues one backfill run per stream');

select is(
    (select state::text from public.integration_connections where id = (select id from conn)),
    'active', 'the connection is active');

select throws_ok(
    $$ select * from app.integration_activate((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        null, array['payments'], 30) $$,
    'P0001', 'connection_state_invalid',
    'activating twice is refused');

-- ===================================================== runs ===============

select is(
    (select created from app.integration_enqueue_run((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        'manual', 'payments', 'manual:1', null, null)),
    true, 'a manual sync queues a run');

select is(
    (select created from app.integration_enqueue_run((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        'manual', 'payments', 'manual:1', null, null)),
    false, 'pressing it again with the same key returns the same run');

select is(
    (select count(*)::int from app.integration_claim_runs('worker-a', 10, 60)),
    3, 'a worker claims every due run');

select is(
    (select count(*)::int from app.integration_claim_runs('worker-b', 10, 60)),
    0, 'a second worker gets nothing while the leases hold');

create temporary table run1 (id uuid) on commit drop;
insert into run1 select id from public.integration_sync_runs
 where connection_id = (select id from conn) and stream = 'payments' and kind = 'backfill';

select throws_ok(
    $$ select app.integration_run_checkpoint((select id from run1), 'worker-b', 'c1', '{"created": 1}'::jsonb, 60) $$,
    'P0001', 'lease_lost',
    'a worker that does not hold the lease cannot write progress');

select app.integration_run_checkpoint((select id from run1), 'worker-a', 'c1', '{"created": 2, "skipped": 1}'::jsonb, 60);
select app.integration_run_checkpoint((select id from run1), 'worker-a', null, '{"created": 1}'::jsonb, 60);

select is(
    (select counts from public.integration_sync_runs where id = (select id from run1)),
    '{"created": 3, "skipped": 1}'::jsonb,
    'page counts add up across checkpoints');

select app.integration_finish_run((select id from run1), 'worker-a', 'partial', null, now());

select is(
    (select health::text || ':' || array_to_string(warning_codes, ',')
       from public.integration_connections where id = (select id from conn)),
    'warning:records_skipped', 'a partial run leaves the connection with a warning');

select isnt(
    (select last_success_at from public.integration_connections where id = (select id from conn)),
    null, 'and records when it last brought data in');

select app.integration_finish_run(id, 'worker-a', 'succeeded', null, now())
  from public.integration_sync_runs where connection_id = (select id from conn) and status = 'running';

select is(
    (select health::text from public.integration_connections where id = (select id from conn)),
    'healthy', 'a clean run clears the warning');

-- Retry with backoff, then failure once attempts run out.
select app.integration_enqueue_run((select id from conn), '9c000000-0000-0000-0000-00000000000a',
    'reconcile', 'payments', 'retry-me', null, null);
update public.integration_sync_runs set max_attempts = 1 where idempotency_key = 'retry-me';
select app.integration_claim_runs('worker-c', 10, 60);
select is(
    (select app.integration_retry_run(id, 'worker-c', 'server_error', 30)
       from public.integration_sync_runs where idempotency_key = 'retry-me'),
    'failed', 'a run out of attempts fails instead of retrying forever');

-- ===================================================== inbox ==============

select is(
    (select inserted from app.integration_inbox_receive('fake', 'evt-1', 'MERCHANT-1', 'payment.updated',
        'payment', 'P1', 1, now(), 'fake.v1', 'v1:body')),
    true, 'a verified event is stored');

select is(
    (select inserted from app.integration_inbox_receive('fake', 'evt-1', 'MERCHANT-1', 'payment.updated',
        'payment', 'P1', 1, now(), 'fake.v1', 'v1:body')),
    false, 'a redelivered event is not stored twice');

select is(
    (select org_id from public.integration_inbox where provider_event_id = 'evt-1'),
    '9c000000-0000-0000-0000-00000000000a'::uuid,
    'the organization comes from the account, never from the request');

select is(
    (select status from app.integration_inbox_receive('fake', 'evt-x', 'NOBODY', 'payment.updated',
        'payment', 'P9', 1, now(), 'fake.v1', 'v1:body')),
    'skipped', 'an event for an account nobody connected is recorded as skipped');

select is(
    (select body_encrypted from public.integration_inbox where provider_event_id = 'evt-x'),
    null, 'and its body is not kept');

select is((select count(*)::int from app.integration_inbox_claim('w1', 10, 60)), 1,
    'the worker claims the pending event');
select is((select count(*)::int from app.integration_inbox_claim('w2', 10, 60)), 0,
    'nobody else can while the lease holds');

update public.integration_inbox set max_attempts = 2 where provider_event_id = 'evt-1';
select is(
    (select app.integration_inbox_settle(id, 'w1', 'retry', 'server_error', 0)
       from public.integration_inbox where provider_event_id = 'evt-1'),
    'pending', 'a transient failure puts the event back');
update public.integration_inbox set next_attempt_at = now() where provider_event_id = 'evt-1';
select app.integration_inbox_claim('w1', 10, 60);
select is(
    (select app.integration_inbox_settle(id, 'w1', 'retry', 'server_error', 0)
       from public.integration_inbox where provider_event_id = 'evt-1'),
    'dead_letter', 'an event out of attempts goes to the dead letter, not the bin');

select is(app.integration_retry_dead_letters((select id from conn)), 1,
    'an operator can send dead letters round again');

-- ===================================================== customers ==========

select is(
    (select outcome from app.integration_apply_customer((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        'C1', repeat('1', 64), 'v1:p1', 1::smallint, '1111', 'v1:ana', repeat('a', 64), now(), now(), 1)),
    'created', 'a customer from the source becomes a contact');

select is(
    (select outcome from app.integration_apply_customer((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        'C1', repeat('1', 64), 'v1:p1', 1::smallint, '1111', 'v1:ana', repeat('a', 64), now(), now(), 1)),
    'unchanged', 'the same version again changes nothing');

select is(
    (select outcome from app.integration_apply_customer((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        'C1', repeat('1', 64), 'v1:p1', 1::smallint, '1111', 'v1:old', repeat('b', 64), now(), now(), 0)),
    'stale', 'an older version arriving late is ignored');

-- A second source customer with the same phone joins the same contact.
select app.integration_apply_customer((select id from conn), '9c000000-0000-0000-0000-00000000000a',
    'C2', repeat('1', 64), 'v1:p1', 1::smallint, '1111', 'v1:a-ruiz', repeat('c', 64), now(), now(), 1);

select is(
    (select count(*)::int from public.customers where org_id = '9c000000-0000-0000-0000-00000000000a'),
    1, 'two source customers with one phone are one contact');

select is(
    (select names_differ from public.customers where org_id = '9c000000-0000-0000-0000-00000000000a'),
    true, 'whose differing names are flagged, not merged');

-- ===================================================== visits =============

select is(
    (select outcome from app.integration_apply_visit((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        'payment', 'P1', 'C1', 'L-UNKNOWN', 'completed', now(), now(), 1)),
    'location_not_mapped', 'a visit at an unmapped location is not stored');

select is(
    (select outcome from app.integration_apply_visit((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        'payment', 'P1', 'C-NONE', 'L1', 'completed', now(), now(), 1)),
    'no_customer', 'a visit with no known customer is not stored');

select is(
    (select outcome from app.integration_apply_visit((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        'payment', 'P1', 'C1', 'L1', 'completed', now() - interval '1 hour', now(), 1)),
    'created', 'a visit is stored once');

select is(
    (select outcome from app.integration_apply_visit((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        'payment', 'P1', 'C1', 'L1', 'completed', now() - interval '1 hour', now(), 1)),
    'unchanged', 'replaying it creates nothing');

select is(
    (select outcome from app.integration_apply_visit((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        'payment', 'P1', 'C1', 'L1', 'cancelled', now() - interval '1 hour', now(), 2)),
    'updated', 'a newer version updates it');

select is(
    (select outcome from app.integration_apply_visit((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        'payment', 'P1', 'C1', 'L1', 'completed', now() - interval '1 hour', now(), 1)),
    'stale', 'an older version arriving after it does not undo it');

select is(
    (select count(*)::int from public.customer_visits where connection_id = (select id from conn)),
    1, 'one payment is one visit, however often it arrives');

-- Phone changed at the source: the profile and its visits move; the old
-- number keeps its consent.
select app.sms_record_consent('9c000000-0000-0000-0000-00000000000a', repeat('1', 64), 'v1:p1',
    1::smallint, '1111', 'review_request', 'opted_out', 'reply_stop', null, '{}'::jsonb, now());

select is(
    (select outcome from app.integration_apply_customer((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        'C1', repeat('2', 64), 'v1:p2', 1::smallint, '2222', 'v1:ana', repeat('a', 64), now(), now(), 2)),
    'updated', 'a phone change at the source is applied');

select is(
    (select cu.phone_hash from public.customer_visits v join public.customers cu on cu.id = v.customer_id
      where v.external_id = 'P1'),
    repeat('2', 64), 'the visit follows its customer to the new number');

select is(
    (select status::text from public.sms_consent_state
      where org_id = '9c000000-0000-0000-0000-00000000000a' and phone_hash = repeat('1', 64)),
    'opted_out', 'the old number''s opt-out is untouched');

select is(
    (select names_differ from public.customers where phone_hash = repeat('1', 64)),
    false, 'and with one name left it is no longer flagged');

-- Owner reads; member and another business do not.
select tests.set_actor('9b000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.customer_visits), 1, 'the owner sees the visit');
select is((select count(*)::int from public.customers), 2, 'and both contacts');
select tests.set_actor('9b000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.customers), 0, 'a member sees no contacts');
select tests.set_actor('9b000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.customer_visits), 0, 'another business sees no visits');
select tests.set_service();

-- ===================================================== issues =============

select app.integration_record_issue((select id from conn), '9c000000-0000-0000-0000-00000000000a', null, null,
    'customer', 'C9', 'invalid_phone', 'Ben O. · •••• 12');
select app.integration_record_issue((select id from conn), '9c000000-0000-0000-0000-00000000000a', null, null,
    'customer', 'C9', 'invalid_phone', null);
select is(
    (select count(*)::int || ':' || max(display_hint)
       from public.integration_record_issues where external_id = 'C9'),
    '1:Ben O. · •••• 12', 'a repeated issue is one row that keeps its hint');
select app.integration_resolve_issues((select id from conn), 'customer', 'C9');
select isnt((select resolved_at from public.integration_record_issues where external_id = 'C9'), null,
    'an object that later applies cleanly resolves its issue');

-- ===================================================== health =============

select is(
    app.integration_report_outcome((select id from conn), '9c000000-0000-0000-0000-00000000000a', 'retryable', 'server_error'),
    'active'::public.integration_state, 'one transient failure changes nothing');

update public.integration_connections set failing_since = now() - interval '16 minutes' where id = (select id from conn);
select is(
    app.integration_report_outcome((select id from conn), '9c000000-0000-0000-0000-00000000000a', 'retryable', 'server_error'),
    'unavailable'::public.integration_state, 'fifteen minutes of failures marks the provider unavailable');

select is(
    app.integration_report_outcome((select id from conn), '9c000000-0000-0000-0000-00000000000a', 'ok', null),
    'active'::public.integration_state, 'a success brings it back');

select is(
    app.integration_report_outcome((select id from conn), '9c000000-0000-0000-0000-00000000000a', 'auth', 'token_revoked'),
    'reauth_required'::public.integration_state, 'refused tokens need the owner to sign in again');

select throws_ok(
    $$ select app.integration_connection_reauthorize((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        'MERCHANT-OTHER', array['scope.read'], true, null, 1::smallint, 'v1:a2', null, null, null) $$,
    'P0001', 'account_mismatch',
    'signing in again as a different account is refused');

select is(
    app.integration_connection_reauthorize((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        'MERCHANT-1', array['scope.read'], true, '9b000000-0000-0000-0000-000000000001',
        1::smallint, 'v1:a2', null, null, null),
    'active'::public.integration_state, 'signing in again as the same account restores it');

select is(
    (select refresh_token_enc from public.integration_credentials where connection_id = (select id from conn)),
    'v1:refresh', 'a sign-in that returns no refresh token keeps the one we had');

select is(app.integration_lock_refresh((select id from conn), 60), true, 'one worker takes the refresh lock');
select is(app.integration_lock_refresh((select id from conn), 60), false, 'a second worker does not');

-- ===================================================== disconnect =========

select app.integration_enqueue_run((select id from conn), '9c000000-0000-0000-0000-00000000000a',
    'manual', 'payments', 'before-disconnect', null, null);

select is(
    app.integration_begin_disconnect((select id from conn), '9c000000-0000-0000-0000-00000000000a',
        '9b000000-0000-0000-0000-000000000001', 'owner_disconnected'),
    'disconnecting'::public.integration_state, 'disconnecting starts');

select is(
    (select status from public.integration_sync_runs where idempotency_key = 'before-disconnect'),
    'cancelled', 'queued runs are cancelled');

select is(
    (select status from app.integration_inbox_receive('fake', 'evt-late', 'MERCHANT-1', 'payment.updated',
        'payment', 'P2', 1, now(), 'fake.v1', 'v1:body')),
    'skipped', 'events arriving while disconnecting are dropped');

select is(
    app.integration_finish_disconnect((select id from conn), '9c000000-0000-0000-0000-00000000000a', 'revoked'),
    'disconnected'::public.integration_state, 'disconnecting finishes');

select is(
    (select count(*)::int from public.integration_credentials where connection_id = (select id from conn)),
    0, 'the tokens are deleted');

select is(
    (select count(*)::int from app.integration_connection_create(
        '9c000000-0000-0000-0000-00000000000b', 'fake', 'payments', 'MERCHANT-1', 'Corner Cafe LLC',
        array['scope.read'], true, '9b000000-0000-0000-0000-000000000003',
        1::smallint, 'v1:a', null, null, null)),
    1, 'once disconnected, the account may be connected again');

-- ===================================================== retention ==========

update public.integration_connections set purge_after = now() - interval '1 second' where id = (select id from conn);
select app.integration_purge(100);

select is(
    (select count(*)::int from public.customer_visits where connection_id = (select id from conn)),
    0, 'after the grace period the visits are deleted');

select is(
    (select count(*)::int from public.customers where phone_hash = repeat('2', 64)),
    0, 'a contact with nothing else to keep it is deleted');

select is(
    (select display_name_encrypted from public.customers where phone_hash = repeat('1', 64)),
    null, 'a contact kept for its consent history loses its name');

select is(
    (select count(*)::int from public.sms_consent_events
      where org_id = '9c000000-0000-0000-0000-00000000000a' and phone_hash = repeat('1', 64)),
    1, 'and its consent history is untouched');

select * from finish();
rollback;
