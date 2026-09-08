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

select plan(25);

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

-- Shape encrypt() writes: v1:<b64>:<b64>:<b64>. SQL cannot decrypt; it
-- can refuse anything that is not this shape. Used for happy-path and
-- authz cases so those tests do not trip the format gate first.
--
-- 16 / 24 / 32 chars — IV / tag / ct floors the application actually emits.
create function tests.reprint_ciphertext() returns text
language sql immutable as $$
    select 'v1:ABCDEFGHIJKLMNOP:QRSTUVWXYZabcdefghijklmn:opqrstuvwxyzABCDEFGHIJKLMNOPQR';
$$;

grant execute on function tests.reprint_ciphertext() to public;

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

select lives_ok(
    $$ select public.rpc_create_stand(
        '62000000-0000-0000-0000-00000000000a',
        '63000000-0000-0000-0000-00000000000a',
        'Reprint Desk',
        'cipher-stand-hash-000000000000000000000000000001',
        'ciphpfx1',
        1::smallint,
        'req-create-stand-ok',
        tests.reprint_ciphertext(),
        1::smallint) $$,
    'owner can create a stand');

-- Separate statement: a same-query SELECT cannot see the INSERT (statement
-- snapshot). The ciphertext must already be on the row after the RPC returns.
select results_eq(
    $$ select public_token_encrypted, token_encryption_key_version
         from public.review_stands
        where public_token_hash = 'cipher-stand-hash-000000000000000000000000000001' $$,
    $$ values (tests.reprint_ciphertext(), 1::smallint) $$,
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

-- ASCII space-only trim is not enough. Direct RPC with other whitespace
-- (or garbage that tryDecrypt cannot read) must fail closed with no row.

select throws_ok(
    $$ select public.rpc_create_stand(
        '62000000-0000-0000-0000-00000000000a',
        '63000000-0000-0000-0000-00000000000a',
        'Tab Desk',
        'cipher-stand-hash-tab000000000000000000000000002',
        'ciphtab1',
        1::smallint,
        'req-create-stand-tab',
        E'\t',
        1::smallint) $$,
    'P0001',
    'ciphertext_required',
    'tab-only ciphertext is refused');

select is_empty(
    $$ select id from public.review_stands
       where public_token_hash = 'cipher-stand-hash-tab000000000000000000000000002' $$,
    'tab-only ciphertext leaves no orphan stand');

select throws_ok(
    $$ select public.rpc_create_stand(
        '62000000-0000-0000-0000-00000000000a',
        '63000000-0000-0000-0000-00000000000a',
        'NL Desk',
        'cipher-stand-hash-nl0000000000000000000000000002',
        'ciphnl01',
        1::smallint,
        'req-create-stand-nl',
        E'\n',
        1::smallint) $$,
    'P0001',
    'ciphertext_required',
    'newline-only ciphertext is refused');

select is_empty(
    $$ select id from public.review_stands
       where public_token_hash = 'cipher-stand-hash-nl0000000000000000000000000002' $$,
    'newline-only ciphertext leaves no orphan stand');

select throws_ok(
    $$ select public.rpc_create_stand(
        '62000000-0000-0000-0000-00000000000a',
        '63000000-0000-0000-0000-00000000000a',
        'CRLF Desk',
        'cipher-stand-hash-crlf00000000000000000000000002',
        'ciphcrlf',
        1::smallint,
        'req-create-stand-crlf',
        E'\r\n',
        1::smallint) $$,
    'P0001',
    'ciphertext_required',
    'CRLF-only ciphertext is refused');

select is_empty(
    $$ select id from public.review_stands
       where public_token_hash = 'cipher-stand-hash-crlf00000000000000000000000002' $$,
    'CRLF-only ciphertext leaves no orphan stand');

select throws_ok(
    $$ select public.rpc_create_stand(
        '62000000-0000-0000-0000-00000000000a',
        '63000000-0000-0000-0000-00000000000a',
        'NBSP Desk',
        'cipher-stand-hash-nbsp00000000000000000000000002',
        'ciphnbsp',
        1::smallint,
        'req-create-stand-nbsp',
        E'\u00A0',
        1::smallint) $$,
    'P0001',
    'ciphertext_required',
    'NBSP-only ciphertext is refused');

select is_empty(
    $$ select id from public.review_stands
       where public_token_hash = 'cipher-stand-hash-nbsp00000000000000000000000002' $$,
    'NBSP-only ciphertext leaves no orphan stand');

select throws_ok(
    $$ select public.rpc_create_stand(
        '62000000-0000-0000-0000-00000000000a',
        '63000000-0000-0000-0000-00000000000a',
        'Garbage Desk',
        'cipher-stand-hash-garbage00000000000000000000002',
        'ciphgarb',
        1::smallint,
        'req-create-stand-garbage',
        'not-a-ciphertext',
        1::smallint) $$,
    'P0001',
    'ciphertext_required',
    'non-decryptable garbage ciphertext is refused');

select is_empty(
    $$ select id from public.review_stands
       where public_token_hash = 'cipher-stand-hash-garbage00000000000000000000002' $$,
    'garbage ciphertext leaves no orphan stand');

select throws_ok(
    $$ select public.rpc_create_stand(
        '62000000-0000-0000-0000-00000000000a',
        '63000000-0000-0000-0000-00000000000a',
        'Two-part Desk',
        'cipher-stand-hash-twopart0000000000000000000002',
        'ciphtwo1',
        1::smallint,
        'req-create-stand-twopart',
        'v1:enc-not-enough-parts',
        1::smallint) $$,
    'P0001',
    'ciphertext_required',
    'v1: two-part payload is not reprintable and is refused');

select is_empty(
    $$ select id from public.review_stands
       where public_token_hash = 'cipher-stand-hash-twopart0000000000000000000002' $$,
    'malformed v1: payload leaves no orphan stand');

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
        tests.reprint_ciphertext(),
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
        tests.reprint_ciphertext(),
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
        tests.reprint_ciphertext(),
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
        tests.reprint_ciphertext(),
        1::smallint) $$,
    '42501',
    null,
    'anon cannot execute rpc_create_stand');

select * from finish();

rollback;
