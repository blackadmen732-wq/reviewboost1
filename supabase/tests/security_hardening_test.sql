-- Security hardening tests.
--
-- Proves the attacks closed by migration 20260813000100 stay closed.
-- Every test performs the actual attack as the actual role.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

select plan(68);

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
values
    ('a1000000-da0d-e570-0000-00000000000a', 'Hardening Test Org', 'hardening-test'),
    ('a1000000-da0d-e570-0000-00000000000b', 'Second Org', 'second-org');

insert into public.organization_members (id, org_id, user_id, role, status)
values
    ('c1000000-0000-0000-0000-000000000001', 'a1000000-da0d-e570-0000-00000000000a', 'bb000000-0000-0000-0000-000000000001', 'owner', 'active'),
    ('c1000000-0000-0000-0000-000000000002', 'a1000000-da0d-e570-0000-00000000000a', 'bb000000-0000-0000-0000-000000000002', 'admin', 'active'),
    ('c1000000-0000-0000-0000-000000000003', 'a1000000-da0d-e570-0000-00000000000a', 'bb000000-0000-0000-0000-000000000003', 'member', 'active'),
    ('c1000000-0000-0000-0000-000000000010', 'a1000000-da0d-e570-0000-00000000000b', 'bb000000-0000-0000-0000-000000000001', 'owner', 'active');

insert into public.locations (id, org_id, name, google_review_url)
values
    ('d1000000-0000-0000-0000-00000000000a', 'a1000000-da0d-e570-0000-00000000000a', 'Hardening Location', 'https://g.page/r/hardening/review'),
    ('d1000000-0000-0000-0000-00000000000b', 'a1000000-da0d-e570-0000-00000000000b', 'Second Location', 'https://g.page/r/second/review');

insert into public.review_stands (id, org_id, location_id, public_token_hash, public_token_prefix)
values ('e1000000-0000-0000-0000-00000000000a', 'a1000000-da0d-e570-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a', 'hash-hard-test', 'hardpfx1');

-- Staff members for FK tests
insert into public.staff_members (id, org_id, name_encrypted)
values
    ('f3000000-0000-0000-0000-00000000000a', 'a1000000-da0d-e570-0000-00000000000a', 'v1:enc-hard-staff'),
    ('f3000000-0000-0000-0000-00000000000b', 'a1000000-da0d-e570-0000-00000000000b', 'v1:enc-second-staff');

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
-- 3. STAFF MEMBERS — direct UPDATE fully revoked, RPC works
-- ============================================================

select throws_ok(
    $$ update public.staff_members
       set name_encrypted = 'v1:updated-name'
       where id = 'f3000000-0000-0000-0000-00000000000a' $$,
    '42501', null,
    'direct UPDATE on staff_members is denied');

select lives_ok(
    $$ select public.rpc_update_staff(
        'f3000000-0000-0000-0000-00000000000a',
        'v1:updated-name', null, null, false) $$,
    'owner can update staff via RPC');

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
        'test-rotation',
        'v1:enc-rotated-token',
        1::smallint) $$,
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
        'outsider-rotation',
        'v1:enc-outsider-token',
        1::smallint) $$,
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
        'member-rotation',
        'v1:enc-member-token',
        1::smallint) $$,
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
-- 19. MULTI-ORG — owner updates only the requested org
-- ============================================================

-- bb..001 owns both orgs. Update second org, verify first is untouched.
select tests.set_actor('bb000000-0000-0000-0000-000000000001');

select lives_ok(
    $$ select public.rpc_update_organization(
        'a1000000-da0d-e570-0000-00000000000b',
        'Renamed Second Org',
        null) $$,
    'multi-org owner updates only the targeted org');

select results_eq(
    $$ select name from public.organizations
       where id = 'a1000000-da0d-e570-0000-00000000000a' $$,
    array['Hardening Test Org'],
    'first org name is untouched after updating second org');

-- ============================================================
-- 20. CROSS-TENANT — outsider cannot update org
-- ============================================================

select tests.set_actor('bb000000-0000-0000-0000-000000000004');

select throws_ok(
    $$ select public.rpc_update_organization(
        'a1000000-da0d-e570-0000-00000000000a',
        'Hacked Org', null) $$,
    'P0001', null,
    'outsider cannot update another org');

-- ============================================================
-- 21. CROSS-TENANT — outsider cannot update location
-- ============================================================

select throws_ok(
    $$ select public.rpc_update_location(
        'd1000000-0000-0000-0000-00000000000a',
        'Hacked Location', null, false) $$,
    'P0001', null,
    'outsider cannot update another org location');

-- ============================================================
-- 22. CROSS-TENANT — outsider cannot update staff
-- ============================================================

select throws_ok(
    $$ select public.rpc_update_staff(
        'f3000000-0000-0000-0000-00000000000a',
        'v1:hacked-staff', null, null, false) $$,
    'P0001', null,
    'outsider cannot update another org staff');

-- ============================================================
-- 23. MEMBER — cannot update org settings
-- ============================================================

select tests.set_actor('bb000000-0000-0000-0000-000000000003');

select throws_ok(
    $$ select public.rpc_update_organization(
        'a1000000-da0d-e570-0000-00000000000a',
        'Member Rename', null) $$,
    'P0001', null,
    'member cannot update org settings');

-- ============================================================
-- 24b. MEMBER — cannot update staff
-- ============================================================

select throws_ok(
    $$ select public.rpc_update_staff(
        'f3000000-0000-0000-0000-00000000000a',
        'v1:member-edit', null, null, false) $$,
    'P0001', null,
    'member cannot update staff');

-- ============================================================
-- 25. OWNER — can update org settings
-- ============================================================

select tests.set_actor('bb000000-0000-0000-0000-000000000001');

select lives_ok(
    $$ select public.rpc_update_organization(
        'a1000000-da0d-e570-0000-00000000000a',
        'Owner Renamed Org', null) $$,
    'owner can update org settings');

-- ============================================================
-- 26. ADMIN — can update staff
-- ============================================================

select tests.set_actor('bb000000-0000-0000-0000-000000000002');

select lives_ok(
    $$ select public.rpc_update_staff(
        'f3000000-0000-0000-0000-00000000000a',
        'v1:admin-updated', null, null, false) $$,
    'admin can update staff');

-- ============================================================
-- 27. OWNER — can update location
-- ============================================================

select tests.set_actor('bb000000-0000-0000-0000-000000000001');

select lives_ok(
    $$ select public.rpc_update_location(
        'd1000000-0000-0000-0000-00000000000a',
        'Owner Renamed Location', null, false) $$,
    'owner can update location');

-- ============================================================
-- 28. VALIDATION — invalid timezone rejected
-- ============================================================

select throws_ok(
    $$ select public.rpc_update_organization(
        'a1000000-da0d-e570-0000-00000000000a',
        null, 'Not/A/Timezone') $$,
    'P0001', null,
    'invalid timezone is rejected at DB layer');

-- ============================================================
-- 29. VALIDATION — empty org name rejected
-- ============================================================

select throws_ok(
    $$ select public.rpc_update_organization(
        'a1000000-da0d-e570-0000-00000000000a',
        '', null) $$,
    'P0001', null,
    'empty org name is rejected at DB layer');

-- ============================================================
-- 30. VALIDATION — oversized org name rejected
-- ============================================================

select throws_ok(
    $$ select public.rpc_update_organization(
        'a1000000-da0d-e570-0000-00000000000a',
        repeat('x', 161), null) $$,
    'P0001', null,
    'oversized org name is rejected at DB layer');

-- ============================================================
-- 31. VALIDATION — invalid Google URL rejected
-- ============================================================

select throws_ok(
    $$ select public.rpc_update_location(
        'd1000000-0000-0000-0000-00000000000a',
        null, 'https://evil.example.com/phishing', false) $$,
    'P0001', null,
    'invalid Google review URL is rejected at DB layer');

-- ============================================================
-- 32. VALIDATION — http:// Google URL rejected
-- ============================================================

select throws_ok(
    $$ select public.rpc_update_location(
        'd1000000-0000-0000-0000-00000000000a',
        null, 'http://g.page/r/test/review', false) $$,
    'P0001', null,
    'non-https Google review URL is rejected');

-- ============================================================
-- 33. IDEMPOTENT — repeated org update creates no duplicate audit
-- ============================================================

-- First, set org to a known state
select tests.set_service();
update public.organizations set name = 'Idempotent Test', timezone = 'UTC'
where id = 'a1000000-da0d-e570-0000-00000000000a';
delete from public.audit_events
where org_id = 'a1000000-da0d-e570-0000-00000000000a'
  and action = 'organization.updated';
select tests.set_actor('bb000000-0000-0000-0000-000000000001');

-- First call: changes name, should create audit event
select lives_ok(
    $$ select public.rpc_update_organization(
        'a1000000-da0d-e570-0000-00000000000a',
        'Changed Name', null) $$,
    'org update with real change succeeds');

-- Second call: same values, should NOT create another audit event
select lives_ok(
    $$ select public.rpc_update_organization(
        'a1000000-da0d-e570-0000-00000000000a',
        'Changed Name', null) $$,
    'repeated identical org update succeeds silently');

select results_eq(
    $$ select count(*)::integer from public.audit_events
       where org_id = 'a1000000-da0d-e570-0000-00000000000a'
         and action = 'organization.updated' $$,
    array[1],
    'repeated identical org update created exactly one audit event');

-- ============================================================
-- 34. IDEMPOTENT — repeated staff update creates no duplicate audit
-- ============================================================

select tests.set_service();
delete from public.audit_events
where org_id = 'a1000000-da0d-e570-0000-00000000000a'
  and action = 'staff.updated'
  and target_id = 'f3000000-0000-0000-0000-00000000000a';
select tests.set_actor('bb000000-0000-0000-0000-000000000001');

select lives_ok(
    $$ select public.rpc_update_staff(
        'f3000000-0000-0000-0000-00000000000a',
        'v1:idempotent-name', null, true, false) $$,
    'staff update with real change succeeds');

select lives_ok(
    $$ select public.rpc_update_staff(
        'f3000000-0000-0000-0000-00000000000a',
        'v1:idempotent-name', null, true, false) $$,
    'repeated identical staff update succeeds silently');

select results_eq(
    $$ select count(*)::integer from public.audit_events
       where org_id = 'a1000000-da0d-e570-0000-00000000000a'
         and action = 'staff.updated'
         and target_id = 'f3000000-0000-0000-0000-00000000000a' $$,
    array[1],
    'repeated identical staff update created exactly one audit event');

-- ============================================================
-- 35. DIRECT TABLE UPDATE — organizations still denied
-- ============================================================

select throws_ok(
    $$ update public.organizations
       set name = 'Direct Attack'
       where id = 'a1000000-da0d-e570-0000-00000000000a' $$,
    '42501', null,
    'direct UPDATE on organizations is denied');

-- ============================================================
-- 36. DIRECT TABLE UPDATE — locations still denied
-- ============================================================

select throws_ok(
    $$ update public.locations
       set name = 'Direct Attack'
       where id = 'd1000000-0000-0000-0000-00000000000a' $$,
    '42501', null,
    'direct UPDATE on locations is denied');

-- ============================================================
-- 37. GOOGLE URL VALIDATOR — valid g.page short link
-- ============================================================

select tests.set_service();

select ok(
    public._validate_google_review_url('https://g.page/r/myplace/review'),
    'g.page short link is valid');

-- ============================================================
-- 38. GOOGLE URL VALIDATOR — valid maps.app.goo.gl
-- ============================================================

select ok(
    public._validate_google_review_url('https://maps.app.goo.gl/abc123'),
    'maps.app.goo.gl short link is valid');

-- ============================================================
-- 39. GOOGLE URL VALIDATOR — valid search.google.com writereview
-- ============================================================

select ok(
    public._validate_google_review_url('https://search.google.com/local/writereview?placeid=ChIJ12345'),
    'search.google.com writereview is valid');

-- ============================================================
-- 40. GOOGLE URL VALIDATOR — valid www.google.com/maps/
-- ============================================================

select ok(
    public._validate_google_review_url('https://www.google.com/maps/place/My+Cafe'),
    'www.google.com/maps/ is valid');

-- ============================================================
-- 41. GOOGLE URL VALIDATOR — valid maps.google.com/maps/
-- ============================================================

select ok(
    public._validate_google_review_url('https://maps.google.com/maps/place/My+Cafe'),
    'maps.google.com/maps/ is valid');

-- ============================================================
-- 42. GOOGLE URL VALIDATOR — host-only URL (no trailing slash)
-- ============================================================

select ok(
    public._validate_google_review_url('https://g.page'),
    'host-only g.page URL (no slash) is valid');

-- ============================================================
-- 43. GOOGLE URL VALIDATOR — credentials rejected
-- ============================================================

select ok(
    not public._validate_google_review_url('https://user:pass@g.page/r/test/review'),
    'credentials in URL authority rejected');

-- ============================================================
-- 44. GOOGLE URL VALIDATOR — port with valid host
-- ============================================================

select ok(
    not public._validate_google_review_url('https://g.page:8443/r/test/review'),
    'port in URL authority rejected (not standard Google)');

-- ============================================================
-- 45. GOOGLE URL VALIDATOR — HTTP rejected
-- ============================================================

select ok(
    not public._validate_google_review_url('http://g.page/r/test/review'),
    'http scheme rejected');

-- ============================================================
-- 46. GOOGLE URL VALIDATOR — malicious host
-- ============================================================

select ok(
    not public._validate_google_review_url('https://evil.example.com/maps/place/fake'),
    'malicious host rejected');

-- ============================================================
-- 47b. GOOGLE URL VALIDATOR — query string on short link
-- ============================================================

select ok(
    public._validate_google_review_url('https://g.page/r/test/review?utm_source=qr'),
    'query string on short link still valid');

-- ============================================================
-- 48. GOOGLE URL VALIDATOR — oversized URL
-- ============================================================

select ok(
    not public._validate_google_review_url('https://g.page/r/' || repeat('x', 2040)),
    'oversized URL rejected');

-- ============================================================
-- 49. GOOGLE URL VALIDATOR — NULL input
-- ============================================================

select ok(
    not public._validate_google_review_url(null),
    'NULL input returns false');

-- ============================================================
-- 50. GOOGLE URL VALIDATOR — empty string
-- ============================================================

select ok(
    not public._validate_google_review_url(''),
    'empty string returns false');

-- ============================================================
-- 51. APP SCHEMA — no USAGE for public/anon/authenticated
-- ============================================================

select tests.set_actor('bb000000-0000-0000-0000-000000000001');

select results_eq(
    $$ select count(*)::integer
       from information_schema.role_usage_grants
       where object_schema = 'app'
         and grantee in ('anon', 'authenticated', 'public') $$,
    array[0],
    'app schema has no USAGE for public, anon, or authenticated');

-- ============================================================
-- 52. APP SCHEMA — no EXECUTE for public/anon/authenticated
-- ============================================================

select results_eq(
    $$ select count(*)::integer
       from information_schema.role_routine_grants
       where specific_schema = 'app'
         and grantee in ('anon', 'authenticated', 'public') $$,
    array[0],
    'app schema functions have no EXECUTE for public, anon, or authenticated');

-- ============================================================
-- 53. REVIEW STANDS — direct UPDATE denied
-- ============================================================

select throws_ok(
    $$ update public.review_stands
       set label = 'Tampered Label'
       where id = 'e1000000-0000-0000-0000-00000000000a' $$,
    '42501', null,
    'direct UPDATE on review_stands label is denied');

select throws_ok(
    $$ update public.review_stands
       set status = 'inactive'
       where id = 'e1000000-0000-0000-0000-00000000000a' $$,
    '42501', null,
    'direct UPDATE on review_stands status is denied');

-- ============================================================
-- 54. REVIEW STANDS — rpc_update_stand works for owner
-- ============================================================

select lives_ok(
    $$ select public.rpc_update_stand(
        'e1000000-0000-0000-0000-00000000000a',
        'Updated Label', null) $$,
    'owner can update stand via RPC');

-- ============================================================
-- 55. REVIEW STANDS — rpc_update_stand blocked for outsider
-- ============================================================

select tests.set_actor('bb000000-0000-0000-0000-000000000004');

select throws_ok(
    $$ select public.rpc_update_stand(
        'e1000000-0000-0000-0000-00000000000a',
        'Outsider Label', null) $$,
    'P0001', null,
    'outsider cannot update stand via RPC');

-- ============================================================
-- 56. REVIEW STANDS — rpc_update_stand blocked for member
-- ============================================================

select tests.set_actor('bb000000-0000-0000-0000-000000000003');

select throws_ok(
    $$ select public.rpc_update_stand(
        'e1000000-0000-0000-0000-00000000000a',
        'Member Label', null) $$,
    'P0001', null,
    'member cannot update stand via RPC');

select tests.set_actor('bb000000-0000-0000-0000-000000000001');

-- ============================================================

select * from finish();

rollback;
