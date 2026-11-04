-- A realistic pre-destination database, with the old single-bucket SMS ledger.
--
-- The populated-upgrade proof starts here: migrations applied through
-- 20260902000800, then this data, then the rest of the migrations.
--
--   scripts/backend/local-postgres.sh upgrade 20260902000800

\ir baseline_core.sql

-- ---------------------------------------------------------------- SMS credit

-- Credit under the old single-bucket ledger, in the awkward shapes that exist
-- in a real database: allowance that will expire, credit that was bought and
-- never expires, an allocation that already lapsed and was never swept, and a
-- reservation still in flight for a message nobody has heard back about.
--
-- Legacy Diner: allocated 200, of which 60 has lapsed; 30 spent and 5 held.
-- What it can actually send today is 200 - 5 - 30 - 60 = 105 segments, and
-- that is the number the upgrade has to still be true after it runs.
insert into public.sms_quota_ledger
    (id, org_id, kind, amount, correlation_key, effective_at, expires_at, note)
values
    ('00000000-0e10-0000-0000-000000000071', '00000000-0e10-0000-0000-000000000001',
     'allocation', 100, 'alloc:legacy-monthly-1', now() - interval '10 days',
     now() + interval '20 days', 'monthly allowance'),
    ('00000000-0e10-0000-0000-000000000072', '00000000-0e10-0000-0000-000000000001',
     'allocation', 40, 'alloc:legacy-purchased-1', now() - interval '40 days',
     null, 'a pack the business bought'),
    -- Lapsed and never swept. It was not spendable before the upgrade and it
    -- must not become spendable because of it.
    ('00000000-0e10-0000-0000-000000000073', '00000000-0e10-0000-0000-000000000001',
     'allocation', 60, 'alloc:legacy-expired-1', now() - interval '70 days',
     now() - interval '2 days', 'last month''s allowance'),
    ('00000000-0e10-0000-0000-000000000074', '00000000-0e10-0000-0000-000000000001',
     'consumption', 30, 'legacy-consumption-history', now() - interval '6 days',
     null, 'messages already sent'),
    -- In flight: reserved, never consumed, never released.
    ('00000000-0e10-0000-0000-000000000075', '00000000-0e10-0000-0000-000000000001',
     'reservation', 5, 'req:legacy-in-flight-1', now() - interval '1 hour',
     null, 'a message awaiting its receipt'),
    ('00000000-0e10-0000-0000-000000000076', '00000000-0e10-0000-0000-000000000002',
     'allocation', 20, 'alloc:rival-purchased-1', now() - interval '3 days',
     null, 'the other tenant''s pack');

insert into public.sms_quota_balance (org_id, allocated, reserved, consumed)
values
    ('00000000-0e10-0000-0000-000000000001', 200, 5, 30),
    ('00000000-0e10-0000-0000-000000000002', 20, 0, 0);
