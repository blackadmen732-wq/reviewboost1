-- Privilege / grant / RPC attack pass.
--
-- Every assertion performs the actual attack as the actual role
-- (anon, authenticated member, viewer, outsider). Privilege comments in
-- migrations are not a proof — this file is.
--
-- Covers leftover holes the earlier suites did not attack:
--   * default PUBLIC EXECUTE on newly created public functions
--   * anon / member EXECUTE on NFC provision
--   * authenticated EXECUTE on service-only Text Request RPCs
--   * Data API column grants on text_requests (phone/message ciphertext)
--   * Data API column grants on review_stands (token ciphertext)
--   * infrastructure tables (outbox, webhook inbox, phone opt-out)
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

select plan(41);

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
    ('91000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'atk-owner@test.com', '', now(), now()),
    ('91000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'atk-admin@test.com', '', now(), now()),
    ('91000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'atk-member@test.com', '', now(), now()),
    ('91000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'atk-viewer@test.com', '', now(), now()),
    ('91000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'atk-outsider@test.com', '', now(), now());

insert into public.organizations (id, name, slug)
values
    ('92000000-0000-0000-0000-00000000000a', 'Attack Org A', 'attack-org-a'),
    ('92000000-0000-0000-0000-00000000000b', 'Attack Org B', 'attack-org-b');

insert into public.organization_members (org_id, user_id, role, status)
values
    ('92000000-0000-0000-0000-00000000000a', '91000000-0000-0000-0000-000000000001', 'owner', 'active'),
    ('92000000-0000-0000-0000-00000000000a', '91000000-0000-0000-0000-000000000002', 'admin', 'active'),
    ('92000000-0000-0000-0000-00000000000a', '91000000-0000-0000-0000-000000000003', 'member', 'active'),
    ('92000000-0000-0000-0000-00000000000a', '91000000-0000-0000-0000-000000000004', 'viewer', 'active'),
    ('92000000-0000-0000-0000-00000000000b', '91000000-0000-0000-0000-000000000005', 'owner', 'active');

insert into public.locations (id, org_id, name)
values ('93000000-0000-0000-0000-00000000000a', '92000000-0000-0000-0000-00000000000a', 'Attack Location');

insert into public.review_stands (
    id, org_id, location_id, public_token_hash, public_token_prefix,
    public_token_encrypted, token_encryption_key_version, label)
values (
    '94000000-0000-0000-0000-00000000000a',
    '92000000-0000-0000-0000-00000000000a',
    '93000000-0000-0000-0000-00000000000a',
    'attack-stand-hash-000000000000000000000000000000',
    'atkpfx01',
    'v1:enc-stand-token-ciphertext',
    1,
    'Attack Stand');

insert into public.text_requests (
    id, org_id, location_id, stand_id,
    recipient_phone_hash, recipient_phone_encrypted, recipient_last_four,
    message_encrypted, encoding, unit_count, segments, dedupe_key)
values (
    '95000000-0000-0000-0000-00000000000a',
    '92000000-0000-0000-0000-00000000000a',
    '93000000-0000-0000-0000-00000000000a',
    '94000000-0000-0000-0000-00000000000a',
    repeat('a', 64),
    'v1:enc-phone',
    '4242',
    'v1:enc-message-with-stand-token',
    'gsm7', 40, 1, 'attack-dedupe-key');

-- ============================================================
-- 1. DEFAULT PUBLIC EXECUTE — new functions must not inherit it
-- ============================================================
-- Postgres grants EXECUTE to PUBLIC on every new function. The NFC
-- provision RPC shipped that way. Default privileges must close it so
-- the next CREATE FUNCTION does not reopen /rest/v1/rpc/* to anon.

create function public._probe_default_execute() returns integer
language sql as $$ select 1; $$;

select ok(
    not has_function_privilege('anon', 'public._probe_default_execute()', 'EXECUTE'),
    'a newly created public function is not executable by anon');

select ok(
    not has_function_privilege('authenticated', 'public._probe_default_execute()', 'EXECUTE'),
    'a newly created public function is not executable by authenticated');

select ok(
    not has_function_privilege('public', 'public._probe_default_execute()', 'EXECUTE'),
    'a newly created public function is not executable by PUBLIC');

drop function public._probe_default_execute();

-- ============================================================
-- 2. NFC PROVISION — grants and real-role attacks
-- ============================================================

select ok(
    not has_function_privilege(
        'anon',
        'public.rpc_record_nfc_provision(uuid, uuid, text)',
        'EXECUTE'),
    'anon has no EXECUTE on rpc_record_nfc_provision');

select ok(
    not has_function_privilege(
        'public',
        'public.rpc_record_nfc_provision(uuid, uuid, text)',
        'EXECUTE'),
    'PUBLIC has no EXECUTE on rpc_record_nfc_provision');

select ok(
    has_function_privilege(
        'authenticated',
        'public.rpc_record_nfc_provision(uuid, uuid, text)',
        'EXECUTE'),
    'authenticated retains EXECUTE on rpc_record_nfc_provision');

select tests.set_anonymous();

select throws_ok(
    $$ select public.rpc_record_nfc_provision(
        '94000000-0000-0000-0000-00000000000a',
        '92000000-0000-0000-0000-00000000000a',
        'anon-nfc') $$,
    '42501', null,
    'anon cannot reach rpc_record_nfc_provision');

select tests.set_actor('91000000-0000-0000-0000-000000000003'); -- member

select throws_ok(
    $$ select public.rpc_record_nfc_provision(
        '94000000-0000-0000-0000-00000000000a',
        '92000000-0000-0000-0000-00000000000a',
        'member-nfc') $$,
    'P0001', null,
    'member cannot record NFC provision');

select tests.set_actor('91000000-0000-0000-0000-000000000004'); -- viewer

select throws_ok(
    $$ select public.rpc_record_nfc_provision(
        '94000000-0000-0000-0000-00000000000a',
        '92000000-0000-0000-0000-00000000000a',
        'viewer-nfc') $$,
    'P0001', null,
    'viewer cannot record NFC provision');

select tests.set_actor('91000000-0000-0000-0000-000000000005'); -- outsider

select throws_ok(
    $$ select public.rpc_record_nfc_provision(
        '94000000-0000-0000-0000-00000000000a',
        '92000000-0000-0000-0000-00000000000a',
        'outsider-nfc') $$,
    'P0001', null,
    'outsider cannot record NFC provision on another org');

select tests.set_actor('91000000-0000-0000-0000-000000000001'); -- owner

select lives_ok(
    $$ select public.rpc_record_nfc_provision(
        '94000000-0000-0000-0000-00000000000a',
        '92000000-0000-0000-0000-00000000000a',
        'owner-nfc') $$,
    'owner can record NFC provision');

-- ============================================================
-- 3. TEXT REQUEST SERVICE RPCs — authenticated must not execute
-- ============================================================
-- rpc_schedule_text_request takes p_actor_user. If authenticated can
-- call it, any signed-in user can impersonate an owner and under-reserve
-- quota with a forged segment count.

select ok(
    not has_function_privilege(
        'authenticated',
        'public.rpc_schedule_text_request(uuid, uuid, uuid, uuid, text, text, smallint, text, text, smallint, text, integer, integer, bigint, character, text, timestamptz, text, text)',
        'EXECUTE'),
    'authenticated has no EXECUTE on rpc_schedule_text_request');

select ok(
    not has_function_privilege(
        'anon',
        'public.rpc_schedule_text_request(uuid, uuid, uuid, uuid, text, text, smallint, text, text, smallint, text, integer, integer, bigint, character, text, timestamptz, text, text)',
        'EXECUTE'),
    'anon has no EXECUTE on rpc_schedule_text_request');

select ok(
    not has_function_privilege(
        'authenticated',
        'public.rpc_sms_settle_attempt(uuid, uuid, text, text, text, jsonb)',
        'EXECUTE'),
    'authenticated has no EXECUTE on rpc_sms_settle_attempt');

select ok(
    not has_function_privilege(
        'authenticated',
        'public.rpc_sms_quota_allocate(uuid, bigint, text, timestamptz, text)',
        'EXECUTE'),
    'authenticated has no EXECUTE on rpc_sms_quota_allocate');

select ok(
    not has_function_privilege(
        'authenticated',
        'public.rpc_sms_claim_outbox(text, integer, integer, text)',
        'EXECUTE'),
    'authenticated has no EXECUTE on rpc_sms_claim_outbox');

select ok(
    not has_function_privilege(
        'authenticated',
        'public.rpc_sms_record_consent(uuid, text, text, smallint, text, public.sms_consent_purpose, public.sms_consent_status, public.sms_consent_source, uuid, jsonb, timestamptz)',
        'EXECUTE'),
    'authenticated has no EXECUTE on rpc_sms_record_consent');

select tests.set_actor('91000000-0000-0000-0000-000000000001');

select throws_ok(
    $$ select public.rpc_schedule_text_request(
        '92000000-0000-0000-0000-00000000000a',
        '91000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-00000000000a',
        '94000000-0000-0000-0000-00000000000a',
        repeat('b', 64), 'v1:x', 1::smallint, '0000',
        'v1:msg', 1::smallint, 'gsm7', 1, 1, 0, 'USD',
        'UTC', now(), 'forged-dedupe', 'forged-req') $$,
    '42501', null,
    'owner cannot invoke rpc_schedule_text_request (service-role only)');

-- ============================================================
-- 4. TEXT REQUESTS — column grants (Data API bypass of the list API)
-- ============================================================
-- The list API exposes last_four / status / schedule. Table-wide SELECT
-- also handed members the phone hash, phone ciphertext, and the encrypted
-- message (which contains the stand token). Column grants must match the
-- API, the way praise hides response_id.

select tests.set_actor('91000000-0000-0000-0000-000000000003'); -- member

select throws_ok(
    $$ select message_encrypted from public.text_requests $$,
    '42501', null,
    'member cannot select text_requests.message_encrypted');

select throws_ok(
    $$ select recipient_phone_encrypted from public.text_requests $$,
    '42501', null,
    'member cannot select text_requests.recipient_phone_encrypted');

select throws_ok(
    $$ select recipient_phone_hash from public.text_requests $$,
    '42501', null,
    'member cannot select text_requests.recipient_phone_hash');

select throws_ok(
    $$ select * from public.text_requests $$,
    '42501', null,
    'member cannot SELECT * on text_requests');

select tests.set_actor('91000000-0000-0000-0000-000000000001'); -- owner

select throws_ok(
    $$ select message_encrypted from public.text_requests $$,
    '42501', null,
    'owner cannot select message_encrypted through the Data API either');

select tests.set_actor('91000000-0000-0000-0000-000000000003'); -- member

select results_eq(
    $$ select recipient_last_four from public.text_requests
       where id = '95000000-0000-0000-0000-00000000000a' $$,
    array['4242'],
    'member can still read last-four (the list API column)');

select results_eq(
    $$ select status::text from public.text_requests
       where id = '95000000-0000-0000-0000-00000000000a' $$,
    array['scheduled'],
    'member can still read text_requests.status');

select tests.set_actor('91000000-0000-0000-0000-000000000005'); -- outsider

select is_empty(
    $$ select id from public.text_requests $$,
    'outsider sees no text_requests via safe columns');

select tests.set_anonymous();

select throws_ok(
    $$ select id from public.text_requests $$,
    '42501', null,
    'anon has no SELECT on text_requests');

-- ============================================================
-- 5. STAND TOKENS — ciphertext is RPC-only
-- ============================================================

select tests.set_actor('91000000-0000-0000-0000-000000000003'); -- member

select throws_ok(
    $$ select public_token_encrypted from public.review_stands $$,
    '42501', null,
    'member cannot select review_stands.public_token_encrypted');

select throws_ok(
    $$ select * from public.review_stands $$,
    '42501', null,
    'member cannot SELECT * on review_stands');

select results_eq(
    $$ select public_token_prefix from public.review_stands
       where id = '94000000-0000-0000-0000-00000000000a' $$,
    array['atkpfx01'],
    'member can still read the display prefix');

select lives_ok(
    $$ select id from public.review_stands
       where public_token_hash = 'attack-stand-hash-000000000000000000000000000000' $$,
    'member can still look up a stand by token hash (SMS resolve path)');

select throws_ok(
    $$ select * from public.rpc_get_stand_token_ciphertext(
        '94000000-0000-0000-0000-00000000000a',
        '92000000-0000-0000-0000-00000000000a') $$,
    'P0001', null,
    'member cannot read stand token ciphertext via RPC');

select tests.set_actor('91000000-0000-0000-0000-000000000005'); -- outsider

select throws_ok(
    $$ select * from public.rpc_get_stand_token_ciphertext(
        '94000000-0000-0000-0000-00000000000a',
        '92000000-0000-0000-0000-00000000000a') $$,
    'P0001', null,
    'outsider cannot read another org''s stand token ciphertext');

select tests.set_actor('91000000-0000-0000-0000-000000000001'); -- owner

select results_eq(
    $$ select token_ciphertext from public.rpc_get_stand_token_ciphertext(
        '94000000-0000-0000-0000-00000000000a',
        '92000000-0000-0000-0000-00000000000a') $$,
    array['v1:enc-stand-token-ciphertext'],
    'owner reads stand token ciphertext via the reprint RPC');

select tests.set_anonymous();

select throws_ok(
    $$ select public_token_prefix from public.review_stands $$,
    '42501', null,
    'anon has no SELECT on review_stands');

-- ============================================================
-- 6. INFRASTRUCTURE TABLES — no client privilege
-- ============================================================

select tests.set_actor('91000000-0000-0000-0000-000000000001'); -- owner

select throws_ok(
    $$ select id from public.sms_outbox $$,
    '42501', null,
    'authenticated cannot select sms_outbox');

select throws_ok(
    $$ select id from public.sms_webhook_inbox $$,
    '42501', null,
    'authenticated cannot select sms_webhook_inbox');

select throws_ok(
    $$ select phone_hash from public.sms_phone_optout $$,
    '42501', null,
    'authenticated cannot select sms_phone_optout');

select throws_ok(
    $$ insert into public.text_requests
        (org_id, location_id, stand_id, recipient_phone_hash,
         message_encrypted, encoding, unit_count, segments, dedupe_key)
       values (
        '92000000-0000-0000-0000-00000000000a',
        '93000000-0000-0000-0000-00000000000a',
        '94000000-0000-0000-0000-00000000000a',
        repeat('c', 64), 'v1:x', 'gsm7', 1, 1, 'direct-insert') $$,
    '42501', null,
    'authenticated cannot insert text_requests directly');

select throws_ok(
    $$ update public.text_requests
       set status = 'delivered'
       where id = '95000000-0000-0000-0000-00000000000a' $$,
    '42501', null,
    'authenticated cannot update text_requests directly');

select throws_ok(
    $$ truncate public.text_requests $$,
    '42501', null,
    'authenticated cannot TRUNCATE text_requests');

-- ============================================================

select * from finish();

rollback;
