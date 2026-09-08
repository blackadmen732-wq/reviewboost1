-- Phase 1: Send/settle correctness fixes for 15k–20k business scale.
--
-- 1. sms_settle_attempt: add 'retryable' outcome (429/5xx) that fails the
--    attempt but re-queues the request instead of terminal-failing it.
-- 2. sms_request_transition_allowed: add sending→queued for retryable path;
--    REMOVE provider_unknown→queued and failed→queued to close the
--    duplicate-send footgun for automated workers.
-- 3. sms_apply_delivery_status: add FOR UPDATE on attempt lookup to prevent
--    concurrent receipt processing from double-applying.
-- 4. Compliance indexes: sms_consent_state(phone_hash) for webhook STOP
--    lookups, sms_outbox(request_id) for per-request outbox queries.


-- ======== 1. Transition table: close the duplicate-send footgun ==========

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
        -- Retryable provider errors (429/5xx) roll the request back to queued.
        -- Safe: the provider definitively rejected; no message was accepted.
        ('sending', 'queued'),
        -- Reconciliation resolves an unknown.
        ('provider_unknown', 'delivered'),
        ('provider_unknown', 'failed'),
        ('provider_unknown', 'submitted'),
        ('submitted', 'delivered'),
        ('submitted', 'failed')
        -- REMOVED: ('provider_unknown', 'queued') — automated re-queue risks
        -- double-send when a delivery receipt arrives after re-queue.
        -- REMOVED: ('failed', 'queued') — same risk; manual re-send should
        -- create a new request, not re-queue a failed one.
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
        -- Provider returned a transient error (429, 5xx). The message was NOT
        -- accepted, so there is no duplicate-send risk. Fail the attempt but
        -- move the request back to queued so the outbox can retry with a new
        -- attempt after backoff. Quota stays reserved.
        update public.sms_delivery_attempts a
           set status = 'failed', error_class = coalesce(p_error_class, 'provider_error'),
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


-- ======== 3. sms_apply_delivery_status: FOR UPDATE on attempt lookup =====

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


-- ======== 4. Compliance indexes ==========================================

-- STOP/START keyword processing looks up consent by phone_hash across all orgs.
-- The PK is (org_id, phone_hash, purpose) — a bare phone_hash scan is a seq scan.
create index if not exists sms_consent_state_phone_hash_idx
    on public.sms_consent_state (phone_hash);

-- Per-request outbox lookup (cancel, status checks). The FK exists but has no
-- supporting index, so a cancel that checks the outbox does a seq scan.
create index if not exists sms_outbox_request_id_idx
    on public.sms_outbox (request_id)
    where request_id is not null;
