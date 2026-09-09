-- SMS correctness follow-up on the #47 / #53 / #54 stack.
--
-- Migration version 20260908000400 is #54 sms_reconcile_sid_conflict (leave
-- it alone). 20260908000500 is #59 privilege_attack_pass. This file is
-- 000600 — do not steal 000400 or 000500.
--
-- 1) Concurrent SID claiming: unique (provider, SID) plus advisory lock and
--    unique_violation → sid_conflict so two unbound attempts cannot both
--    consume the same provider message.
-- 2) Ambiguous matching: two unresolved attempts for the same recipient
--    cannot guess which SID belongs to which request (ambiguous_match).
--    Twilio list lookup already returns unknown for 2+ exact bodies.
-- 3) Expired credits: after release/refund, residual unused capacity on an
--    expired grant is expired again so it cannot be reserved.

-- ======== 1. Unique provider SID =========================================

drop index if exists public.sms_delivery_attempts_provider_msg_idx;

create unique index sms_delivery_attempts_provider_sid_uidx
    on public.sms_delivery_attempts (provider, provider_message_id)
    where provider_message_id is not null;


-- ======== 2. Expiration attribution (residuals after release/refund) ======

create or replace function app.sms_quota_expiration_amount(
    p_org_id        uuid,
    p_allocation_id uuid
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(sum(e.amount), 0)
      from public.sms_quota_ledger e
     where e.org_id = p_org_id
       and e.kind = 'expiration'
       and (
            e.correlation_key = 'expire:' || p_allocation_id::text
         or e.correlation_key like ('expire:' || p_allocation_id::text || '#%')
       );
$$;

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
               l.effective_at,
               greatest(0, l.amount - app.sms_quota_expiration_amount(p_org_id, l.id)) as remaining
          from public.sms_quota_ledger l
         where l.org_id = p_org_id
           and l.kind = 'allocation'
    ),
    ranked as (
        select a.id,
               a.remaining,
               coalesce(sum(a.remaining) over (
                   order by a.effective_at, a.id
                   rows between unbounded preceding and 1 preceding
               ), 0) as prior_capacity
          from allocs a
    )
    select least(r.remaining, greatest(0, n.used - r.prior_capacity))
      from ranked r
      cross join net n
     where r.id = p_allocation_id;
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
    v_already   bigint;
    v_should    bigint;
    v_gap       bigint;
    v_n         integer;
    v_key       text;
    v_total     bigint := 0;
    v_count     integer := 0;
begin
    perform app.sms_quota_lock_balance(p_org_id);

    for r in
        select l.id, l.amount
          from public.sms_quota_ledger l
         where l.org_id = p_org_id
           and l.kind = 'allocation'
           and l.expires_at is not null
           and l.expires_at <= now()
         order by l.effective_at, l.id
    loop
        v_used := coalesce(app.sms_quota_fifo_used(p_org_id, r.id), 0);
        v_already := app.sms_quota_expiration_amount(p_org_id, r.id);
        v_should := greatest(0, r.amount - v_used);
        v_gap := v_should - v_already;

        if v_gap > 0 then
            select count(*) into v_n
              from public.sms_quota_ledger e
             where e.org_id = p_org_id
               and e.kind = 'expiration'
               and (
                    e.correlation_key = 'expire:' || r.id::text
                 or e.correlation_key like ('expire:' || r.id::text || '#%')
               );
            if v_n = 0 then
                v_key := 'expire:' || r.id::text;
            else
                v_key := 'expire:' || r.id::text || '#' || (v_n + 1)::text;
            end if;

            insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id, note)
            values (p_org_id, 'expiration', v_gap, v_key, null,
                    case when v_n = 0 then 'allocation expired'
                         else 'expired residual after release/refund' end)
            on conflict (org_id, kind, correlation_key) do nothing;
            v_total := v_total + v_gap;
            v_count := v_count + 1;
        elsif v_already = 0 then
            insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id, note)
            values (p_org_id, 'expiration', 0, 'expire:' || r.id::text, null, 'fully consumed before expiry')
            on conflict (org_id, kind, correlation_key) do nothing;
            v_count := v_count + 1;
        end if;
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
    v_already bigint;
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
         order by l.effective_at, l.id
    loop
        v_used := coalesce(app.sms_quota_fifo_used(p_org_id, r.id), 0);
        v_already := app.sms_quota_expiration_amount(p_org_id, r.id);
        v_unswept := v_unswept + greatest(0, r.amount - v_used - v_already);
    end loop;

    return v_base - v_unswept;
end;
$$;

create or replace function app.sms_quota_release(
    p_org_id          uuid,
    p_amount          bigint,
    p_correlation_key text,
    p_request_id      uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_inserted uuid;
begin
    perform app.sms_quota_lock_balance(p_org_id);

    insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id)
    values (p_org_id, 'release', p_amount, p_correlation_key, p_request_id)
    on conflict (org_id, kind, correlation_key) do nothing
    returning id into v_inserted;

    if v_inserted is null then
        return false;
    end if;

    update public.sms_quota_balance b
       set reserved = greatest(0, b.reserved - p_amount), updated_at = now()
     where b.org_id = p_org_id;

    -- Residual unused capacity on expired grants must not become spendable.
    perform app.sms_quota_apply_expirations(p_org_id);
    return true;
end;
$$;

create or replace function app.sms_quota_refund(
    p_org_id          uuid,
    p_amount          bigint,
    p_correlation_key text,
    p_request_id      uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_inserted uuid;
begin
    perform app.sms_quota_lock_balance(p_org_id);

    insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id)
    values (p_org_id, 'refund', p_amount, p_correlation_key, p_request_id)
    on conflict (org_id, kind, correlation_key) do nothing
    returning id into v_inserted;

    if v_inserted is null then
        return false;
    end if;

    update public.sms_quota_balance b
       set consumed = greatest(0, b.consumed - p_amount), updated_at = now()
     where b.org_id = p_org_id;

    perform app.sms_quota_apply_expirations(p_org_id);
    return true;
end;
$$;


-- ======== 3. Atomic SID attach ===========================================

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
    v_attempt    public.sms_delivery_attempts%rowtype;
    v_req        public.text_requests%rowtype;
    v_result     text;
    v_constraint text;
begin
    if p_attempt_id is null or p_org_id is null
       or p_provider_message_id is null
       or char_length(p_provider_message_id) < 1 then
        return 'invalid';
    end if;
    if p_terminal is not null and p_terminal not in ('delivered', 'failed') then
        return 'invalid';
    end if;

    -- Lock attempt then request — same order as settle / apply_delivery_status.
    select * into v_attempt from public.sms_delivery_attempts a
     where a.id = p_attempt_id and a.org_id = p_org_id
       for update;
    if v_attempt.id is null then
        return 'not_found';
    end if;

    select * into v_req from public.text_requests tr
     where tr.id = v_attempt.request_id and tr.org_id = p_org_id
       for update;
    if v_req.id is null then
        return 'not_found';
    end if;

    -- Serialize same-recipient and same-SID attachers in this transaction.
    perform pg_advisory_xact_lock(
        hashtext('sms.rcpt:' || v_attempt.provider || ':' || v_req.recipient_phone_hash));
    perform pg_advisory_xact_lock(
        hashtext('sms.sid:' || v_attempt.provider || ':' || p_provider_message_id));

    -- Fail-closed: never overwrite a different SID on this attempt.
    if v_attempt.provider_message_id is not null
       and v_attempt.provider_message_id is distinct from p_provider_message_id then
        return 'sid_conflict';
    end if;

    -- Fail-closed: never steal a SID already bound to another attempt.
    if exists (
        select 1 from public.sms_delivery_attempts o
         where o.provider = v_attempt.provider
           and o.provider_message_id = p_provider_message_id
           and o.id is distinct from p_attempt_id
    ) then
        return 'sid_conflict';
    end if;

    -- Two unresolved attempts to the same recipient cannot be distinguished
    -- by a singleton list hit (same To, often the same body). Do not guess.
    if v_attempt.provider_message_id is null
       and exists (
        select 1
          from public.sms_delivery_attempts o
          join public.text_requests otr
            on otr.id = o.request_id and otr.org_id = o.org_id
         where o.provider = v_attempt.provider
           and o.id is distinct from p_attempt_id
           and o.provider_message_id is null
           and o.status in ('created', 'dispatched', 'provider_unknown')
           and otr.recipient_phone_hash = v_req.recipient_phone_hash
           and otr.purpose = v_req.purpose
    ) then
        return 'ambiguous_match';
    end if;

    if v_req.status not in ('provider_unknown', 'submitted', 'delivered', 'failed') then
        return 'already_' || v_req.status::text;
    end if;

    begin
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
    exception
        when unique_violation then
            get stacked diagnostics v_constraint = constraint_name;
            if v_constraint = 'sms_delivery_attempts_provider_sid_uidx' then
                return 'sid_conflict';
            end if;
            raise;
    end;

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


-- ======== 4. Settle refuses a SID another attempt already owns ===========

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
    v_attempt    public.sms_delivery_attempts%rowtype;
    v_req        public.text_requests%rowtype;
    v_req_id     uuid;
    v_reserved   integer;
    v_constraint text;
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
    select * into v_req from public.text_requests tr where tr.id = v_req_id for update;
    v_reserved := v_req.reserved_quota;

    if p_outcome = 'submitted' then
        if p_provider_message_id is not null then
            perform pg_advisory_xact_lock(
                hashtext('sms.sid:' || v_attempt.provider || ':' || p_provider_message_id));
            if exists (
                select 1 from public.sms_delivery_attempts o
                 where o.provider = v_attempt.provider
                   and o.provider_message_id = p_provider_message_id
                   and o.id is distinct from p_attempt_id
            ) then
                return 'sid_conflict';
            end if;
        end if;

        begin
            update public.sms_delivery_attempts a
               set status = 'submitted', provider_message_id = p_provider_message_id,
                   provider_response = coalesce(p_provider_response, '{}'::jsonb),
                   reconciliation_state = 'reconciled', settled_at = now()
             where a.id = p_attempt_id;
        exception
            when unique_violation then
                get stacked diagnostics v_constraint = constraint_name;
                if v_constraint = 'sms_delivery_attempts_provider_sid_uidx' then
                    return 'sid_conflict';
                end if;
                raise;
        end;

        update public.text_requests tr set status = 'submitted' where tr.id = v_req_id and tr.status = 'sending';
        perform app.sms_quota_consume(p_org_id, v_reserved::bigint, 'req:' || v_req_id::text, v_req_id);

        perform app.sms_add_suppression(
            p_org_id, v_req.recipient_phone_hash, v_req.purpose, 'recent_send',
            now() + interval '24 hours',
            jsonb_build_object('request_id', v_req_id));

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


-- ======== 5. Grants ======================================================

do $$
declare
    fn text;
begin
    foreach fn in array array[
        'app.sms_quota_expiration_amount(uuid, uuid)',
        'app.sms_quota_fifo_used(uuid, uuid)',
        'app.sms_quota_apply_expirations(uuid)',
        'app.sms_quota_available(uuid)',
        'app.sms_quota_release(uuid, bigint, text, uuid)',
        'app.sms_quota_refund(uuid, bigint, text, uuid)',
        'app.sms_reconcile_attach_sid(uuid, uuid, text, text, text)',
        'app.sms_settle_attempt(uuid, uuid, text, text, text, jsonb)'
    ]
    loop
        execute format('revoke all on function %s from public, anon, authenticated;', fn);
        execute format('grant execute on function %s to service_role;', fn);
    end loop;
end $$;
