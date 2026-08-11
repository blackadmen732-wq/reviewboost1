-- ReviewBoost database tests.
--
-- These are the tests that matter. Everything in `frontend/tests` mocks
-- Supabase, so it proves the handlers behave — not that Postgres agrees. This
-- file attempts the forbidden operations and asserts the database refuses them.
--
-- A test that only checks a policy exists is worthless. Every isolation test
-- below performs the attack.
--
--   supabase test db
--
-- Roles matter here. `postgres` owns the tables and bypasses RLS, so a test run
-- as postgres proves nothing about isolation. Each isolation test explicitly
-- switches to `authenticated` and sets a JWT claim, which is exactly what
-- PostgREST does for a real request.

begin;

create extension if not exists pgtap with schema extensions;

-- Rolled back with the transaction. Exists only so the role-switching helpers
-- below have somewhere to live.
create schema if not exists tests;

select plan(70);

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

create or replace function tests.set_anonymous() returns void
language plpgsql as $$
begin
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end $$;

create or replace function tests.set_service() returns void
language plpgsql as $$
begin
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
end $$;

-- The helpers must stay callable after the role switches below, or the suite
-- cannot switch back out of `anon`. Rolled back with everything else.
grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

-- Two tenants and one outsider.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
    ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@example.com', '', now(), now()),
    ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@example.com', '', now(), now()),
    ('cccccccc-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nobody@example.com', '', now(), now()),
    ('dddddddd-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'removed@example.com', '', now(), now());

insert into public.organizations (id, name, slug)
values
    ('a0000000-0000-0000-0000-00000000000a', 'Tenant A', 'tenant-a'),
    ('b0000000-0000-0000-0000-00000000000b', 'Tenant B', 'tenant-b');

insert into public.organization_members (org_id, user_id, role, status)
values
    ('a0000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner', 'active'),
    ('b0000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'owner', 'active'),
    -- Has a row, and no access. Membership existence is not membership.
    ('a0000000-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-000000000001', 'member', 'removed');

insert into public.locations (id, org_id, name, google_review_url)
values
    ('a1000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', 'A High Street', 'https://g.page/r/tenantA/review'),
    ('b1000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', 'B Market Square', 'https://g.page/r/tenantB/review');

insert into public.review_stands (id, org_id, location_id, public_token_hash, public_token_prefix)
values
    ('a2000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-00000000000a', 'hash-stand-a', 'standa01'),
    ('b2000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', 'b1000000-0000-0000-0000-00000000000b', 'hash-stand-b', 'standb01');

-- =========================================================== schema ========

select has_table('public', 'organizations', 'organizations exists');
select has_table('public', 'customer_responses', 'customer_responses exists');
select has_table('public', 'team_praise_records', 'team_praise_records exists');
select has_table('public', 'idempotency_records', 'idempotency_records exists');

-- Review integrity, enforced by absence.
select hasnt_column('public', 'review_stands', 'review_threshold',
    'no stand carries a review threshold');
select hasnt_column('public', 'team_praise_records', 'rating',
    'Team Praise cannot see the rating, because the column does not exist');
select hasnt_column('public', 'team_praise_records', 'google_clicked_at',
    'Team Praise cannot see Google state');

select col_has_check('public', 'customer_responses', 'rating', 'rating is constrained');

-- Uniqueness the flow depends on.
select col_is_unique('public', 'customer_responses', 'session_id',
    'one response per session');
select col_is_unique('public', 'google_review_clicks', 'response_id',
    'one Google click per response');
select col_is_unique('public', 'team_praise_records', 'response_id',
    'one praise record per response');
select col_is_unique('public', 'idempotency_records',
    array['operation', 'scope_key', 'idempotency_key'],
    'one idempotency record per operation, scope, and key');
select col_is_unique('public', 'review_stands', 'public_token_hash',
    'a stand token digest is unique');

-- RLS enabled everywhere it is exposed.
select results_eq(
    $$ select count(*)::int from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname in ('organizations','organization_members','locations','review_stands',
                           'public_review_sessions','customer_responses','google_review_clicks',
                           'team_praise_records','idempotency_records','audit_events','profiles')
         and c.relrowsecurity $$,
    $$ values (11) $$,
    'row level security is enabled on all eleven exposed tables');

-- ===================================================== table privileges ====
--
-- These exist because inspection missed both of the problems they now catch.
-- A policy filters rows; a grant decides whether the statement runs at all, and
-- the two are not substitutes.

-- TRUNCATE is not subject to row level security. A single stray grant would let
-- any signed-in user empty every business's feedback, with every policy intact.
select is_empty(
    $$ select table_name, grantee, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'public'
          and grantee in ('anon', 'authenticated')
          and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES') $$,
    'neither anon nor authenticated can truncate, trigger, or reference any table');

-- The anonymous customer never touches a table. Every public write goes through
-- a definer function the service role calls on their behalf.
select is_empty(
    $$ select table_name from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'anon' $$,
    'anon holds no table privilege of any kind');

-- The mirror image: a policy with no underlying grant is inert, and the
-- dashboard would fail with permission denied on its first query.
select isnt_empty(
    $$ select 1 from information_schema.role_table_grants
        where table_schema='public' and grantee='authenticated'
          and table_name='organizations' and privilege_type='SELECT' $$,
    'authenticated can select organizations, so its policy is not inert');

select isnt_empty(
    $$ select 1 from information_schema.role_table_grants
        where table_schema='public' and grantee='authenticated'
          and table_name='customer_responses' and privilege_type='SELECT' $$,
    'authenticated can select customer responses');

-- Customer words are read-only to every member. Fabricating a response would
-- corrupt the only honest signal the product produces.
select is_empty(
    $$ select 1 from information_schema.role_table_grants
        where table_schema='public' and grantee='authenticated'
          and table_name='customer_responses' and privilege_type='INSERT' $$,
    'no member can insert a customer response');

select is_empty(
    $$ select 1 from information_schema.role_table_grants
        where table_schema='public' and grantee in ('anon','authenticated')
          and table_name in ('idempotency_records','rate_limit_buckets') $$,
    'infrastructure tables are invisible to every client role');

-- ======================================================= rating storage ====

select tests.set_service();

insert into public.public_review_sessions
    (id, org_id, location_id, stand_id, session_token_hash, locale, expires_at)
select
    ('a3000000-0000-0000-0000-00000000000' || n)::uuid,
    'a0000000-0000-0000-0000-00000000000a',
    'a1000000-0000-0000-0000-00000000000a',
    'a2000000-0000-0000-0000-00000000000a',
    'hash-session-' || n,
    'en',
    now() + interval '1 day'
from generate_series(1, 5) n;

insert into public.customer_responses
    (org_id, location_id, stand_id, session_id, response_token_hash, rating)
select
    'a0000000-0000-0000-0000-00000000000a',
    'a1000000-0000-0000-0000-00000000000a',
    'a2000000-0000-0000-0000-00000000000a',
    ('a3000000-0000-0000-0000-00000000000' || n)::uuid,
    'hash-response-' || n,
    n
from generate_series(1, 5) n;

-- Every rating is stored. A 4 or a 5 is not a conversion that skips storage,
-- and a 1 is not diverted anywhere.
select results_eq(
    $$ select array_agg(rating order by rating)::int[] from public.customer_responses $$,
    $$ values (array[1,2,3,4,5]) $$,
    'all five ratings are stored');

select throws_ok(
    $$ insert into public.customer_responses
         (org_id, location_id, stand_id, session_id, response_token_hash, rating)
       values ('a0000000-0000-0000-0000-00000000000a','a1000000-0000-0000-0000-00000000000a',
               'a2000000-0000-0000-0000-00000000000a','a3000000-0000-0000-0000-000000000001',
               'hash-response-x', 6) $$,
    23514,
    null,
    'a rating above five is refused');

select throws_ok(
    $$ insert into public.customer_responses
         (org_id, location_id, stand_id, session_id, response_token_hash, rating)
       values ('a0000000-0000-0000-0000-00000000000a','a1000000-0000-0000-0000-00000000000a',
               'a2000000-0000-0000-0000-00000000000a','a3000000-0000-0000-0000-000000000001',
               'hash-response-y', 0) $$,
    23514,
    null,
    'a rating below one is refused');

select throws_ok(
    $$ insert into public.customer_responses
         (org_id, location_id, stand_id, session_id, response_token_hash, rating)
       values ('a0000000-0000-0000-0000-00000000000a','a1000000-0000-0000-0000-00000000000a',
               'a2000000-0000-0000-0000-00000000000a','a3000000-0000-0000-0000-000000000001',
               'hash-response-dup', 3) $$,
    23505,
    null,
    'a second response on the same session is refused');

-- ==================================================== tenant integrity =====

-- Composite foreign keys carry org_id through every relationship, so the
-- database refuses a cross-organization link even if application code asks.
select throws_ok(
    $$ insert into public.public_review_sessions
         (org_id, location_id, stand_id, session_token_hash, locale, expires_at)
       values ('a0000000-0000-0000-0000-00000000000a',
               'b1000000-0000-0000-0000-00000000000b',
               'b2000000-0000-0000-0000-00000000000b',
               'hash-cross-tenant', 'en', now() + interval '1 day') $$,
    23503,
    null,
    'a session cannot join one tenant to another tenant''s stand');

select throws_ok(
    $$ insert into public.review_stands (org_id, location_id, public_token_hash, public_token_prefix)
       values ('a0000000-0000-0000-0000-00000000000a',
               'b1000000-0000-0000-0000-00000000000b', 'hash-x', 'prefix01') $$,
    23503,
    null,
    'a stand cannot be attached to another tenant''s location');

-- ======================================================= anonymous ==========

select tests.set_anonymous();

-- Anonymous customers get no direct table access at all. Their writes go
-- through definer functions the Data API cannot reach.
-- Denied at the *privilege* level, before RLS is even consulted. That is
-- stronger than a policy returning no rows: there is no statement to filter.
select throws_ok($$ select 1 from public.customer_responses $$, '42501', null,
    'anonymous cannot read customer responses');
select throws_ok($$ select 1 from public.organizations $$, '42501', null,
    'anonymous cannot read organizations');
select throws_ok($$ select 1 from public.review_stands $$, '42501', null,
    'anonymous cannot read stands');
select throws_ok($$ select 1 from public.team_praise_records $$, '42501', null,
    'anonymous cannot read team praise');
select throws_ok($$ select 1 from public.idempotency_records $$, '42501', null,
    'anonymous cannot read idempotency records');
select throws_ok($$ select 1 from public.locations $$, '42501', null,
    'anonymous cannot read locations');

select throws_ok(
    $$ insert into public.organizations (name, slug) values ('Forged', 'forged-org') $$,
    '42501', null,
    'anonymous cannot create an organization');

-- The definer functions are unreachable from a browser even with a valid key.
select throws_ok(
    $$ select app.resolve_public_stand('hash-stand-a') $$,
    '42501', null,
    'anonymous cannot call the stand resolver directly');

select throws_ok(
    $$ select public.rpc_public_resolve_stand('hash-stand-a') $$,
    '42501', null,
    'anonymous cannot call the public RPC wrapper');

-- =================================================== cross-tenant reads =====

select tests.set_actor('aaaaaaaa-0000-0000-0000-000000000001');

select isnt_empty($$ select 1 from public.organizations $$,
    'tenant A sees its own organization');

select results_eq(
    $$ select count(*)::int from public.organizations
        where id = 'b0000000-0000-0000-0000-00000000000b' $$,
    $$ values (0) $$,
    'tenant A cannot read tenant B''s organization');

select results_eq(
    $$ select count(*)::int from public.locations
        where org_id = 'b0000000-0000-0000-0000-00000000000b' $$,
    $$ values (0) $$,
    'tenant A cannot read tenant B''s locations');

select results_eq(
    $$ select count(*)::int from public.review_stands
        where org_id = 'b0000000-0000-0000-0000-00000000000b' $$,
    $$ values (0) $$,
    'tenant A cannot read tenant B''s stands');

select isnt_empty($$ select 1 from public.customer_responses $$,
    'tenant A sees its own customer responses');

-- ================================================== cross-tenant writes =====
--
-- The attacker is allowed to submit tenant B's UUID. The database must still
-- refuse, because access is derived from membership rather than from anything
-- the caller sent.

select throws_ok(
    $$ insert into public.locations (org_id, name)
       values ('b0000000-0000-0000-0000-00000000000b', 'Forged location') $$,
    '42501', null,
    'tenant A cannot insert into tenant B');

select results_eq(
    $$ with attempt as (
         update public.locations set name = 'Hijacked'
          where org_id = 'b0000000-0000-0000-0000-00000000000b' returning 1)
       select count(*)::int from attempt $$,
    $$ values (0) $$,
    'tenant A cannot update tenant B''s locations');

select results_eq(
    $$ with attempt as (
         delete from public.locations
          where org_id = 'b0000000-0000-0000-0000-00000000000b' returning 1)
       select count(*)::int from attempt $$,
    $$ values (0) $$,
    'tenant A cannot delete tenant B''s locations');

select results_eq(
    $$ with attempt as (
         update public.customer_responses set rating = 1
          where org_id = 'b0000000-0000-0000-0000-00000000000b' returning 1)
       select count(*)::int from attempt $$,
    $$ values (0) $$,
    'tenant A cannot rewrite tenant B''s ratings');

-- A member may not fabricate a customer response even in their own tenant.
-- Those rows are written only by the anonymous path, through definer functions.
select throws_ok(
    $$ insert into public.customer_responses
         (org_id, location_id, stand_id, session_id, response_token_hash, rating)
       values ('a0000000-0000-0000-0000-00000000000a','a1000000-0000-0000-0000-00000000000a',
               'a2000000-0000-0000-0000-00000000000a','a3000000-0000-0000-0000-000000000001',
               'hash-fabricated', 5) $$,
    '42501', null,
    'an owner cannot fabricate a customer response');

-- ==================================================== membership status =====

select tests.set_actor('cccccccc-0000-0000-0000-000000000001');

select is_empty($$ select 1 from public.organizations $$,
    'a user with no membership sees nothing');
select is_empty($$ select 1 from public.customer_responses $$,
    'a user with no membership sees no responses');

select tests.set_actor('dddddddd-0000-0000-0000-000000000001');

-- Only 'active' grants access. A removed member keeps the row and loses the
-- data on their very next request.
select is_empty($$ select 1 from public.organizations $$,
    'a removed member sees nothing');
select is_empty($$ select 1 from public.customer_responses $$,
    'a removed member sees no responses');
select is_empty($$ select 1 from public.locations $$,
    'a removed member sees no locations');

-- =========================================================== audit ==========

select tests.set_service();
insert into public.audit_events (org_id, actor_type, action)
values ('a0000000-0000-0000-0000-00000000000a', 'system', 'test.event');

select tests.set_actor('aaaaaaaa-0000-0000-0000-000000000001');

select isnt_empty($$ select 1 from public.audit_events $$,
    'an owner can read their own audit history');

-- Append-only: no insert, update, or delete policy exists for a normal user.
select throws_ok(
    $$ insert into public.audit_events (org_id, actor_type, action)
       values ('a0000000-0000-0000-0000-00000000000a', 'user', 'forged') $$,
    '42501', null,
    'a normal user cannot write audit history');

-- Denied at the privilege level: there is no UPDATE or DELETE grant on
-- audit_events at all, so history cannot be rewritten even by a query that
-- would otherwise pass a policy.
select throws_ok(
    $$ update public.audit_events set action = 'rewritten' $$,
    '42501', null,
    'a normal user cannot rewrite audit history');

select throws_ok(
    $$ delete from public.audit_events $$,
    '42501', null,
    'a normal user cannot erase audit history');

-- ================================================ feedback workflow ========
--
-- The action-note thread and the resolved state. Every isolation claim below
-- performs the attack rather than asserting a policy exists.

select tests.set_service();

-- One known response to hang the thread from.
insert into public.public_review_sessions
    (id, org_id, location_id, stand_id, session_token_hash, locale, expires_at)
values ('a4000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-00000000000a',
        'a1000000-0000-0000-0000-00000000000a',
        'a2000000-0000-0000-0000-00000000000a',
        'hash-session-workflow', 'en', now() + interval '1 day');

insert into public.customer_responses
    (id, org_id, location_id, stand_id, session_id, response_token_hash, rating)
values ('a5000000-0000-0000-0000-00000000000a',
        'a0000000-0000-0000-0000-00000000000a',
        'a1000000-0000-0000-0000-00000000000a',
        'a2000000-0000-0000-0000-00000000000a',
        'a4000000-0000-0000-0000-00000000000a',
        'hash-response-workflow', 3);

-- Tenant B gets one too, so cross-tenant reads have something to fail to find.
insert into public.public_review_sessions
    (id, org_id, location_id, stand_id, session_token_hash, locale, expires_at)
values ('b4000000-0000-0000-0000-00000000000b',
        'b0000000-0000-0000-0000-00000000000b',
        'b1000000-0000-0000-0000-00000000000b',
        'b2000000-0000-0000-0000-00000000000b',
        'hash-session-workflow-b', 'en', now() + interval '1 day');

insert into public.customer_responses
    (id, org_id, location_id, stand_id, session_id, response_token_hash, rating)
values ('b5000000-0000-0000-0000-00000000000b',
        'b0000000-0000-0000-0000-00000000000b',
        'b1000000-0000-0000-0000-00000000000b',
        'b2000000-0000-0000-0000-00000000000b',
        'b4000000-0000-0000-0000-00000000000b',
        'hash-response-workflow-b', 2);

insert into public.response_notes (org_id, response_id, author_id, body_encrypted)
values ('b0000000-0000-0000-0000-00000000000b',
        'b5000000-0000-0000-0000-00000000000b',
        'bbbbbbbb-0000-0000-0000-000000000001',
        'ciphertext-tenant-b');

-- ---- as tenant A's owner ----

select tests.set_actor('aaaaaaaa-0000-0000-0000-000000000001');

select lives_ok(
    $$ insert into public.response_notes (org_id, response_id, author_id, body_encrypted)
       values ('a0000000-0000-0000-0000-00000000000a',
               'a5000000-0000-0000-0000-00000000000a',
               'aaaaaaaa-0000-0000-0000-000000000001',
               'ciphertext-called-them-back') $$,
    'an owner can record what they did about their own feedback');

select isnt_empty(
    $$ select 1 from public.response_notes
        where response_id = 'a5000000-0000-0000-0000-00000000000a' $$,
    'an owner can read their own action notes');

-- Attribution cannot be forged: the insert policy requires author_id to be the
-- caller, so a note cannot be filed under a colleague's name.
select throws_ok(
    $$ insert into public.response_notes (org_id, response_id, author_id, body_encrypted)
       values ('a0000000-0000-0000-0000-00000000000a',
               'a5000000-0000-0000-0000-00000000000a',
               'bbbbbbbb-0000-0000-0000-000000000001',
               'forged-attribution') $$,
    '42501', null,
    'a note cannot be attributed to somebody else');

-- Cross-tenant write, refused by the policy.
select throws_ok(
    $$ insert into public.response_notes (org_id, response_id, author_id, body_encrypted)
       values ('b0000000-0000-0000-0000-00000000000b',
               'b5000000-0000-0000-0000-00000000000b',
               'aaaaaaaa-0000-0000-0000-000000000001',
               'note-on-a-rivals-feedback') $$,
    '42501', null,
    'an owner cannot annotate another business feedback');

-- Cross-tenant read returns nothing rather than erroring, which is what RLS
-- does and what keeps existence itself private.
select is_empty(
    $$ select 1 from public.response_notes
        where org_id = 'b0000000-0000-0000-0000-00000000000b' $$,
    'an owner never sees another business action notes');

-- Append-only, enforced by the absence of a grant rather than by convention.
select throws_ok(
    $$ update public.response_notes set body_encrypted = 'rewritten' $$,
    '42501', null,
    'an action note cannot be rewritten');

select throws_ok(
    $$ delete from public.response_notes $$,
    '42501', null,
    'an action note cannot be deleted');

select throws_ok(
    $$ truncate public.response_notes $$,
    '42501', null,
    'action notes cannot be truncated away');

-- ---- resolution ----

select lives_ok(
    $$ update public.customer_responses
          set resolved_at = now(), resolved_by = 'aaaaaaaa-0000-0000-0000-000000000001'
        where id = 'a5000000-0000-0000-0000-00000000000a' $$,
    'an owner can mark their own feedback sorted');

-- resolved_at and resolved_by travel together or not at all, so "sorted" always
-- has a name against it.
select throws_ok(
    $$ update public.customer_responses set resolved_at = now(), resolved_by = null
        where id = 'a5000000-0000-0000-0000-00000000000a' $$,
    '23514', null,
    'feedback cannot be sorted by nobody');

select lives_ok(
    $$ update public.customer_responses set resolved_at = null, resolved_by = null
        where id = 'a5000000-0000-0000-0000-00000000000a' $$,
    'an owner can reopen their own feedback');

-- The customer's own words stay immutable. Nothing in this workflow may edit
-- what was actually said.
select is(
    (select rating from public.customer_responses
      where id = 'a5000000-0000-0000-0000-00000000000a'),
    3::smallint,
    'the rating is untouched by the workflow');

-- ---- anonymous ----

select tests.set_anonymous();

select throws_ok(
    $$ select 1 from public.response_notes $$,
    '42501', null,
    'the anonymous customer role cannot read internal notes');

select throws_ok(
    $$ insert into public.response_notes (org_id, response_id, author_id, body_encrypted)
       values ('a0000000-0000-0000-0000-00000000000a',
               'a5000000-0000-0000-0000-00000000000a',
               'aaaaaaaa-0000-0000-0000-000000000001', 'x') $$,
    '42501', null,
    'the anonymous customer role cannot write internal notes');

-- ---- seeing your own team ----

select tests.set_actor('aaaaaaaa-0000-0000-0000-000000000001');

select isnt_empty(
    $$ select 1 from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
    'a user can still see their own profile');

select is_empty(
    $$ select 1 from public.profiles where id = 'bbbbbbbb-0000-0000-0000-000000000001' $$,
    'a user cannot see somebody from another business');

select * from finish();


rollback;
