-- Isolated fixtures for the two-session SID-claim race.
-- Fake provider SIDs only. Safe to re-run.

begin;

delete from public.sms_quota_ledger where org_id = 'c1000000-0000-0000-0000-00000000000a';
delete from public.sms_quota_balance where org_id = 'c1000000-0000-0000-0000-00000000000a';
delete from public.organizations where id = 'c1000000-0000-0000-0000-00000000000a';
delete from auth.users where id = 'b1000000-0000-0000-0000-000000000001';

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values (
    'b1000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'sms-prove@test.com', '', now(), now());

insert into public.organizations (id, name, slug)
values ('c1000000-0000-0000-0000-00000000000a', 'SMS Prove Org', 'sms-prove-org');

insert into public.organization_members (org_id, user_id, role, status)
values ('c1000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000001', 'owner', 'active');

insert into public.locations (id, org_id, name, timezone)
values ('d1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a', 'Prove Loc', 'UTC');

insert into public.review_stands (id, org_id, location_id, public_token_hash, public_token_prefix, label)
values (
    'e1000000-0000-0000-0000-00000000000a',
    'c1000000-0000-0000-0000-00000000000a',
    'd1000000-0000-0000-0000-00000000000a',
    'smsprovehash0000000000000000000000',
    'smsprove1',
    'Prove Stand');

select app.sms_quota_allocate('c1000000-0000-0000-0000-00000000000a', 20, 'sms-prove-alloc-1', null, null);

select app.sms_record_consent(
    'c1000000-0000-0000-0000-00000000000a', repeat('p', 64),
    'v1:enc', 1::smallint, '1717', 'review_request', 'opted_in', 'owner_import',
    null, '{}'::jsonb, now());
select app.sms_record_consent(
    'c1000000-0000-0000-0000-00000000000a', repeat('q', 64),
    'v1:enc', 1::smallint, '1818', 'review_request', 'opted_in', 'owner_import',
    null, '{}'::jsonb, now());

-- Quiet-hours-safe zone: local hour ~12 (Etc/GMT signs are inverted).
select app.sms_schedule_request(
    'c1000000-0000-0000-0000-00000000000a',
    'd1000000-0000-0000-0000-00000000000a',
    'e1000000-0000-0000-0000-00000000000a',
    repeat('p', 64), 'v1:enc', 1::smallint, '1717', 'v1:msg', 1::smallint,
    'gsm7', 40, 1, 7500, 'USD',
    case
        when (12 - extract(hour from now())::int) = 0 then 'UTC'
        when (12 - extract(hour from now())::int) > 0
            then 'Etc/GMT-' || (12 - extract(hour from now())::int)::text
        else 'Etc/GMT+' || abs(12 - extract(hour from now())::int)::text
    end,
    now(),
    'sms-prove-race-a', 'b1000000-0000-0000-0000-000000000001', 'req-prove-a');
select app.sms_schedule_request(
    'c1000000-0000-0000-0000-00000000000a',
    'd1000000-0000-0000-0000-00000000000a',
    'e1000000-0000-0000-0000-00000000000a',
    repeat('q', 64), 'v1:enc', 1::smallint, '1818', 'v1:msg', 1::smallint,
    'gsm7', 40, 1, 7500, 'USD',
    case
        when (12 - extract(hour from now())::int) = 0 then 'UTC'
        when (12 - extract(hour from now())::int) > 0
            then 'Etc/GMT-' || (12 - extract(hour from now())::int)::text
        else 'Etc/GMT+' || abs(12 - extract(hour from now())::int)::text
    end,
    now(),
    'sms-prove-race-b', 'b1000000-0000-0000-0000-000000000001', 'req-prove-b');

select app.sms_begin_dispatch(
    (select id from public.text_requests where dedupe_key = 'sms-prove-race-a'),
    'c1000000-0000-0000-0000-00000000000a', 'fake');
select app.sms_begin_dispatch(
    (select id from public.text_requests where dedupe_key = 'sms-prove-race-b'),
    'c1000000-0000-0000-0000-00000000000a', 'fake');

select app.sms_settle_attempt(
    (select a.id from public.sms_delivery_attempts a
      join public.text_requests tr on tr.id = a.request_id
     where tr.dedupe_key = 'sms-prove-race-a'
     order by a.attempt_number desc limit 1),
    'c1000000-0000-0000-0000-00000000000a', 'provider_unknown', null, 'timeout', '{}'::jsonb);
select app.sms_settle_attempt(
    (select a.id from public.sms_delivery_attempts a
      join public.text_requests tr on tr.id = a.request_id
     where tr.dedupe_key = 'sms-prove-race-b'
     order by a.attempt_number desc limit 1),
    'c1000000-0000-0000-0000-00000000000a', 'provider_unknown', null, 'timeout', '{}'::jsonb);

drop table if exists public.sms_prove_race;
create table public.sms_prove_race (
    attempt_a uuid not null,
    attempt_b uuid not null,
    org_id    uuid not null
);

insert into public.sms_prove_race (attempt_a, attempt_b, org_id)
select
    (select a.id from public.sms_delivery_attempts a
      join public.text_requests tr on tr.id = a.request_id
     where tr.dedupe_key = 'sms-prove-race-a'
     order by a.attempt_number desc limit 1),
    (select a.id from public.sms_delivery_attempts a
      join public.text_requests tr on tr.id = a.request_id
     where tr.dedupe_key = 'sms-prove-race-b'
     order by a.attempt_number desc limit 1),
    'c1000000-0000-0000-0000-00000000000a';

commit;
