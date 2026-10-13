-- Customers (customer_contacts): who can read, who can write, and what saving
-- a customer does not do.
--
-- Performed, not asserted: each case runs the read or the write as that caller.
--
--   * an owner and an admin can save, list, update and remove;
--   * a member and a viewer can neither read nor write;
--   * another business's owner can neither read nor change this business's list;
--   * a number already saved is refused, not merged;
--   * a place from another business is refused;
--   * saving a customer records no consent;
--   * the list shows the consent ledger's status and the latest Text Request;
--   * every write leaves an audit event with ids only;
--   * nobody can write the table directly.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

select plan(24);

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
    ('00000000-1601-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'owner@cc.test', 'x', now(), now()),
    ('00000000-1601-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'admin@cc.test', 'x', now(), now()),
    ('00000000-1601-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'member@cc.test', 'x', now(), now()),
    ('00000000-1601-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'viewer@cc.test', 'x', now(), now()),
    ('00000000-1601-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'other@cc.test', 'x', now(), now());

insert into public.organizations (id, name, slug, status)
values
    ('00000000-1601-0000-0000-000000000001', 'Mine', 'cc-mine', 'active'),
    ('00000000-1601-0000-0000-000000000002', 'Theirs', 'cc-theirs', 'active');

insert into public.organization_members (org_id, user_id, role, status)
values
    ('00000000-1601-0000-0000-000000000001', '00000000-1601-0000-0000-0000000000a1', 'owner', 'active'),
    ('00000000-1601-0000-0000-000000000001', '00000000-1601-0000-0000-0000000000a2', 'admin', 'active'),
    ('00000000-1601-0000-0000-000000000001', '00000000-1601-0000-0000-0000000000a3', 'member', 'active'),
    ('00000000-1601-0000-0000-000000000001', '00000000-1601-0000-0000-0000000000a4', 'viewer', 'active'),
    ('00000000-1601-0000-0000-000000000002', '00000000-1601-0000-0000-0000000000b1', 'owner', 'active');

insert into public.locations (id, org_id, name, google_review_url, status)
values
    ('00000000-1601-0000-0000-000000000011', '00000000-1601-0000-0000-000000000001',
     'Mine Main', 'https://g.page/r/mine/review', 'active'),
    ('00000000-1601-0000-0000-000000000021', '00000000-1601-0000-0000-000000000002',
     'Theirs Main', 'https://g.page/r/theirs/review', 'active');

-- ------------------------------------------------------- owner saves -----

select tests.set_actor('00000000-1601-0000-0000-0000000000a1');

select is(
    (select created from public.rpc_customer_contact_save(
        '00000000-1601-0000-0000-000000000001', null, '00000000-1601-0000-0000-000000000011',
        'v1:name-ciphertext-aaaa', 1::smallint, repeat('a', 64), 'v1:phone-ciphertext-aaaa',
        1::smallint, '0142', 'req-1')),
    true, 'an owner saves a new customer');

select throws_ok(
    $$ select * from public.rpc_customer_contact_save(
        '00000000-1601-0000-0000-000000000001', null, null,
        null, 1::smallint, repeat('a', 64), 'v1:phone-ciphertext-bbbb', 1::smallint, '0142', 'req-2') $$,
    'P0001', 'contact_exists',
    'the same number cannot be saved twice for one business');

select throws_ok(
    $$ select * from public.rpc_customer_contact_save(
        '00000000-1601-0000-0000-000000000001', null, '00000000-1601-0000-0000-000000000021',
        null, 1::smallint, repeat('c', 64), 'v1:phone-ciphertext-cccc', 1::smallint, '7781', 'req-3') $$,
    'P0001', 'not_found_or_forbidden',
    'a place belonging to another business is refused');

select throws_ok(
    $$ select * from public.rpc_customer_contact_save(
        '00000000-1601-0000-0000-000000000001', null, null,
        null, 1::smallint, repeat('d', 64), 'v1:phone-ciphertext-dddd', 1::smallint, '12ab', 'req-4') $$,
    '23514', NULL,
    'last four must be four digits');

select is(
    (select count(*)::int from public.rpc_customer_contacts_list('00000000-1601-0000-0000-000000000001')),
    1, 'the owner lists the saved customer');

select is(
    (select consent_status from public.rpc_customer_contacts_list('00000000-1601-0000-0000-000000000001')),
    null, 'saving a customer records no consent');

select tests.reset_role();

select is(
    (select count(*)::int from public.sms_consent_events
      where org_id = '00000000-1601-0000-0000-000000000001'),
    0, 'no consent event was written by saving a customer');

select is(
    (select count(*)::int from public.audit_events
      where org_id = '00000000-1601-0000-0000-000000000001'
        and action = 'customer_contact.created'
        and metadata::text !~ '0142|ciphertext'),
    1, 'the save is audited, with ids only');

-- ------------------------------------- the list reads the ledger ---------

select app.sms_record_consent('00000000-1601-0000-0000-000000000001', repeat('a', 64),
    'v1:enc', 1::smallint, '0142', 'review_request', 'opted_in', 'owner_import', null,
    '{"method":"in_person","attested_by":"u","wording_version":"owner-attestation-v1"}'::jsonb, now());

select tests.set_actor('00000000-1601-0000-0000-0000000000a2');

select is(
    (select consent_status from public.rpc_customer_contacts_list('00000000-1601-0000-0000-000000000001')),
    'opted_in', 'an admin sees the consent the owner attested');

-- ------------------------------------------------------- admin edits -----

select is(
    (select created from public.rpc_customer_contact_save(
        '00000000-1601-0000-0000-000000000001',
        (select id from public.customer_contacts limit 1),
        null, 'v1:name-ciphertext-renamed', 1::smallint, repeat('a', 64),
        'v1:phone-ciphertext-aaaa', 1::smallint, '0142', 'req-5')),
    false, 'an admin updates a customer');

select lives_ok(
    $$ select * from public.rpc_customer_contacts_record_export('00000000-1601-0000-0000-000000000001', 1, 'req-6') $$,
    'an admin may export, and the export is recorded');

-- ------------------------------------------- member and viewer -----------

select tests.set_actor('00000000-1601-0000-0000-0000000000a3');

select is(
    (select count(*)::int from public.customer_contacts),
    0, 'a member cannot read the list');

select is(
    (select count(*)::int from public.rpc_customer_contacts_list('00000000-1601-0000-0000-000000000001')),
    0, 'a member gets nothing from the list function');

select throws_ok(
    $$ select * from public.rpc_customer_contact_save(
        '00000000-1601-0000-0000-000000000001', null, null,
        null, 1::smallint, repeat('e', 64), 'v1:phone-ciphertext-eeee', 1::smallint, '5521', 'req-7') $$,
    'P0001', 'not_found_or_forbidden',
    'a member cannot save a customer');

select tests.set_actor('00000000-1601-0000-0000-0000000000a4');

select throws_ok(
    $$ select public.rpc_customer_contact_delete('00000000-1601-0000-0000-000000000001',
        (select id from public.customer_contacts limit 1), 'req-8') $$,
    'P0001', 'not_found_or_forbidden',
    'a viewer cannot remove a customer');

-- ----------------------------------------------- another business -------

select tests.set_actor('00000000-1601-0000-0000-0000000000b1');

select is(
    (select count(*)::int from public.customer_contacts),
    0, 'another business cannot read this list');

select throws_ok(
    $$ select * from public.rpc_customer_contact_save(
        '00000000-1601-0000-0000-000000000001', null, null,
        null, 1::smallint, repeat('f', 64), 'v1:phone-ciphertext-ffff', 1::smallint, '3390', 'req-9') $$,
    'P0001', 'not_found_or_forbidden',
    'another business cannot add to this list');

select throws_ok(
    $$ select * from public.rpc_customer_contact_save(
        '00000000-1601-0000-0000-000000000002',
        '00000000-1601-0000-0000-00000000ffff', null,
        null, 1::smallint, repeat('f', 64), 'v1:phone-ciphertext-ffff', 1::smallint, '3390', 'req-10') $$,
    'P0001', 'not_found_or_forbidden',
    'an update aimed at a row outside the caller''s business finds nothing');

select is(
    public.rpc_customer_contact_delete('00000000-1601-0000-0000-000000000002',
        (select id from public.customer_contacts c where c.org_id = '00000000-1601-0000-0000-000000000001' limit 1),
        'req-11'),
    false, 'another business cannot remove this business''s customer through its own id');

select throws_ok(
    $$ insert into public.customer_contacts (org_id, phone_hash, phone_encrypted, phone_last_four)
       values ('00000000-1601-0000-0000-000000000002', repeat('g', 64), 'v1:phone-ciphertext-gggg', '1111') $$,
    '42501', NULL,
    'nobody writes the table directly');

-- ------------------------------------------------------ anonymous -------

select tests.set_anonymous();

select throws_ok(
    $$ select * from public.rpc_customer_contacts_list('00000000-1601-0000-0000-000000000001') $$,
    '42501', NULL,
    'a signed-out visitor cannot call the list');

-- ------------------------------------------------------- removal --------

select tests.set_actor('00000000-1601-0000-0000-0000000000a1');

select is(
    public.rpc_customer_contact_delete('00000000-1601-0000-0000-000000000001',
        (select id from public.customer_contacts limit 1), 'req-12'),
    true, 'the owner removes the customer');

select tests.reset_role();

select is(
    (select count(*)::int from public.sms_consent_state
      where org_id = '00000000-1601-0000-0000-000000000001' and phone_hash = repeat('a', 64)),
    1, 'removing a customer leaves their consent history alone');

select is(
    (select array_agg(action order by id) from public.audit_events
      where org_id = '00000000-1601-0000-0000-000000000001' and action like 'customer_contact.%'),
    array['customer_contact.created', 'customer_contact.updated',
          'customer_contact.exported', 'customer_contact.deleted'],
    'every write left exactly one audit event, in order');

select * from finish();
rollback;
