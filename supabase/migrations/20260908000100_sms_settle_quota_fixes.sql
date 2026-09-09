-- Fix: send/settle correctness, receipt-before-SID replay, and credit expiry.
--
-- 1. Transition table: add sending→queued (retryable 429), remove
--    provider_unknown→queued and failed→queued (duplicate-send footgun).
-- 2. sms_settle_attempt: add 'retryable' outcome branch.
-- 3. sms_apply_delivery_status: add FOR UPDATE on attempt lookup.
-- 4. sms_quota_apply_expirations: expire remaining unused credits, not the
--    original allocation amount.
-- 5. sms_quota_available: align pre-sweep read-path with partial expiry.
-- 6. Compliance indexes.


-- ======== 1. Transition table ============================================

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
        ('sending', 'submitted'),
        ('sending', 'failed'),
        ('sending', 'provider_unknown'),
        -- 429 rate-limit: definitively not accepted, safe to retry.
        ('sending', 'queued'),
        -- Reconciliation resolves an unknown.
        ('provider_unknown', 'delivered'),
        ('provider_unknown', 'failed'),
        ('provider_unknown', 'submitted'),
        ('submitted', 'delivered'),
        ('submitted', 'failed')
        -- REMOVED: ('provider_unknown', 'queued') — re-queue risks duplicate.
        -- REMOVED: ('failed', 'queued') — same; create a new request instead.
    );
$$;


-- ======== 2. sms_settle_attempt: add 'retryable' branch =================

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
        -- 429: provider definitively rejected, no message accepted. Fail the
        -- attempt but move the request back to queued so the outbox retries
        -- with a new attempt after backoff. Quota stays reserved.
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


-- ======== 3. sms_apply_delivery_status: FOR UPDATE on attempt ============

create or replace function app.sms_apply_delivery_status(
    p_provider   text,
    p_provider_message_id text,
    p_terminal   text,
    p_error_class text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_attempt public.sms_delivery_attempts%rowtype;
    v_req     public.text_requests%rowtype;
    p_org_id  uuid;
begin
    select * into v_attempt from public.sms_delivery_attempts a
     where a.provider = p_provider
       and a.provider_message_id = p_provider_message_id
     order by a.attempt_number desc limit 1
       for update;
    if v_attempt.id is null then
        return 'no_matching_attempt';
    end if;
    p_org_id := v_attempt.org_id;

    select * into v_req from public.text_requests tr where tr.id = v_attempt.request_id for update;

    if p_terminal = 'delivered' then
        if app.sms_request_transition_allowed(v_req.status, 'delivered') then
            update public.text_requests tr set status = 'delivered', delivered_at = now() where tr.id = v_req.id;
            update public.sms_delivery_attempts a
               set status = 'delivered', reconciliation_state = 'reconciled', settled_at = now()
             where a.id = v_attempt.id;
            if v_req.status = 'provider_unknown' then
                perform app.sms_quota_consume(p_org_id, v_req.reserved_quota::bigint, 'req:' || v_req.id::text, v_req.id);
            end if;
            return 'delivered';
        end if;
        return 'ignored';
    elsif p_terminal = 'failed' then
        if app.sms_request_transition_allowed(v_req.status, 'failed') then
            update public.text_requests tr set status = 'failed', failed_at = now() where tr.id = v_req.id;
            update public.sms_delivery_attempts a
               set status = 'failed', error_class = coalesce(p_error_class, a.error_class),
                   reconciliation_state = 'reconciled', settled_at = now()
             where a.id = v_attempt.id;
            if v_req.status = 'submitted' then
                perform app.sms_quota_refund(p_org_id, v_req.reserved_quota::bigint, 'req:' || v_req.id::text, v_req.id);
            else
                perform app.sms_quota_release(p_org_id, v_req.reserved_quota::bigint, 'req:' || v_req.id::text, v_req.id);
            end if;
            return 'failed';
        end if;
        return 'ignored';
    end if;

    return 'invalid_terminal';
end;
$$;


-- ======== 4. Credit expiry: expire REMAINING, not original ===============
--
-- Bug: allocate 100, consume 60, expire → old code expired 100 (the original
-- allocation.amount), leaving allocated = -60 + consumed = 60 → available = -120.
-- Fix: sum all consumption, reservation, release, and refund entries correlated
-- to this allocation's requests, then expire only what's left.

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
begin
    perform app.sms_quota_lock_balance(p_org_id);

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
    loop
        -- Net credits still claimed (reserved minus returned) against this
        -- grant window. Consumption is a reclassification of already-reserved
        -- credits, so counting it too would double-count.
        select coalesce(sum(
            case when u.kind = 'reservation' then u.amount
                 when u.kind in ('release', 'refund') then -u.amount
                 else 0 end
        ), 0) into v_used
          from public.sms_quota_ledger u
         where u.org_id = p_org_id
           and u.kind in ('reservation', 'release', 'refund')
           and u.effective_at >= (select al.effective_at from public.sms_quota_ledger al where al.id = r.id)
           and u.effective_at <= coalesce(
               (select min(al2.effective_at)
                  from public.sms_quota_ledger al2
                 where al2.org_id = p_org_id
                   and al2.kind = 'allocation'
                   and al2.effective_at > (select al3.effective_at from public.sms_quota_ledger al3 where al3.id = r.id)),
               now());

        v_remaining := greatest(0, r.amount - v_used);

        if v_remaining > 0 then
            insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id, note)
            values (p_org_id, 'expiration', v_remaining, 'expire:' || r.id::text, null, 'allocation expired')
            on conflict (org_id, kind, correlation_key) do nothing;
            v_total := v_total + v_remaining;
        else
            -- Everything was used; record a zero-amount expiration to mark it
            -- as processed so we don't re-scan it every sweep.
            insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id, note)
            values (p_org_id, 'expiration', 0, 'expire:' || r.id::text, null, 'fully consumed before expiry')
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


-- ======== 5. sms_quota_available: align pre-sweep read with partial expiry
--
-- The read-path must subtract the same unused remainder as the sweep, not
-- the full original allocation amount, so available stays correct between
-- expires_at and the next cron sweep.

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
    loop
        select coalesce(sum(
            case when u.kind = 'reservation' then u.amount
                 when u.kind in ('release', 'refund') then -u.amount
                 else 0 end
        ), 0) into v_used
          from public.sms_quota_ledger u
         where u.org_id = p_org_id
           and u.kind in ('reservation', 'release', 'refund')
           and u.effective_at >= (select al.effective_at from public.sms_quota_ledger al where al.id = r.id)
           and u.effective_at <= coalesce(
               (select min(al2.effective_at)
                  from public.sms_quota_ledger al2
                 where al2.org_id = p_org_id
                   and al2.kind = 'allocation'
                   and al2.effective_at > (select al3.effective_at from public.sms_quota_ledger al3 where al3.id = r.id)),
               now());

        v_unswept := v_unswept + greatest(0, r.amount - v_used);
    end loop;

    return v_base - v_unswept;
end;
$$;


-- ======== 6. Compliance indexes ==========================================

create index if not exists sms_consent_state_phone_hash_idx
    on public.sms_consent_state (phone_hash);

create index if not exists sms_outbox_request_id_idx
    on public.sms_outbox (request_id)
    where request_id is not null;
