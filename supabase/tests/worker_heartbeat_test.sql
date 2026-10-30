-- The scheduler's pulse.
--
-- A worker that has stopped running raises no error of its own; these prove
-- the heartbeat records what health needs to notice, and that nobody but the
-- server can write or read it.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

select is((select count(*)::int from public.rpc_worker_health()), 2,
          'health always reports both workers, even before either has run');
select is((select last_success_age_s from public.rpc_worker_health() where worker = 'sms_dispatch'), null::bigint,
          'a worker that has never run has no success age — which health treats as stale');

select lives_ok($$select public.rpc_worker_heartbeat('sms_dispatch', 'started')$$, 'a run can start');
select lives_ok($$select public.rpc_worker_heartbeat('sms_dispatch', 'succeeded')$$, 'a run can succeed');
select ok((select last_success_age_s from public.rpc_worker_health() where worker = 'sms_dispatch') between 0 and 5,
          'a success is recent');
select is((select runs from public.worker_heartbeats where worker = 'sms_dispatch'), 1::bigint,
          'runs are counted once per start');

select public.rpc_worker_heartbeat('maintenance', 'failed', 'expire_quota: failed');
select is((select failing from public.rpc_worker_health() where worker = 'maintenance'), true,
          'a failure after the last success marks the worker failing');
select public.rpc_worker_heartbeat('maintenance', 'succeeded');
select is((select failing::text || '/' || coalesce(last_error, '<none>') from public.rpc_worker_health()
            where worker = 'maintenance'),
          'false/<none>', 'the next success clears it');

select throws_ok($$select public.rpc_worker_heartbeat('sms_dispatch', 'exploded')$$,
                 'P0001', 'invalid_heartbeat_outcome', 'only known outcomes are recorded');
select throws_ok($$select public.rpc_worker_heartbeat('crypto_miner', 'started')$$,
                 '23514', null, 'only known workers are recorded');

set local role authenticated;
select throws_ok($$select public.rpc_worker_heartbeat('sms_dispatch', 'succeeded')$$, '42501', null,
                 'a signed-in user cannot fake a heartbeat to hide a dead scheduler');
reset role;

select * from finish();
rollback;
