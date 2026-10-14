-- Customer list imports (Google Sheets).
--
-- Real roles doing real things: clients unable to write or reach the import
-- functions, members and other businesses refused, re-imports updating instead
-- of duplicating, a list never overwriting a name from the business's own
-- system, removal taking back exactly what was added, and nothing touching
-- consent.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

select plan(27);

create or replace function tests.cl_set_actor(p_user_id uuid) returns void
language plpgsql as $$
begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end $$;

create or replace function tests.cl_set_service() returns void
language plpgsql as $$
begin
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
end $$;

-- One normalised row, as the server sends it.
create or replace function tests.cl_row(p_digit text, p_name text) returns jsonb
language sql as $$
    select jsonb_build_object(
        'phone_hash', repeat(p_digit, 64),
        'phone_encrypted', 'enc:' || p_digit,
        'phone_key_version', 1,
        'phone_last_four', repeat(p_digit, 4),
        'name_encrypted', case when p_name is null then null else 'enc:' || p_name end,
        'name_digest', case when p_name is null then null else rpad(md5(p_name), 64, '0') end)
$$;

grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

-- ------------------------------------------------------------- fixtures ----

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
    ('7b000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cl-owner@test.com', '', now(), now()),
    ('7b000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cl-member@test.com', '', now(), now()),
    ('7b000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cl-outsider@test.com', '', now(), now());

insert into public.organizations (id, name, slug)
values
    ('7c000000-0000-0000-0000-00000000000a', 'CL Org A', 'cl-org-a'),
    ('7c000000-0000-0000-0000-00000000000b', 'CL Org B', 'cl-org-b');

insert into public.organization_members (org_id, user_id, role, status)
values
    ('7c000000-0000-0000-0000-00000000000a', '7b000000-0000-0000-0000-000000000001', 'owner', 'active'),
    ('7c000000-0000-0000-0000-00000000000a', '7b000000-0000-0000-0000-000000000002', 'member', 'active'),
    ('7c000000-0000-0000-0000-00000000000b', '7b000000-0000-0000-0000-000000000003', 'owner', 'active');

insert into public.locations (id, org_id, name, timezone)
values ('7d000000-0000-0000-0000-00000000000a', '7c000000-0000-0000-0000-00000000000a', 'Main St', 'UTC');

-- A contact the business already had, with a name from its own system and a
-- visit. A list must not overwrite or remove any of it.
insert into public.customers (id, org_id, phone_hash, phone_encrypted, phone_last_four, display_name_encrypted)
values ('7e000000-0000-0000-0000-000000000001', '7c000000-0000-0000-0000-00000000000a', repeat('9', 64), 'enc:9', '9999', 'enc:from-pos');
insert into public.customer_visits (org_id, customer_id, location_id, source_kind, kind, status, occurred_at)
values ('7c000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-000000000001',
        '7d000000-0000-0000-0000-00000000000a', 'manual', 'payment', 'completed', now());

-- ===================================================== privileges =========

select is_empty(
    $$ select privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('anon', 'authenticated')
          and table_name = 'customer_list_imports' and privilege_type <> 'SELECT' $$,
    'no client role may write customer_list_imports');

select is_empty(
    $$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'app')
          and (p.proname like 'customer_list%' or p.proname like 'rpc_customer_list%')
          and (has_function_privilege('authenticated', p.oid, 'execute')
               or has_function_privilege('anon', p.oid, 'execute')) $$,
    'no client role may execute any customer list function');

select ok(has_function_privilege('service_role', 'public.rpc_customer_list_import(uuid, uuid, text, text, text, integer, integer, jsonb)', 'execute'),
    'the service role reaches the import wrapper');

-- ======================================================= authorization =====

select throws_ok(
    $$ select * from app.customer_list_import('7c000000-0000-0000-0000-00000000000a',
         '7b000000-0000-0000-0000-000000000002', 'google_sheets', 'List', null, 1, 0,
         jsonb_build_array(tests.cl_row('1', 'Ana'))) $$,
    'P0002', null, 'a member cannot import into the business');

select throws_ok(
    $$ select * from app.customer_list_import('7c000000-0000-0000-0000-00000000000a',
         '7b000000-0000-0000-0000-000000000003', 'google_sheets', 'List', null, 1, 0,
         jsonb_build_array(tests.cl_row('1', 'Ana'))) $$,
    'P0002', null, 'another business''s owner cannot import into it');

select throws_ok(
    $$ select * from app.customer_list_import('7c000000-0000-0000-0000-00000000000a',
         null, 'google_sheets', 'List', null, 1, 0, jsonb_build_array(tests.cl_row('1', 'Ana'))) $$,
    'P0002', null, 'an import with no actor is refused');

select throws_ok(
    $$ select * from app.customer_list_import('7c000000-0000-0000-0000-00000000000a',
         '7b000000-0000-0000-0000-000000000001', 'square', 'List', null, 1, 0, '[]'::jsonb) $$,
    '22023', null, 'an unknown source is refused');

select throws_ok(
    $$ select * from app.customer_list_import('7c000000-0000-0000-0000-00000000000a',
         '7b000000-0000-0000-0000-000000000001', 'google_sheets', 'List', null, 2001, 0, '[]'::jsonb) $$,
    '22023', null, 'more than 2,000 rows is refused');

-- ============================================================= import =====

create temp table first_import as
select * from app.customer_list_import('7c000000-0000-0000-0000-00000000000a',
    '7b000000-0000-0000-0000-000000000001', 'google_sheets', 'Customers 2026', repeat('d', 64), 5, 1,
    jsonb_build_array(tests.cl_row('1', 'Ana Ruiz'), tests.cl_row('2', 'Ben Cole'),
                      tests.cl_row('1', 'Someone Else'), tests.cl_row('9', 'Sheet Name')));

select results_eq(
    $$ select created_count, updated_count, unchanged_count from first_import $$,
    $$ values (2, 1, 0) $$,
    'two new contacts, one existing contact matched, a repeated number counted once');

select is(
    (select count(*)::int from public.customers where org_id = '7c000000-0000-0000-0000-00000000000a'),
    3, 'the business now has three contacts, not four');

select is(
    (select display_name_encrypted from public.customers where id = '7e000000-0000-0000-0000-000000000001'),
    'enc:from-pos', 'a list never overwrites a name the business already had');

select is(
    (select name_encrypted from public.customer_source_profiles p
       join public.customers c on c.id = p.customer_id
      where c.phone_hash = repeat('1', 64) and p.source_kind = 'google_sheets'),
    'enc:Ana Ruiz', 'the first row for a repeated number wins');

select results_eq(
    $$ select rows_received, rows_unusable, source_label, status from public.customer_list_imports
        where id = (select import_id from first_import) $$,
    $$ values (5, 1, 'Customers 2026'::text, 'active'::text) $$,
    'the import keeps counts and the sheet''s title, nothing about people');

-- ========================================================== re-import =====

create temp table second_import as
select * from app.customer_list_import('7c000000-0000-0000-0000-00000000000a',
    '7b000000-0000-0000-0000-000000000001', 'google_sheets', 'Customers 2026', repeat('d', 64), 3, 0,
    jsonb_build_array(tests.cl_row('1', 'Ana Ruiz'), tests.cl_row('2', 'Benjamin Cole'), tests.cl_row('3', null)));

select results_eq(
    $$ select created_count, updated_count, unchanged_count from second_import $$,
    $$ values (1, 1, 1) $$,
    're-importing updates a changed name, leaves an unchanged one, adds the new person');

select is(
    (select count(*)::int from public.customer_source_profiles p
       join public.customers c on c.id = p.customer_id
      where c.org_id = '7c000000-0000-0000-0000-00000000000a' and p.source_kind = 'google_sheets'),
    4, 'one Google Sheets profile per contact, never a second copy');

select is(
    (select names_differ from public.customers where id = '7e000000-0000-0000-0000-000000000001'),
    false, 'a list name alone does not mark a contact as having two names');

-- ========================================================== isolation =====

select tests.cl_set_actor('7b000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.customer_list_imports), 2, 'the owner sees their two imports');
select tests.cl_set_actor('7b000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.customer_list_imports), 0, 'a member sees no imports');
select tests.cl_set_actor('7b000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.customer_list_imports), 0, 'another business sees no imports');
select throws_ok(
    $$ insert into public.customer_list_imports (org_id, source, rows_received)
       values ('7c000000-0000-0000-0000-00000000000b', 'google_sheets', 0) $$,
    '42501', null, 'a signed-in user cannot write an import row directly');
select tests.cl_set_service();

-- ============================================================= removal =====

select throws_ok(
    format($$ select app.customer_list_remove('7c000000-0000-0000-0000-00000000000b',
              '7b000000-0000-0000-0000-000000000003', %L) $$, (select import_id from second_import)),
    'P0002', null, 'another business cannot remove this business''s import');

-- Removing the first import takes back nothing: the second import re-wrote
-- every profile the first one made.
select is(
    app.customer_list_remove('7c000000-0000-0000-0000-00000000000a',
        '7b000000-0000-0000-0000-000000000001', (select import_id from first_import)),
    0, 'removing an import superseded by a newer one removes no contacts');

select is(
    app.customer_list_remove('7c000000-0000-0000-0000-00000000000a',
        '7b000000-0000-0000-0000-000000000001', (select import_id from second_import)),
    3, 'removing the current import deletes the contacts only it knew about');

select is(
    (select count(*)::int from public.customers where id = '7e000000-0000-0000-0000-000000000001'),
    1, 'a contact with a visit stays when the list is removed');

select is(
    (select count(*)::int from public.customer_source_profiles p
       join public.customers c on c.id = p.customer_id
      where c.org_id = '7c000000-0000-0000-0000-00000000000a' and p.source_kind = 'google_sheets'),
    0, 'no Google Sheets profiles remain');

select is(
    app.customer_list_remove('7c000000-0000-0000-0000-00000000000a',
        '7b000000-0000-0000-0000-000000000001', (select import_id from second_import)),
    0, 'removing twice is harmless');

select is(
    (select count(*)::int from public.sms_consent_events where org_id = '7c000000-0000-0000-0000-00000000000a'),
    0, 'importing and removing lists never writes consent');

select * from finish();
rollback;
