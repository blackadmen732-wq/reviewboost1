-- Money tests: billing state, and the two sources of SMS credit.
--
-- These are the assertions that decide whether a business is charged
-- correctly and whether a webhook delivered fifty times costs it fifty times.
-- Every one performs the real operation against the real functions.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

select plan(59);

create or replace function tests.reset_role() returns void
language plpgsql as $$
begin
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
end $$;

grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

select tests.reset_role();

insert into public.organizations (id, name, slug, status)
values
    ('00000000-b101-0000-0000-000000000001', 'Money Co', 'money-co', 'active'),
    ('00000000-b101-0000-0000-000000000002', 'Spend Co', 'spend-co', 'active');

-- ============================================================
-- 1. STRIPE STATUS BECOMES ENTITLEMENT STATUS
-- ============================================================

select is(app.entitlement_status_from_stripe('trialing'), 'trialing', 'trialing stays trialing');
select is(app.entitlement_status_from_stripe('active'), 'active', 'active stays active');
select is(app.entitlement_status_from_stripe('past_due'), 'past_due', 'past_due stays past_due');
select is(app.entitlement_status_from_stripe('canceled'), 'cancelled', 'Stripe''s canceled is our cancelled');
select is(app.entitlement_status_from_stripe('unpaid'), 'suspended', 'the end of dunning suspends');
select is(app.entitlement_status_from_stripe('incomplete'), 'suspended',
    'a subscription whose first payment never succeeded is not a trial');
select is(app.entitlement_status_from_stripe('some_future_status'), 'suspended',
    'a status Stripe adds later suspends rather than silently granting a plan');

-- ============================================================
-- 2. THE SUBSCRIPTION WRITE, AND OUT-OF-ORDER DELIVERY
-- ============================================================

select is(
    public.rpc_billing_apply_subscription(
        '00000000-b101-0000-0000-000000000001', 'sub_money1', 'price_starter', 'starter',
        'trialing', false, now(), now() + interval '7 days', now() + interval '7 days',
        'evt_1', now() - interval '10 minutes'),
    'applied',
    'the first subscription event applies');

select is(
    (select status from public.entitlement_snapshots
      where org_id = '00000000-b101-0000-0000-000000000001'),
    'trialing',
    'the entitlement is written in the same transaction as the subscription');

select is(
    (select plan_id from public.entitlement_snapshots
      where org_id = '00000000-b101-0000-0000-000000000001'),
    'starter',
    'the trial knows which paid plan it is a trial of');

select is(
    public.rpc_billing_apply_subscription(
        '00000000-b101-0000-0000-000000000001', 'sub_money1', 'price_starter', 'starter',
        'active', false, now(), now() + interval '30 days', null,
        'evt_2', now() - interval '5 minutes'),
    'applied',
    'a newer event applies');

select is(
    (select status from public.entitlement_snapshots
      where org_id = '00000000-b101-0000-0000-000000000001'),
    'active',
    'the business is now active');

-- Stripe delivers out of order. An older event must not undo a newer one.
select is(
    public.rpc_billing_apply_subscription(
        '00000000-b101-0000-0000-000000000001', 'sub_money1', 'price_starter', 'starter',
        'canceled', false, now(), now(), null,
        'evt_0', now() - interval '20 minutes'),
    'stale',
    'an event older than what has been applied is discarded');

select is(
    (select status from public.entitlement_snapshots
      where org_id = '00000000-b101-0000-0000-000000000001'),
    'active',
    'a late-arriving cancellation from before the activation does NOT cancel the business');

select is(
    public.rpc_billing_apply_subscription(
        '00000000-b101-0000-0000-000000000001', 'sub_money1', 'price_starter', 'starter',
        'active', true, now(), now() + interval '30 days', null,
        'evt_3', now()),
    'applied',
    'cancel-at-period-end applies');

select is(
    (select cancel_at_period_end from public.entitlement_snapshots
      where org_id = '00000000-b101-0000-0000-000000000001'),
    true,
    'cancelling at period end is tracked separately from being cancelled');

select is(
    (select status from public.entitlement_snapshots
      where org_id = '00000000-b101-0000-0000-000000000001'),
    'active',
    'a business that has cancelled for later is still active now, and still works');

-- ============================================================
-- 3. THE WEBHOOK INBOX
-- ============================================================

select is(
    public.rpc_stripe_event_record('evt_inbox1', 'invoice.paid', '{"a":1}'::jsonb, now()),
    'stored',
    'a new event is stored');

-- Stripe retries for days so a transient failure does not cost the event.
-- Calling that retry a duplicate would strand the row unprocessed forever:
-- nothing else in this system sweeps the inbox.
select is(
    public.rpc_stripe_event_record('evt_inbox1', 'invoice.paid', '{"a":1}'::jsonb, now()),
    'stored',
    'a redelivery of an event that never finished is a retry, and runs');

select lives_ok(
    $$select public.rpc_stripe_event_complete('evt_inbox1')$$,
    'an event can be marked processed');

select is(
    public.rpc_stripe_event_record('evt_inbox1', 'invoice.paid', '{"a":1}'::jsonb, now()),
    'duplicate',
    'once processed, the same event delivered again is a duplicate, not a second effect');

-- ============================================================
-- 4. ONLY A PAID INVOICE MINTS MONTHLY ALLOWANCE
-- ============================================================

select is(
    public.rpc_billing_apply_invoice_paid(
        '00000000-b101-0000-0000-000000000001', 'in_trial', 'starter',
        now(), now() + interval '30 days', 0),
    'not_paid',
    'a zero-amount invoice — a trial''s invoice — mints nothing');

select is(
    (select total from app.sms_balance('00000000-b101-0000-0000-000000000001')),
    0::bigint,
    'a trial has no SMS at all');

select is(
    public.rpc_billing_apply_invoice_paid(
        '00000000-b101-0000-0000-000000000001', 'in_1', 'starter',
        now(), now() + interval '30 days', 4900),
    'granted',
    'a paid Starter invoice mints its allowance');

select is(
    (select monthly from app.sms_balance('00000000-b101-0000-0000-000000000001')),
    150::bigint,
    'Starter is exactly 150 segments');

-- Stripe retries for days. Fifty deliveries must not be fifty allowances.
do $$
declare i integer;
begin
    for i in 1..50 loop
        perform public.rpc_billing_apply_invoice_paid(
            '00000000-b101-0000-0000-000000000001', 'in_1', 'starter',
            now(), now() + interval '30 days', 4900);
    end loop;
end $$;

select is(
    (select monthly from app.sms_balance('00000000-b101-0000-0000-000000000001')),
    150::bigint,
    'the same invoice delivered fifty times is still 150 segments');

select is(
    public.rpc_billing_apply_invoice_paid(
        '00000000-b101-0000-0000-000000000001', 'in_2', 'enterprise',
        now(), now() + interval '30 days', 9900),
    'no_plan',
    'a plan nobody recognises gets no allowance, not the cheapest tier''s');

-- ============================================================
-- 5. MONTHLY FIRST, PURCHASED SECOND
-- ============================================================

-- The example from the product rules, exactly: monthly 2, purchased 100,
-- cost 3 → monthly 0, purchased 99.
select app.sms_grant_credits('00000000-b101-0000-0000-000000000002', 'monthly', 2,
    'invoice', 'in_spend', now() + interval '30 days', null);
select app.sms_grant_credits('00000000-b101-0000-0000-000000000002', 'purchased', 100,
    'purchase', 'pi_spend', null, null);

select is(
    (select monthly from app.sms_balance('00000000-b101-0000-0000-000000000002')),
    2::bigint, 'monthly starts at 2');
select is(
    (select purchased from app.sms_balance('00000000-b101-0000-0000-000000000002')),
    100::bigint, 'purchased starts at 100');

select is(
    (select reserved from app.sms_quota_reserve('00000000-b101-0000-0000-000000000002', 3, 'reservation-spend-1', null)),
    true,
    'a three-segment message reserves across both sources');
select ok(
    app.sms_quota_consume('00000000-b101-0000-0000-000000000002', 3, 'reservation-spend-1', null),
    'the message goes out and the reservation settles');

select is(
    (select monthly from app.sms_balance('00000000-b101-0000-0000-000000000002')),
    0::bigint, 'monthly is spent first — 2 to 0');
select is(
    (select purchased from app.sms_balance('00000000-b101-0000-0000-000000000002')),
    99::bigint, 'purchased covers only the remainder — 100 to 99');

-- ============================================================
-- 6. A RELEASE GOES BACK WHERE IT CAME FROM
-- ============================================================

select app.sms_grant_credits('00000000-b101-0000-0000-000000000002', 'monthly', 5,
    'invoice', 'in_release', now() + interval '30 days', null);

select is(
    (select reserved from app.sms_quota_reserve('00000000-b101-0000-0000-000000000002', 6, 'reservation-spend-2', null)),
    true,
    'a six-segment message reserves 5 monthly and 1 purchased');
select ok(
    app.sms_quota_release('00000000-b101-0000-0000-000000000002', 6, 'reservation-spend-2', null),
    'the message is suppressed and the reservation is released');

select is(
    (select monthly from app.sms_balance('00000000-b101-0000-0000-000000000002')),
    5::bigint,
    'the monthly part comes back as monthly — not as permanent credit');
select is(
    (select purchased from app.sms_balance('00000000-b101-0000-0000-000000000002')),
    99::bigint,
    'the purchased part comes back as purchased');

-- ============================================================
-- 6b. SO DOES A REFUND
-- ============================================================

-- A message that was submitted and then rejected by the provider is money the
-- business must get back. Consumption moved to the grants; a refund that only
-- decremented the old projection would take the credit twice — once for a
-- message that never arrived, and once more because nothing gave it back.
select is(
    (select reserved from app.sms_quota_reserve('00000000-b101-0000-0000-000000000002', 4, 'reservation-refund-1', null)),
    true,
    'a four-segment message reserves out of monthly');
select ok(
    app.sms_quota_consume('00000000-b101-0000-0000-000000000002', 4, 'reservation-refund-1', null),
    'it is handed to the provider and the reservation settles');
select ok(
    app.sms_quota_refund('00000000-b101-0000-0000-000000000002', 4, 'reservation-refund-1', null),
    'the provider rejects it and the credit is refunded');

select is(
    (select monthly from app.sms_balance('00000000-b101-0000-0000-000000000002')),
    5::bigint,
    'the refund returns the credit to the monthly grant it came from');
select is(
    (select purchased from app.sms_balance('00000000-b101-0000-0000-000000000002')),
    99::bigint,
    'and turns none of it into permanent credit');

select is(
    app.sms_quota_refund('00000000-b101-0000-0000-000000000002', 4, 'reservation-refund-1', null),
    false,
    'the same refund applied twice is not two refunds');
select is(
    (select monthly from app.sms_balance('00000000-b101-0000-0000-000000000002')),
    5::bigint,
    'and the balance says so');

-- ============================================================
-- 7. MONTHLY EXPIRES, PURCHASED DOES NOT
-- ============================================================

select tests.reset_role();
update public.sms_credit_grants
   set expires_at = now() - interval '1 minute'
 where org_id = '00000000-b101-0000-0000-000000000002' and source = 'monthly';

select is(
    (select monthly from app.sms_balance('00000000-b101-0000-0000-000000000002')),
    0::bigint,
    'monthly credit stops counting the moment its period ends');
select is(
    (select purchased from app.sms_balance('00000000-b101-0000-0000-000000000002')),
    99::bigint,
    'purchased credit is untouched by a billing period ending');

select is(
    (select reserved from app.sms_quota_reserve('00000000-b101-0000-0000-000000000002', 100, 'reservation-spend-3', null)),
    false,
    'expired monthly credit cannot be spent, even by one segment');

-- A new period's invoice mints a fresh allowance. It does not add to the old
-- one: there is no rollover.
select is(
    public.rpc_billing_apply_invoice_paid(
        '00000000-b101-0000-0000-000000000002', 'in_renewal', 'starter',
        now(), now() + interval '30 days', 4900),
    'granted',
    'the next period''s paid invoice mints the next allowance');
select is(
    (select monthly from app.sms_balance('00000000-b101-0000-0000-000000000002')),
    150::bigint,
    'the new month is 150, not 150 plus whatever was left of the last one');

-- ============================================================
-- 8. CANCELLATION KEEPS WHAT WAS BOUGHT
-- ============================================================

select is(
    public.rpc_billing_apply_subscription(
        '00000000-b101-0000-0000-000000000002', 'sub_spend', 'price_starter', 'starter',
        'canceled', false, now() - interval '30 days', now(), null,
        'evt_cancel', now()),
    'applied',
    'the cancellation applies');

select is(
    (select status from public.entitlement_snapshots
      where org_id = '00000000-b101-0000-0000-000000000002'),
    'cancelled',
    'the business is cancelled');

select is(
    (select purchased from app.sms_balance('00000000-b101-0000-0000-000000000002')),
    99::bigint,
    'the credit they paid for is still theirs after cancelling');

-- ============================================================
-- 9. DUPLICATE PURCHASE, AND NO NEGATIVE BALANCES
-- ============================================================

select is(
    public.rpc_billing_apply_credit_purchase('00000000-b101-0000-0000-000000000002', 'pi_pack1', 500),
    'granted',
    'a purchase grants its pack');
select is(
    public.rpc_billing_apply_credit_purchase('00000000-b101-0000-0000-000000000002', 'pi_pack1', 500),
    'duplicate',
    'the same payment delivered again grants nothing more');

select is(
    (select reserved from app.sms_quota_reserve('00000000-b101-0000-0000-000000000002', 100000, 'reservation-spend-huge', null)),
    false,
    'a reservation beyond everything available is refused, not part-filled');

select ok(
    (select min(segments - consumed - reserved) from public.sms_credit_grants
      where org_id = '00000000-b101-0000-0000-000000000002') >= 0,
    'no grant is ever overspent');

-- A retried reservation under the same key takes nothing extra.
select is(
    (select reserved from app.sms_quota_reserve('00000000-b101-0000-0000-000000000002', 10, 'reservation-spend-retry', null)),
    true, 'a reservation succeeds');
select is(
    (select reserved from app.sms_quota_reserve('00000000-b101-0000-0000-000000000002', 10, 'reservation-spend-retry', null)),
    true, 'the same reservation retried is still a success');
select is(
    (select sum(segments)::bigint from public.sms_reservation_slices
      where org_id = '00000000-b101-0000-0000-000000000002' and correlation_key = 'reservation-spend-retry'),
    10::bigint,
    'and it reserved ten segments once, not twenty');

select * from finish();
rollback;
