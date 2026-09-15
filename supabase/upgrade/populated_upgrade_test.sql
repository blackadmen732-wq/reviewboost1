-- The populated-upgrade proof.
--
-- Run against a database that was built at the pre-destination baseline, filled
-- with `populated_baseline.sql`, and then migrated forward. A fresh `db reset`
-- proves the migrations can build an empty schema; only this proves they can
-- carry a real one — with its ratings, its history, and its tenant boundaries —
-- across the change.
--
--   scripts/backend/local-postgres.sh upgrade 20260902000800_dashboard_indexes.sql

begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

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
-- 5. THE CREDIT A BUSINESS ALREADY PAID FOR
-- ============================================================

-- Before the upgrade Legacy Diner could send 105 segments: 200 allocated, 5
-- held for a message in flight, 30 already sent, and 60 that had lapsed. A
-- change of ledger is not a reason for any of that to be different.
select is((select total from app.sms_balance('00000000-0e10-0000-0000-000000000001')),
          105::bigint,
          'a business can send exactly what it could send before the ledger changed');

select is((select monthly from app.sms_balance('00000000-0e10-0000-0000-000000000001')),
          65::bigint,
          'allowance that was going to expire is still allowance that expires');

select is((select purchased from app.sms_balance('00000000-0e10-0000-0000-000000000001')),
          40::bigint,
          'credit that was bought outright is still permanent');

-- The lapsed allocation was not spendable the day before the upgrade. An
-- upgrade that handed it back would be minting money.
select is((select count(*)::int from public.sms_credit_grants
            where origin_id = 'legacy-allocation:00000000-0e10-0000-0000-000000000073'),
          0, 'an allocation that had already lapsed is not resurrected');

-- A message was in flight when the ledger changed. Its reservation has to
-- still be settleable, and settling it has to move real credit.
select is((select coalesce(sum(segments), 0)::int from public.sms_reservation_slices
            where org_id = '00000000-0e10-0000-0000-000000000001'
              and correlation_key = 'req:legacy-in-flight-1'
              and status = 'held'),
          5, 'a reservation in flight across the upgrade still knows what it is holding');

select ok(app.sms_quota_consume('00000000-0e10-0000-0000-000000000001', 5,
                                'req:legacy-in-flight-1'),
          'the message that was in flight can be settled after the upgrade');

select is((select total from app.sms_balance('00000000-0e10-0000-0000-000000000001')),
          105::bigint,
          'settling a held reservation spends what was already held, not more');

-- And the provider rejected it after all. The old refund only decremented a
-- projection nobody reads any more, so the business lost the credit twice.
select ok(app.sms_quota_refund('00000000-0e10-0000-0000-000000000001', 5,
                               'req:legacy-in-flight-1'),
          'a message the provider rejected can be refunded');

select is((select total from app.sms_balance('00000000-0e10-0000-0000-000000000001')),
          110::bigint,
          'a refund gives the credit back to the business, not to nobody');

select is((select total from app.sms_balance('00000000-0e10-0000-0000-000000000002')),
          20::bigint,
          'the other tenant''s credit is its own, before and after');

select * from finish();
rollback;
