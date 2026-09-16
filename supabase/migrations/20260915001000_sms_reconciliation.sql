-- The workers that finish what a send starts.
--
-- Two things are left hanging by a real provider integration, and both cost
-- money if nobody picks them up.
--
-- 1. PROVIDER_UNKNOWN. The submit request timed out *after* it left, so nobody
--    knows whether the provider accepted it. Retrying risks sending twice, so
--    the pipeline correctly does neither: it does not retry and it does not
--    touch the quota. But a reservation held forever is credit a business
--    cannot spend on a message they may never have sent.
--
--    After the reconciliation window closes, the reservation is SETTLED AS
--    SPENT, not released. The provider probably did accept it, and the
--    asymmetry matters: settling a message that never went out costs a
--    business one segment, while releasing one that did go out hands out free
--    sends forever to anyone who can cause a timeout. The attempt stays
--    `unresolved` so it is visible and countable rather than quietly closed.
--
-- 2. DEAD LETTERS. An outbox job that exhausted its attempts before any
--    provider submit. Nothing left, so the reservation is released — that one
--    is unambiguous.

create or replace function app.sms_reconcile_aged_unknowns(p_older_than_seconds integer default 900)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    r       record;
    v_count integer := 0;
begin
    for r in
        select a.id, a.org_id, a.request_id, tr.reserved_quota
          from public.sms_delivery_attempts a
          join public.text_requests tr on tr.id = a.request_id
         where a.status = 'provider_unknown'
           and a.reconciliation_state = 'unresolved'
           and a.settled_at < now() - make_interval(secs => greatest(p_older_than_seconds, 60))
           and coalesce(tr.reserved_quota, 0) > 0
    loop
        -- Idempotent on the correlation key, so a second pass changes nothing.
        if app.sms_quota_consume(r.org_id, r.reserved_quota::bigint,
                                 'req:' || r.request_id::text, r.request_id) then
            v_count := v_count + 1;
        end if;
    end loop;

    return v_count;
end;
$$;

revoke all on function app.sms_reconcile_aged_unknowns(integer) from public, anon, authenticated;

create or replace function public.rpc_sms_reconcile_aged_unknowns(p_older_than_seconds integer default 900)
returns integer
language sql
security invoker
set search_path = ''
as $$
    select app.sms_reconcile_aged_unknowns(p_older_than_seconds);
$$;

revoke all on function public.rpc_sms_reconcile_aged_unknowns(integer) from public, anon, authenticated;
grant execute on function public.rpc_sms_reconcile_aged_unknowns(integer) to service_role;

-- --------------------------------------------------------- dead letters ----

create or replace function app.sms_release_dead_letters()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    r       record;
    v_count integer := 0;
begin
    for r in
        select o.id as outbox_id, tr.id as request_id, tr.org_id, tr.reserved_quota
          from public.sms_outbox o
          join public.text_requests tr on tr.id = o.request_id
         where o.status = 'dead_letter'
           and tr.status in ('queued', 'sending')
           and coalesce(tr.reserved_quota, 0) > 0
           -- Only when nothing ever reached the provider. An attempt that did
           -- is the previous function's business, not this one's.
           and not exists (
               select 1 from public.sms_delivery_attempts a
                where a.request_id = tr.id
                  and a.status in ('submitted', 'delivered', 'provider_unknown')
           )
    loop
        if app.sms_quota_release(r.org_id, r.reserved_quota::bigint,
                                 'req:' || r.request_id::text, r.request_id) then
            update public.text_requests
               set status = 'failed', failed_at = now()
             where id = r.request_id and status in ('queued', 'sending');
            v_count := v_count + 1;
        end if;
    end loop;

    return v_count;
end;
$$;

revoke all on function app.sms_release_dead_letters() from public, anon, authenticated;

create or replace function public.rpc_sms_release_dead_letters()
returns integer
language sql
security invoker
set search_path = ''
as $$
    select app.sms_release_dead_letters();
$$;

revoke all on function public.rpc_sms_release_dead_letters() from public, anon, authenticated;
grant execute on function public.rpc_sms_release_dead_letters() to service_role;

-- ------------------------------------------------------- what to watch -----

-- The numbers an operator needs to know whether the pipeline is healthy,
-- in one read rather than five. Counts only: nothing here carries a phone
-- number, a message, or a token.
create or replace function public.rpc_sms_health()
returns table (
    outbox_pending        bigint,
    outbox_dead_letter    bigint,
    oldest_pending_age_s  bigint,
    provider_unknown      bigint,
    oldest_unknown_age_s  bigint,
    webhooks_unprocessed  bigint,
    stripe_unprocessed    bigint
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        (select count(*) from public.sms_outbox where status = 'pending'),
        (select count(*) from public.sms_outbox where status = 'dead_letter'),
        (select coalesce(extract(epoch from now() - min(created_at))::bigint, 0)
           from public.sms_outbox where status = 'pending'),
        (select count(*) from public.sms_delivery_attempts
          where status = 'provider_unknown' and reconciliation_state = 'unresolved'),
        (select coalesce(extract(epoch from now() - min(settled_at))::bigint, 0)
           from public.sms_delivery_attempts
          where status = 'provider_unknown' and reconciliation_state = 'unresolved'),
        (select count(*) from public.sms_webhook_inbox where processed_at is null),
        (select count(*) from public.stripe_webhook_events where processed_at is null);
$$;

revoke all on function public.rpc_sms_health() from public, anon, authenticated;
grant execute on function public.rpc_sms_health() to service_role;
