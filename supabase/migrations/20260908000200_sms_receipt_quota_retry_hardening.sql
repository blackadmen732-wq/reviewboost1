-- Harden SMS settle / quota / retry correctness.
--
-- 1. Receipt-before-SID: park unmatched terminal receipts by provider
--    message id, then atomically replay them when settle persists the SID.
--    Do not rely on a provider retry after HTTP 200.
-- 2. Quota expiry: attribute usage with locked FIFO (effective_at, id)
--    instead of inclusive timestamp windows that double-count equal now().
-- 3. Exhausted outbox: on terminal dead_letter, fail a queued request and
--    release its reservation in the same transaction. A sending request is
--    parked as provider_unknown (unknown whether the provider was reached).


-- ======== 1. Inbox columns for parked terminal receipts =================

alter table public.sms_webhook_inbox
    add column if not exists provider_message_id text,
    add column if not exists pending_terminal text
        check (pending_terminal is null or pending_terminal in ('delivered', 'failed')),
    add column if not exists pending_error_class text;

create index if not exists sms_webhook_inbox_pending_receipt_idx
    on public.sms_webhook_inbox (provider, provider_message_id)
    where pending_terminal is not null;


-- ======== 2. Transition: queued → failed (exhausted retries) ============

create or replace function app.sms_request_transition_allowed(
    p_from public.text_request_status,
    p_to   public.text_request_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
    select (p_from, p_to) in (
        ('scheduled', 'queued'),
        ('scheduled', 'suppressed'),
        ('scheduled', 'cancelled'),
        ('queued', 'sending'),
        ('queued', 'suppressed'),
        ('queued', 'cancelled'),
        -- Outbox retry budget exhausted while the request is still queued.
        ('queued', 'failed'),
        ('sending', 'submitted'),
        ('sending', 'failed'),
        ('sending', 'provider_unknown'),
        ('sending', 'queued'),
        ('provider_unknown', 'delivered'),
        ('provider_unknown', 'failed'),
        ('provider_unknown', 'submitted'),
        ('submitted', 'delivered'),
        ('submitted', 'failed')
    );
$$;


-- ======== 3. Park / apply / replay unmatched receipts ===================

-- Persist the SID + terminal on the inbox, then try to apply. If the attempt
-- does not exist yet, the row stays reclaimable AND findable by SID so
-- sms_settle_attempt can replay it in the same transaction that writes the SID.
create or replace function app.sms_apply_or_park_delivery_status(
    p_inbox_id            uuid,
    p_provider            text,
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
    v_result text;
begin
    if p_inbox_id is null
       or p_provider is null
       or p_provider_message_id is null
       or p_terminal not in ('delivered', 'failed') then
        return 'invalid';
    end if;

    update public.sms_webhook_inbox w
       set provider_message_id = p_provider_message_id,
           pending_terminal = p_terminal,
           pending_error_class = p_error_class,
           status = 'received',
           last_error = 'unmatched_receipt',
           updated_at = now()
     where w.id = p_inbox_id;

    v_result := app.sms_apply_delivery_status(
        p_provider, p_provider_message_id, p_terminal, p_error_class);

    if v_result in ('delivered', 'failed', 'ignored') then
        update public.sms_webhook_inbox w
           set status = 'processed',
               processed_at = coalesce(w.processed_at, now()),
               pending_terminal = null,
               pending_error_class = null,
               last_error = null,
               attempts = w.attempts + 1,
               updated_at = now()
         where w.id = p_inbox_id;
    end if;

    return v_result;
end;
$$;

-- Apply every parked terminal receipt for a SID. Called from settle after the
-- attempt records its provider message id, so the webhook HTTP 200 does not
-- depend on an unsolicited provider retry.
create or replace function app.sms_replay_parked_delivery_receipt(
    p_provider            text,
    p_provider_message_id text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    r        record;
    v_result text;
    v_count  integer := 0;
begin
    if p_provider is null or p_provider_message_id is null then
        return 0;
    end if;

    for r in
        select w.id, w.pending_terminal, w.pending_error_class
          from public.sms_webhook_inbox w
         where w.provider = p_provider
           and w.provider_message_id = p_provider_message_id
           and w.pending_terminal is not null
           and w.status in ('received', 'processing')
         order by w.received_at, w.id
           for update
    loop
        v_result := app.sms_apply_delivery_status(
            p_provider, p_provider_message_id, r.pending_terminal, r.pending_error_class);
        if v_result in ('delivered', 'failed', 'ignored') then
            update public.sms_webhook_inbox w
               set status = 'processed',
                   processed_at = coalesce(w.processed_at, now()),
                   pending_terminal = null,
                   pending_error_class = null,
                   last_error = null,
                   attempts = w.attempts + 1,
                   updated_at = now()
             where w.id = r.id;
            v_count := v_count + 1;
        end if;
    end loop;

    return v_count;
end;
$$;


-- ======== 4. settle_attempt: replay parked receipts after SID ===========

create or replace function app.sms_settle_attempt(
    p_attempt_id        uuid,
    p_org_id            uuid,
    p_outcome           text,
    p_provider_message_id text,
    p_error_class       text,
    p_provider_response jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_attempt public.sms_delivery_attempts%rowtype;
    v_req     public.text_requests%rowtype;
    v_req_id  uuid;
    v_reserved integer;
begin
    select * into v_attempt from public.sms_delivery_attempts a
     where a.id = p_attempt_id and a.org_id = p_org_id for update;
    if v_attempt.id is null then
        return 'not_found';
    end if;

    if v_attempt.status not in ('created', 'dispatched') then
        return 'already_settled';
    end if;

    v_req_id := v_attempt.request_id;
    select * into v_req from public.text_requests tr where tr.id = v_req_id;
    v_reserved := v_req.reserved_quota;

    if p_outcome = 'submitted' then
        update public.sms_delivery_attempts a
           set status = 'submitted', provider_message_id = p_provider_message_id,
               provider_response = coalesce(p_provider_response, '{}'::jsonb),
               reconciliation_state = 'reconciled', settled_at = now()
         where a.id = p_attempt_id;
        update public.text_requests tr set status = 'submitted' where tr.id = v_req_id and tr.status = 'sending';
        perform app.sms_quota_consume(p_org_id, v_reserved::bigint, 'req:' || v_req_id::text, v_req_id);

        perform app.sms_add_suppression(
            p_org_id, v_req.recipient_phone_hash, v_req.purpose, 'recent_send',
            now() + interval '24 hours',
            jsonb_build_object('request_id', v_req_id));

        -- Receipt may already be parked (webhook beat this write). Replay now
        -- that the SID exists — same transaction, no provider retry needed.
        if p_provider_message_id is not null then
            perform app.sms_replay_parked_delivery_receipt(v_attempt.provider, p_provider_message_id);
        end if;

    elsif p_outcome = 'failed' then
        update public.sms_delivery_attempts a
           set status = 'failed', error_class = p_error_class,
               provider_response = coalesce(p_provider_response, '{}'::jsonb),
               reconciliation_state = 'reconciled', settled_at = now()
         where a.id = p_attempt_id;
        update public.text_requests tr set status = 'failed', failed_at = now()
         where tr.id = v_req_id and tr.status = 'sending';
        perform app.sms_quota_release(p_org_id, v_reserved::bigint, 'req:' || v_req_id::text, v_req_id);

    elsif p_outcome = 'retryable' then
        update public.sms_delivery_attempts a
           set status = 'failed', error_class = coalesce(p_error_class, 'rate_limited'),
               provider_response = coalesce(p_provider_response, '{}'::jsonb),
               reconciliation_state = 'reconciled', settled_at = now()
         where a.id = p_attempt_id;
        update public.text_requests tr set status = 'queued'
         where tr.id = v_req_id and tr.status = 'sending';

    elsif p_outcome = 'provider_unknown' then
        update public.sms_delivery_attempts a
           set status = 'provider_unknown', error_class = coalesce(p_error_class, 'timeout'),
               provider_response = coalesce(p_provider_response, '{}'::jsonb),
               reconciliation_state = 'unresolved', settled_at = now()
         where a.id = p_attempt_id;
        update public.text_requests tr set status = 'provider_unknown'
         where tr.id = v_req_id and tr.status = 'sending';
    else
        return 'invalid_outcome';
    end if;

    return p_outcome;
end;
$$;


-- ======== 5. Dead-letter: fail queued / park sending atomically ==========

-- Terminal outbox failure must not leave a queued request with a reserved
-- credit and no job. A sending request is unknown (the provider call may have
-- happened) so it is parked, not released.
create or replace function app.sms_finalize_dead_lettered_request(
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
            v_row.request_id, v_row.org_id, coalesce(p_error, 'outbox_dead_letter'));
    end if;

    return v_status;
end;
$$;

create or replace function app.sms_outbox_claim(
    p_worker        text,
    p_limit         integer,
    p_lease_seconds integer
)
returns setof public.sms_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
    r record;
begin
    -- Expired-lease jobs that have used all attempts: dead-letter and settle
    -- the request in the same transaction (queued → failed + release).
    for r in
        update public.sms_outbox o
           set status = 'dead_letter', leased_until = null, lease_owner = null, updated_at = now()
         where o.status = 'leased'
           and o.leased_until is not null
           and o.leased_until <= now()
           and o.attempts >= o.max_attempts
        returning o.request_id, o.org_id
    loop
        if r.request_id is not null then
            perform app.sms_finalize_dead_lettered_request(
                r.request_id, r.org_id, 'outbox_lease_exhausted');
        end if;
    end loop;

    return query
    with claimable as (
        select o.id
          from public.sms_outbox o
         where o.available_at <= now()
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


-- ======== 6. FIFO grant attribution =====================================

-- Oldest still-active allocation (effective_at, id) absorbs net outstanding
-- reservations first. Equal timestamps are deterministic via id. Consumption
-- is ignored (it reclassifies an existing reservation). Swept expirations
-- must not remain as prior_capacity: an unused expired grant would otherwise
-- make a later grant look unused, expire it in full, and leave reserved
-- credits against allocated=0 (negative availability).
create or replace function app.sms_quota_fifo_used(p_org_id uuid, p_allocation_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
    with net as (
        select coalesce(sum(case
                   when u.kind = 'reservation' then u.amount
                   when u.kind in ('release', 'refund') then -u.amount
                   else 0 end), 0) as used
          from public.sms_quota_ledger u
         where u.org_id = p_org_id
           and u.kind in ('reservation', 'release', 'refund')
    ),
    allocs as (
        select l.id,
               l.amount,
               coalesce(sum(l.amount) over (
                   order by l.effective_at, l.id
                   rows between unbounded preceding and 1 preceding
               ), 0) as prior_capacity
          from public.sms_quota_ledger l
         where l.org_id = p_org_id
           and l.kind = 'allocation'
           and not exists (
               select 1 from public.sms_quota_ledger e
                where e.org_id = p_org_id
                  and e.kind = 'expiration'
                  and e.correlation_key = 'expire:' || l.id::text)
    )
    select least(a.amount, greatest(0, n.used - a.prior_capacity))
      from allocs a
      cross join net n
     where a.id = p_allocation_id;
$$;

create or replace function app.sms_quota_apply_expirations(p_org_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    r           record;
    v_used      bigint;
    v_remaining bigint;
    v_total     bigint := 0;
    v_count     integer := 0;
    v_ids       uuid[] := '{}';
    v_amounts   bigint[] := '{}';
    v_useds     bigint[] := '{}';
    i           integer;
begin
    perform app.sms_quota_lock_balance(p_org_id);

    -- Snapshot FIFO attribution before writing any expiration row. A grant
    -- swept in this pass must still count as prior_capacity for later
    -- siblings in the same batch; subsequent calls exclude it via fifo_used.
    for r in
        select l.id, l.amount
          from public.sms_quota_ledger l
         where l.org_id = p_org_id
           and l.kind = 'allocation'
           and l.expires_at is not null
           and l.expires_at <= now()
           and not exists (
               select 1 from public.sms_quota_ledger e
                where e.org_id = p_org_id
                  and e.kind = 'expiration'
                  and e.correlation_key = 'expire:' || l.id::text)
         order by l.effective_at, l.id
    loop
        v_ids := array_append(v_ids, r.id);
        v_amounts := array_append(v_amounts, r.amount);
        v_useds := array_append(v_useds, coalesce(app.sms_quota_fifo_used(p_org_id, r.id), 0));
    end loop;

    for i in 1 .. coalesce(array_length(v_ids, 1), 0)
    loop
        v_used := v_useds[i];
        v_remaining := greatest(0, v_amounts[i] - v_used);

        if v_remaining > 0 then
            insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id, note)
            values (p_org_id, 'expiration', v_remaining, 'expire:' || v_ids[i]::text, null, 'allocation expired')
            on conflict (org_id, kind, correlation_key) do nothing;
            v_total := v_total + v_remaining;
        else
            insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id, note)
            values (p_org_id, 'expiration', 0, 'expire:' || v_ids[i]::text, null, 'fully consumed before expiry')
            on conflict (org_id, kind, correlation_key) do nothing;
        end if;
        v_count := v_count + 1;
    end loop;

    if v_total > 0 then
        update public.sms_quota_balance b
           set allocated = greatest(0, b.allocated - v_total), updated_at = now()
         where b.org_id = p_org_id;
    end if;

    return v_count;
end;
$$;

create or replace function app.sms_quota_available(p_org_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_base    bigint;
    v_unswept bigint := 0;
    r         record;
    v_used    bigint;
begin
    v_base := coalesce(
        (select b.allocated - b.reserved - b.consumed
           from public.sms_quota_balance b where b.org_id = p_org_id),
        0::bigint);

    for r in
        select l.id, l.amount
          from public.sms_quota_ledger l
         where l.org_id = p_org_id
           and l.kind = 'allocation'
           and l.expires_at is not null
           and l.expires_at <= now()
           and not exists (
               select 1 from public.sms_quota_ledger e
                where e.org_id = p_org_id
                  and e.kind = 'expiration'
                  and e.correlation_key = 'expire:' || l.id::text)
         order by l.effective_at, l.id
    loop
        v_used := coalesce(app.sms_quota_fifo_used(p_org_id, r.id), 0);
        v_unswept := v_unswept + greatest(0, r.amount - v_used);
    end loop;

    return v_base - v_unswept;
end;
$$;


-- ======== 7. RPC wrappers + grants ======================================

create or replace function public.rpc_sms_apply_or_park_delivery_status(
    p_inbox_id uuid, p_provider text, p_provider_message_id text,
    p_terminal text, p_error_class text
)
returns text language sql security definer set search_path = ''
as $$ select app.sms_apply_or_park_delivery_status(
    p_inbox_id, p_provider, p_provider_message_id, p_terminal, p_error_class); $$;

create or replace function public.rpc_sms_replay_parked_delivery_receipt(
    p_provider text, p_provider_message_id text
)
returns integer language sql security definer set search_path = ''
as $$ select app.sms_replay_parked_delivery_receipt(p_provider, p_provider_message_id); $$;

do $$
declare
    fn text;
begin
    foreach fn in array array[
        'app.sms_apply_or_park_delivery_status(uuid, text, text, text, text)',
        'app.sms_replay_parked_delivery_receipt(text, text)',
        'app.sms_finalize_dead_lettered_request(uuid, uuid, text)',
        'app.sms_quota_fifo_used(uuid, uuid)',
        'public.rpc_sms_apply_or_park_delivery_status(uuid, text, text, text, text)',
        'public.rpc_sms_replay_parked_delivery_receipt(text, text)'
    ]
    loop
        execute format('revoke all on function %s from public, anon, authenticated;', fn);
        execute format('grant execute on function %s to service_role;', fn);
    end loop;
end $$;
