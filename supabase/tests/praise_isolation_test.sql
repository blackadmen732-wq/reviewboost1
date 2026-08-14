-- Praise view isolation and state machine tests.
--
-- Proves:
--   1. praise_safe_view isolates between two orgs (security_invoker=true)
--   2. praise_safe_view excludes response_id
--   3. Archive/restore RPCs work and enforce state transitions
--   4. Idempotent praise RPCs do not duplicate audit events
--   5. FOR UPDATE locking paths execute without error
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

select plan(22);

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

-- Org A users
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
    ('cc000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'iso-ownerA@test.com', '', now(), now()),
    ('cc000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'iso-ownerB@test.com', '', now(), now()),
    ('cc000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'iso-outsider@test.com', '', now(), now());

-- Org A
insert into public.organizations (id, name, slug) values
    ('ca000000-0000-0000-0000-00000000000a', 'Isolation Org A', 'iso-org-a');
insert into public.organization_members (id, org_id, user_id, role, status) values
    ('cb000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-00000000000a', 'cc000000-0000-0000-0000-000000000001', 'owner', 'active');
insert into public.locations (id, org_id, name, google_review_url) values
    ('cd000000-0000-0000-0000-00000000000a', 'ca000000-0000-0000-0000-00000000000a', 'Loc A', 'https://g.page/r/a/review');
insert into public.review_stands (id, org_id, location_id, public_token_hash, public_token_prefix) values
    ('ce000000-0000-0000-0000-00000000000a', 'ca000000-0000-0000-0000-00000000000a', 'cd000000-0000-0000-0000-00000000000a', 'hash-iso-a', 'isoapfx1');
insert into public.public_review_sessions (id, org_id, location_id, stand_id, session_token_hash, locale, expires_at) values
    ('cf000000-0000-0000-0000-00000000000a', 'ca000000-0000-0000-0000-00000000000a', 'cd000000-0000-0000-0000-00000000000a', 'ce000000-0000-0000-0000-00000000000a', 'iso-sess-a', 'en', now() + interval '1 hour');
insert into public.customer_responses (id, org_id, location_id, stand_id, session_id, response_token_hash, rating, submitted_at) values
    ('cf100000-0000-0000-0000-00000000000a', 'ca000000-0000-0000-0000-00000000000a', 'cd000000-0000-0000-0000-00000000000a', 'ce000000-0000-0000-0000-00000000000a', 'cf000000-0000-0000-0000-00000000000a', 'iso-resp-a', 4, now());
insert into public.staff_members (id, org_id, name_encrypted) values
    ('cf200000-0000-0000-0000-00000000000a', 'ca000000-0000-0000-0000-00000000000a', 'v1:enc-staff-iso-a');
insert into public.team_praise_records (id, org_id, location_id, response_id, first_name_encrypted, praise_note_encrypted) values
    ('cf300000-0000-0000-0000-00000000000a', 'ca000000-0000-0000-0000-00000000000a', 'cd000000-0000-0000-0000-00000000000a', 'cf100000-0000-0000-0000-00000000000a', 'v1:enc-name-a', 'v1:enc-note-a');

-- Org B
insert into public.organizations (id, name, slug) values
    ('ca000000-0000-0000-0000-00000000000b', 'Isolation Org B', 'iso-org-b');
insert into public.organization_members (id, org_id, user_id, role, status) values
    ('cb000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-00000000000b', 'cc000000-0000-0000-0000-000000000002', 'owner', 'active');
insert into public.locations (id, org_id, name, google_review_url) values
    ('cd000000-0000-0000-0000-00000000000b', 'ca000000-0000-0000-0000-00000000000b', 'Loc B', 'https://g.page/r/b/review');
insert into public.review_stands (id, org_id, location_id, public_token_hash, public_token_prefix) values
    ('ce000000-0000-0000-0000-00000000000b', 'ca000000-0000-0000-0000-00000000000b', 'cd000000-0000-0000-0000-00000000000b', 'hash-iso-b', 'isobpfx1');
insert into public.public_review_sessions (id, org_id, location_id, stand_id, session_token_hash, locale, expires_at) values
    ('cf000000-0000-0000-0000-00000000000b', 'ca000000-0000-0000-0000-00000000000b', 'cd000000-0000-0000-0000-00000000000b', 'ce000000-0000-0000-0000-00000000000b', 'iso-sess-b', 'en', now() + interval '1 hour');
insert into public.customer_responses (id, org_id, location_id, stand_id, session_id, response_token_hash, rating, submitted_at) values
    ('cf100000-0000-0000-0000-00000000000b', 'ca000000-0000-0000-0000-00000000000b', 'cd000000-0000-0000-0000-00000000000b', 'ce000000-0000-0000-0000-00000000000b', 'cf000000-0000-0000-0000-00000000000b', 'iso-resp-b', 2, now());
insert into public.team_praise_records (id, org_id, location_id, response_id, first_name_encrypted, praise_note_encrypted) values
    ('cf300000-0000-0000-0000-00000000000b', 'ca000000-0000-0000-0000-00000000000b', 'cd000000-0000-0000-0000-00000000000b', 'cf100000-0000-0000-0000-00000000000b', 'v1:enc-name-b', 'v1:enc-note-b');

-- ============================================================
-- 1. PRAISE VIEW ISOLATION — Org A sees only Org A
-- ============================================================

select tests.set_actor('cc000000-0000-0000-0000-000000000001');

select results_eq(
    $$ select count(*)::integer from public.praise_safe_view $$,
    array[1],
    'Org A owner sees exactly 1 praise record');

select results_eq(
    $$ select id from public.praise_safe_view $$,
    $$ values ('cf300000-0000-0000-0000-00000000000a'::uuid) $$,
    'Org A owner sees only their own praise');

-- ============================================================
-- 2. PRAISE VIEW ISOLATION — Org B sees only Org B
-- ============================================================

select tests.set_actor('cc000000-0000-0000-0000-000000000002');

select results_eq(
    $$ select count(*)::integer from public.praise_safe_view $$,
    array[1],
    'Org B owner sees exactly 1 praise record');

select results_eq(
    $$ select id from public.praise_safe_view $$,
    $$ values ('cf300000-0000-0000-0000-00000000000b'::uuid) $$,
    'Org B owner sees only their own praise');

-- ============================================================
-- 3. PRAISE VIEW ISOLATION — outsider sees nothing
-- ============================================================

select tests.set_actor('cc000000-0000-0000-0000-000000000003');

select is_empty(
    $$ select id from public.praise_safe_view $$,
    'outsider sees no praise via view');

-- ============================================================
-- 4. PRAISE VIEW — response_id excluded
-- ============================================================

select hasnt_column('public', 'praise_safe_view', 'response_id',
    'praise_safe_view excludes response_id');

-- ============================================================
-- 5. rpc_response_has_praise — dropped
-- ============================================================

select tests.set_actor('cc000000-0000-0000-0000-000000000001');

select throws_ok(
    $$ select public.rpc_response_has_praise(
        'ca000000-0000-0000-0000-00000000000a',
        array['cf100000-0000-0000-0000-00000000000a']::uuid[]) $$,
    '42883', null,
    'rpc_response_has_praise no longer exists');

-- ============================================================
-- 6. ARCHIVE PRAISE — works
-- ============================================================

select lives_ok(
    $$ select public.rpc_archive_praise('cf300000-0000-0000-0000-00000000000a') $$,
    'rpc_archive_praise succeeds');

select results_eq(
    $$ select status::text from public.praise_safe_view
       where id = 'cf300000-0000-0000-0000-00000000000a' $$,
    array['archived'],
    'praise is now archived');

-- ============================================================
-- 7. ARCHIVE PRAISE — idempotent (no duplicate audit)
-- ============================================================

select lives_ok(
    $$ select public.rpc_archive_praise('cf300000-0000-0000-0000-00000000000a') $$,
    'rpc_archive_praise is idempotent');

select tests.set_service();
select results_eq(
    $$ select count(*)::integer from public.audit_events
       where action = 'praise.archived'
         and target_id = 'cf300000-0000-0000-0000-00000000000a' $$,
    array[1],
    'only one audit event for archive (idempotent)');
select tests.set_actor('cc000000-0000-0000-0000-000000000001');

-- ============================================================
-- 8. MATCH on archived praise — blocked
-- ============================================================

select throws_ok(
    $$ select public.rpc_match_praise(
        'cf300000-0000-0000-0000-00000000000a',
        'cf200000-0000-0000-0000-00000000000a') $$,
    'P0001', null,
    'cannot match archived praise');

-- ============================================================
-- 9. RESTORE PRAISE — works
-- ============================================================

select lives_ok(
    $$ select public.rpc_restore_praise('cf300000-0000-0000-0000-00000000000a') $$,
    'rpc_restore_praise succeeds');

select results_eq(
    $$ select status::text from public.praise_safe_view
       where id = 'cf300000-0000-0000-0000-00000000000a' $$,
    array['unmatched'],
    'praise is restored to unmatched');

-- ============================================================
-- 10. RESTORE on unmatched — idempotent
-- ============================================================

select lives_ok(
    $$ select public.rpc_restore_praise('cf300000-0000-0000-0000-00000000000a') $$,
    'rpc_restore_praise is idempotent on unmatched');

-- ============================================================
-- 11. MATCH, then UNMATCH — idempotent audit
-- ============================================================

select lives_ok(
    $$ select public.rpc_match_praise(
        'cf300000-0000-0000-0000-00000000000a',
        'cf200000-0000-0000-0000-00000000000a') $$,
    'match succeeds after restore');

-- Match again to same staff (idempotent)
select lives_ok(
    $$ select public.rpc_match_praise(
        'cf300000-0000-0000-0000-00000000000a',
        'cf200000-0000-0000-0000-00000000000a') $$,
    'matching to same staff is idempotent');

select tests.set_service();
select results_eq(
    $$ select count(*)::integer from public.audit_events
       where action = 'praise.matched'
         and target_id = 'cf300000-0000-0000-0000-00000000000a' $$,
    array[1],
    'only one audit event for match (idempotent)');
select tests.set_actor('cc000000-0000-0000-0000-000000000001');

select lives_ok(
    $$ select public.rpc_unmatch_praise('cf300000-0000-0000-0000-00000000000a') $$,
    'unmatch succeeds');

-- Unmatch again (idempotent)
select lives_ok(
    $$ select public.rpc_unmatch_praise('cf300000-0000-0000-0000-00000000000a') $$,
    'unmatch is idempotent');

-- ============================================================
-- 12. CROSS-TENANT — Org B cannot touch Org A praise
-- ============================================================

select tests.set_actor('cc000000-0000-0000-0000-000000000002');

select throws_ok(
    $$ select public.rpc_archive_praise('cf300000-0000-0000-0000-00000000000a') $$,
    'P0001', null,
    'Org B cannot archive Org A praise');

select throws_ok(
    $$ select public.rpc_match_praise(
        'cf300000-0000-0000-0000-00000000000a',
        'cf200000-0000-0000-0000-00000000000a') $$,
    'P0001', null,
    'Org B cannot match Org A praise');

-- ============================================================

select * from finish();

rollback;
