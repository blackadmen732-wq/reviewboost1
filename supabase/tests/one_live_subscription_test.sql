-- One live subscription per business (20261104000100_one_live_subscription).
--
-- billing_subscriptions keeps one row per business. Before this migration any
-- subscription event overwrote it, so a second subscription for the same
-- business (two checkout tabs, or a checkout opened while an old one was still
-- `incomplete`) could switch off the plan the business was paying for. These
-- cases replay that, as the service role the webhook runs as.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

insert into public.organizations (id, name, slug, status)
values
    ('00000000-1d01-0000-0000-000000000001', 'Paying Co',  'paying-co',  'active'),
    ('00000000-1d01-0000-0000-000000000002', 'Lapsed Co',  'lapsed-co',  'active');

insert into public.billing_plan_prices (stripe_price_id, plan_id)
values ('price_ol_starter', 'starter'), ('price_ol_growth', 'growth');

-- Apply one subscription event, naming the subscription explicitly.
create or replace function pg_temp.sub(
    p_org uuid, p_sub text, p_price text, p_status text, p_event text, p_at timestamptz)
returns text language sql as $$
    select public.rpc_billing_apply_subscription(
        p_org, p_sub, p_price, null, p_status, false,
        p_at - interval '1 day', p_at + interval '30 days', null, p_event, p_at)
$$;

create or replace function pg_temp.snap(p_org uuid)
returns text language sql as $$
    select coalesce(plan_id, '<null>') || '/' || status
      from public.entitlement_snapshots where org_id = p_org
$$;

create or replace function pg_temp.held(p_org uuid)
returns text language sql as $$
    select stripe_subscription_id from public.billing_subscriptions where org_id = p_org
$$;

-- ============================================================
-- 1. A SECOND SUBSCRIPTION CANNOT SWITCH OFF THE ONE BEING PAID
-- ============================================================

select is(pg_temp.sub('00000000-1d01-0000-0000-000000000001', 'sub_olPaid', 'price_ol_starter', 'active', 'evt_ol1', now() - interval '60 minutes'),
          'applied', 'the paid subscription applies');
select is(pg_temp.snap('00000000-1d01-0000-0000-000000000001'), 'starter/active', 'the business is on Starter');

-- A second checkout, never paid.
select is(pg_temp.sub('00000000-1d01-0000-0000-000000000001', 'sub_olTab2', 'price_ol_growth', 'incomplete', 'evt_ol2', now() - interval '50 minutes'),
          'other_subscription', 'an unpaid second subscription is recognised as a different one');
select is(pg_temp.snap('00000000-1d01-0000-0000-000000000001'), 'starter/active', 'and does not suspend the business');
select is(pg_temp.held('00000000-1d01-0000-0000-000000000001'), 'sub_olPaid', 'and does not replace the subscription on record');

-- The same abandoned checkout expiring: the exact event that used to cut a
-- paying business off.
select is(pg_temp.sub('00000000-1d01-0000-0000-000000000001', 'sub_olTab2', 'price_ol_growth', 'incomplete_expired', 'evt_ol3', now() - interval '40 minutes'),
          'other_subscription', 'the abandoned subscription expiring is recognised as a different one');
select is(pg_temp.snap('00000000-1d01-0000-0000-000000000001'), 'starter/active', 'the paying business stays on');

select is(pg_temp.sub('00000000-1d01-0000-0000-000000000001', 'sub_olTab2', 'price_ol_growth', 'unpaid', 'evt_ol4', now() - interval '35 minutes'),
          'other_subscription', 'an unpaid different subscription changes nothing either');
select is(pg_temp.snap('00000000-1d01-0000-0000-000000000001'), 'starter/active', 'still on');

-- ============================================================
-- 2. THE SUBSCRIPTION ON RECORD STILL CONTROLS THE PLAN
-- ============================================================

select is(pg_temp.sub('00000000-1d01-0000-0000-000000000001', 'sub_olPaid', 'price_ol_starter', 'past_due', 'evt_ol5', now() - interval '30 minutes'),
          'applied', 'a failed payment on the subscription on record applies');
select is(pg_temp.snap('00000000-1d01-0000-0000-000000000001'), 'starter/past_due', 'and shows as past due');

select is(pg_temp.sub('00000000-1d01-0000-0000-000000000001', 'sub_olPaid', 'price_ol_starter', 'canceled', 'evt_ol6', now() - interval '25 minutes'),
          'applied', 'cancelling the subscription on record applies');
select is(pg_temp.snap('00000000-1d01-0000-0000-000000000001'), 'starter/cancelled', 'and the plan ends');

-- ============================================================
-- 3. A NEW SUBSCRIPTION AFTER THE OLD ONE ENDED IS ACCEPTED
-- ============================================================

select is(pg_temp.sub('00000000-1d01-0000-0000-000000000001', 'sub_olBack', 'price_ol_growth', 'active', 'evt_ol7', now() - interval '20 minutes'),
          'applied', 'coming back with a new subscription applies');
select is(pg_temp.snap('00000000-1d01-0000-0000-000000000001'), 'growth/active', 'on the new plan');
select is(pg_temp.held('00000000-1d01-0000-0000-000000000001'), 'sub_olBack', 'with the new subscription on record');

-- A business whose plan has lapsed is not protected by a dead subscription:
-- a new one that is waiting on payment is recorded as what it is.
select is(pg_temp.sub('00000000-1d01-0000-0000-000000000002', 'sub_olOld', 'price_ol_starter', 'canceled', 'evt_ol8', now() - interval '15 minutes')
       || ',' ||
          pg_temp.sub('00000000-1d01-0000-0000-000000000002', 'sub_olNew', 'price_ol_starter', 'incomplete', 'evt_ol9', now() - interval '10 minutes'),
          'applied,applied', 'with no live subscription on record, a new one applies whatever its status');
select is(pg_temp.snap('00000000-1d01-0000-0000-000000000002'), 'starter/suspended', 'and an unpaid one grants nothing');

select * from finish();

rollback;
