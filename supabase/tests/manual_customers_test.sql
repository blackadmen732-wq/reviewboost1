-- Customers an owner adds by hand, in the one customer model.
--
-- Performed, not asserted: each case runs as that caller.
--
--   * an owner and an admin can add, list, change and remove;
--   * a member, a viewer and another business can do none of it;
--   * a number added twice by hand is refused, not merged;
--   * a number already known from a connected app becomes the same customer,
--     with the owner's name as a second source, and differing names are flagged;
--   * a number from a connected app cannot be changed by hand;
--   * removing keeps what a connected app brought in, and consent history;
--   * saving records no consent; every write is audited with ids only;
--   * nobody can write the tables directly.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

select plan(26);

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

create or replace function tests.reset_role() returns void
language plpgsql as $$
begin
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
end $$;

grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

select tests.reset_role();

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
    ('00000000-1701-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'owner@mc.test', 'x', now(), now()),
    ('00000000-1701-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'admin@mc.test', 'x', now(), now()),
    ('00000000-1701-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'member@mc.test', 'x', now(), now()),
    ('00000000-1701-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'viewer@mc.test', 'x', now(), now()),
    ('00000000-1701-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'other@mc.test', 'x', now(), now());

insert into public.organizations (id, name, slug, status)
values
    ('00000000-1701-0000-0000-000000000001', 'Mine', 'mc-mine', 'active'),
    ('00000000-1701-0000-0000-000000000002', 'Theirs', 'mc-theirs', 'active');

insert into public.organization_members (org_id, user_id, role, status)
values
    ('00000000-1701-0000-0000-000000000001', '00000000-1701-0000-0000-0000000000a1', 'owner', 'active'),
    ('00000000-1701-0000-0000-000000000001', '00000000-1701-0000-0000-0000000000a2', 'admin', 'active'),
    ('00000000-1701-0000-0000-000000000001', '00000000-1701-0000-0000-0000000000a3', 'member', 'active'),
    ('00000000-1701-0000-0000-000000000001', '00000000-1701-0000-0000-0000000000a4', 'viewer', 'active'),
    ('00000000-1701-0000-0000-000000000002', '00000000-1701-0000-0000-0000000000b1', 'owner', 'active');

insert into public.locations (id, org_id, name, google_review_url, status)
values ('00000000-1701-0000-0000-000000000011', '00000000-1701-0000-0000-000000000001',
        'Mine Main', 'https://g.page/r/mine/review', 'active');

-- A customer Square already brought in: a connection, a source profile, a visit.
insert into public.integration_connections
    (id, org_id, provider_id, workflow_id, external_account_id, state)
values ('00000000-1701-0000-0000-0000000000c1', '00000000-1701-0000-0000-000000000001',
        'square', 'payments', 'merchant-1', 'active');
insert into public.customers (id, org_id, phone_hash, phone_encrypted, phone_last_four, display_name_encrypted)
values ('00000000-1701-0000-0000-0000000000d1', '00000000-1701-0000-0000-000000000001',
        repeat('s', 64), 'v1:square-phone-cipher', '7781', 'v1:square-name-cipher');
insert into public.customer_source_profiles
    (org_id, customer_id, connection_id, source_kind, external_id, name_encrypted, name_digest)
values ('00000000-1701-0000-0000-000000000001', '00000000-1701-0000-0000-0000000000d1',
        '00000000-1701-0000-0000-0000000000c1', 'integration', 'SQ-CUST-1', 'v1:square-name-cipher', repeat('n', 32));
insert into public.customer_visits
    (org_id, customer_id, location_id, connection_id, source_kind, external_id, customer_external_id, kind, status, occurred_at)
values ('00000000-1701-0000-0000-000000000001', '00000000-1701-0000-0000-0000000000d1',
        '00000000-1701-0000-0000-000000000011', '00000000-1701-0000-0000-0000000000c1', 'integration',
        'SQ-PAY-1', 'SQ-CUST-1', 'payment', 'completed', now() - interval '1 hour');

-- ------------------------------------------------------- owner adds -------

select tests.set_actor('00000000-1701-0000-0000-0000000000a1');

select is(
    (select outcome from public.rpc_customer_manual_save(
        '00000000-1701-0000-0000-000000000001', null, 'v1:ana-cipher', repeat('a', 32),
        repeat('p', 64), 'v1:ana-phone-cipher', 1::smallint, '0142', 'req-1')),
    'created', 'an owner adds a new customer');

select throws_ok(
    $$ select * from public.rpc_customer_manual_save(
        '00000000-1701-0000-0000-000000000001', null, null, null,
        repeat('p', 64), 'v1:other-cipher', 1::smallint, '0142', 'req-2') $$,
    'P0001', 'contact_exists',
    'the same number added twice by hand is refused, not merged');

select is(
    (select outcome from public.rpc_customer_manual_save(
        '00000000-1701-0000-0000-000000000001', null, 'v1:bo-cipher', repeat('b', 32),
        repeat('s', 64), 'v1:bo-phone-cipher', 1::smallint, '7781', 'req-3')),
    'linked', 'a number Square already knows becomes the same customer');

select is(
    (select count(*)::int from public.customers where org_id = '00000000-1701-0000-0000-000000000001'),
    2, 'one customer per number: no duplicate for the Square customer');

select is(
    (select names_differ from public.customers where id = '00000000-1701-0000-0000-0000000000d1'),
    true, 'the owner''s name and Square''s name differ, and that is flagged');

select is(
    (select sources from public.rpc_customers_list('00000000-1701-0000-0000-000000000001')
      where id = '00000000-1701-0000-0000-0000000000d1'),
    array['manual', 'square'], 'the list shows both sources');

select is(
    (select last_visit_kind from public.rpc_customers_list('00000000-1701-0000-0000-000000000001')
      where id = '00000000-1701-0000-0000-0000000000d1'),
    'payment', 'the list shows the last visit from Square');

select throws_ok(
    $$ select * from public.rpc_customer_manual_save(
        '00000000-1701-0000-0000-000000000001', '00000000-1701-0000-0000-0000000000d1', 'v1:bo-cipher', repeat('b', 32),
        repeat('q', 64), 'v1:new-phone-cipher', 1::smallint, '9999', 'req-4') $$,
    'P0001', 'phone_from_source',
    'a number from a connected app cannot be changed by hand');

select throws_ok(
    $$ select * from public.rpc_customer_manual_save(
        '00000000-1701-0000-0000-000000000001', null, null, null,
        repeat('r', 64), 'v1:x-cipher', 1::smallint, '12ab', 'req-5') $$,
    '22023', NULL,
    'a malformed last four is refused');

select is(
    (select consent_status from public.rpc_customers_list('00000000-1701-0000-0000-000000000001')
      where phone_last_four = '0142'),
    null, 'adding a customer records no consent');

select tests.reset_role();

select is(
    (select count(*)::int from public.sms_consent_events where org_id = '00000000-1701-0000-0000-000000000001'),
    0, 'no consent event was written');

-- ------------------------------------------------------- admin edits ------

select tests.set_actor('00000000-1701-0000-0000-0000000000a2');

select is(
    (select outcome from public.rpc_customer_manual_save(
        '00000000-1701-0000-0000-000000000001',
        (select id from public.customers where phone_last_four = '0142'),
        'v1:ana-renamed', repeat('c', 32), repeat('t', 64), 'v1:ana-new-phone', 1::smallint, '5555', 'req-6')),
    'updated', 'an admin changes a hand-added customer, number included');

select lives_ok(
    $$ select public.rpc_customers_record_export('00000000-1701-0000-0000-000000000001', 2, 'req-7') $$,
    'an admin may export, and the export is recorded');

-- ------------------------------------------------- member and viewer ------

select tests.set_actor('00000000-1701-0000-0000-0000000000a3');

select is(
    (select count(*)::int from public.rpc_customers_list('00000000-1701-0000-0000-000000000001')),
    0, 'a member gets nothing from the list');

select throws_ok(
    $$ select * from public.rpc_customer_manual_save(
        '00000000-1701-0000-0000-000000000001', null, null, null,
        repeat('u', 64), 'v1:x-cipher', 1::smallint, '1111', 'req-8') $$,
    'P0001', 'not_found_or_forbidden', 'a member cannot add a customer');

select tests.set_actor('00000000-1701-0000-0000-0000000000a4');

select throws_ok(
    $$ select public.rpc_customer_manual_delete('00000000-1701-0000-0000-000000000001',
        '00000000-1701-0000-0000-0000000000d1', 'req-9') $$,
    'P0001', 'not_found_or_forbidden', 'a viewer cannot remove a customer');

-- -------------------------------------------------- another business ------

select tests.set_actor('00000000-1701-0000-0000-0000000000b1');

select is(
    (select count(*)::int from public.customers), 0, 'another business cannot read the customers');

select throws_ok(
    $$ select * from public.rpc_customer_manual_save(
        '00000000-1701-0000-0000-000000000001', null, null, null,
        repeat('v', 64), 'v1:x-cipher', 1::smallint, '2222', 'req-10') $$,
    'P0001', 'not_found_or_forbidden', 'another business cannot add to this list');

select throws_ok(
    $$ select * from public.rpc_customer_manual_save(
        '00000000-1701-0000-0000-000000000002', '00000000-1701-0000-0000-0000000000d1', null, null,
        null, null, 1::smallint, null, 'req-11') $$,
    'P0001', 'not_found_or_forbidden', 'a change aimed at another business''s customer finds nothing');

select is(
    public.rpc_customer_manual_delete('00000000-1701-0000-0000-000000000002',
        '00000000-1701-0000-0000-0000000000d1', 'req-12'),
    'not_found', 'another business cannot remove this business''s customer');

select throws_ok(
    $$ insert into public.customers (org_id, phone_hash) values ('00000000-1701-0000-0000-000000000002', repeat('w', 64)) $$,
    '42501', NULL, 'nobody writes customers directly');

select throws_ok(
    $$ insert into public.customer_source_profiles (org_id, customer_id, source_kind)
       values ('00000000-1701-0000-0000-000000000001', '00000000-1701-0000-0000-0000000000d1', 'manual') $$,
    '42501', NULL, 'nobody writes source profiles directly');

select tests.set_anonymous();

select throws_ok(
    $$ select * from public.rpc_customers_list('00000000-1701-0000-0000-000000000001') $$,
    '42501', NULL, 'a signed-out visitor cannot call the list');

-- ------------------------------------------------------------ removal -----

select tests.set_actor('00000000-1701-0000-0000-0000000000a1');

select is(
    public.rpc_customer_manual_delete('00000000-1701-0000-0000-000000000001',
        '00000000-1701-0000-0000-0000000000d1', 'req-13'),
    'kept_from_source', 'removing a Square customer''s hand-added name keeps the customer Square brought in');

select is(
    public.rpc_customer_manual_delete('00000000-1701-0000-0000-000000000001',
        (select id from public.customers where phone_last_four = '5555'), 'req-14'),
    'deleted', 'removing a customer only added by hand deletes them');

select tests.reset_role();

select is(
    (select array_agg(action order by id) from public.audit_events
      where org_id = '00000000-1701-0000-0000-000000000001' and action like 'customer.%'
        and metadata::text !~ 'cipher|0142|7781'),
    array['customer.manual_created', 'customer.manual_linked', 'customer.manual_updated',
          'customer.exported', 'customer.manual_removed', 'customer.manual_removed'],
    'every write left one audit event, in order, with ids only');

select * from finish();
rollback;
