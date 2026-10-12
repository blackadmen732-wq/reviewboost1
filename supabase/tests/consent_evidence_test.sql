-- Owner consent must carry evidence.
--
-- The composer used to record an owner_import opt-in with empty evidence on
-- every send. These tests prove that the database now refuses such a row, that
-- an attested opt-in is accepted and lets the gate say yes, that historical
-- unevidenced opt-ins are reset to `unknown` (appended, never deleted), and
-- that the reset leaves a customer's own START, a STOP, and an attested
-- opt-in alone.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

insert into public.organizations (id, name, slug)
values ('8c000000-0000-0000-0000-00000000000a', 'Evidence Org', 'evidence-org');

-- ------------------------------------------------ the constraint ---------

select throws_ok(
    $$ select app.sms_record_consent('8c000000-0000-0000-0000-00000000000a', repeat('a', 64),
        'v1:enc', 1::smallint, '1001', 'review_request', 'opted_in', 'owner_import', null,
        '{}'::jsonb, now()) $$,
    '23514', NULL,
    'an owner opt-in with no evidence is refused');

select throws_ok(
    $$ select app.sms_record_consent('8c000000-0000-0000-0000-00000000000a', repeat('a', 64),
        'v1:enc', 1::smallint, '1001', 'review_request', 'opted_in', 'owner_import', null,
        '{"method":"in_person","attested_by":"u"}'::jsonb, now()) $$,
    '23514', NULL,
    'an owner opt-in missing the wording version is refused');

select lives_ok(
    $$ select app.sms_record_consent('8c000000-0000-0000-0000-00000000000a', repeat('b', 64),
        'v1:enc', 1::smallint, '1002', 'review_request', 'opted_in', 'owner_import', null,
        '{"method":"in_person","attested_by":"u","wording_version":"owner-attestation-v1"}'::jsonb, now()) $$,
    'an attested owner opt-in is accepted');

select is(
    (select allowed from app.sms_can_send('8c000000-0000-0000-0000-00000000000a', repeat('b', 64))),
    true, 'an attested opt-in lets the gate say yes');

select lives_ok(
    $$ select app.sms_record_consent('8c000000-0000-0000-0000-00000000000a', repeat('c', 64),
        null, 1::smallint, null, 'review_request', 'opted_out', 'owner_import', null,
        '{}'::jsonb, now()) $$,
    'an owner recording an opt-out needs no evidence');

select is(
    (select reason from app.sms_can_send('8c000000-0000-0000-0000-00000000000a', repeat('d', 64))),
    'no_consent', 'a number with nothing recorded is refused as no_consent');

-- ---------------------------------------------------- the reset ----------

-- Recreate the state the old composer left behind: lift the constraint inside
-- this transaction, write the opt-ins it used to write, and put it back.
alter table public.sms_consent_events drop constraint sms_consent_events_owner_import_evidence;

select app.sms_record_consent('8c000000-0000-0000-0000-00000000000a', repeat('e', 64),
    'v1:enc', 1::smallint, '1005', 'review_request', 'opted_in', 'owner_import', null,
    '{}'::jsonb, now() - interval '2 days');
select app.sms_record_consent('8c000000-0000-0000-0000-00000000000a', repeat('f', 64),
    'v1:enc', 1::smallint, '1006', 'review_request', 'opted_in', 'owner_import', null,
    '{}'::jsonb, now() - interval '2 days');
-- f later replied START itself: its own opt-in, which the reset must keep.
select app.sms_record_consent('8c000000-0000-0000-0000-00000000000a', repeat('f', 64),
    null, 1::smallint, null, 'review_request', 'opted_in', 'reply_start', null,
    '{"keyword":"START"}'::jsonb, now() - interval '1 day');

alter table public.sms_consent_events
    add constraint sms_consent_events_owner_import_evidence
    check (
        source <> 'owner_import'
        or status <> 'opted_in'
        or (evidence ? 'method' and evidence ? 'attested_by' and evidence ? 'wording_version')
    ) not valid;

select is(
    (select allowed from app.sms_can_send('8c000000-0000-0000-0000-00000000000a', repeat('e', 64))),
    true, 'before the reset, an unevidenced opt-in is (wrongly) allowed');

select is(app.sms_reset_unevidenced_owner_consent(), 1,
    'the reset touches exactly the one unevidenced owner opt-in');

select is(
    (select status::text from public.sms_consent_state
      where org_id = '8c000000-0000-0000-0000-00000000000a' and phone_hash = repeat('e', 64)),
    'unknown', 'the unevidenced opt-in is now unknown');

select is(
    (select reason from app.sms_can_send('8c000000-0000-0000-0000-00000000000a', repeat('e', 64))),
    'no_consent', 'and the gate refuses it as no_consent');

select is(
    (select count(*)::integer from public.sms_consent_events
      where org_id = '8c000000-0000-0000-0000-00000000000a' and phone_hash = repeat('e', 64)),
    2, 'the original event is kept and the reset is appended');

select is(
    (select evidence->>'reason' from public.sms_consent_events
      where org_id = '8c000000-0000-0000-0000-00000000000a' and phone_hash = repeat('e', 64)
        and source = 'admin'),
    'consent_without_evidence_reset', 'the reset says why in its evidence');

select is(
    (select status::text || '/' || source::text from public.sms_consent_state
      where org_id = '8c000000-0000-0000-0000-00000000000a' and phone_hash = repeat('f', 64)),
    'opted_in/reply_start', 'a customer''s own START is left alone');

select is(app.sms_reset_unevidenced_owner_consent(), 0,
    'running the reset again changes nothing');

select * from finish();
rollback;
