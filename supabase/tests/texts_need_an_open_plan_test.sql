-- A text goes out only while the business is open for customers.
--
-- Before 20261115000200 the send gate checked only the customer, so a business
-- whose plan had lapsed kept texting on credit it still held, and a text queued
-- before a cancellation was still sent and charged. The gate is shared by the
-- preview, the contact picker, scheduling and the worker, so these cases ask
-- it directly and then walk one queued text through dispatch.
--
-- Cases 2, 3, 4 and 6 to 12 fail against the previous gate.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

-- ------------------------------------------------------------- helpers ------

-- Midday somewhere right now, so dispatch's quiet-hours recheck always allows
-- a send (the same device `text_requests_test.sql` uses). Etc/GMT is inverted.
create or replace function pg_temp.noon_zone() returns text
language sql stable as $$
    select case
        when (12 - extract(hour from now())::int) = 0 then 'UTC'
        when (12 - extract(hour from now())::int) > 0
            then 'Etc/GMT-' || (12 - extract(hour from now())::int)::text
        else 'Etc/GMT+' || abs(12 - extract(hour from now())::int)::text
    end;
$$;

create or replace function pg_temp.gate(p_org uuid) returns text
language sql as $$
    select case when g.allowed then 'allowed' else g.reason end
      from app.sms_can_send(p_org, repeat('9', 64), 'review_request') g;
$$;

-- ------------------------------------------------------------- fixtures -----

select set_config('role', 'postgres', true);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('00000000-5e1d-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'owner@opentexts.test', 'x', now(), now());

-- P paid; C cancelled; N never subscribed; X trial long over; D payment late.
insert into public.organizations (id, name, slug)
values
    ('00000000-5e1d-0000-0000-000000000001', 'Paid',      'opentexts-paid'),
    ('00000000-5e1d-0000-0000-000000000002', 'Cancelled', 'opentexts-cancelled'),
    ('00000000-5e1d-0000-0000-000000000003', 'New',       'opentexts-new'),
    ('00000000-5e1d-0000-0000-000000000004', 'Trial over','opentexts-trial-over'),
    ('00000000-5e1d-0000-0000-000000000005', 'Late',      'opentexts-late');

insert into public.organization_members (org_id, user_id, role, status)
select o, '00000000-5e1d-0000-0000-0000000000a1', 'owner', 'active'
  from unnest(array['00000000-5e1d-0000-0000-000000000001',
                    '00000000-5e1d-0000-0000-000000000002',
                    '00000000-5e1d-0000-0000-000000000003',
                    '00000000-5e1d-0000-0000-000000000004',
                    '00000000-5e1d-0000-0000-000000000005']::uuid[]) as o;

update public.entitlement_snapshots set plan_id = 'starter', status = 'active', source = 'test'
 where org_id = '00000000-5e1d-0000-0000-000000000001';
update public.entitlement_snapshots set plan_id = 'starter', status = 'cancelled', source = 'test'
 where org_id = '00000000-5e1d-0000-0000-000000000002';
update public.entitlement_snapshots
   set plan_id = 'starter', status = 'trialing', trial_ends_at = now() - interval '5 days', source = 'test'
 where org_id = '00000000-5e1d-0000-0000-000000000004';
update public.entitlement_snapshots set plan_id = 'starter', status = 'past_due', source = 'test'
 where org_id = '00000000-5e1d-0000-0000-000000000005';

-- The same customer agreed to texts from every one of them, so only the
-- business differs.
select app.sms_record_consent(o, repeat('9', 64),
    'v1:enc', 1::smallint, '9999', 'review_request', 'opted_in', 'owner_import', null,
    '{"method":"in_person","attested_by":"test","wording_version":"owner-attestation-v1"}'::jsonb, now())
  from unnest(array['00000000-5e1d-0000-0000-000000000001',
                    '00000000-5e1d-0000-0000-000000000002',
                    '00000000-5e1d-0000-0000-000000000003',
                    '00000000-5e1d-0000-0000-000000000004',
                    '00000000-5e1d-0000-0000-000000000005']::uuid[]) as o;

insert into public.locations (id, org_id, name, timezone)
values ('00000000-5e1d-0000-0000-000000000011', '00000000-5e1d-0000-0000-000000000001', 'Main', 'UTC');

insert into public.review_stands (id, org_id, location_id, public_token_hash, public_token_prefix, label)
values ('00000000-5e1d-0000-0000-000000000021', '00000000-5e1d-0000-0000-000000000001',
        '00000000-5e1d-0000-0000-000000000011', 'opentexts-stand-hash-000000000000', 'opntxt01', 'Counter');

-- ----------------------------------------------------- the gate, by plan ----

-- 1
select is(pg_temp.gate('00000000-5e1d-0000-0000-000000000001'), 'allowed',
    'a paid business may text a customer who agreed');

-- 2
select is(pg_temp.gate('00000000-5e1d-0000-0000-000000000002'), 'plan_inactive',
    'a cancelled business may not, whatever credit it still holds');

-- 3
select is(pg_temp.gate('00000000-5e1d-0000-0000-000000000003'), 'plan_inactive',
    'a business that never subscribed may not');

-- 4
select is(pg_temp.gate('00000000-5e1d-0000-0000-000000000004'), 'plan_inactive',
    'a trial that has ended does not keep texting');

-- 5
select is(pg_temp.gate('00000000-5e1d-0000-0000-000000000005'), 'allowed',
    'a late payment is in its grace period, the same as its Tags');

-- 6
select is(
    (select g.reason from app.sms_can_send('00000000-5e1d-0000-0000-000000000099', repeat('9', 64), 'review_request') g),
    'plan_inactive',
    'a business with no entitlement at all is closed, never a default');

-- 7
select is(
    (select count(*)::integer
       from public.rpc_sms_can_send_many('00000000-5e1d-0000-0000-000000000002',
                                         array[repeat('9', 64), repeat('8', 64)], 'review_request') m
      where not m.allowed and m.reason = 'plan_inactive'),
    2,
    'the contact picker shows every number as blocked by the plan');

-- ------------------------------- a text queued before the plan lapsed -------

select app.sms_quota_allocate('00000000-5e1d-0000-0000-000000000001', 10, 'opentexts-alloc', null, null);

select app.sms_schedule_request(
    '00000000-5e1d-0000-0000-000000000001', '00000000-5e1d-0000-0000-000000000011',
    '00000000-5e1d-0000-0000-000000000021',
    repeat('9', 64), 'v1:enc', 1::smallint, '9999', 'v1:msg', 1::smallint, 'gsm7', 40, 1, 7500, 'USD',
    pg_temp.noon_zone(), now(), 'opentexts-queued', '00000000-5e1d-0000-0000-0000000000a1', 'req-opentexts');

-- The owner cancels before the worker gets to it.
update public.entitlement_snapshots set status = 'cancelled'
 where org_id = '00000000-5e1d-0000-0000-000000000001';

-- 8
select is(
    (select outcome from app.sms_begin_dispatch(
        (select id from public.text_requests where dedupe_key = 'opentexts-queued'),
        '00000000-5e1d-0000-0000-000000000001', 'fake')),
    'suppressed',
    'the worker does not send it');

-- 9
select is(
    (select status::text from public.text_requests where dedupe_key = 'opentexts-queued'),
    'suppressed',
    'the text ends suppressed');

-- 10
select is(
    (select suppressed_reason from public.text_requests where dedupe_key = 'opentexts-queued'),
    'plan_inactive',
    'and says why');

-- 11
select is(app.sms_quota_available('00000000-5e1d-0000-0000-000000000001'), 10::bigint,
    'its credit is given back: the owner is not charged for a text that was not sent');

-- 12
select is(
    (select count(*)::integer from public.sms_delivery_attempts a
       join public.text_requests tr on tr.id = a.request_id
      where tr.dedupe_key = 'opentexts-queued'),
    0,
    'and the provider was never called');

select * from finish();

rollback;
