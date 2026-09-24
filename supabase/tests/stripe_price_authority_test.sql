-- The Stripe Price is the only entitlement authority.
--
-- Every case here is a way a business could end up with a plan it did not pay
-- for, or keep one it stopped paying for. `p_plan_id` is passed exactly the
-- way an attacker-influenced caller would pass it — from subscription
-- metadata — to prove the database no longer believes it.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(54);

insert into public.organizations (id, name, slug, status)
values
    ('00000000-5a01-0000-0000-000000000001', 'Price Co',   'price-co',   'active'),
    ('00000000-5a01-0000-0000-000000000002', 'Meta Co',    'meta-co',    'active'),
    ('00000000-5a01-0000-0000-000000000003', 'Unmapped Co','unmapped-co','active');

insert into public.billing_plan_prices (stripe_price_id, plan_id)
values ('price_pa_starter', 'starter'), ('price_pa_growth', 'growth'), ('price_pa_pro', 'pro');

-- Shorthand: apply one subscription event for an org.
create or replace function pg_temp.sub(
    p_org uuid, p_price text, p_claimed_plan text, p_status text,
    p_event text, p_at timestamptz, p_cancel_at_end boolean default false,
    p_trial_end timestamptz default null)
returns text language sql as $$
    select public.rpc_billing_apply_subscription(
        p_org, 'sub_' || right(replace(p_org::text, '-', ''), 12), p_price, p_claimed_plan,
        p_status, p_cancel_at_end, p_at - interval '1 day', p_at + interval '30 days',
        p_trial_end, p_event, p_at)
$$;

create or replace function pg_temp.snap(p_org uuid)
returns text language sql as $$
    select coalesce(plan_id, '<null>') || '/' || status
      from public.entitlement_snapshots where org_id = p_org
$$;

-- ============================================================
-- 1. EACH PRICE IS ITS OWN PLAN — WITHOUT THE CALLER SAYING SO
-- ============================================================

select is(pg_temp.sub('00000000-5a01-0000-0000-000000000001', 'price_pa_starter', null, 'active', 'evt_pa_1', now() - interval '60 minutes'),
          'applied', 'a Starter price applies with no plan supplied by the caller');
select is(pg_temp.snap('00000000-5a01-0000-0000-000000000001'), 'starter/active', 'the Starter price is Starter');

select is(pg_temp.sub('00000000-5a01-0000-0000-000000000001', 'price_pa_growth', null, 'active', 'evt_pa_2', now() - interval '55 minutes'),
          'applied', 'an upgrade to the Growth price applies');
select is(pg_temp.snap('00000000-5a01-0000-0000-000000000001'), 'growth/active', 'the Growth price is Growth');

select is(pg_temp.sub('00000000-5a01-0000-0000-000000000001', 'price_pa_pro', 'pro', 'active', 'evt_pa_3', now() - interval '50 minutes'),
          'applied', 'a Pro price with an agreeing claim applies');
select is(pg_temp.snap('00000000-5a01-0000-0000-000000000001'), 'pro/active', 'the Pro price is Pro');

select is(pg_temp.sub('00000000-5a01-0000-0000-000000000001', 'price_pa_starter', null, 'active', 'evt_pa_4', now() - interval '45 minutes'),
          'applied', 'a downgrade applies');
select is(pg_temp.snap('00000000-5a01-0000-0000-000000000001'), 'starter/active', 'a downgrade is a downgrade');

select is((select plan_id from public.billing_subscriptions where org_id = '00000000-5a01-0000-0000-000000000001'),
          'starter', 'the subscription record agrees with the entitlement');

-- ============================================================
-- 2. METADATA IS NOT AUTHORITY
-- ============================================================

-- A subscription for a price we do not sell, carrying `plan_id=pro` in its
-- metadata. This is the exact shape of the old hole.
select throws_ok(
    $$select pg_temp.sub('00000000-5a01-0000-0000-000000000002', 'price_someone_elses_product', 'pro', 'active', 'evt_meta_1', now())$$,
    'P0001', 'unknown_price',
    'metadata claiming Pro on an unknown price is refused');
select is(pg_temp.snap('00000000-5a01-0000-0000-000000000002'), '<null>/suspended',
          'and the business gained nothing from the claim (a new business starts suspended until checkout)');
select is((select count(*)::int from public.billing_subscriptions where org_id = '00000000-5a01-0000-0000-000000000002'),
          0, 'no subscription row was written for the unknown price');

-- A known price with a lie on top: Starter paid, Pro claimed.
select throws_ok(
    $$select pg_temp.sub('00000000-5a01-0000-0000-000000000002', 'price_pa_starter', 'pro', 'active', 'evt_meta_2', now())$$,
    'P0001', 'plan_price_mismatch',
    'a claimed plan that disagrees with the price fails rather than either being believed');
select is(pg_temp.snap('00000000-5a01-0000-0000-000000000002'), '<null>/suspended',
          'a mismatch grants nothing');

-- Every status that grants service fails closed on an unknown price.
select throws_ok(
    $$select pg_temp.sub('00000000-5a01-0000-0000-000000000002', 'price_unknown_x', null, 'trialing', 'evt_meta_3', now(), false, now() + interval '7 days')$$,
    'P0001', 'unknown_price', 'an unknown price cannot start a trial');
select throws_ok(
    $$select pg_temp.sub('00000000-5a01-0000-0000-000000000002', 'price_unknown_x', null, 'past_due', 'evt_meta_4', now())$$,
    'P0001', 'unknown_price', 'an unknown price cannot be past_due-with-service');
select throws_ok(
    $$select pg_temp.sub('00000000-5a01-0000-0000-000000000002', null, 'pro', 'active', 'evt_meta_5', now())$$,
    'P0001', 'unknown_price', 'a subscription with no price at all grants nothing, whatever it claims');

-- ============================================================
-- 3. MALFORMED EVENTS
-- ============================================================

select throws_ok(
    $$select public.rpc_billing_apply_subscription('00000000-5a01-0000-0000-000000000002', null, 'price_pa_pro', null,
        'active', false, now(), now() + interval '30 days', null, 'evt_bad_1', now())$$,
    'P0001', 'malformed_subscription_event', 'a subscription with no id is refused');
select throws_ok(
    $$select public.rpc_billing_apply_subscription('00000000-5a01-0000-0000-000000000002', 'sub_x', 'price_pa_pro', null,
        'active', false, now(), now() + interval '30 days', null, null, now())$$,
    'P0001', 'malformed_subscription_event', 'an event with no id is refused');
select throws_ok(
    $$select public.rpc_billing_apply_subscription('00000000-5a01-0000-0000-000000000002', 'sub_x', 'price_pa_pro', null,
        'active', false, now(), now() + interval '30 days', null, 'evt_bad_3', null)$$,
    'P0001', 'malformed_subscription_event', 'an event with no timestamp is refused (it could never be ordered)');
select throws_ok(
    $$insert into public.billing_plan_prices values ('pro', 'pro')$$,
    '23514', null, 'the mapping only accepts things shaped like Stripe price ids');
select throws_ok(
    $$insert into public.billing_plan_prices values ('price_enterprise', 'enterprise')$$,
    '23514', null, 'the mapping only accepts plans this product sells');

-- ============================================================
-- 4. THE LIFECYCLE, IN ORDER AND OUT OF IT
-- ============================================================

select is(pg_temp.sub('00000000-5a01-0000-0000-000000000003', 'price_pa_growth', null, 'trialing', 'evt_lc_1', now() - interval '40 minutes', false, now() + interval '7 days'),
          'applied', 'trialing applies');
select is(pg_temp.snap('00000000-5a01-0000-0000-000000000003'), 'growth/trialing', 'a trial carries its chosen plan');

select is(pg_temp.sub('00000000-5a01-0000-0000-000000000003', 'price_pa_growth', null, 'active', 'evt_lc_2', now() - interval '35 minutes'),
          'applied', 'the trial converts');
select is(pg_temp.snap('00000000-5a01-0000-0000-000000000003'), 'growth/active', 'converted is active');

select is(pg_temp.sub('00000000-5a01-0000-0000-000000000003', 'price_pa_growth', null, 'active', 'evt_lc_2', now() - interval '35 minutes'),
          'applied', 'the same event applied twice is harmless');
select is(pg_temp.snap('00000000-5a01-0000-0000-000000000003'), 'growth/active', 'and changes nothing');

select is(pg_temp.sub('00000000-5a01-0000-0000-000000000003', 'price_pa_growth', null, 'past_due', 'evt_lc_3', now() - interval '30 minutes'),
          'applied', 'a failed renewal applies');
select is(pg_temp.snap('00000000-5a01-0000-0000-000000000003'), 'growth/past_due', 'past_due is past_due');

select is(pg_temp.sub('00000000-5a01-0000-0000-000000000003', 'price_pa_growth', null, 'active', 'evt_lc_4', now() - interval '25 minutes'),
          'applied', 'recovery after payment applies');
select is(pg_temp.snap('00000000-5a01-0000-0000-000000000003'), 'growth/active', 'recovered is active');

select is(pg_temp.sub('00000000-5a01-0000-0000-000000000003', 'price_pa_growth', null, 'active', 'evt_lc_5', now() - interval '20 minutes', true),
          'applied', 'cancel-at-period-end applies');
select is((select cancel_at_period_end::text || '/' || status from public.entitlement_snapshots
            where org_id = '00000000-5a01-0000-0000-000000000003'),
          'true/active', 'cancelling for later keeps service until then');

select is(pg_temp.sub('00000000-5a01-0000-0000-000000000003', 'price_pa_growth', null, 'canceled', 'evt_lc_6', now() - interval '15 minutes'),
          'applied', 'the deletion applies');
select is(pg_temp.snap('00000000-5a01-0000-0000-000000000003'), 'growth/cancelled', 'deleted is cancelled');

-- The `updated` that preceded the `deleted`, delivered late.
select is(pg_temp.sub('00000000-5a01-0000-0000-000000000003', 'price_pa_growth', null, 'active', 'evt_lc_late', now() - interval '17 minutes'),
          'stale', 'an out-of-order event older than the deletion is discarded');
select is(pg_temp.snap('00000000-5a01-0000-0000-000000000003'), 'growth/cancelled', 'and does not resurrect the plan');

select is(pg_temp.sub('00000000-5a01-0000-0000-000000000003', 'price_pa_pro', null, 'active', 'evt_lc_7', now() - interval '10 minutes'),
          'applied', 're-subscribing applies');
select is(pg_temp.snap('00000000-5a01-0000-0000-000000000003'), 'pro/active', 're-subscribed on the price actually paid');

-- ============================================================
-- 5. REVOKING NEVER NEEDS THE PRICE; GRANTING ALWAYS DOES
-- ============================================================

-- A cancellation for a price that was since removed from the catalog still
-- takes access away. Leaving a cancelled business entitled would be the
-- fail-open direction.
select is(pg_temp.sub('00000000-5a01-0000-0000-000000000003', 'price_retired', null, 'canceled', 'evt_lc_8', now() - interval '5 minutes'),
          'applied', 'a cancellation on an unknown price still revokes');
select is(pg_temp.snap('00000000-5a01-0000-0000-000000000003'), 'pro/cancelled',
          'it revokes against the plan already held, and grants nothing new');

-- ============================================================
-- 6. FIXING THE CONFIGURATION MAKES THE RETRY SUCCEED
-- ============================================================

-- The operator decides this price really is one of ours, and which plan.
insert into public.billing_plan_prices (stripe_price_id, plan_id) values ('price_someone_elses_product', 'growth');

select throws_ok(
    $$select pg_temp.sub('00000000-5a01-0000-0000-000000000002', 'price_someone_elses_product', 'pro', 'active', 'evt_meta_1', now())$$,
    'P0001', 'plan_price_mismatch',
    'even once mapped, the metadata claim does not win over the mapping');
select is(pg_temp.sub('00000000-5a01-0000-0000-000000000002', 'price_someone_elses_product', null, 'active', 'evt_meta_1', now()),
          'applied', 'the retried event applies once the price is mapped');
select is(pg_temp.snap('00000000-5a01-0000-0000-000000000002'), 'growth/active',
          'as the plan the mapping says, not the plan the metadata said');

-- ============================================================
-- 7. PAID INVOICES MINT BY PRICE
-- ============================================================

select is(public.rpc_billing_apply_invoice_paid('00000000-5a01-0000-0000-000000000001', 'in_pa_1', 'price_pa_pro',
              now(), now() + interval '30 days', 12900),
          'granted', 'a paid Pro invoice mints');
select is((select monthly from app.sms_balance('00000000-5a01-0000-0000-000000000001')),
          1500::bigint, 'the allowance is the Pro allowance, decided by the price');
select throws_ok(
    $$select public.rpc_billing_apply_invoice_paid('00000000-5a01-0000-0000-000000000001', 'in_pa_2', 'price_nobody_sells',
          now(), now() + interval '30 days', 99900)$$,
    'P0001', 'unknown_price', 'a paid invoice for an unknown price mints nothing and fails loudly');
select is((select monthly from app.sms_balance('00000000-5a01-0000-0000-000000000001')),
          1500::bigint, 'and the balance is untouched');
select is(public.rpc_billing_apply_invoice_paid('00000000-5a01-0000-0000-000000000001', 'in_pa_3', null,
              now(), now() + interval '30 days', 500),
          'no_plan', 'an invoice with no subscription price is not a plan renewal');

-- ============================================================
-- 8. NOBODY BUT THE SERVER TOUCHES THE AUTHORITY
-- ============================================================

set local role authenticated;
select throws_ok($$select * from public.billing_plan_prices$$, '42501', null,
                 'a signed-in user cannot read the price map');
select throws_ok($$insert into public.billing_plan_prices values ('price_free_pro', 'pro')$$, '42501', null,
                 'a signed-in user cannot add a price that grants Pro');
select throws_ok($$select * from public.rpc_billing_price_catalog()$$, '42501', null,
                 'a signed-in user cannot call the catalog RPC');
reset role;

set local role anon;
select throws_ok($$insert into public.billing_plan_prices values ('price_free_pro', 'pro')$$, '42501', null,
                 'an anonymous caller cannot add a price');
reset role;

select * from finish();
rollback;
