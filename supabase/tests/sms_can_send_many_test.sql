-- The Text Requests picker's status comes from the one texting gate.
--
-- `rpc_sms_can_send_many` must answer exactly what `app.sms_can_send` answers
-- for each number (agreed, never asked, owner-recorded opt-out), must be
-- callable by the service role only, and must refuse an oversized list.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

insert into public.organizations (id, name, slug)
values ('8d000000-0000-0000-0000-00000000000a', 'Picker Org', 'picker-org');

-- b agreed (attested), c opted out, d never asked.
select app.sms_record_consent('8d000000-0000-0000-0000-00000000000a', repeat('b', 64),
    'v1:enc', 1::smallint, '1002', 'review_request', 'opted_in', 'owner_import', null,
    '{"method":"in_person","attested_by":"u","wording_version":"owner-attestation-v1"}'::jsonb, now());
select app.sms_record_consent('8d000000-0000-0000-0000-00000000000a', repeat('c', 64),
    null, 1::smallint, null, 'review_request', 'opted_out', 'owner_import', null,
    '{}'::jsonb, now());

select results_eq(
    $$ select phone_hash, allowed, reason
         from public.rpc_sms_can_send_many('8d000000-0000-0000-0000-00000000000a',
              array[repeat('b', 64), repeat('c', 64), repeat('d', 64)], 'review_request')
        order by phone_hash $$,
    $$ select h, g.allowed, g.reason
         from unnest(array[repeat('b', 64), repeat('c', 64), repeat('d', 64)]) h
         cross join lateral app.sms_can_send('8d000000-0000-0000-0000-00000000000a', h, 'review_request') g
        order by h $$,
    'the batch answers exactly what the single gate answers, number by number');

select is(
    (select allowed from public.rpc_sms_can_send_many('8d000000-0000-0000-0000-00000000000a',
        array[repeat('b', 64)], 'review_request')),
    true, 'an attested agreement can be texted');

select is(
    (select reason from public.rpc_sms_can_send_many('8d000000-0000-0000-0000-00000000000a',
        array[repeat('d', 64)], 'review_request')),
    'no_consent', 'importing someone is not permission: never asked means no_consent');

select is(
    (select count(*)::int from public.rpc_sms_can_send_many('8d000000-0000-0000-0000-00000000000a',
        array[repeat('b', 64), repeat('b', 64)], 'review_request')),
    1, 'a number listed twice is answered once');

select is_empty(
    $$ select * from public.rpc_sms_can_send_many('8d000000-0000-0000-0000-00000000000a',
        array[]::text[], 'review_request') $$,
    'an empty list answers nothing');

select throws_ok(
    $$ select * from public.rpc_sms_can_send_many('8d000000-0000-0000-0000-00000000000a',
        array(select repeat('z', 63) || g::text from generate_series(1, 2001) g)::text[], 'review_request') $$,
    '22023', 'too_many_numbers',
    'more than 2,000 numbers is refused');

select function_privs_are('public', 'rpc_sms_can_send_many',
    array['uuid', 'text[]', 'sms_consent_purpose'], 'authenticated', array[]::text[],
    'a signed-in client cannot call it (it takes an organization id)');

select function_privs_are('public', 'rpc_sms_can_send_many',
    array['uuid', 'text[]', 'sms_consent_purpose'], 'service_role', array['EXECUTE'],
    'the server can');

select * from finish();

rollback;
