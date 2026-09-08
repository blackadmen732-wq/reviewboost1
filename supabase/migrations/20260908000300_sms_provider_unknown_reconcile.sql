-- Durable provider_unknown / parked-SID reconciliation.
--
-- After a timeout or 5xx parks a request as provider_unknown (credits stay
-- reserved), a topic-filtered outbox job must eventually:
--   * attach a looked-up SID and replay any parked terminal receipts, or
--   * fail the request and release the reservation.
-- Dispatch jobs never re-send these; provider_unknown → queued stays blocked.
--
-- Timeout-after-accept (provider accepted, we never stored the SID) is the
-- case this closes: a webhook may already be parked by SID, and attach_sid
-- replays it in the same transaction that writes the SID.

-- ======== 1. Claim by topic (dispatch must not grab reconcile jobs) ======

create index if not exists sms_outbox_claimable_topic_idx
    on public.sms_outbox (topic, available_at)
    where status in ('pending', 'leased');

create or replace function app.sms_enqueue_reconcile(
    p_org_id     uuid,
    p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_attempt uuid;
    v_id      uuid;
begin
    if p_org_id is null or p_request_id is null then
        return null;
    end if;

    select a.id into v_attempt
      from public.sms_delivery_attempts a
     where a.org_id = p_org_id
       and a.request_id = p_request_id
       and a.status = 'provider_unknown'
     order by a.attempt_number desc
     limit 1;

    insert into public.sms_outbox (
        org_id, topic, request_id, idempotency_key, payload
    ) values (
        p_org_id,
        'sms.reconcile',
        p_request_id,
        'reconcile:' || p_request_id::text,
        jsonb_build_object('attemptId', v_attempt)
    )
    on conflict (idempotency_key) do nothing
    returning id into v_id;

    if v_id is null then
        select o.id into v_id
          from public.sms_outbox o
         where o.idempotency_key = 'reconcile:' || p_request_id::text;
    end if;

    return v_id;
end;
$$;

create or replace function app.sms_enqueue_reconcile_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform app.sms_enqueue_reconcile(NEW.org_id, NEW.id);
    return NEW;
end;
$$;

drop trigger if exists text_requests_enqueue_reconcile on public.text_requests;
create trigger text_requests_enqueue_reconcile
    after update of status on public.text_requests
    for each row
    when (NEW.status = 'provider_unknown'::public.text_request_status
          and OLD.status is distinct from 'provider_unknown'::public.text_request_status)
    execute function app.sms_enqueue_reconcile_trigger();

-- Backfill: any existing provider_unknown request gets a reconcile job.
insert into public.sms_outbox (org_id, topic, request_id, idempotency_key, payload)
select tr.org_id,
       'sms.reconcile',
       tr.id,
       'reconcile:' || tr.id::text,
       jsonb_build_object(
           'attemptId',
           (select a.id from public.sms_delivery_attempts a
             where a.org_id = tr.org_id and a.request_id = tr.id
               and a.status = 'provider_unknown'
             order by a.attempt_number desc limit 1)
       )
  from public.text_requests tr
 where tr.status = 'provider_unknown'
on conflict (idempotency_key) do nothing;


-- ======== 2. Prepare / attach SID / fail+release ========================

create or replace function app.sms_reconcile_prepare(
    p_request_id uuid,
    p_org_id     uuid
)
returns table (
    outcome            text,
    attempt_id         uuid,
    provider           text,
    phone_encrypted    text,
    message_encrypted  text,
    dispatched_at      timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_req     public.text_requests%rowtype;
    v_attempt public.sms_delivery_attempts%rowtype;
begin
    select * into v_req from public.text_requests tr
     where tr.id = p_request_id and tr.org_id = p_org_id
       for update;
    if v_req.id is null then
        return query select 'not_found'::text, null::uuid, null::text, null::text, null::text, null::timestamptz;
        return;
    end if;

    if v_req.status is distinct from 'provider_unknown' then
        return query select ('already_' || v_req.status)::text, null::uuid, null::text, null::text, null::text, null::timestamptz;
        return;
    end if;

    select * into v_attempt from public.sms_delivery_attempts a
     where a.org_id = p_org_id
       and a.request_id = p_request_id
       and a.status = 'provider_unknown'
     order by a.attempt_number desc
     limit 1
       for update;
    if v_attempt.id is null then
        return query select 'no_attempt'::text, null::uuid, null::text, null::text, null::text, null::timestamptz;
        return;
    end if;

    return query select
        'ready'::text,
        v_attempt.id,
        v_attempt.provider,
        v_req.recipient_phone_encrypted,
        v_req.message_encrypted,
        v_attempt.dispatched_at;
end;
$$;

-- Persist a looked-up SID on a provider_unknown attempt, consume the
-- reservation (same as a normal submit), then replay any parked receipts
-- for that SID in this transaction.
create or replace function app.sms_reconcile_attach_sid(
    p_attempt_id          uuid,
    p_org_id              uuid,
    p_provider_message_id text,
    p_terminal            text,
    p_error_class         text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_attempt public.sms_delivery_attempts%rowtype;
    v_req     public.text_requests%rowtype;
    v_result  text;
begin
    if p_attempt_id is null or p_org_id is null
       or p_provider_message_id is null
       or char_length(p_provider_message_id) < 1 then
        return 'invalid';
    end if;
    if p_terminal is not null and p_terminal not in ('delivered', 'failed') then
        return 'invalid';
    end if;

    select * into v_attempt from public.sms_delivery_attempts a
     where a.id = p_attempt_id and a.org_id = p_org_id;
    if v_attempt.id is null then
        return 'not_found';
    end if;

    -- Lock request then attempt (same order as prepare) to avoid deadlocks.
    select * into v_req from public.text_requests tr
     where tr.id = v_attempt.request_id and tr.org_id = p_org_id
       for update;
    if v_req.id is null then
        return 'not_found';
    end if;

    select * into v_attempt from public.sms_delivery_attempts a
     where a.id = p_attempt_id and a.org_id = p_org_id
       for update;
    if v_attempt.id is null then
        return 'not_found';
    end if;

    -- Fail-closed: never overwrite a different SID.
    if v_attempt.provider_message_id is not null
       and v_attempt.provider_message_id is distinct from p_provider_message_id then
        return 'sid_conflict';
    end if;

    if v_req.status not in ('provider_unknown', 'submitted', 'delivered', 'failed') then
        return 'already_' || v_req.status::text;
    end if;

    if v_req.status = 'provider_unknown' then
        if not app.sms_request_transition_allowed(v_req.status, 'submitted') then
            return 'invalid_transition';
        end if;

        update public.sms_delivery_attempts a
           set provider_message_id = p_provider_message_id,
               status = 'submitted',
               reconciliation_state = 'reconciled',
               settled_at = coalesce(a.settled_at, now()),
               provider_response = a.provider_response
                   || jsonb_build_object('reconciledSid', p_provider_message_id)
         where a.id = p_attempt_id;

        update public.text_requests tr
           set status = 'submitted'
         where tr.id = v_req.id;

        perform app.sms_quota_consume(
            p_org_id, v_req.reserved_quota::bigint, 'req:' || v_req.id::text, v_req.id);

        perform app.sms_add_suppression(
            p_org_id, v_req.recipient_phone_hash, v_req.purpose, 'recent_send',
            now() + interval '24 hours',
            jsonb_build_object('request_id', v_req.id, 'via', 'reconcile'));
    elsif v_attempt.provider_message_id is null then
        update public.sms_delivery_attempts a
           set provider_message_id = p_provider_message_id
         where a.id = p_attempt_id;
    end if;

    perform app.sms_replay_parked_delivery_receipt(v_attempt.provider, p_provider_message_id);

    if p_terminal in ('delivered', 'failed') then
        v_result := app.sms_apply_delivery_status(
            v_attempt.provider, p_provider_message_id, p_terminal, p_error_class);
        if v_result in ('delivered', 'failed') then
            return v_result;
        end if;
    end if;

    select tr.status::text into v_result
      from public.text_requests tr where tr.id = v_req.id;
    return coalesce(v_result, 'submitted');
end;
$$;

create or replace function app.sms_reconcile_fail_release(
    p_request_id uuid,
    p_org_id     uuid,
    p_error      text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_req public.text_requests%rowtype;
begin
    if p_request_id is null or p_org_id is null then
        return 'invalid';
    end if;

    select * into v_req from public.text_requests tr
     where tr.id = p_request_id and tr.org_id = p_org_id
       for update;
    if v_req.id is null then
        return 'not_found';
    end if;

    if v_req.status is distinct from 'provider_unknown' then
        return v_req.status::text;
    end if;

    if not app.sms_request_transition_allowed(v_req.status, 'failed') then
        return 'invalid_transition';
    end if;

    update public.text_requests tr
       set status = 'failed', failed_at = now()
     where tr.id = p_request_id;

    update public.sms_delivery_attempts a
       set status = 'failed',
           error_class = coalesce(a.error_class, 'reconcile_exhausted'),
           reconciliation_state = 'reconciled',
           settled_at = coalesce(a.settled_at, now())
     where a.org_id = p_org_id
       and a.request_id = p_request_id
       and a.status = 'provider_unknown';

    perform app.sms_quota_release(
        p_org_id, v_req.reserved_quota::bigint, 'req:' || p_request_id::text, p_request_id);

    insert into public.audit_events
        (org_id, actor_type, action, target_type, target_id, metadata)
    values
        (p_org_id, 'system', 'text_request.reconcile_failed', 'text_request', p_request_id::text,
         jsonb_build_object('error', left(coalesce(p_error, ''), 200)));

    return 'failed';
end;
$$;


-- ======== 3. Dead-letter: topic-aware terminal paths ====================

drop function if exists app.sms_finalize_dead_lettered_request(uuid, uuid, text);

create or replace function app.sms_finalize_dead_lettered_request(
    p_request_id uuid,
    p_org_id     uuid,
    p_error      text,
    p_topic      text default 'sms.dispatch'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_req      public.text_requests%rowtype;
    v_stranded uuid;
begin
    if p_request_id is null then
        return 'no_request';
    end if;

    select * into v_req from public.text_requests tr
     where tr.id = p_request_id and tr.org_id = p_org_id
       for update;
    if v_req.id is null then
        return 'not_found';
    end if;

    -- Reconcile budget exhausted: we never confirmed a SID. Fail-closed
    -- terminal is fail+release (do not re-send).
    if p_topic = 'sms.reconcile' and v_req.status = 'provider_unknown' then
        return app.sms_reconcile_fail_release(p_request_id, p_org_id, coalesce(p_error, 'reconcile_dead_letter'));
    end if;

    -- A dispatch job must never fail+release a provider_unknown request:
    -- the provider may already have accepted the message.
    if p_topic is distinct from 'sms.reconcile' and v_req.status = 'provider_unknown' then
        perform app.sms_enqueue_reconcile(p_org_id, p_request_id);
        return 'provider_unknown';
    end if;

    if v_req.status = 'queued'
       and app.sms_request_transition_allowed(v_req.status, 'failed') then
        update public.text_requests tr
           set status = 'failed', failed_at = now()
         where tr.id = p_request_id;
        perform app.sms_quota_release(
            p_org_id, v_req.reserved_quota::bigint, 'req:' || p_request_id::text, p_request_id);
        insert into public.audit_events
            (org_id, actor_type, action, target_type, target_id, metadata)
        values
            (p_org_id, 'system', 'text_request.dead_letter_failed', 'text_request', p_request_id::text,
             jsonb_build_object('error', left(coalesce(p_error, ''), 200)));
        return 'failed';
    end if;

    if v_req.status = 'sending'
       and app.sms_request_transition_allowed(v_req.status, 'provider_unknown') then
        update public.sms_delivery_attempts a
           set status = 'provider_unknown',
               error_class = coalesce(a.error_class, 'outbox_dead_letter'),
               reconciliation_state = 'unresolved',
               settled_at = coalesce(a.settled_at, now())
         where a.org_id = p_org_id and a.request_id = p_request_id
           and a.status in ('created', 'dispatched')
        returning a.id into v_stranded;

        update public.text_requests tr set status = 'provider_unknown'
         where tr.id = p_request_id;

        insert into public.audit_events
            (org_id, actor_type, action, target_type, target_id, metadata)
        values
            (p_org_id, 'system', 'text_request.dead_letter_unknown', 'text_request', p_request_id::text,
             jsonb_build_object('attempt_id', v_stranded, 'error', left(coalesce(p_error, ''), 200)));
        return 'provider_unknown';
    end if;

    return v_req.status::text;
end;
$$;

create or replace function app.sms_outbox_fail(
    p_id             uuid,
    p_worker         text,
    p_error          text,
    p_backoff_seconds integer
)
returns public.sms_outbox_status
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_row    public.sms_outbox%rowtype;
    v_status public.sms_outbox_status;
begin
    select * into v_row from public.sms_outbox o where o.id = p_id for update;
    if v_row.id is null then
        return null;
    end if;

    if v_row.status is distinct from 'leased' or v_row.lease_owner is distinct from p_worker then
        return v_row.status;
    end if;

    if v_row.attempts >= v_row.max_attempts then
        v_status := 'dead_letter';
    else
        v_status := 'pending';
    end if;

    update public.sms_outbox o
       set status = v_status,
           last_error = left(coalesce(p_error, ''), 500),
           leased_until = null,
           lease_owner = null,
           available_at = case
               when v_status = 'pending'
               then now() + make_interval(secs => greatest(1, p_backoff_seconds))
               else o.available_at
           end,
           updated_at = now()
     where o.id = p_id;

    if v_status = 'dead_letter' then
        perform app.sms_finalize_dead_lettered_request(
            v_row.request_id, v_row.org_id, coalesce(p_error, 'outbox_dead_letter'), v_row.topic);
    end if;

    return v_status;
end;
$$;

drop function if exists app.sms_outbox_claim(text, integer, integer);

create or replace function app.sms_outbox_claim(
    p_worker        text,
    p_limit         integer,
    p_lease_seconds integer,
    p_topic         text default 'sms.dispatch'
)
returns setof public.sms_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
    r record;
    v_topic text := coalesce(nullif(p_topic, ''), 'sms.dispatch');
begin
    -- Exhausted leases of every topic: a dispatch-only cron still terminates
    -- a reconcile job that has used its budget (fail+release, never a re-send).
    for r in
        update public.sms_outbox o
           set status = 'dead_letter', leased_until = null, lease_owner = null, updated_at = now()
         where o.status = 'leased'
           and o.leased_until is not null
           and o.leased_until <= now()
           and o.attempts >= o.max_attempts
        returning o.request_id, o.org_id, o.topic
    loop
        if r.request_id is not null then
            perform app.sms_finalize_dead_lettered_request(
                r.request_id, r.org_id, 'outbox_lease_exhausted', r.topic);
        end if;
    end loop;

    return query
    with claimable as (
        select o.id
          from public.sms_outbox o
         where o.available_at <= now()
           and o.topic = v_topic
           and (
                 o.status = 'pending'
              or (o.status = 'leased' and o.leased_until is not null and o.leased_until <= now()
                  and o.attempts < o.max_attempts)
               )
         order by o.available_at
         for update skip locked
         limit greatest(1, p_limit)
    )
    update public.sms_outbox o
       set status = 'leased',
           attempts = o.attempts + 1,
           lease_owner = p_worker,
           leased_until = now() + make_interval(secs => greatest(1, p_lease_seconds)),
           updated_at = now()
      from claimable c
     where o.id = c.id
     returning o.*;
end;
$$;


-- ======== 4. RPC wrappers + grants ======================================

drop function if exists public.rpc_sms_claim_outbox(text, integer, integer);

create or replace function public.rpc_sms_claim_outbox(
    p_worker text, p_limit integer, p_lease_seconds integer,
    p_topic text default 'sms.dispatch'
)
returns setof public.sms_outbox
language sql security definer set search_path = ''
as $$ select * from app.sms_outbox_claim(p_worker, p_limit, p_lease_seconds, p_topic); $$;

create or replace function public.rpc_sms_enqueue_reconcile(p_org_id uuid, p_request_id uuid)
returns uuid language sql security definer set search_path = ''
as $$ select app.sms_enqueue_reconcile(p_org_id, p_request_id); $$;

create or replace function public.rpc_sms_reconcile_prepare(p_request_id uuid, p_org_id uuid)
returns table (
    outcome text, attempt_id uuid, provider text,
    phone_encrypted text, message_encrypted text, dispatched_at timestamptz
)
language sql security definer set search_path = ''
as $$ select * from app.sms_reconcile_prepare(p_request_id, p_org_id); $$;

create or replace function public.rpc_sms_reconcile_attach_sid(
    p_attempt_id uuid, p_org_id uuid, p_provider_message_id text,
    p_terminal text, p_error_class text
)
returns text language sql security definer set search_path = ''
as $$ select app.sms_reconcile_attach_sid(
    p_attempt_id, p_org_id, p_provider_message_id, p_terminal, p_error_class); $$;

create or replace function public.rpc_sms_reconcile_fail_release(
    p_request_id uuid, p_org_id uuid, p_error text
)
returns text language sql security definer set search_path = ''
as $$ select app.sms_reconcile_fail_release(p_request_id, p_org_id, p_error); $$;

do $$
declare
    fn text;
begin
    foreach fn in array array[
        'app.sms_enqueue_reconcile(uuid, uuid)',
        'app.sms_enqueue_reconcile_trigger()',
        'app.sms_reconcile_prepare(uuid, uuid)',
        'app.sms_reconcile_attach_sid(uuid, uuid, text, text, text)',
        'app.sms_reconcile_fail_release(uuid, uuid, text)',
        'app.sms_finalize_dead_lettered_request(uuid, uuid, text, text)',
        'app.sms_outbox_claim(text, integer, integer, text)',
        'public.rpc_sms_claim_outbox(text, integer, integer, text)',
        'public.rpc_sms_enqueue_reconcile(uuid, uuid)',
        'public.rpc_sms_reconcile_prepare(uuid, uuid)',
        'public.rpc_sms_reconcile_attach_sid(uuid, uuid, text, text, text)',
        'public.rpc_sms_reconcile_fail_release(uuid, uuid, text)'
    ]
    loop
        execute format('revoke all on function %s from public, anon, authenticated;', fn);
        execute format('grant execute on function %s to service_role;', fn);
    end loop;
end $$;
