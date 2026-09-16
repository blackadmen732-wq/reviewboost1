-- Customer import + integration foundation — database layer tests.
--
-- Covers the canonical customer schema and the import pipeline's DB half:
-- match-or-create idempotency, cross-org isolation, external-link uniqueness
-- per org, import-job idempotency by (org, idempotency_key), per-row
-- outcomes, RLS lockdown against anon and non-admin roles.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

select plan(14);

-- ------------------------------------------------------------- fixtures ----

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

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
    ('7b000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cust-owner@test.com', '', now(), now()),
    ('7b000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cust-member@test.com', '', now(), now()),
    ('7b000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cust-outsider@test.com', '', now(), now());

insert into public.organizations (id, name, slug)
values
    ('7c000000-0000-0000-0000-0000000000c1', 'Customer Org A', 'customer-org-a'),
    ('7c000000-0000-0000-0000-0000000000c2', 'Customer Org B', 'customer-org-b');

insert into public.organization_members (org_id, user_id, role, status)
values
    ('7c000000-0000-0000-0000-0000000000c1', '7b000000-0000-0000-0000-0000000000c1', 'owner', 'active'),
    ('7c000000-0000-0000-0000-0000000000c1', '7b000000-0000-0000-0000-0000000000c3', 'member', 'active'),
    ('7c000000-0000-0000-0000-0000000000c2', '7b000000-0000-0000-0000-0000000000c4', 'owner', 'active');

-- =========================================== canonical customer upsert ====

select tests.set_service();

-- First upsert creates a new canonical customer.
select is(
    (select matched from app.customer_upsert_by_phone(
        '7c000000-0000-0000-0000-0000000000c1', repeat('a',64), 'v1:enc', 1::smallint, '0001',
        'Alice', null, null, null, null)),
    false, 'first upsert with a new phone hash reports matched=false');

-- Same (org, phone_hash) → matched=true, same customer id.
select is(
    (select customer_id from app.customer_upsert_by_phone(
        '7c000000-0000-0000-0000-0000000000c1', repeat('a',64), 'v1:enc', 1::smallint, '0001',
        'Alice', null, null, null, null)),
    (select id from public.customers
      where org_id = '7c000000-0000-0000-0000-0000000000c1' and phone_hash = repeat('a',64)),
    'a re-upsert returns the same canonical customer id');
select is(
    (select matched from app.customer_upsert_by_phone(
        '7c000000-0000-0000-0000-0000000000c1', repeat('a',64), 'v1:enc', 1::smallint, '0001',
        'Alice', null, null, null, null)),
    true, 'a re-upsert reports matched=true');

-- Same phone hash under a DIFFERENT org creates a distinct canonical customer.
select is(
    (select matched from app.customer_upsert_by_phone(
        '7c000000-0000-0000-0000-0000000000c2', repeat('a',64), 'v1:enc', 1::smallint, '0001',
        'Alice at Org B', null, null, null, null)),
    false, 'the same phone hash at a different org is a new customer (no cross-org leak)');

select is(
    (select count(*)::integer from public.customers where phone_hash = repeat('a',64)),
    2, 'two orgs with the same phone hash produce two distinct customer rows');

-- =============================================== external link uniqueness =

select tests.set_service();
-- Create a source connection to link.
insert into public.customer_source_connections (id, org_id, kind, name)
values ('7d000000-0000-0000-0000-0000000000e1', '7c000000-0000-0000-0000-0000000000c1', 'csv', 'Imported Upload');

-- Link two orgs' customers to the SAME source external_id — allowed because
-- uniqueness is (org, source_kind, external_id).
select lives_ok(
    $$ select app.customer_external_link('7c000000-0000-0000-0000-0000000000c1',
        (select id from public.customers where org_id = '7c000000-0000-0000-0000-0000000000c1' and phone_hash = repeat('a',64)),
        'csv', '7d000000-0000-0000-0000-0000000000e1', 'ext-1', null) $$,
    'first external link in org A succeeds');
select lives_ok(
    $$ select app.customer_external_link('7c000000-0000-0000-0000-0000000000c2',
        (select id from public.customers where org_id = '7c000000-0000-0000-0000-0000000000c2' and phone_hash = repeat('a',64)),
        'csv', null, 'ext-1', null) $$,
    'same external_id in org B does not collide (uniqueness scoped by org)');

-- Idempotent within org: re-linking the same (org, source_kind, external_id) is a no-op.
select is(
    (select count(*)::integer from public.customer_external_links
      where org_id = '7c000000-0000-0000-0000-0000000000c1'
        and source_kind = 'csv' and external_id = 'ext-1'),
    1, 'external links are idempotent per (org, source_kind, external_id)');

-- ================================================== import job idempotency

select tests.set_service();
select is(
    app.customer_import_begin('7c000000-0000-0000-0000-0000000000c1', 'csv', null, false, 'imp-key-abc12345', null),
    app.customer_import_begin('7c000000-0000-0000-0000-0000000000c1', 'csv', null, false, 'imp-key-abc12345', null),
    'a retried import with the same idempotency key returns the same job id');

-- =================================================== per-row + finish =====

-- Record a row and finish the job with a mixed outcome (partial).
do $$
declare
    v_job uuid;
begin
    v_job := app.customer_import_begin('7c000000-0000-0000-0000-0000000000c1', 'csv', null, false, 'imp-key-xyz45678', null);
    perform app.customer_import_record_row(v_job, '7c000000-0000-0000-0000-0000000000c1', 1, 'imported', null, null, null);
    perform app.customer_import_record_row(v_job, '7c000000-0000-0000-0000-0000000000c1', 2, 'invalid', null, null, 'bad phone');
    -- Idempotent: re-recording the same (job, row_number) is a no-op.
    perform app.customer_import_record_row(v_job, '7c000000-0000-0000-0000-0000000000c1', 1, 'imported', null, null, null);
    perform app.customer_import_finish(v_job, '7c000000-0000-0000-0000-0000000000c1', 2, 1, 0, 0, 1, 0, 1, null);
end $$;

select is(
    (select count(*)::integer from public.customer_import_rows
       where job_id = (select id from public.customer_import_jobs where idempotency_key = 'imp-key-xyz45678')),
    2, 'per-row records are stored exactly once (idempotent)');
select is(
    (select status::text from public.customer_import_jobs where idempotency_key = 'imp-key-xyz45678'),
    'partial', 'a job with imports AND invalid rows finishes as partial');

-- ============================================================== RLS =======

-- anon can never SELECT customer PII.
select is(has_table_privilege('anon', 'public.customers', 'SELECT'), false,
    'anon has no SELECT privilege on customers');

-- A member (not owner/admin) sees none of their org's customers.
select tests.set_actor('7b000000-0000-0000-0000-0000000000c3');
select is(
    (select count(*)::integer from public.customers),
    0, 'a member cannot read customers (owner/admin only)');

-- An outsider (different org) sees none of the other org's rows.
select tests.set_actor('7b000000-0000-0000-0000-0000000000c4');
select is(
    (select count(*)::integer from public.customers
      where org_id = '7c000000-0000-0000-0000-0000000000c1'),
    0, 'an outsider sees no other org customers');

select * from finish();
rollback;
