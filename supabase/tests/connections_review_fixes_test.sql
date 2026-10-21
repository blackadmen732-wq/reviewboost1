-- Fixes from the review of PR #85 (migration 20261021000200):
--
--   * the worker loads a connection, its tokens and chosen places through one
--     service-role function scoped to the business;
--   * a provider marked unavailable is still scheduled, claimed and retried,
--     so a success brings it back;
--   * a contact's shown name follows its lists: a corrected name shows,
--     a removed list's name stops showing, another source's name is kept;
--   * membership is per import, so removing one list keeps the people another
--     list still has.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

select plan(34);

create or replace function tests.rf_row(p_digit text, p_name text) returns jsonb
language sql as $$
    select jsonb_build_object(
        'phone_hash', repeat(p_digit, 64),
        'phone_encrypted', 'enc:' || p_digit,
        'phone_key_version', 1,
        'phone_last_four', repeat(p_digit, 4),
        'name_encrypted', case when p_name is null then null else 'enc:' || p_name end,
        'name_digest', case when p_name is null then null else rpad(md5(p_name), 64, '0') end)
$$;

create or replace function tests.rf_import(p_source text, p_label text, p_rows jsonb) returns uuid
language sql as $$
    select import_id from app.customer_list_import('7f000000-0000-0000-0000-00000000000a',
        '7f100000-0000-0000-0000-000000000001', p_source, p_label, null,
        jsonb_array_length(p_rows), 0, p_rows)
$$;

create or replace function tests.rf_name(p_digit text) returns text
language sql as $$
    select display_name_encrypted from public.customers
     where org_id = '7f000000-0000-0000-0000-00000000000a' and phone_hash = repeat(p_digit, 64)
$$;

create or replace function tests.rf_remove(p_import uuid) returns integer
language sql as $$
    select app.customer_list_remove('7f000000-0000-0000-0000-00000000000a',
        '7f100000-0000-0000-0000-000000000001', p_import)
$$;

-- ------------------------------------------------------------- fixtures ----

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('7f100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'rf-owner@test.com', '', now(), now());

insert into public.organizations (id, name, slug)
values
    ('7f000000-0000-0000-0000-00000000000a', 'RF Org', 'rf-org'),
    ('7f000000-0000-0000-0000-00000000000b', 'RF Other', 'rf-other');

insert into public.organization_members (org_id, user_id, role, status)
values ('7f000000-0000-0000-0000-00000000000a', '7f100000-0000-0000-0000-000000000001', 'owner', 'active');

insert into public.locations (id, org_id, name, timezone)
values ('7f200000-0000-0000-0000-00000000000a', '7f000000-0000-0000-0000-00000000000a', 'Main St', 'UTC');

insert into public.integration_connections (id, org_id, provider_id, workflow_id, external_account_id, state, granted_scopes)
values
    ('7f300000-0000-0000-0000-0000000000c1', '7f000000-0000-0000-0000-00000000000a',
     'fake', 'payments', 'RF-1', 'active', array['scope.read']),
    ('7f300000-0000-0000-0000-0000000000c2', '7f000000-0000-0000-0000-00000000000b',
     'fake', 'payments', 'RF-2', 'active', '{}');

insert into public.integration_credentials (connection_id, org_id, key_version, access_token_enc, refresh_token_enc)
values ('7f300000-0000-0000-0000-0000000000c1', '7f000000-0000-0000-0000-00000000000a', 1, 'ic1:at', 'ic1:rt');

insert into public.integration_location_mappings (connection_id, org_id, external_location_id, location_id)
values ('7f300000-0000-0000-0000-0000000000c1', '7f000000-0000-0000-0000-00000000000a', 'LOC-1',
        '7f200000-0000-0000-0000-00000000000a');

-- ================================================== loading a connection ===

select results_eq(
    $$ select provider_id, external_account_id, state, granted_scopes, access_token_enc, refresh_token_enc,
              mapped_location_ids
         from public.rpc_integration_load_connection('7f000000-0000-0000-0000-00000000000a',
                                                     '7f300000-0000-0000-0000-0000000000c1') $$,
    $$ values ('fake'::text, 'RF-1'::text, 'active'::text, array['scope.read']::text[], 'ic1:at'::text,
               'ic1:rt'::text, array['LOC-1']::text[]) $$,
    'one call loads the connection, its sealed tokens and its chosen places');

select is_empty(
    $$ select * from public.rpc_integration_load_connection('7f000000-0000-0000-0000-00000000000b',
                                                            '7f300000-0000-0000-0000-0000000000c1') $$,
    'naming another business loads nothing');

select results_eq(
    $$ select access_token_enc, mapped_location_ids
         from public.rpc_integration_load_connection('7f000000-0000-0000-0000-00000000000b',
                                                     '7f300000-0000-0000-0000-0000000000c2') $$,
    $$ values (null::text, '{}'::text[]) $$,
    'a connection with no tokens and no places says so rather than vanishing');

select function_privs_are('public', 'rpc_integration_load_connection', array['uuid', 'uuid'],
    'authenticated', array[]::text[], 'signed-in clients cannot load tokens');
select function_privs_are('public', 'rpc_integration_load_connection', array['uuid', 'uuid'],
    'anon', array[]::text[], 'anonymous callers cannot either');
select function_privs_are('public', 'rpc_integration_load_connection', array['uuid', 'uuid'],
    'service_role', array['EXECUTE'], 'the worker can');

-- ======================================================= unavailable =====

update public.integration_connections
   set failing_since = now() - interval '16 minutes', next_sync_at = now() + interval '1 hour'
 where id = '7f300000-0000-0000-0000-0000000000c1';

select is(
    app.integration_report_outcome('7f300000-0000-0000-0000-0000000000c1', '7f000000-0000-0000-0000-00000000000a',
                                   'retryable', 'server_error'),
    'unavailable'::public.integration_state, 'fifteen minutes of failures marks the provider unavailable');

select isnt(
    (select next_sync_at from public.integration_connections where id = '7f300000-0000-0000-0000-0000000000c1'),
    null, 'an unavailable connection keeps its schedule');

update public.integration_connections set next_sync_at = now() - interval '1 minute'
 where id = '7f300000-0000-0000-0000-0000000000c1';

select is(
    (select count(*)::int from app.integration_due_connections(50, 300)
      where connection_id = '7f300000-0000-0000-0000-0000000000c1'),
    1, 'the scheduled reconcile still comes due');

select is(
    (select created from app.integration_enqueue_run('7f300000-0000-0000-0000-0000000000c1',
        '7f000000-0000-0000-0000-00000000000a', 'reconcile', 'payments', 'rf:reconcile:1', null, null)),
    true, 'a run can be queued while the provider is unavailable');

select is(
    (select count(*)::int from app.integration_claim_runs('rf-worker', 50, 60)
      where connection_id = '7f300000-0000-0000-0000-0000000000c1'),
    1, 'and a worker claims it');

insert into public.integration_inbox
    (provider_id, provider_event_id, external_account_id, connection_id, org_id, event_type, occurred_at, payload_version)
values ('fake', 'rf-event-1', 'RF-1', '7f300000-0000-0000-0000-0000000000c1',
        '7f000000-0000-0000-0000-00000000000a', 'payment.updated', now(), 'v1');

select is(
    (select count(*)::int from app.integration_inbox_claim('rf-worker', 50, 60)
      where connection_id = '7f300000-0000-0000-0000-0000000000c1'),
    1, 'webhook events for an unavailable provider are still worked');

select is(
    app.integration_report_outcome('7f300000-0000-0000-0000-0000000000c1', '7f000000-0000-0000-0000-00000000000a',
                                   'ok', null),
    'active'::public.integration_state, 'and the first success brings it back');

update public.integration_connections set state = 'reauth_required'
 where id = '7f300000-0000-0000-0000-0000000000c1';
select throws_ok(
    $$ select * from app.integration_enqueue_run('7f300000-0000-0000-0000-0000000000c1',
        '7f000000-0000-0000-0000-00000000000a', 'manual', 'payments', 'rf:manual:1', null, null) $$,
    'P0001', 'connection_state_invalid', 'a connection that needs the owner to sign in again is not worked');

-- ========================================================= list names =====

-- A contact the business already knew by another name, with a visit.
insert into public.customers (id, org_id, phone_hash, phone_encrypted, phone_last_four, display_name_encrypted)
values
    ('7f400000-0000-0000-0000-000000000009', '7f000000-0000-0000-0000-00000000000a', repeat('9', 64), 'enc:9', '9999', 'enc:from-pos'),
    ('7f400000-0000-0000-0000-000000000005', '7f000000-0000-0000-0000-00000000000a', repeat('5', 64), 'enc:5', '5555', null);
insert into public.customer_visits (org_id, customer_id, location_id, source_kind, kind, status, occurred_at)
values
    ('7f000000-0000-0000-0000-00000000000a', '7f400000-0000-0000-0000-000000000009',
     '7f200000-0000-0000-0000-00000000000a', 'manual', 'payment', 'completed', now()),
    ('7f000000-0000-0000-0000-00000000000a', '7f400000-0000-0000-0000-000000000005',
     '7f200000-0000-0000-0000-00000000000a', 'manual', 'payment', 'completed', now());

create temp table imp (label text primary key, id uuid);
insert into imp values ('s1',  tests.rf_import('google_sheets', 'Sheet one',
    jsonb_build_array(tests.rf_row('1', 'Ana'), tests.rf_row('2', 'Ben'))));

select is(tests.rf_name('2'), 'enc:Ben', 'a new contact shows the list''s name');

insert into imp values ('s1b', tests.rf_import('google_sheets', 'Sheet one',
    jsonb_build_array(tests.rf_row('1', 'Ana'), tests.rf_row('2', 'Benjamin'))));

select is(tests.rf_name('2'), 'enc:Benjamin', 're-importing a corrected name shows the correction');
select is(tests.rf_name('1'), 'enc:Ana', 'an unchanged name stays as it was');

insert into imp values ('s2', tests.rf_import('google_sheets', 'Sheet two',
    jsonb_build_array(tests.rf_row('1', 'Ana Bee'), tests.rf_row('3', 'Cy'))));

select is(tests.rf_name('1'), 'enc:Ana Bee', 'a newer sheet''s name for the person shows');
select is(
    (select count(*)::int from public.customer_list_members m
       join public.customers c on c.id = m.customer_id
      where c.phone_hash = repeat('1', 64)),
    3, 'each import that listed the person remembers them');

-- ================================================== removal, per import ===

select is(tests.rf_remove((select id from imp where label = 's2')), 1,
    'removing the second sheet deletes only the person no other list has');
select is(
    (select count(*)::int from public.customers where phone_hash = repeat('1', 64)
        and org_id = '7f000000-0000-0000-0000-00000000000a'),
    1, 'a person the first sheet still lists stays');
select is(
    (select p.name_encrypted from public.customer_source_profiles p
       join public.customers c on c.id = p.customer_id
      where c.phone_hash = repeat('1', 64) and p.source_kind = 'google_sheets'),
    'enc:Ana', 'their list profile goes back to the remaining sheet''s name');
select is(tests.rf_name('1'), 'enc:Ana', 'and so does the name they show');
select is(
    (select count(*)::int from public.customer_list_members where import_id = (select id from imp where label = 's2')),
    0, 'a removed import keeps no record of who was on it');

select is(tests.rf_remove((select id from imp where label = 's1b')), 0,
    'removing the newer copy of the first sheet deletes no one the older copy still has');
select is(tests.rf_name('2'), 'enc:Ben', 'the older copy''s name for the person shows again');

select is(tests.rf_remove((select id from imp where label = 's1')), 2,
    'removing the last list that has them deletes them');

-- ================================================ names from elsewhere ===

insert into imp values ('c1', tests.rf_import('csv', 'Clients',
    jsonb_build_array(tests.rf_row('9', 'Sheet Nine'), tests.rf_row('5', 'Eve'))));

select is(tests.rf_name('9'), 'enc:from-pos', 'a list never overwrites a name the business already had');
select is(tests.rf_name('5'), 'enc:Eve', 'a list fills a name the business did not have');

select is(tests.rf_remove((select id from imp where label = 'c1')), 0,
    'contacts with visits stay when the list goes');
select is(tests.rf_name('9'), 'enc:from-pos', 'the business''s own name for them is untouched');
select is(tests.rf_name('5'), null, 'a name only the removed list supplied is no longer shown');

-- ============================================================ privileges ===

select is_empty(
    $$ select privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('anon', 'authenticated')
          and table_name = 'customer_list_members' $$,
    'no client role may read or write list membership');

select ok(not has_function_privilege('authenticated', 'app.customer_refresh_display_name(uuid, text, uuid)', 'execute'),
    'no client role may rewrite a contact''s name');

select * from finish();
rollback;
