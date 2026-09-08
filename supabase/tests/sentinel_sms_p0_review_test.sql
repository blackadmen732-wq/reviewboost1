-- SENTINEL isolated P0 review for PR #47 head 64e76371f4dd9c6b528139ba3cb7bdd8b3a4ed4b.
-- Synthetic orgs only. No product fix.
--
-- FIFO assertions encode the SECURE contract and are expected to FAIL on this
-- SHA (available must be 0, not -30). FORGE owns the fix.

begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

-- ========================= P0-2 FIFO stale prior-capacity =================

insert into public.organizations (id, name, slug)
values ('a1000000-0000-0000-0000-0000000000f1', 'SENTINEL FIFO Org', 'sentinel-fifo-p0');

select app.sms_quota_allocate(
    'a1000000-0000-0000-0000-0000000000f1', 100, 'sentinel-fifo-grant-a',
    now() - interval '1 second', 'expired unused grant');
select app.sms_quota_apply_expirations('a1000000-0000-0000-0000-0000000000f1');
select app.sms_quota_allocate(
    'a1000000-0000-0000-0000-0000000000f1', 50, 'sentinel-fifo-grant-b',
    null, 'live grant that backs the reservation');
select app.sms_quota_reserve(
    'a1000000-0000-0000-0000-0000000000f1', 30, 'sentinel-fifo-resv-1', null);

update public.sms_quota_ledger
   set effective_at = now() - interval '10 seconds'
 where org_id = 'a1000000-0000-0000-0000-0000000000f1'
   and kind = 'allocation'
   and correlation_key = 'sentinel-fifo-grant-a';
update public.sms_quota_ledger
   set effective_at = now() - interval '5 seconds'
 where org_id = 'a1000000-0000-0000-0000-0000000000f1'
   and kind = 'allocation'
   and correlation_key = 'sentinel-fifo-grant-b';

update public.sms_quota_ledger
   set expires_at = now() - interval '1 second'
 where org_id = 'a1000000-0000-0000-0000-0000000000f1'
   and kind = 'allocation'
   and correlation_key = 'sentinel-fifo-grant-b';

select app.sms_quota_apply_expirations('a1000000-0000-0000-0000-0000000000f1');

-- Secure expectation. On 64e76371 this SHA reports fifo_used=0, expire=50,
-- available=-30 (allocated=0, reserved=30).
select is(
    app.sms_quota_fifo_used(
        'a1000000-0000-0000-0000-0000000000f1',
        (select id from public.sms_quota_ledger
          where org_id = 'a1000000-0000-0000-0000-0000000000f1'
            and kind = 'allocation'
            and correlation_key = 'sentinel-fifo-grant-b')),
    30::bigint,
    'secure: later grant absorbs the reservation made after grant A expired');

select is(
    (select e.amount from public.sms_quota_ledger a
       join public.sms_quota_ledger e
         on e.org_id = a.org_id and e.kind = 'expiration'
        and e.correlation_key = 'expire:' || a.id::text
      where a.org_id = 'a1000000-0000-0000-0000-0000000000f1'
        and a.kind = 'allocation' and a.correlation_key = 'sentinel-fifo-grant-b'),
    20::bigint,
    'secure: expire only unused remainder of the live grant (50-30)');

select is(
    app.sms_quota_available('a1000000-0000-0000-0000-0000000000f1'),
    0::bigint,
    'secure: available is never negative (64e76371 observes -30)');

-- ========================= Residual: SID reuse on attach ==================

insert into public.organizations (id, name, slug)
values ('a1000000-0000-0000-0000-0000000000f2', 'SENTINEL SID Org', 'sentinel-sid-p0');

insert into public.locations (id, org_id, name, timezone)
values ('a1000000-0000-0000-0000-0000000000d2', 'a1000000-0000-0000-0000-0000000000f2',
        'SENTINEL Loc', 'UTC');

insert into public.review_stands (id, org_id, location_id, public_token_hash, public_token_prefix, label)
values ('a1000000-0000-0000-0000-0000000000e2', 'a1000000-0000-0000-0000-0000000000f2',
        'a1000000-0000-0000-0000-0000000000d2',
        'sentinelstandhash000000000000000001', 'sentin1', 'SENTINEL Stand');

select app.sms_quota_allocate(
    'a1000000-0000-0000-0000-0000000000f2', 10, 'sentinel-sid-alloc', null, null);

insert into public.text_requests
    (id, org_id, location_id, stand_id, recipient_phone_hash, message_encrypted,
     encoding, unit_count, segments, reserved_quota, status, dedupe_key)
values
    ('a1000000-0000-0000-0000-0000000000c1', 'a1000000-0000-0000-0000-0000000000f2',
     'a1000000-0000-0000-0000-0000000000d2', 'a1000000-0000-0000-0000-0000000000e2',
     repeat('c', 64), 'v1:enc-a', 'gsm7', 40, 1, 1, 'provider_unknown', 'sentinel-sid-a'),
    ('a1000000-0000-0000-0000-0000000000c2', 'a1000000-0000-0000-0000-0000000000f2',
     'a1000000-0000-0000-0000-0000000000d2', 'a1000000-0000-0000-0000-0000000000e2',
     repeat('c', 64), 'v1:enc-b', 'gsm7', 40, 1, 1, 'provider_unknown', 'sentinel-sid-b');

insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id)
values
    ('a1000000-0000-0000-0000-0000000000f2', 'reservation', 1, 'req:a1000000-0000-0000-0000-0000000000c1',
     'a1000000-0000-0000-0000-0000000000c1'),
    ('a1000000-0000-0000-0000-0000000000f2', 'reservation', 1, 'req:a1000000-0000-0000-0000-0000000000c2',
     'a1000000-0000-0000-0000-0000000000c2');

update public.sms_quota_balance
   set reserved = 2
 where org_id = 'a1000000-0000-0000-0000-0000000000f2';

insert into public.sms_delivery_attempts
    (id, org_id, request_id, attempt_number, provider, provider_message_id, status, reconciliation_state)
values
    ('a1000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-0000000000f2',
     'a1000000-0000-0000-0000-0000000000c1', 1, 'twilio', 'SM_OWNED_BY_A', 'submitted', 'reconciled'),
    ('a1000000-0000-0000-0000-0000000000a2', 'a1000000-0000-0000-0000-0000000000f2',
     'a1000000-0000-0000-0000-0000000000c2', 1, 'twilio', null, 'provider_unknown', 'unresolved');

select is(
    app.sms_reconcile_attach_sid(
        'a1000000-0000-0000-0000-0000000000a2',
        'a1000000-0000-0000-0000-0000000000f2',
        'SM_OWNED_BY_A',
        'delivered',
        null),
    'delivered',
    'SENTINEL residual: attach_sid binds a SID already owned by another attempt');

select is(
    (select count(*)::integer from public.sms_delivery_attempts
      where provider = 'twilio' and provider_message_id = 'SM_OWNED_BY_A'),
    2,
    'SENTINEL residual: two attempts share SM_OWNED_BY_A (no unique SID index)');

select is(
    (select indexname from pg_indexes
      where schemaname = 'public'
        and tablename = 'sms_delivery_attempts'
        and indexdef ilike '%unique%'
        and indexdef ilike '%provider_message_id%'),
    null,
    'SENTINEL residual: no unique index on (provider, provider_message_id)');

select * from finish();
rollback;
