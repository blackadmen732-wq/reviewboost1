-- SENTINEL independent FIFO P0 retest against tip SHA
-- d280573eb9b137bce9ea99f43c46e3353c3778ab
-- FIFO only. Synthetic org. Transaction rolls back.
--
-- Required sequence:
--   1) Expire unused grant A=100
--   2) Allocate grant B=50
--   3) Reserve 30
--   4) Ensure A effective_at older than B (pin timestamps)
--   5) Expire B
--
-- SECURE expected: fifo_used(B)=30, B expire=20,
--                  allocated=30, reserved=30, consumed=0, available=0
-- BUG at 64e76371: fifo_used(B)=0, expire=50, allocated=0, available=-30

begin;

create temporary table sentinel_fifo_retest (
    step  text not null,
    key   text not null,
    value text not null
);

insert into public.organizations (id, name, slug)
values ('b2805730-0000-0000-0000-0000000000f1', 'SENTINEL FIFO Retest d280573', 'sentinel-fifo-retest-d280573');

-- 1) Expire unused grant A=100
select app.sms_quota_allocate(
    'b2805730-0000-0000-0000-0000000000f1', 100, 'retest-grant-a',
    now() - interval '1 second', 'unused grant A');
select app.sms_quota_apply_expirations('b2805730-0000-0000-0000-0000000000f1');

insert into sentinel_fifo_retest (step, key, value)
select 'after_expire_A', 'allocated',
       (select allocated::text from public.sms_quota_balance
         where org_id = 'b2805730-0000-0000-0000-0000000000f1');
insert into sentinel_fifo_retest (step, key, value)
select 'after_expire_A', 'available',
       app.sms_quota_available('b2805730-0000-0000-0000-0000000000f1')::text;

-- 2) Allocate grant B=50
select app.sms_quota_allocate(
    'b2805730-0000-0000-0000-0000000000f1', 50, 'retest-grant-b',
    null, 'live grant B');

-- 3) Reserve 30
select app.sms_quota_reserve(
    'b2805730-0000-0000-0000-0000000000f1', 30, 'retest-resv-30', null);

-- 4) Pin A older than B so UUID order cannot hide ghost prior_capacity
update public.sms_quota_ledger
   set effective_at = now() - interval '10 seconds'
 where org_id = 'b2805730-0000-0000-0000-0000000000f1'
   and kind = 'allocation'
   and correlation_key = 'retest-grant-a';
update public.sms_quota_ledger
   set effective_at = now() - interval '5 seconds'
 where org_id = 'b2805730-0000-0000-0000-0000000000f1'
   and kind = 'allocation'
   and correlation_key = 'retest-grant-b';

insert into sentinel_fifo_retest (step, key, value)
select 'after_reserve_before_expire_B', 'fifo_used_B',
       app.sms_quota_fifo_used(
           'b2805730-0000-0000-0000-0000000000f1',
           (select id from public.sms_quota_ledger
             where org_id = 'b2805730-0000-0000-0000-0000000000f1'
               and kind = 'allocation'
               and correlation_key = 'retest-grant-b')
       )::text;

insert into sentinel_fifo_retest (step, key, value)
select 'after_reserve_before_expire_B', 'allocated',
       (select allocated::text from public.sms_quota_balance
         where org_id = 'b2805730-0000-0000-0000-0000000000f1');
insert into sentinel_fifo_retest (step, key, value)
select 'after_reserve_before_expire_B', 'reserved',
       (select reserved::text from public.sms_quota_balance
         where org_id = 'b2805730-0000-0000-0000-0000000000f1');
insert into sentinel_fifo_retest (step, key, value)
select 'after_reserve_before_expire_B', 'consumed',
       (select consumed::text from public.sms_quota_balance
         where org_id = 'b2805730-0000-0000-0000-0000000000f1');
insert into sentinel_fifo_retest (step, key, value)
select 'after_reserve_before_expire_B', 'available',
       app.sms_quota_available('b2805730-0000-0000-0000-0000000000f1')::text;

-- 5) Expire B
update public.sms_quota_ledger
   set expires_at = now() - interval '1 second'
 where org_id = 'b2805730-0000-0000-0000-0000000000f1'
   and kind = 'allocation'
   and correlation_key = 'retest-grant-b';

insert into sentinel_fifo_retest (step, key, value)
select 'unswept_B', 'available',
       app.sms_quota_available('b2805730-0000-0000-0000-0000000000f1')::text;

select app.sms_quota_apply_expirations('b2805730-0000-0000-0000-0000000000f1');

insert into sentinel_fifo_retest (step, key, value)
select 'after_expire_B', 'fifo_used_B',
       app.sms_quota_fifo_used(
           'b2805730-0000-0000-0000-0000000000f1',
           (select id from public.sms_quota_ledger
             where org_id = 'b2805730-0000-0000-0000-0000000000f1'
               and kind = 'allocation'
               and correlation_key = 'retest-grant-b')
       )::text;

insert into sentinel_fifo_retest (step, key, value)
select 'after_expire_B', 'B_expiration_amount',
       coalesce((
           select e.amount::text
             from public.sms_quota_ledger a
             join public.sms_quota_ledger e
               on e.org_id = a.org_id
              and e.kind = 'expiration'
              and e.correlation_key = 'expire:' || a.id::text
            where a.org_id = 'b2805730-0000-0000-0000-0000000000f1'
              and a.kind = 'allocation'
              and a.correlation_key = 'retest-grant-b'
       ), 'missing');

insert into sentinel_fifo_retest (step, key, value)
select 'after_expire_B', 'allocated',
       (select allocated::text from public.sms_quota_balance
         where org_id = 'b2805730-0000-0000-0000-0000000000f1');
insert into sentinel_fifo_retest (step, key, value)
select 'after_expire_B', 'reserved',
       (select reserved::text from public.sms_quota_balance
         where org_id = 'b2805730-0000-0000-0000-0000000000f1');
insert into sentinel_fifo_retest (step, key, value)
select 'after_expire_B', 'consumed',
       (select consumed::text from public.sms_quota_balance
         where org_id = 'b2805730-0000-0000-0000-0000000000f1');
insert into sentinel_fifo_retest (step, key, value)
select 'after_expire_B', 'available',
       app.sms_quota_available('b2805730-0000-0000-0000-0000000000f1')::text;

insert into sentinel_fifo_retest (step, key, value)
values
    ('expected_secure', 'fifo_used_B', '30'),
    ('expected_secure', 'B_expiration_amount', '20'),
    ('expected_secure', 'allocated', '30'),
    ('expected_secure', 'reserved', '30'),
    ('expected_secure', 'consumed', '0'),
    ('expected_secure', 'available', '0');

insert into sentinel_fifo_retest (step, key, value)
select 'verdict', 'fifo_p0',
       case
           when (select value from sentinel_fifo_retest
                  where step = 'after_expire_B' and key = 'fifo_used_B') = '30'
            and (select value from sentinel_fifo_retest
                  where step = 'after_expire_B' and key = 'B_expiration_amount') = '20'
            and (select value from sentinel_fifo_retest
                  where step = 'after_expire_B' and key = 'allocated') = '30'
            and (select value from sentinel_fifo_retest
                  where step = 'after_expire_B' and key = 'reserved') = '30'
            and (select value from sentinel_fifo_retest
                  where step = 'after_expire_B' and key = 'consumed') = '0'
            and (select value from sentinel_fifo_retest
                  where step = 'after_expire_B' and key = 'available') = '0'
           then 'CONFIRM'
           else 'REJECT'
       end;

select step, key, value
  from sentinel_fifo_retest
 order by step, key;

rollback;
