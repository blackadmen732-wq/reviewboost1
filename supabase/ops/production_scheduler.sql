-- Production scheduler: Supabase pg_cron + pg_net → the two worker endpoints.
--
-- WHY THIS AND NOT vercel.json
-- The Vercel project is on a plan whose crons may fire at most once a day
-- (frontend/vercel.json is the daily floor). pg_cron is already installed on
-- the production database and pg_net ships with every Supabase project, so
-- this gives every-minute dispatch at no extra cost, and is independent of
-- the Vercel plan.
--
-- WHY PREVIEWS CAN NEVER SEND
-- The jobs live only in the production database and call only the production
-- origin stored below. A preview deployment has no scheduler at all (Vercel
-- runs vercel.json crons for production deployments only), and a preview is
-- additionally refused a real SMS provider by lib/server/sms/provider.
--
-- NOT A MIGRATION: it needs this environment's origin and worker secret.
-- Run once per environment, by an operator, in the SQL editor. Idempotent:
-- re-running replaces the jobs and the secret.
--
--   1. Replace the two placeholders below. Never commit the filled-in copy.
--   2. Run it.
--   3. Verify: select jobname, schedule, active from cron.job;
--              select * from cron.job_run_details order by start_time desc limit 10;
--      and /api/v1/internal/health shows sms_dispatch / maintenance fresh.
--   4. Leave frontend/vercel.json's daily crons in place as a backstop, or
--      remove them; the workers are idempotent either way.

create extension if not exists pg_net;          -- async HTTP from Postgres
-- pg_cron is already installed on the hosted project.

-- The worker secret lives in Vault, not in the job text (cron.job is
-- readable by anyone who can read the cron schema).
do $$
declare
    v_origin constant text := '__PRODUCTION_ORIGIN__';   -- e.g. https://reviewboost.fit
    v_secret constant text := '__CRON_SECRET__';         -- same value as Vercel CRON_SECRET
begin
    if v_origin like '\_\_%' or v_secret like '\_\_%' then
        raise exception 'fill in the origin and secret placeholders first';
    end if;
    delete from vault.secrets where name in ('reviewboost_worker_origin', 'reviewboost_worker_secret');
    perform vault.create_secret(v_origin, 'reviewboost_worker_origin', 'Origin the scheduler calls');
    perform vault.create_secret(v_secret, 'reviewboost_worker_secret', 'Bearer token for /api/v1/internal/*');
end $$;

-- One helper, so both jobs read the secret the same way at run time.
create or replace function app.call_worker(p_path text)
returns bigint
language sql
security definer
set search_path = ''
as $$
    select net.http_get(
        url     := (select decrypted_secret from vault.decrypted_secrets where name = 'reviewboost_worker_origin') || p_path,
        headers := jsonb_build_object(
            'Authorization',
            'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'reviewboost_worker_secret')),
        timeout_milliseconds := 55000
    );
$$;
revoke all on function app.call_worker(text) from public, anon, authenticated;

select cron.schedule('reviewboost-sms-dispatch', '* * * * *',
                     $$select app.call_worker('/api/v1/internal/sms/dispatch')$$);
select cron.schedule('reviewboost-maintenance', '*/15 * * * *',
                     $$select app.call_worker('/api/v1/internal/maintenance')$$);

-- pg_net keeps a response log; keep it small.
select cron.schedule('reviewboost-net-cleanup', '17 * * * *',
                     $$delete from net._http_response where created < now() - interval '1 day'$$);

-- Rollback: select cron.unschedule(j) from unnest(array['reviewboost-sms-dispatch',
--           'reviewboost-maintenance','reviewboost-net-cleanup']) j;
