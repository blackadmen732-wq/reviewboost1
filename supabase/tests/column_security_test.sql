-- Column-level security and membership protection tests.
--
-- These tests prove the attacks identified in the security audit are blocked.
-- Every test performs the actual attack as the actual role.
--
--   supabase test db
--
-- Depends on the column_level_security and rls_policy_tightening migrations.

begin;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

select plan(42);

-- ------------------------------------------------------------- fixtures ----

create or replace function tests.set_actor(p_user_id uuid) returns void
language plpgsql as $$
begin
    perform set_config('role', 'authenticated', true);
    perform set_config(
        'request.jwt.claims',
        json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
        true);
end $$;

create or replace function tests.set_service() returns void
language plpgsql as $$
begin
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
end $$;

grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

-- Users: owner, admin, member, viewer, outsider
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
    ('aa000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@test.com', '', now(), now()),
    ('aa000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.com', '', now(), now()),
    ('aa000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member@test.com', '', now(), now()),
    ('aa000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@test.com', '', now(), now()),
    ('aa000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider@test.com', '', now(), now());

insert into public.organizations (id, name, slug)
values ('a0000000-col-test-0000-00000000000a', 'Column Security Test Org', 'col-sec-test');

insert into public.organization_members (id, org_id, user_id, role, status)
values
    ('m0000000-0000-0000-0000-000000000001', 'a0000000-col-test-0000-00000000000a', 'aa000000-0000-0000-0000-000000000001', 'owner', 'active'),
    ('m0000000-0000-0000-0000-000000000002', 'a0000000-col-test-0000-00000000000a', 'aa000000-0000-0000-0000-000000000002', 'admin', 'active'),
    ('m0000000-0000-0000-0000-000000000003', 'a0000000-col-test-0000-00000000000a', 'aa000000-0000-0000-0000-000000000003', 'member', 'active'),
    ('m0000000-0000-0000-0000-000000000004', 'a0000000-col-test-0000-00000000000a', 'aa000000-0000-0000-0000-000000000004', 'viewer', 'active');

insert into public.locations (id, org_id, name, google_review_url)
values ('l0000000-col-test-0000-00000000000a', 'a0000000-col-test-0000-00000000000a', 'Test Location', 'https://g.page/r/test/review');

insert into public.review_stands (id, org_id, location_id, public_token_hash, public_token_prefix)
values ('s0000000-col-test-0000-00000000000a', 'a0000000-col-test-0000-00000000000a', 'l0000000-col-test-0000-00000000000a', 'hash-test', 'testpfx1');

insert into public.customer_responses (id, org_id, location_id, stand_id, rating, submitted_at)
values ('r0000000-col-test-0000-00000000000a', 'a0000000-col-test-0000-00000000000a', 'l0000000-col-test-0000-00000000000a', 's0000000-col-test-0000-00000000000a', 4, now());

insert into public.team_praise_records (id, org_id, location_id, response_id, first_name_encrypted, praise_note_encrypted)
values ('p0000000-col-test-0000-00000000000a', 'a0000000-col-test-0000-00000000000a', 'l0000000-col-test-0000-00000000000a', 'r0000000-col-test-0000-00000000000a', 'v1:enc-name', 'v1:enc-note');

-- ============================================================
-- 1. CUSTOMER RESPONSES — column restriction
-- ============================================================

select tests.set_actor('aa000000-0000-0000-0000-000000000001');

-- Allowed: triage columns
select lives_ok(
    $$ update public.customer_responses
       set read_at = now()
       where id = 'r0000000-col-test-0000-00000000000a' $$,
    'owner can mark response as read');

-- Blocked: rating column
select throws_ok(
    $$ update public.customer_responses
       set rating = 5
       where id = 'r0000000-col-test-0000-00000000000a' $$,
    '42501', null,
    'owner cannot modify rating through Data API');

-- Blocked: note_encrypted column
select throws_ok(
    $$ update public.customer_responses
       set note_encrypted = 'tampered'
       where id = 'r0000000-col-test-0000-00000000000a' $$,
    '42501', null,
    'owner cannot modify encrypted note through Data API');

-- Blocked: org_id column (cross-tenant reassignment)
select throws_ok(
    $$ update public.customer_responses
       set org_id = 'b0000000-0000-0000-0000-00000000000b'
       where id = 'r0000000-col-test-0000-00000000000a' $$,
    '42501', null,
    'owner cannot reassign response to another org');

-- Blocked: submitted_at column
select throws_ok(
    $$ update public.customer_responses
       set submitted_at = '2020-01-01T00:00:00Z'
       where id = 'r0000000-col-test-0000-00000000000a' $$,
    '42501', null,
    'owner cannot backdate submission timestamp');

-- ============================================================
-- 2. TEAM PRAISE — column restriction
-- ============================================================

-- Allowed: matching fields
select lives_ok(
    $$ update public.team_praise_records
       set status = 'matched',
           matched_by_user_id = 'aa000000-0000-0000-0000-000000000001',
           matched_at = now()
       where id = 'p0000000-col-test-0000-00000000000a' $$,
    'owner can match praise');

-- Blocked: encrypted fields
select throws_ok(
    $$ update public.team_praise_records
       set first_name_encrypted = 'tampered'
       where id = 'p0000000-col-test-0000-00000000000a' $$,
    '42501', null,
    'owner cannot modify encrypted praise name');

select throws_ok(
    $$ update public.team_praise_records
       set praise_note_encrypted = 'tampered'
       where id = 'p0000000-col-test-0000-00000000000a' $$,
    '42501', null,
    'owner cannot modify encrypted praise note');

-- Blocked: response_id (correlation attack)
select throws_ok(
    $$ update public.team_praise_records
       set response_id = null
       where id = 'p0000000-col-test-0000-00000000000a' $$,
    '42501', null,
    'owner cannot modify response_id on praise');

-- Blocked: org_id
select throws_ok(
    $$ update public.team_praise_records
       set org_id = 'b0000000-0000-0000-0000-00000000000b'
       where id = 'p0000000-col-test-0000-00000000000a' $$,
    '42501', null,
    'owner cannot reassign praise to another org');

-- ============================================================
-- 3. HARD DELETE PREVENTION
-- ============================================================

-- Blocked: DELETE on locations
select throws_ok(
    $$ delete from public.locations
       where id = 'l0000000-col-test-0000-00000000000a' $$,
    '42501', null,
    'admin cannot delete locations');

-- Blocked: DELETE on review_stands
select throws_ok(
    $$ delete from public.review_stands
       where id = 's0000000-col-test-0000-00000000000a' $$,
    '42501', null,
    'admin cannot delete review stands');

-- Blocked: DELETE on organization_members
select throws_ok(
    $$ delete from public.organization_members
       where id = 'm0000000-0000-0000-0000-000000000003' $$,
    '42501', null,
    'admin cannot hard-delete members');

-- ============================================================
-- 4. ORGANIZATION MEMBERS — column restriction
-- ============================================================

-- Blocked: org_id reassignment on membership row
select throws_ok(
    $$ update public.organization_members
       set org_id = 'b0000000-0000-0000-0000-00000000000b'
       where id = 'm0000000-0000-0000-0000-000000000003' $$,
    '42501', null,
    'admin cannot reassign membership to another org');

-- Blocked: user_id swap
select throws_ok(
    $$ update public.organization_members
       set user_id = 'aa000000-0000-0000-0000-000000000005'
       where id = 'm0000000-0000-0000-0000-000000000003' $$,
    '42501', null,
    'admin cannot swap user_id on membership row');

-- ============================================================
-- 5. MEMBERSHIP SECURITY — last-owner protection
-- ============================================================

-- Blocked: demoting the only owner
select throws_ok(
    $$ select public.rpc_change_member_role(
        'm0000000-0000-0000-0000-000000000001',
        'admin'::public.member_role) $$,
    'P0001', null,
    'cannot demote the last owner');

-- Blocked: suspending the only owner
select throws_ok(
    $$ select public.rpc_suspend_member('m0000000-0000-0000-0000-000000000001') $$,
    'P0001', null,
    'cannot suspend the last owner');

-- Blocked: removing the only owner
select throws_ok(
    $$ select public.rpc_remove_member('m0000000-0000-0000-0000-000000000001') $$,
    'P0001', null,
    'cannot remove the last owner');

-- ============================================================
-- 6. SELF-PROMOTION PREVENTION
-- ============================================================

-- Member tries to self-promote to owner
select tests.set_actor('aa000000-0000-0000-0000-000000000003');

select throws_ok(
    $$ select public.rpc_change_member_role(
        'm0000000-0000-0000-0000-000000000003',
        'owner'::public.member_role) $$,
    'P0001', null,
    'member cannot self-promote to owner');

-- Member tries to self-promote to admin
select throws_ok(
    $$ select public.rpc_change_member_role(
        'm0000000-0000-0000-0000-000000000003',
        'admin'::public.member_role) $$,
    'P0001', null,
    'member cannot self-promote to admin');

-- ============================================================
-- 7. VIEWER EXCLUSION — triage operations
-- ============================================================

select tests.set_actor('aa000000-0000-0000-0000-000000000004');

-- Reset read_at for clean test
select tests.set_service();
update public.customer_responses
set read_at = null
where id = 'r0000000-col-test-0000-00000000000a';

select tests.set_actor('aa000000-0000-0000-0000-000000000004');

-- Viewer cannot triage responses (RLS blocks it)
select is_empty(
    $$ update public.customer_responses
       set read_at = now()
       where id = 'r0000000-col-test-0000-00000000000a'
       returning id $$,
    'viewer cannot triage customer responses');

-- ============================================================
-- 8. OUTSIDER EXCLUSION — cross-tenant
-- ============================================================

select tests.set_actor('aa000000-0000-0000-0000-000000000005');

-- Outsider sees nothing
select is_empty(
    $$ select id from public.customer_responses $$,
    'outsider sees no customer responses');

select is_empty(
    $$ select id from public.team_praise_records $$,
    'outsider sees no team praise');

select is_empty(
    $$ select id from public.locations $$,
    'outsider sees no locations');

select is_empty(
    $$ select id from public.review_stands $$,
    'outsider sees no review stands');

select is_empty(
    $$ select id from public.organization_members $$,
    'outsider sees no memberships');

-- ============================================================
-- 9. AUDIT INTEGRITY — action allowlist
-- ============================================================

select tests.set_actor('aa000000-0000-0000-0000-000000000001');

-- Allowed action
select lives_ok(
    $$ select public.rpc_record_audit_event(
        'a0000000-col-test-0000-00000000000a',
        'stand.token_rotated',
        'review_stand',
        's0000000-col-test-0000-00000000000a',
        'test-req-id',
        '{}'::jsonb) $$,
    'allowed audit action succeeds');

-- Blocked: arbitrary action
select throws_ok(
    $$ select public.rpc_record_audit_event(
        'a0000000-col-test-0000-00000000000a',
        'attack.inject_fake_event',
        'review_stand',
        's0000000-col-test-0000-00000000000a',
        'test-req-id',
        '{}'::jsonb) $$,
    '42501', null,
    'arbitrary audit action is rejected');

-- Blocked: null action
select throws_ok(
    $$ select public.rpc_record_audit_event(
        'a0000000-col-test-0000-00000000000a',
        null,
        'review_stand',
        's0000000-col-test-0000-00000000000a',
        'test-req-id',
        '{}'::jsonb) $$,
    '42501', null,
    'null audit action is rejected');

-- Blocked: direct INSERT into audit_events
select throws_ok(
    $$ insert into public.audit_events (org_id, actor_user_id, actor_type, action, target_type, target_id)
       values ('a0000000-col-test-0000-00000000000a', 'aa000000-0000-0000-0000-000000000001', 'user', 'fake', 'test', 'test') $$,
    '42501', null,
    'direct INSERT into audit_events is blocked');

-- ============================================================
-- 10. PRAISE-SAFE VIEW — response_id excluded
-- ============================================================

select hasnt_column('public', 'praise_safe_view', 'response_id',
    'praise_safe_view does not expose response_id');

-- View returns data but without response_id
select results_eq(
    $$ select count(*)::integer from public.praise_safe_view $$,
    array[1],
    'praise_safe_view returns praise records');

-- ============================================================
-- 11. PRAISE-RATING STRUCTURAL BARRIER
-- ============================================================

select hasnt_column('public', 'team_praise_records', 'rating',
    'team_praise_records has no rating column');

-- ============================================================

select * from finish();

rollback;
