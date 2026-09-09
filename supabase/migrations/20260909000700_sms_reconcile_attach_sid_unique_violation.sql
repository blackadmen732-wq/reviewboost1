-- 20260908000600 added unique_violation → sid_conflict on attach_sid.
-- 20260909000200 (FORWARD SID conflict) CREATE OR REPLACE's the same
-- function later in apply order and drops that handler. The unique index
-- still blocks a second consume, but a concurrent claim surfaces SQLSTATE
-- 23505 instead of the contract status. Restore the handler without
-- moving 08000600 or editing the #59 forward.

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

    if v_req.status not in ('provider_unknown', 'submitted', 'delivered', 'failed') then
        return 'already_' || v_req.status::text;
    end if;

    if v_req.status = 'provider_unknown' then
        if not app.sms_request_transition_allowed(v_req.status, 'submitted') then
            return 'invalid_transition';
        end if;

        begin
            update public.sms_delivery_attempts a
               set provider_message_id = p_provider_message_id,
                   status = 'submitted',
                   reconciliation_state = 'reconciled',
                   settled_at = coalesce(a.settled_at, now()),
                   provider_response = a.provider_response
                       || jsonb_build_object('reconciledSid', p_provider_message_id)
             where a.id = p_attempt_id;
        exception
            when unique_violation then
                return 'sid_conflict';
        end;

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
        begin
            update public.sms_delivery_attempts a
               set provider_message_id = p_provider_message_id
             where a.id = p_attempt_id;
        exception
            when unique_violation then
                return 'sid_conflict';
        end;
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

do $$
begin
    revoke all on function app.sms_reconcile_attach_sid(uuid, uuid, text, text, text)
        from public, anon, authenticated;
    grant execute on function app.sms_reconcile_attach_sid(uuid, uuid, text, text, text)
        to service_role;
end $$;
