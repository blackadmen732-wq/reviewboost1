-- SMS packs: the money edges.
--
-- Selling a pack, refunding it, losing it to a chargeback, and winning the
-- chargeback back — each performed against the real functions, with the
-- balance checked after every step. The rule under test throughout: a refund
-- never leaves free credit behind, and never makes a balance negative. Credit
-- that was already spent becomes a number an operator has to account for.
--
-- Also here: a failed first payment after the seven-day trial mints nothing.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(76);

insert into public.organizations (id, name, slug, status)
values
    ('00000000-c201-0000-0000-000000000001', 'Pack Co', 'pack-co', 'active'),
    ('00000000-c201-0000-0000-000000000002', 'Spent Co', 'spent-co', 'active'),
    ('00000000-c201-0000-0000-000000000003', 'Flight Co', 'flight-co', 'active'),
    ('00000000-c201-0000-0000-000000000004', 'Dispute Co', 'dispute-co', 'active'),
    ('00000000-c201-0000-0000-000000000005', 'Trial Co', 'trial-co', 'active'),
    ('00000000-c201-0000-0000-000000000006', 'Early Co', 'early-co', 'active');

create or replace function pg_temp.purchased(p_org uuid) returns bigint
language sql as $$ select purchased from app.sms_balance(p_org) $$;

create or replace function pg_temp.review(p_pi text) returns text
language sql as $$ select review_state from public.sms_pack_accounting where payment_intent_id = p_pi $$;

create or replace function pg_temp.outstanding(p_pi text) returns bigint
language sql as $$ select outstanding_segments from public.sms_pack_accounting where payment_intent_id = p_pi $$;

-- ============================================================
-- 1. THE CATALOG, AND A PACK BEING SOLD
-- ============================================================

select is((select segments from app.sms_pack_catalog('pack_50')), 50::bigint, 'the small pack is 50 segments');
select is((select price_cents from app.sms_pack_catalog('pack_50')), 400::bigint, 'for $4');
select is((select price_cents from app.sms_pack_catalog('pack_200')), 1600::bigint, 'the medium pack is $16');
select is((select price_cents from app.sms_pack_catalog('pack_500')), 4000::bigint, 'the large pack is $40');
select is((select count(*)::integer from app.sms_pack_catalog('pack_1000000')), 0, 'there is no fourth pack');

select is(
    public.rpc_billing_apply_pack_payment('00000000-c201-0000-0000-000000000001',
        'pi_full1', 'cs_test_full1', 'pack_50', 400, 'usd', 'evt_p1'),
    'granted', 'a paid pack grants its credit');
select is(pg_temp.purchased('00000000-c201-0000-0000-000000000001'), 50::bigint, '50 purchased segments');
select is(
    public.rpc_billing_apply_pack_payment('00000000-c201-0000-0000-000000000001',
        'pi_full1', 'cs_test_full1', 'pack_50', 400, 'usd', 'evt_p1_again'),
    'duplicate', 'the same payment delivered again is a duplicate');
select is(pg_temp.purchased('00000000-c201-0000-0000-000000000001'), 50::bigint, 'and grants nothing more');
select is(
    (select accounting_state from public.sms_pack_accounting where payment_intent_id = 'pi_full1'),
    'granted', 'the purchase reads as granted');

-- ============================================================
-- 2. PAID, BUT NOT THE PRICE — NO CREDIT, AND IT IS VISIBLE
-- ============================================================

select is(
    public.rpc_billing_apply_pack_payment('00000000-c201-0000-0000-000000000001',
        'pi_cheap1', 'cs_test_cheap1', 'pack_500', 400, 'usd', 'evt_cheap'),
    'amount_mismatch', 'a large pack paid at the small pack''s price is not granted');
select is(
    public.rpc_billing_apply_pack_payment('00000000-c201-0000-0000-000000000001',
        'pi_eur1', 'cs_test_eur1', 'pack_50', 400, 'eur', 'evt_eur'),
    'amount_mismatch', 'the right number in the wrong currency is not the price');
select is(
    public.rpc_billing_apply_pack_payment('00000000-c201-0000-0000-000000000001',
        'pi_ghost1', 'cs_test_ghost1', 'pack_ghost', 400, 'usd', 'evt_ghost'),
    'unknown_pack', 'a pack that does not exist grants nothing');
select is(pg_temp.purchased('00000000-c201-0000-0000-000000000001'), 50::bigint,
    'none of them added credit');
select is(
    public.rpc_billing_apply_pack_payment('00000000-c201-0000-0000-000000000001',
        'pi_cheap1', 'cs_test_cheap1', 'pack_500', 400, 'usd', 'evt_cheap_again'),
    'amount_mismatch', 'the same refused payment seen again is refused again');
select is(
    (select count(*)::integer from public.audit_events
      where action = 'sms_pack.paid_without_credit'
        and target_id = (select id::text from public.sms_pack_purchases where payment_intent_id = 'pi_cheap1')),
    1, 'and is one finding, not two');
select is(
    (select count(*)::integer from public.sms_pack_accounting
      where org_id = '00000000-c201-0000-0000-000000000001' and accounting_state = 'paid_without_credit'),
    3, 'all three are recorded as paid-without-credit');
select is(
    (select count(*)::integer from public.rpc_billing_pack_reconciliation_findings()
      where kind = 'paid_without_credit' and org_id = '00000000-c201-0000-0000-000000000001'),
    3, 'and reconciliation reports each of them');
select ok(
    ((public.rpc_ops_health() -> 'packs' ->> 'paidWithoutCredit')::integer) >= 3,
    'and health counts them');

-- ============================================================
-- 3. A FULL REFUND OF AN UNSPENT PACK TAKES IT ALL BACK
-- ============================================================

select is(
    (select outcome from public.rpc_billing_apply_pack_refund('00000000-c201-0000-0000-000000000001',
        'pi_full1', 400, 400, 'evt_r1')),
    'applied', 'the refund applies');
select is(pg_temp.purchased('00000000-c201-0000-0000-000000000001'), 0::bigint,
    'no purchased credit is left behind');
select is(pg_temp.review('pi_full1'), 'none', 'nothing was spent, so there is nothing to review');
select is(
    (select accounting_state from public.sms_pack_accounting where payment_intent_id = 'pi_full1'),
    'refunded', 'the purchase reads as refunded');

-- A refund event delivered late, with Stripe's older, smaller cumulative
-- number, does not un-refund anything.
select is(
    (select outcome from public.rpc_billing_apply_pack_refund('00000000-c201-0000-0000-000000000001',
        'pi_full1', 400, 100, 'evt_r1_old')),
    'applied', 'an older partial-refund event arrives after the full one');
select is(pg_temp.purchased('00000000-c201-0000-0000-000000000001'), 0::bigint,
    'and the credit stays taken back');

-- ============================================================
-- 4. A PARTIAL REFUND TAKES ITS SHARE, ROUNDED UP
-- ============================================================

select public.rpc_billing_apply_pack_payment('00000000-c201-0000-0000-000000000001',
    'pi_part1', 'cs_test_part1', 'pack_200', 1600, 'usd', 'evt_p2');
select is(pg_temp.purchased('00000000-c201-0000-0000-000000000001'), 200::bigint, '200 purchased');

select public.rpc_billing_apply_pack_refund('00000000-c201-0000-0000-000000000001',
    'pi_part1', 1600, 400, 'evt_r2');
select is(pg_temp.purchased('00000000-c201-0000-0000-000000000001'), 150::bigint,
    'a quarter refunded takes back a quarter: 50 of 200');

select public.rpc_billing_apply_pack_refund('00000000-c201-0000-0000-000000000001',
    'pi_part1', 1600, 401, 'evt_r3');
select is(pg_temp.purchased('00000000-c201-0000-0000-000000000001'), 149::bigint,
    'one cent more takes one segment more: a fraction of a segment is never left free');

-- ============================================================
-- 5. REFUNDED AFTER IT WAS SPENT — NEVER NEGATIVE, ALWAYS VISIBLE
-- ============================================================

-- Five included segments and a pack. Eight segments go out: five monthly,
-- then three from the pack. Then the pack is refunded in full.
select app.sms_grant_credits('00000000-c201-0000-0000-000000000002', 'monthly', 5,
    'invoice', 'in_spent', now() + interval '30 days', null);
select public.rpc_billing_apply_pack_payment('00000000-c201-0000-0000-000000000002',
    'pi_spent1', 'cs_test_spent1', 'pack_50', 400, 'usd', 'evt_p3');

select is(
    (select reserved from app.sms_quota_reserve('00000000-c201-0000-0000-000000000002', 8, 'res-spent-1', null)),
    true, 'eight segments are reserved');
select ok(app.sms_quota_consume('00000000-c201-0000-0000-000000000002', 8, 'res-spent-1', null),
    'and sent');
select is(pg_temp.purchased('00000000-c201-0000-0000-000000000002'), 47::bigint,
    'monthly went first; the pack paid for three');

select is(
    (select outstanding_segments from public.rpc_billing_apply_pack_refund(
        '00000000-c201-0000-0000-000000000002', 'pi_spent1', 400, 400, 'evt_r4')),
    3::bigint, 'the refund reports the three segments it could not take back');
select is(pg_temp.purchased('00000000-c201-0000-0000-000000000002'), 0::bigint,
    'every unspent segment of the pack is gone');
select is((select total from app.sms_balance('00000000-c201-0000-0000-000000000002')), 0::bigint,
    'the balance is zero — not minus three');
select is(
    (select monthly from app.sms_balance('00000000-c201-0000-0000-000000000002')), 0::bigint,
    'and the refund did not reach into monthly credit to make up the difference');
select is(pg_temp.review('pi_spent1'), 'needs_review',
    'the three spent segments are an explicit review state');
select is(
    (select unrecoverable_segments from public.sms_pack_accounting where payment_intent_id = 'pi_spent1'),
    3::bigint, 'with the exact number of segments');
select ok(
    exists (select 1 from public.audit_events
             where action = 'sms_pack.clawback_shortfall'
               and org_id = '00000000-c201-0000-0000-000000000002'),
    'and an audit record of the shortfall');
select ok(
    exists (select 1 from public.rpc_billing_pack_reconciliation_findings()
             where kind = 'needs_review' and org_id = '00000000-c201-0000-0000-000000000002'),
    'reconciliation lists it');
select ok(((public.rpc_ops_health() -> 'packs' ->> 'needsReview')::integer) >= 1,
    'and health counts it');

select is(
    (select reserved from app.sms_quota_reserve('00000000-c201-0000-0000-000000000002', 1, 'res-spent-2', null)),
    false, 'a business whose pack was refunded cannot send on it');

select is(
    public.rpc_billing_resolve_pack_review(
        (select id from public.sms_pack_purchases where payment_intent_id = 'pi_spent1'),
        'written_off', 'refund issued as goodwill'),
    3::bigint, 'an operator writes the three segments off');
select is(pg_temp.review('pi_spent1'), 'resolved', 'and the review is resolved');
select ok(
    not exists (select 1 from public.rpc_billing_pack_reconciliation_findings()
                 where kind = 'needs_review' and org_id = '00000000-c201-0000-0000-000000000002'),
    'reconciliation stops reporting it');

-- ============================================================
-- 6. REFUNDED WHILE A SEND IS IN FLIGHT
-- ============================================================

select public.rpc_billing_apply_pack_payment('00000000-c201-0000-0000-000000000003',
    'pi_flight1', 'cs_test_flight1', 'pack_50', 400, 'usd', 'evt_p4');
select app.sms_quota_reserve('00000000-c201-0000-0000-000000000003', 10, 'res-flight-1', null);
select app.sms_quota_reserve('00000000-c201-0000-0000-000000000003', 4, 'res-flight-2', null);

select public.rpc_billing_apply_pack_refund('00000000-c201-0000-0000-000000000003',
    'pi_flight1', 400, 400, 'evt_r5');
select is(pg_temp.purchased('00000000-c201-0000-0000-000000000003'), 0::bigint,
    'the unreserved credit is taken back at once');
select is(pg_temp.outstanding('pi_flight1'), 14::bigint, 'fourteen are still in flight');
select is(pg_temp.review('pi_flight1'), 'pending_in_flight',
    'in-flight credit is not yet a loss');

-- The first send fails at the provider. Its credit comes back to a refunded
-- grant — and is revoked in the same statement, not handed out as free.
select ok(app.sms_quota_release('00000000-c201-0000-0000-000000000003', 10, 'res-flight-1', null),
    'the ten-segment send is released');
select is(pg_temp.purchased('00000000-c201-0000-0000-000000000003'), 0::bigint,
    'released credit on a refunded pack is not free credit');
select is(pg_temp.outstanding('pi_flight1'), 4::bigint, 'four still in flight');

-- The second send goes out: that credit is spent, and now it is a review.
select ok(app.sms_quota_consume('00000000-c201-0000-0000-000000000003', 4, 'res-flight-2', null),
    'the four-segment send goes out');
select is(pg_temp.review('pi_flight1'), 'needs_review', 'what was sent becomes a review');
select is(
    (select unrecoverable_segments from public.sms_pack_accounting where payment_intent_id = 'pi_flight1'),
    4::bigint, 'of exactly four segments');

-- A provider refund of that message (submitted, then rejected) gives the
-- credit back to the grant — which revokes it, and closes the review.
select ok(app.sms_quota_refund('00000000-c201-0000-0000-000000000003', 4, 'res-flight-2', null),
    'the provider later rejects the message');
select is(pg_temp.purchased('00000000-c201-0000-0000-000000000003'), 0::bigint,
    'still no free credit');
select is(pg_temp.review('pi_flight1'), 'none', 'and nothing left to review');

-- ============================================================
-- 7. CHARGEBACKS
-- ============================================================

select public.rpc_billing_apply_pack_payment('00000000-c201-0000-0000-000000000004',
    'pi_dispute1', 'cs_test_dispute1', 'pack_50', 400, 'usd', 'evt_p5');

select public.rpc_billing_apply_pack_dispute('00000000-c201-0000-0000-000000000004',
    'pi_dispute1', 'du_1', 'needs_response', '2026-09-01 10:00+00', 'evt_d1');
select is(pg_temp.purchased('00000000-c201-0000-0000-000000000004'), 0::bigint,
    'an open dispute freezes the whole pack');
select is(
    (select accounting_state from public.sms_pack_accounting where payment_intent_id = 'pi_dispute1'),
    'disputed', 'and reads as disputed');

select public.rpc_billing_apply_pack_dispute('00000000-c201-0000-0000-000000000004',
    'pi_dispute1', 'du_1', 'won', '2026-09-10 10:00+00', 'evt_d2');
select is(pg_temp.purchased('00000000-c201-0000-0000-000000000004'), 50::bigint,
    'a won dispute gives the credit back');

select is(
    (select outcome from public.rpc_billing_apply_pack_dispute('00000000-c201-0000-0000-000000000004',
        'pi_dispute1', 'du_1', 'under_review', '2026-09-05 10:00+00', 'evt_d_late')),
    'stale', 'an older dispute event arriving late is stale');
select is(pg_temp.purchased('00000000-c201-0000-0000-000000000004'), 50::bigint,
    'and does not re-freeze a won dispute');

select public.rpc_billing_apply_pack_dispute('00000000-c201-0000-0000-000000000004',
    'pi_dispute1', 'du_2', 'lost', '2026-09-20 10:00+00', 'evt_d3');
select is(pg_temp.purchased('00000000-c201-0000-0000-000000000004'), 0::bigint,
    'a lost chargeback takes the pack back');
select is(
    (select accounting_state from public.sms_pack_accounting where payment_intent_id = 'pi_dispute1'),
    'chargeback_lost', 'and reads as a lost chargeback');

-- ============================================================
-- 8. THE REFUND ARRIVES BEFORE THE PAYMENT
-- ============================================================

select is(
    (select outcome from public.rpc_billing_apply_pack_refund('00000000-c201-0000-0000-000000000006',
        'pi_early1', 400, 400, 'evt_r_early')),
    'recorded_before_grant', 'a refund for a payment not yet seen is recorded, not dropped');
select is(
    public.rpc_billing_apply_pack_payment('00000000-c201-0000-0000-000000000006',
        'pi_early1', 'cs_test_early1', 'pack_50', 400, 'usd', 'evt_p_early'),
    'granted', 'the payment then arrives');
select is(pg_temp.purchased('00000000-c201-0000-0000-000000000006'), 0::bigint,
    'and the refund that preceded it applies at once');

select throws_ok(
    $$ select public.rpc_billing_apply_pack_payment('00000000-c201-0000-0000-000000000001',
        'pi_early1', 'cs_test_other', 'pack_50', 400, 'usd', 'evt_cross') $$,
    'P0001', 'pack_org_mismatch',
    'a payment cannot be claimed by a second business');

-- ============================================================
-- 9. INVARIANTS AND ACCESS
-- ============================================================

select is(
    (select count(*)::integer from public.sms_credit_grants
      where segments - consumed - reserved - revoked < 0),
    0, 'no grant anywhere has negative spendable credit');
select is(
    (select count(*)::integer from public.rpc_billing_pack_reconciliation_findings()
      where kind = 'clawback_unapplied'),
    0, 'no owed credit is ever left sitting unspent');

select ok(not has_table_privilege('authenticated', 'public.sms_pack_purchases', 'select'),
    'owners cannot read the purchase ledger directly');
select ok(not has_function_privilege('authenticated',
    'public.rpc_billing_apply_pack_payment(uuid, text, text, text, bigint, text, text)', 'execute'),
    'no signed-in user can grant themselves a pack');
select ok(not has_function_privilege('service_role',
    'public.rpc_billing_apply_credit_purchase(uuid, text, bigint)', 'execute'),
    'the legacy mint with no purchase record is closed to the application');

-- ============================================================
-- 10. A FAILED FIRST PAYMENT AFTER THE TRIAL MINTS NOTHING
-- ============================================================

-- The Stripe sequence for a Starter trial whose card fails on day eight.
select public.rpc_billing_apply_subscription(
    '00000000-c201-0000-0000-000000000005', 'sub_trial1', 'price_starter', 'starter',
    'trialing', false, now() - interval '8 days', now() - interval '1 day',
    now() - interval '1 day', 'evt_t1', now() - interval '8 days');
-- The trial's own invoice is for $0.
select is(
    public.rpc_billing_apply_invoice_paid('00000000-c201-0000-0000-000000000005', 'in_trial0',
        'starter', now() - interval '8 days', now() - interval '1 day', 0),
    'not_paid', 'the trial''s zero-amount invoice mints nothing');
-- The first real invoice fails; Stripe moves the subscription to past_due.
-- There is no invoice.paid, so there is nothing to call.
select public.rpc_billing_apply_subscription(
    '00000000-c201-0000-0000-000000000005', 'sub_trial1', 'price_starter', 'starter',
    'past_due', false, now() - interval '1 day', now() + interval '29 days',
    now() - interval '1 day', 'evt_t2', now() - interval '1 day');

select is((select count(*)::integer from public.sms_credit_grants
            where org_id = '00000000-c201-0000-0000-000000000005'),
    0, 'no grant exists after a failed first payment');
select is((select total from app.sms_balance('00000000-c201-0000-0000-000000000005')), 0::bigint,
    'zero monthly SMS');
select is(
    (select reserved from app.sms_quota_reserve('00000000-c201-0000-0000-000000000005', 1, 'res-trial-1', null)),
    false, 'and not a single segment can be sent');

select * from finish();
rollback;
