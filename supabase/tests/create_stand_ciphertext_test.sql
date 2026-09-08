-- rpc_create_stand stores reprint ciphertext atomically.
--
-- Guards the NFC leftover: createStand used to insert a stand, then call the
-- dropped rpc_set_stand_token_ciphertext and ignore the result. A stand
-- without ciphertext cannot be reprinted.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

select plan(12);

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
    perform set_config(
        'request.jwt.claims',
        json_build_object('role', 'anon')::text,
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

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
    ('61000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cs-owner@test.com', '', now(), now()),
    ('61000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cs-member@test.com', '', now(), now()),
    ('61000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cs-outsider@test.com', '', now(), now());

insert into public.organizations (id, name, slug)
values
    ('62000000-0000-0000-0000-00000000000a', 'Cipher Org A', 'cipher-org-a'),
    ('62000000-0000-0000-0000-00000000000b', 'Cipher Org B', 'cipher-org-b');

insert into public.organization_members (org_id, user_id, role, status)
values
    ('62000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-000000000001', 'owner', 'active'),
    ('62000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-000000000002', 'member', 'active'),
    ('62000000-0000-0000-0000-00000000000b', '61000000-0000-0000-0000-000000000003', 'owner', 'active');

insert into public.locations (id, org_id, name)
values
    ('63000000-0000-0000-0000-00000000000a', '62000000-0000-0000-0000-00000000000a', 'Cipher Location A'),
    ('63000000-0000-0000-0000-00000000000b', '62000000-0000-0000-0000-00000000000b', 'Cipher Location B');

-- ============================================================
-- 1. Signature: 9-param only; standalone setter stays gone
-- ============================================================

select ok(
    to_regprocedure('public.rpc_create_stand(uuid, uuid, text, text, text, smallint, text)') is null,
    'the 7-param rpc_create_stand overload is gone');

select ok(
    to_regprocedure('public.rpc_create_stand(uuid, uuid, text, text, text, smallint, text, text, smallint)') is not null,
    'rpc_create_stand requires ciphertext and cipher key version');

select ok(
    to_regprocedure('public.rpc_set_stand_token_ciphertext(uuid, text, smallint)') is null,
    'standalone rpc_set_stand_token_ciphertext stays dropped');

select ok(
    not has_function_privilege(
        'anon',
        'public.rpc_create_stand(uuid, uuid, text, text, text, smallint, text, text, smallint)',
        'EXECUTE'),
    'anon has no EXECUTE on rpc_create_stand');

select ok(
    not has_function_privilege(
        'public',
        'public.rpc_create_stand(uuid, uuid, text, text, text, smallint, text, text, smallint)',
        'EXECUTE'),
    'PUBLIC has no EXECUTE on rpc_create_stand');

-- ============================================================
-- 2. Owner create stores ciphertext in the same statement
-- ============================================================

select tests.set_actor('61000000-0000-0000-0000-000000000001');

select results_eq(
    $$ select public_token_encrypted, token_encryption_key_version
         from public.review_stands
        where id = public.rpc_create_stand(
            '62000000-0000-0000-0000-00000000000a',
            '63000000-0000-0000-0000-00000000000a',
            'Reprint Desk',
            'cipher-stand-hash-000000000000000000000000000001',
            'ciphpfx1',
            1::smallint,
            'req-create-stand-ok',
            'v1:enc-create-stand-ciphertext',
            1::smallint) $$,
    $$ values ('v1:enc-create-stand-ciphertext'::text, 1::smallint) $$,
    'owner create stores reprint ciphertext atomically');

-- ============================================================
-- 3. Empty ciphertext fails closed — no orphan stand
-- ============================================================

select throws_ok(
    $$ select public.rpc_create_stand(
        '62000000-0000-0000-0000-00000000000a',
        '63000000-0000-0000-0000-00000000000a',
        'Orphan Desk',
        'cipher-stand-hash-000000000000000000000000000002',
        'ciphpfx2',
        1::smallint,
        'req-create-stand-empty',
        '',
        1::smallint) $$,
    'P0001',
    'ciphertext_required',
    'empty ciphertext is refused');

select is_empty(
    $$ select id from public.review_stands
       where public_token_hash = 'cipher-stand-hash-000000000000000000000000000002' $$,
    'refusing empty ciphertext does not leave an orphan stand');

-- ============================================================
-- 4. Role / tenant attacks
-- ============================================================

select tests.set_actor('61000000-0000-0000-0000-000000000002'); -- member

select throws_ok(
    $$ select public.rpc_create_stand(
        '62000000-0000-0000-0000-00000000000a',
        '63000000-0000-0000-0000-00000000000a',
        'Member Desk',
        'cipher-stand-hash-000000000000000000000000000003',
        'ciphpfx3',
        1::smallint,
        'req-create-stand-member',
        'v1:enc-member',
        1::smallint) $$,
    'P0001',
    'not_found_or_forbidden',
    'member cannot create a stand');

select tests.set_actor('61000000-0000-0000-0000-000000000003'); -- other-org owner

select throws_ok(
    $$ select public.rpc_create_stand(
        '62000000-0000-0000-0000-00000000000a',
        '63000000-0000-0000-0000-00000000000a',
        'Cross Desk',
        'cipher-stand-hash-000000000000000000000000000004',
        'ciphpfx4',
        1::smallint,
        'req-create-stand-cross',
        'v1:enc-cross',
        1::smallint) $$,
    'P0001',
    'not_found_or_forbidden',
    'outsider cannot create a stand on another org');

select tests.set_actor('61000000-0000-0000-0000-000000000001');

select throws_ok(
    $$ select public.rpc_create_stand(
        '62000000-0000-0000-0000-00000000000a',
        '63000000-0000-0000-0000-00000000000b',
        'Cross Location',
        'cipher-stand-hash-000000000000000000000000000005',
        'ciphpfx5',
        1::smallint,
        'req-create-stand-loc',
        'v1:enc-cross-loc',
        1::smallint) $$,
    'P0001',
    'not_found_or_forbidden',
    'owner cannot attach a stand to another org''s location');

select tests.set_anonymous();

select throws_ok(
    $$ select public.rpc_create_stand(
        '62000000-0000-0000-0000-00000000000a',
        '63000000-0000-0000-0000-00000000000a',
        'Anon Desk',
        'cipher-stand-hash-000000000000000000000000000006',
        'ciphpfx6',
        1::smallint,
        'req-create-stand-anon',
        'v1:enc-anon',
        1::smallint) $$,
    '42501',
    null,
    'anon cannot execute rpc_create_stand');

select * from finish();

rollback;
