-- The hosted-schema upgrade proof.
--
-- Run against a database built through 20260901213000 (what the hosted
-- Supabase ledger records), filled with `hosted_baseline.sql`, then migrated
-- to head. This is the production forward path: every assertion below is a
-- property the live database must still have after `supabase db push`.
--
--   scripts/backend/local-postgres.sh upgrade 20260901213000 hosted

begin;

create extension if not exists pgtap with schema extensions;

select plan(34);

-- ============================================================
-- 1. NOTHING WAS LOST
-- ============================================================

select is((select count(*)::int from public.organizations
            where id in ('00000000-0e10-0000-0000-000000000001',
                         '00000000-0e10-0000-0000-000000000002')),
          2, 'both organizations survived the upgrade');

select is((select count(*)::int from public.organization_members
            where org_id = '00000000-0e10-0000-0000-000000000001'),
          1, 'memberships survived the upgrade');

select is((select count(*)::int from public.locations
            where org_id = '00000000-0e10-0000-0000-000000000001'),
          3, 'every location survived the upgrade');

select is((select count(*)::int from public.review_stands
            where org_id in ('00000000-0e10-0000-0000-000000000001',
                             '00000000-0e10-0000-0000-000000000002')),
          3, 'every Tag survived the upgrade');

select is((select count(*)::int from public.customer_responses),
          3, 'every rating survived the upgrade');

select is((select rating from public.customer_responses
            where response_token_hash = 'legacy-response-hash-2'),
          1::smallint, 'a one-star rating is still a one-star rating');

-- The V1 public contract stopped accepting notes and Team Praise. That is a
-- change to what can be written, never to what was already written.
select is((select note_encrypted from public.customer_responses
            where response_token_hash = 'legacy-response-hash-1'),
          'v1:legacy-ciphertext-one',
          'a historical customer note is preserved verbatim');

select is((select count(*)::int from public.team_praise_records),
          1, 'historical Team Praise is preserved');

select is((select praise_note_encrypted from public.team_praise_records
            where id = '00000000-0e10-0000-0000-000000000061'),
          'v1:legacy-praise-ciphertext',
          'historical Team Praise content is preserved verbatim');

select is((select count(*)::int from public.audit_events
            where org_id = '00000000-0e10-0000-0000-000000000001'),
          1, 'audit history is preserved');

-- ============================================================
-- 2. THE CLICK HISTORY MOVED WITHOUT LOSING A ROW
-- ============================================================

select is((select count(*)::int from public.destination_selections),
          2, 'every historical Google click is now a destination selection');

select is((select provider from public.destination_selections
            where id = '00000000-0e10-0000-0000-000000000051'),
          'google', 'historical selections are attributed to Google, which is what they were');

select is((select response_id from public.destination_selections
            where id = '00000000-0e10-0000-0000-000000000051'),
          '00000000-0e10-0000-0000-000000000041'::uuid,
          'a historical selection still points at its own response');

select ok((select selected_at from public.destination_selections
            where id = '00000000-0e10-0000-0000-000000000051') < now() - interval '29 days',
          'the original click timestamp is preserved, not reset to the migration time');

-- ============================================================
-- 3. THE BACKFILL
-- ============================================================

select is((select destination_provider from public.locations
            where id = '00000000-0e10-0000-0000-000000000011'),
          'google', 'a valid legacy Google URL was adopted as a google destination');

select is((select destination_url from public.locations
            where id = '00000000-0e10-0000-0000-000000000011'),
          'https://g.page/r/legacy-main/review',
          'the adopted destination is the URL the business already had');

select is((select destination_provider from public.locations
            where id = '00000000-0e10-0000-0000-000000000012'),
          null,
          'a legacy URL that fails validation is NOT adopted — the door stays closed');

select is((select google_review_url from public.locations
            where id = '00000000-0e10-0000-0000-000000000012'),
          'https://not-google.example.com/review',
          'the unusable legacy URL is still on record for the owner to fix, not silently deleted');

select is((select destination_provider from public.locations
            where id = '00000000-0e10-0000-0000-000000000013'),
          null, 'a location that never had a URL still has no destination');

-- ============================================================
-- 4. THE DOOR STILL OPENS ON THE SAME TOKEN
-- ============================================================

-- The whole promise of the upgrade: the Tags already printed keep working,
-- and they resolve to the destination their business already configured.
select is((select destination_url from app.resolve_public_stand('legacy-token-hash-1')),
          'https://g.page/r/legacy-main/review',
          'a Tag printed before the upgrade resolves to its own destination afterwards');

-- ============================================================
-- 5. A BUSINESS THAT IS ALREADY LIVE KEEPS WORKING
-- ============================================================

-- Billing arrived after these businesses printed their Tags. They are
-- grandfathered (20260924000400): `legacy`, no invented plan, no trial clock,
-- and a door that stays open.
select is((select count(*)::int from public.entitlement_snapshots
            where org_id in ('00000000-0e10-0000-0000-000000000001',
                             '00000000-0e10-0000-0000-000000000002',
                             '00000000-0e10-0000-0000-000000000003')
              and status = 'legacy' and plan_id is null and trial_ends_at is null),
          3, 'every business that predates billing is grandfathered, with no plan and no clock');

select is(app.entitlement_allows_service('legacy'), true,
          'a grandfathered business''s Tags keep serving customers');
select is(app.entitlement_effective_status('legacy', null), 'legacy',
          'no date can turn a grandfathered business into a suspended one');

select is(public.rpc_entitlements_expire_trials(), 0,
          'the trial sweeper finds nothing to expire among existing businesses');
select is((select count(*)::int from public.entitlement_snapshots where status = 'legacy'), 3,
          'and they are all still grandfathered after it runs');

select is(app.entitlement_tag_limit(null, 'legacy'), 1,
          'grandfathering keeps what a business has; it is not a free plan to grow on');

-- New businesses are not grandfathered: they follow the billing rules.
insert into public.organizations (id, name, slug, status)
values ('00000000-0e10-0000-0000-000000000009', 'Post Billing Co', 'post-billing-co', 'active');
select isnt((select status from public.entitlement_snapshots
              where org_id = '00000000-0e10-0000-0000-000000000009'),
            'legacy', 'a business created after billing is not grandfathered');

-- Checking out moves a grandfathered business onto normal billing.
insert into public.billing_plan_prices (stripe_price_id, plan_id) values ('price_hostedstarter', 'starter');
select is(public.rpc_billing_apply_subscription(
              '00000000-0e10-0000-0000-000000000001', 'sub_legacy1', 'price_hostedstarter', null,
              'trialing', false, now(), now() + interval '7 days', now() + interval '7 days',
              'evt_legacy_1', now()),
          'applied', 'a grandfathered business can check out');
select is((select status || '/' || plan_id from public.entitlement_snapshots
            where org_id = '00000000-0e10-0000-0000-000000000001'),
          'trialing/starter', 'and from then on it is an ordinary subscriber');
delete from public.billing_subscriptions where org_id = '00000000-0e10-0000-0000-000000000001';
delete from public.billing_plan_prices where stripe_price_id = 'price_hostedstarter';

-- ============================================================
-- 6. NO MONEY APPEARED FROM NOWHERE
-- ============================================================

select is((select count(*)::int from public.billing_subscriptions), 0,
          'no subscription exists that nobody paid for');
select is((select coalesce(sum(total), 0)::bigint from public.organizations o,
                  lateral app.sms_balance(o.id)),
          0::bigint, 'no business was handed SMS credit by the upgrade');
select is((select count(*)::int from public.billing_plan_prices), 0,
          'no price grants anything until an operator maps it for this environment');

-- ============================================================
-- 7. THE TENANT BOUNDARY HELD
-- ============================================================

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"00000000-0e10-0000-0000-0000000000a1","role":"authenticated"}', true);

select is((select count(*)::int from public.organizations), 1,
          'after the upgrade an owner still sees exactly one business: their own');
select is((select count(*)::int from public.entitlement_snapshots
            where org_id = '00000000-0e10-0000-0000-000000000002'), 0,
          'and cannot read another business''s entitlement');

reset role;

select * from finish();
rollback;
