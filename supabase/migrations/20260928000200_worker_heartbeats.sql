-- Did the scheduler actually run?
--
-- Every worker is idempotent and a missed run is caught by the next one, which
-- is exactly why a scheduler that has stopped is invisible: nothing errors, the
-- outbox simply stops draining, and `/internal/health` saw an empty outbox as
-- healthy. A business with no Text Requests queued looked identical to a
-- product whose dispatcher had not run for a week.
--
-- Each worker invocation now records when it started and how it ended. Health
-- compares those timestamps with the cadence the worker is meant to have, so
-- a dead or throttled scheduler is a health failure on its own, before any
-- message is late.

create table if not exists public.worker_heartbeats (
    worker             text primary key
                       check (worker in ('sms_dispatch', 'maintenance')),
    last_started_at    timestamptz,
    last_succeeded_at  timestamptz,
    last_failed_at     timestamptz,
    -- A short, operator-facing reason. Never a message body, phone or token:
    -- the caller passes an error code, not an exception dump.
    last_error         text check (last_error is null or char_length(last_error) <= 300),
    runs               bigint not null default 0,
    updated_at         timestamptz not null default now()
);

comment on table public.worker_heartbeats is
    'One row per scheduled worker: when it last started, succeeded and failed. Read by /internal/health to detect a scheduler that has stopped or slowed.';

alter table public.worker_heartbeats enable row level security;
revoke all on table public.worker_heartbeats from public, anon, authenticated;
grant select on table public.worker_heartbeats to service_role;

-- p_outcome: 'started' | 'succeeded' | 'failed'
create or replace function public.rpc_worker_heartbeat(
    p_worker  text,
    p_outcome text,
    p_error   text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_outcome not in ('started', 'succeeded', 'failed') then
        raise exception 'invalid_heartbeat_outcome' using errcode = 'P0001';
    end if;

    insert into public.worker_heartbeats as h
        (worker, last_started_at, last_succeeded_at, last_failed_at, last_error, runs)
    values
        (p_worker,
         case when p_outcome = 'started'   then now() end,
         case when p_outcome = 'succeeded' then now() end,
         case when p_outcome = 'failed'    then now() end,
         case when p_outcome = 'failed'    then left(p_error, 300) end,
         case when p_outcome = 'started'   then 1 else 0 end)
    on conflict (worker) do update
        set last_started_at   = coalesce(excluded.last_started_at, h.last_started_at),
            last_succeeded_at = coalesce(excluded.last_succeeded_at, h.last_succeeded_at),
            last_failed_at    = coalesce(excluded.last_failed_at, h.last_failed_at),
            last_error        = case p_outcome when 'failed' then excluded.last_error
                                               when 'succeeded' then null
                                               else h.last_error end,
            runs              = h.runs + excluded.runs,
            updated_at        = now();
end;
$$;

revoke all on function public.rpc_worker_heartbeat(text, text, text) from public, anon, authenticated;
grant execute on function public.rpc_worker_heartbeat(text, text, text) to service_role;

-- Seconds since each worker last succeeded (null: never), for health.
create or replace function public.rpc_worker_health()
returns table (
    worker                text,
    last_success_age_s    bigint,
    last_started_age_s    bigint,
    failing               boolean,
    last_error            text
)
language sql
stable
security definer
set search_path = ''
as $$
    select w.worker,
           extract(epoch from now() - h.last_succeeded_at)::bigint,
           extract(epoch from now() - h.last_started_at)::bigint,
           coalesce(h.last_failed_at > coalesce(h.last_succeeded_at, '-infinity'::timestamptz), false),
           h.last_error
      from (values ('sms_dispatch'), ('maintenance')) as w(worker)
      left join public.worker_heartbeats h on h.worker = w.worker
$$;

revoke all on function public.rpc_worker_health() from public, anon, authenticated;
grant execute on function public.rpc_worker_health() to service_role;
