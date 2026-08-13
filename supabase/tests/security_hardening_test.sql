-- Security hardening tests.
--
-- Proves the attacks closed by migration 20260813000100 stay closed.
-- Every test performs the actual attack as the actual role.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

select plan(24);

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

-- Users: owner, admin, member, outsider
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
    ('bb000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'h-owner@test.com', '', now(), now()),
    ('bb000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'h-admin@test.com', '', now(), now()),
    ('bb000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'h-member@test.com', '', now(), now()),
    ('bb000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'h-outsider@test.com', '', now(), now());

insert into public.organizations (id, name, slug)
values ('a1000000-da0d-e570-0000-00000000000a', 'Hardening Test Org', 'hardening-test');

insert into public.organization_members (id, org_id, user_id, role, status)
values
    ('c1000000-0000-0000-0000-000000000001', 'a1000000-da0d-e570-0000-00000000000a', 'bb000000-0000-0000-0000-000000000001', 'owner', 'active'),
    ('c1000000-0000-0000-0000-000000000002', 'a1000000-da0d-e570-0000-00000000000a', 'bb000000-0000-0000-0000-000000000002', 'admin', 'active'),
    ('c1000000-0000-0000-0000-000000000003', 'a1000000-da0d-e570-0000-00000000000a', 'bb000000-0000-0000-0000-000000000003', 'member', 'active');

insert into public.locations (id, org_id, name, google_review_url)
values ('d1000000-0000-0000-0000-00000000000a', 'a1000000-da0d-e570-0000-00000000000a', 'Hardening Location', 'https://g.page/r/hardening/review');

insert into public.review_stands (id, org_id, location_id, public_token_hash, public_token_prefix)
values ('e1000000-0000-0000-0000-00000000000a', 'a1000000-da0d-e570-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a', 'hash-hard-test', 'hardpfx1');

-- Staff member for FK tests
insert into public.staff_members (id, org_id, name_encrypted)
values ('f3000000-0000-0000-0000-00000000000a', 'a1000000-da0d-e570-0000-00000000000a', 'v1:enc-hard-staff');

insert into public.public_review_sessions (id, org_id, location_id, stand_id, session_token_hash, locale, expires_at)
values ('e2000000-0000-0000-0000-00000000000a', 'a1000000-da0d-e570-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'hard-session-hash', 'en', now() + interval '1 hour');

insert into public.customer_responses (id, org_id, location_id, stand_id, session_id, response_token_hash, rating, submitted_at)
values ('f4000000-0000-0000-0000-00000000000a', 'a1000000-da0d-e570-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'e2000000-0000-0000-0000-00000000000a', 'hard-response-hash', 3, now());

insert into public.team_praise_records (id, org_id, location_id, response_id, first_name_encrypted, praise_note_encrypted)
values ('f5000000-0000-0000-0000-00000000000a', 'a1000000-da0d-e570-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a', 'f4000000-0000-0000-0000-00000000000a', 'v1:enc-hard-name', 'v1:enc-hard-note');

-- ============================================================
-- 1. STAFF MEMBERS — direct INSERT blocked
-- ============================================================

select tests.set_actor('bb000000-0000-0000-0000-000000000001');

select throws_ok(
    $$ insert into public.staff_members (org_id, name_encrypted)
       values ('a1000000-da0d-e570-0000-00000000000a', 'v1:direct-insert') $$,
    '42501', null,
    'direct INSERT on staff_members is blocked');

-- ============================================================
-- 2. STAFF MEMBERS — key_version not updatable
-- ============================================================

select throws_ok(
    $$ update public.staff_members
       set key_version = 99
       where id = 'f3000000-0000-0000-0000-00000000000a' $$,
    '42501', null,
    'key_version column cannot be updated directly');

-- ============================================================
-- 3. STAFF MEMBERS — allowed columns still work
-- ============================================================

select lives_ok(
    $$ update public.staff_members
       set name_encrypted = 'v1:updated-name'
       where id = 'f3000000-0000-0000-0000-00000000000a' $$,
    'owner can update staff name_encrypted');

select lives_ok(
    $$ update public.staff_members
       set is_active = false
       where id = 'f3000000-0000-0000-0000-00000000000a' $$,
    'owner can deactivate staff');

-- Re-activate for later tests
select tests.set_service();
update public.staff_members set is_active = true where id = 'f3000000-0000-0000-0000-00000000000a';
select tests.set_actor('bb000000-0000-0000-0000-000000000001');

-- ============================================================
-- 4. STAFF RPC — creates staff successfully
-- ============================================================

select lives_ok(
    $$ select public.rpc_create_staff(
        'a1000000-da0d-e570-0000-00000000000a',
        'v1:rpc-created-staff',
        'Barista') $$,
    'rpc_create_staff succeeds for org member');

-- ============================================================
-- 5. STAFF RPC — outsider cannot create staff
-- ============================================================

select tests.set_actor('bb000000-0000-0000-0000-000000000004');

select throws_ok(
    $$ select public.rpc_create_staff(
        'a1000000-da0d-e570-0000-00000000000a',
        'v1:outsider-staff',
        null) $$,
    'P0001', null,
    'outsider cannot create staff in another org');

select tests.set_actor('bb000000-0000-0000-0000-000000000001');

-- ============================================================
-- 6. AUDIT RPC — authenticated cannot call rpc_record_audit_event
-- ============================================================

select throws_ok(
    $$ select public.rpc_record_audit_event(
        'a1000000-da0d-e570-0000-00000000000a',
        'stand.token_rotated',
        'review_stand',
        'e1000000-0000-0000-0000-00000000000a',
        'test-req',
        '{}'::jsonb) $$,
    '42501', null,
    'authenticated cannot call rpc_record_audit_event');

-- ============================================================
-- 7. STAND TOKEN — direct update on token columns blocked
-- ============================================================

select throws_ok(
    $$ update public.review_stands
       set public_token_hash = 'tampered-hash'
       where id = 'e1000000-0000-0000-0000-00000000000a' $$,
    '42501', null,
    'direct update on public_token_hash is blocked');

select throws_ok(
    $$ update public.review_stands
       set public_token_prefix = 'tampered'
       where id = 'e1000000-0000-0000-0000-00000000000a' $$,
    '42501', null,
    'direct update on public_token_prefix is blocked');

-- ============================================================
-- 8. STAND TOKEN ROTATION RPC — works for owner
-- ============================================================

select lives_ok(
    $$ select public.rpc_rotate_stand_token(
        'e1000000-0000-0000-0000-00000000000a',
        'a1000000-da0d-e570-0000-00000000000a',
        'new-hash-from-rpc',
        'newpfx',
        1::smallint,
        'test-rotation') $$,
    'rpc_rotate_stand_token succeeds for owner');

-- Verify audit event was created
select results_eq(
    $$ select count(*)::integer from public.audit_events
       where org_id = 'a1000000-da0d-e570-0000-00000000000a'
         and action = 'stand.token_rotated'
         and target_id = 'e1000000-0000-0000-0000-00000000000a' $$,
    array[1],
    'token rotation created audit event');

-- ============================================================
-- 9. STAND TOKEN ROTATION RPC — blocked for outsider
-- ============================================================

select tests.set_actor('bb000000-0000-0000-0000-000000000004');

select throws_ok(
    $$ select public.rpc_rotate_stand_token(
        'e1000000-0000-0000-0000-00000000000a',
        'a1000000-da0d-e570-0000-00000000000a',
        'outsider-hash',
        'outpfx',
        1::smallint,
        'outsider-rotation') $$,
    'P0001', null,
    'outsider cannot rotate stand token');

select tests.set_actor('bb000000-0000-0000-0000-000000000001');

-- ============================================================
-- 10. STAND TOKEN ROTATION RPC — blocked for member (non-admin)
-- ============================================================

select tests.set_actor('bb000000-0000-0000-0000-000000000003');

select throws_ok(
    $$ select public.rpc_rotate_stand_token(
        'e1000000-0000-0000-0000-00000000000a',
        'a1000000-da0d-e570-0000-00000000000a',
        'member-hash',
        'mempfx',
        1::smallint,
        'member-rotation') $$,
    'P0001', null,
    'member cannot rotate stand token');

select tests.set_actor('bb000000-0000-0000-0000-000000000001');

-- ============================================================
-- 11. RESPONSE NOTE RPC — works for org member
-- ============================================================

select lives_ok(
    $$ select * from public.rpc_add_response_note(
        'f4000000-0000-0000-0000-00000000000a',
        'a1000000-da0d-e570-0000-00000000000a',
        'v1:encrypted-note-body') $$,
    'rpc_add_response_note succeeds for org member');

-- ============================================================
-- 12. RESPONSE NOTE RPC — blocked for outsider
-- ============================================================

select tests.set_actor('bb000000-0000-0000-0000-000000000004');

select throws_ok(
    $$ select * from public.rpc_add_response_note(
        'f4000000-0000-0000-0000-00000000000a',
        'a1000000-da0d-e570-0000-00000000000a',
        'v1:outsider-note') $$,
    'P0001', null,
    'outsider cannot add response note');

select tests.set_actor('bb000000-0000-0000-0000-000000000001');

-- ============================================================
-- 13. PRAISE — response_id not in praise_safe_view
-- ============================================================

select hasnt_column('public', 'praise_safe_view', 'response_id',
    'praise_safe_view still excludes response_id');

-- ============================================================
-- 14. PRAISE — direct encrypted field update blocked
-- ============================================================

select throws_ok(
    $$ update public.team_praise_records
       set first_name_encrypted = 'tampered'
       where id = 'f5000000-0000-0000-0000-00000000000a' $$,
    '42501', null,
    'cannot directly update first_name_encrypted on praise');

select throws_ok(
    $$ update public.team_praise_records
       set praise_note_encrypted = 'tampered'
       where id = 'f5000000-0000-0000-0000-00000000000a' $$,
    '42501', null,
    'cannot directly update praise_note_encrypted');

-- ============================================================
-- 15. PRAISE — all direct UPDATE now blocked (RPCs only)
-- ============================================================

select throws_ok(
    $$ update public.team_praise_records
       set status = 'archived'
       where id = 'f5000000-0000-0000-0000-00000000000a' $$,
    '42501', null,
    'direct UPDATE on praise status is blocked (use RPCs)');

-- ============================================================
-- 16. PRAISE MATCH/UNMATCH RPCs — work correctly
-- ============================================================

select lives_ok(
    $$ select public.rpc_match_praise(
        'f5000000-0000-0000-0000-00000000000a',
        'f3000000-0000-0000-0000-00000000000a') $$,
    'rpc_match_praise succeeds');

select lives_ok(
    $$ select public.rpc_unmatch_praise(
        'f5000000-0000-0000-0000-00000000000a') $$,
    'rpc_unmatch_praise succeeds');

-- ============================================================
-- 17. STAFF FK — ON DELETE RESTRICT prevents deletion
-- ============================================================

-- Match praise to staff first
select tests.set_service();
update public.team_praise_records
set matched_staff_id = 'f3000000-0000-0000-0000-00000000000a',
    matched_at = now(),
    matched_by_user_id = 'bb000000-0000-0000-0000-000000000001',
    status = 'matched'
where id = 'f5000000-0000-0000-0000-00000000000a';

select throws_ok(
    $$ delete from public.staff_members
       where id = 'f3000000-0000-0000-0000-00000000000a' $$,
    '23503', null,
    'cannot delete staff member with matched praise (ON DELETE RESTRICT)');

-- Clean up match
update public.team_praise_records
set matched_staff_id = null, matched_at = null, matched_by_user_id = null, status = 'unmatched'
where id = 'f5000000-0000-0000-0000-00000000000a';

select tests.set_actor('bb000000-0000-0000-0000-000000000001');

-- ============================================================
-- 18. ORG MEMBERS — column restriction still holds
-- ============================================================

select throws_ok(
    $$ update public.organization_members
       set org_id = 'a1000000-da0d-e570-0000-00000000000b'
       where id = 'c1000000-0000-0000-0000-000000000003' $$,
    '42501', null,
    'cannot reassign membership org_id');

select throws_ok(
    $$ update public.organization_members
       set user_id = 'bb000000-0000-0000-0000-000000000004'
       where id = 'c1000000-0000-0000-0000-000000000003' $$,
    '42501', null,
    'cannot swap membership user_id');

-- ============================================================

select * from finish();

rollback;
