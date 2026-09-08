-- SENTINEL isolated reproduction against SHA 64e76371f4dd9c6b528139ba3cb7bdd8b3a4ed4b
-- Synthetic orgs only. Transaction is rolled back.
--
-- P0-2: FIFO prior_capacity still counts expired grants.
-- Residual: attach_sid will bind a SID already owned by another attempt.

begin;

create temporary table sentinel_p0_results (
    finding text not null,
    key     text not null,
    value   text not null
);

-- ---------------------------------------------------------------------------
-- P0-2 FIFO stale prior-capacity (Codex / qodo JUDGE scenario)
-- Expire unused 100, allocate 50, reserve 30, expire the second grant.
-- Secure: second grant used=30, expire 20, available >= 0, allocated >= reserved.
-- ---------------------------------------------------------------------------

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

-- Pin order: expired grant A is strictly older. Equal effective_at lets
-- UUID order hide the stale prior_capacity bug.
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

insert into sentinel_p0_results (finding, key, value)
select 'fifo_stale_prior_capacity', 'grant_b_fifo_used',
       app.sms_quota_fifo_used(
           'a1000000-0000-0000-0000-0000000000f1',
           (select id from public.sms_quota_ledger
             where org_id = 'a1000000-0000-0000-0000-0000000000f1'
               and kind = 'allocation'
               and correlation_key = 'sentinel-fifo-grant-b')
       )::text;

insert into sentinel_p0_results (finding, key, value)
select 'fifo_stale_prior_capacity', 'grant_b_expiration_amount',
       coalesce((
           select e.amount::text
             from public.sms_quota_ledger a
             join public.sms_quota_ledger e
               on e.org_id = a.org_id
              and e.kind = 'expiration'
              and e.correlation_key = 'expire:' || a.id::text
            where a.org_id = 'a1000000-0000-0000-0000-0000000000f1'
              and a.kind = 'allocation'
              and a.correlation_key = 'sentinel-fifo-grant-b'
       ), 'missing');

insert into sentinel_p0_results (finding, key, value)
select 'fifo_stale_prior_capacity', 'available',
       app.sms_quota_available('a1000000-0000-0000-0000-0000000000f1')::text;

insert into sentinel_p0_results (finding, key, value)
select 'fifo_stale_prior_capacity', 'allocated',
       (select allocated::text from public.sms_quota_balance
         where org_id = 'a1000000-0000-0000-0000-0000000000f1');

insert into sentinel_p0_results (finding, key, value)
select 'fifo_stale_prior_capacity', 'reserved',
       (select reserved::text from public.sms_quota_balance
         where org_id = 'a1000000-0000-0000-0000-0000000000f1');

insert into sentinel_p0_results (finding, key, value)
select 'fifo_stale_prior_capacity', 'consumed',
       (select consumed::text from public.sms_quota_balance
         where org_id = 'a1000000-0000-0000-0000-0000000000f1');

insert into sentinel_p0_results (finding, key, value)
values
    ('fifo_stale_prior_capacity', 'secure_grant_b_used', '30'),
    ('fifo_stale_prior_capacity', 'secure_grant_b_expire', '20'),
    ('fifo_stale_prior_capacity', 'secure_available', '0'),
    ('fifo_stale_prior_capacity', 'secure_allocated', '30');

-- ---------------------------------------------------------------------------
-- Residual: attach_sid binds a SID already owned by another attempt
-- ---------------------------------------------------------------------------

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

insert into sentinel_p0_results (finding, key, value)
values ('sid_reuse', 'attach_result',
        app.sms_reconcile_attach_sid(
            'a1000000-0000-0000-0000-0000000000a2',
            'a1000000-0000-0000-0000-0000000000f2',
            'SM_OWNED_BY_A',
            'delivered',
            null));

insert into sentinel_p0_results (finding, key, value)
select 'sid_reuse', 'attempts_sharing_sid',
       count(*)::text
  from public.sms_delivery_attempts
 where provider = 'twilio'
   and provider_message_id = 'SM_OWNED_BY_A';

insert into sentinel_p0_results (finding, key, value)
select 'sid_reuse', 'provider_msg_unique_indexes',
       coalesce((
           select string_agg(indexname, ',')
             from pg_indexes
            where schemaname = 'public'
              and tablename = 'sms_delivery_attempts'
              and indexdef ilike '%unique%'
              and indexdef ilike '%provider_message_id%'
       ), 'none');

insert into sentinel_p0_results (finding, key, value)
values
    ('sid_reuse', 'secure_attach_result', 'sid_conflict'),
    ('sid_reuse', 'secure_attempts_sharing_sid', '1');

-- Verdict rows
insert into sentinel_p0_results (finding, key, value)
select 'fifo_stale_prior_capacity', 'verdict',
       case
           when (select value from sentinel_p0_results where key = 'available')::bigint < 0
             or (select value from sentinel_p0_results where key = 'grant_b_expiration_amount') = '50'
           then 'CONFIRMED'
           else 'REJECTED'
       end;

insert into sentinel_p0_results (finding, key, value)
select 'sid_reuse', 'verdict',
       case
           when (select value from sentinel_p0_results where finding = 'sid_reuse' and key = 'attach_result')
                is distinct from 'sid_conflict'
             or (select value from sentinel_p0_results where finding = 'sid_reuse' and key = 'attempts_sharing_sid') <> '1'
           then 'CONFIRMED'
           else 'REJECTED'
       end;

select finding, key, value
  from sentinel_p0_results
 order by finding, key;

rollback;
