-- Deleting your own login: who may, and what happens to the business.
--
-- The API removes the login with the Auth Admin API, which is a delete from
-- auth.users. This test performs that same delete and checks the schema lets
-- it through for a team member who wrote notes, keeps the notes with the
-- business, and that the blocker function refuses a business's only owner.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

select plan(21);

create or replace function tests.as_user(p_user_id uuid) returns void
language plpgsql as $$
begin
    perform set_config('role', 'authenticated', true);
    perform set_config(
        'request.jwt.claims',
        json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
        true);
end $$;

create or replace function tests.as_postgres() returns void
language plpgsql as $$
begin
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
end $$;

grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

select tests.as_postgres();

-- ------------------------------------------------------------- seeding ----
-- b1 owns Solo Salon alone, and owns Shared Shop with b2.
-- b3 is a staff member of Solo Salon who wrote a note.
-- b4 signed in and never made a business.

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
    ('00000000-1801-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'solo@me.test', 'x', now(), now()),
    ('00000000-1801-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'coowner@me.test', 'x', now(), now()),
    ('00000000-1801-0000-0000-0000000000b3', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'staff@me.test', 'x', now(), now()),
    ('00000000-1801-0000-0000-0000000000b4', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'nobody@me.test', 'x', now(), now());

insert into public.organizations (id, name, slug, status)
values
    ('00000000-1801-0000-0000-000000000001', 'Solo Salon', 'me-solo', 'active'),
    ('00000000-1801-0000-0000-000000000002', 'Shared Shop', 'me-shared', 'active');

insert into public.organization_members (org_id, user_id, role, status)
values
    ('00000000-1801-0000-0000-000000000001', '00000000-1801-0000-0000-0000000000b1', 'owner', 'active'),
    ('00000000-1801-0000-0000-000000000001', '00000000-1801-0000-0000-0000000000b3', 'member', 'active'),
    ('00000000-1801-0000-0000-000000000002', '00000000-1801-0000-0000-0000000000b1', 'owner', 'active'),
    ('00000000-1801-0000-0000-000000000002', '00000000-1801-0000-0000-0000000000b2', 'owner', 'active');

insert into public.locations (id, org_id, name, google_review_url, status)
values ('00000000-1801-0000-0000-000000000011', '00000000-1801-0000-0000-000000000001',
        'Solo Main', 'https://g.page/r/solo/review', 'active');

insert into public.review_stands (id, org_id, location_id, public_token_hash, public_token_prefix)
values ('00000000-1801-0000-0000-000000000021', '00000000-1801-0000-0000-000000000001',
        '00000000-1801-0000-0000-000000000011', 'me-hash-solo', 'mesl');

insert into public.public_review_sessions
    (id, org_id, location_id, stand_id, session_token_hash, locale, expires_at)
values ('00000000-1801-0000-0000-000000000031', '00000000-1801-0000-0000-000000000001',
        '00000000-1801-0000-0000-000000000011', '00000000-1801-0000-0000-000000000021',
        'me-session-solo', 'en', now() + interval '1 hour');

insert into public.customer_responses
    (id, org_id, location_id, stand_id, session_id, response_token_hash, rating)
values ('00000000-1801-0000-0000-000000000041', '00000000-1801-0000-0000-000000000001',
        '00000000-1801-0000-0000-000000000011', '00000000-1801-0000-0000-000000000021',
        '00000000-1801-0000-0000-000000000031', 'me-response-solo', 2);

insert into public.response_notes (id, org_id, response_id, author_id, body_encrypted)
values ('00000000-1801-0000-0000-000000000051', '00000000-1801-0000-0000-000000000001',
        '00000000-1801-0000-0000-000000000041', '00000000-1801-0000-0000-0000000000b3',
        'enc:called the customer back');

-- ---------------------------------------------------------- the schema ----

select col_is_null('public', 'response_notes', 'author_id',
    'a note can outlive the person who wrote it');

select is(
    (select confdeltype::text from pg_constraint
      where conname = 'response_notes_author_id_fkey'),
    'n',
    'deleting a login sets the note''s author to null instead of refusing');

select function_privs_are('public', 'rpc_my_account_deletion_blockers', array[]::text[],
    'anon', array[]::text[], 'anonymous callers cannot ask');

select function_privs_are('public', 'rpc_my_account_deletion_blockers', array[]::text[],
    'authenticated', array['EXECUTE'], 'a signed-in person can ask about themselves');

-- --------------------------------------------------------- who is blocked ----

select tests.as_user('00000000-1801-0000-0000-0000000000b1');
select results_eq(
    $$ select name from public.rpc_my_account_deletion_blockers() $$,
    $$ values ('Solo Salon'::text) $$,
    'the only owner of a business is told which one to delete first; a co-owned one is not listed');

select tests.as_user('00000000-1801-0000-0000-0000000000b2');
select is_empty(
    $$ select * from public.rpc_my_account_deletion_blockers() $$,
    'a co-owner may leave: the business keeps its other owner');

select tests.as_user('00000000-1801-0000-0000-0000000000b3');
select is_empty(
    $$ select * from public.rpc_my_account_deletion_blockers() $$,
    'a staff member is never blocked');

select tests.as_user('00000000-1801-0000-0000-0000000000b4');
select is_empty(
    $$ select * from public.rpc_my_account_deletion_blockers() $$,
    'someone with no business is never blocked');

select tests.as_postgres();
select set_config('request.jwt.claims', '', true);
select is_empty(
    $$ select * from public.rpc_my_account_deletion_blockers() $$,
    'without a session the answer names nobody');

-- ------------------------------------------- the locked step (prepare) ----

select function_privs_are('public', 'rpc_prepare_my_account_deletion', array[]::text[],
    'anon', array[]::text[], 'anonymous callers cannot prepare a deletion');

select tests.as_user('00000000-1801-0000-0000-0000000000b1');
select results_eq(
    $$ select name from public.rpc_prepare_my_account_deletion() $$,
    $$ values ('Solo Salon'::text) $$,
    'the only owner of a business is refused, by name');

select tests.as_postgres();
select is(
    (select count(*)::int from public.organization_members
      where user_id = '00000000-1801-0000-0000-0000000000b1'),
    2,
    'a refused prepare changes nothing');

-- The first co-owner to go leaves; the second is then the only owner.
select tests.as_user('00000000-1801-0000-0000-0000000000b2');
select is_empty(
    $$ select * from public.rpc_prepare_my_account_deletion() $$,
    'a co-owner may prepare to leave');

select tests.as_postgres();
select is(
    (select count(*)::int from public.organization_members
      where user_id = '00000000-1801-0000-0000-0000000000b2'),
    0,
    'preparing removes all of their memberships before the login goes');

select tests.as_user('00000000-1801-0000-0000-0000000000b1');
select results_eq(
    $$ select name from public.rpc_my_account_deletion_blockers() order by name $$,
    $$ values ('Shared Shop'::text), ('Solo Salon'::text) $$,
    'the remaining co-owner is now the only owner, so they cannot also leave');

select tests.as_postgres();
select throws_ok(
    $$ select * from public.rpc_prepare_my_account_deletion() $$,
    '28000',
    'not_authenticated',
    'without a session nothing is prepared');

-- --------------------------------------------- the delete the API performs ----

select lives_ok(
    $$ delete from auth.users where id = '00000000-1801-0000-0000-0000000000b3' $$,
    'a staff member who wrote a note can be deleted');

select is(
    (select count(*)::int from public.organization_members
      where user_id = '00000000-1801-0000-0000-0000000000b3'),
    0,
    'their memberships go with them');

select is(
    (select author_id from public.response_notes
      where id = '00000000-1801-0000-0000-000000000051'),
    null::uuid,
    'their note stays, with no author');

select is(
    (select count(*)::int from public.organizations
      where id = '00000000-1801-0000-0000-000000000001'),
    1,
    'the business they worked for is untouched');

select lives_ok(
    $$ delete from auth.users where id = '00000000-1801-0000-0000-0000000000b4' $$,
    'someone with no business can be deleted');

select * from finish();

rollback;
