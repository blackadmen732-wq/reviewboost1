-- FORWARD for databases that already recorded 20260908000100 as
-- #45 privilege_attack_pass (same version, different blob).
--
-- Do NOT replay 00100's settle / transition / quota bodies. On this branch
-- 20260908000200 replaces those with the receipt-hardened versions. Replaying
-- 00100 here would regress a #45 database that just applied 00200.
--
-- 00100 pieces that no later SMS migration replaces:
--   * app.sms_apply_delivery_status FOR UPDATE (main's 20260902000600 lacks it)
--   * compliance indexes (phone_hash, outbox.request_id)
--
-- Fresh installs already applied these in 20260908000100; this file is
-- CREATE OR REPLACE / IF NOT EXISTS and is a no-op replace for them.
-- See docs/backend/ATLAS_INTEGRATION_MIGRATION_OWNERSHIP.md.

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

create index if not exists sms_consent_state_phone_hash_idx
    on public.sms_consent_state (phone_hash);

create index if not exists sms_outbox_request_id_idx
    on public.sms_outbox (request_id)
    where request_id is not null;
