-- "Can I text this person?" for a whole contact list at once.
--
-- Text Requests now let an owner pick a customer brought in through
-- Connections, and the picker shows each one's status in plain words before
-- anything is previewed. Asking `rpc_sms_can_send` once per contact would be a
-- round trip per row; answering from `sms_consent_state` directly would be a
-- second, drifting copy of the rule.
--
-- So this asks the same gate, `app.sms_can_send`, for many numbers in one call.
-- There is still exactly one definition of who may be texted: phone-level STOP
-- first, then this business's recorded consent, then suppressions. The send
-- path calls the gate again on the chosen number; this answer is for display.
--
-- Service role only, like every other `rpc_sms_*`: the caller passes an
-- organization id, which a signed-in client must never get to choose.

create or replace function public.rpc_sms_can_send_many(
    p_org_id        uuid,
    p_phone_hashes  text[],
    p_purpose       public.sms_consent_purpose
)
returns table (phone_hash text, allowed boolean, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    -- The picker shows at most 2,000 contacts; a larger array is a mistake,
    -- not a page to work through.
    if coalesce(array_length(p_phone_hashes, 1), 0) > 2000 then
        raise exception 'too_many_numbers' using errcode = '22023';
    end if;

    return query
        select h.hash, g.allowed, g.reason
        from (select distinct unnest(p_phone_hashes) as hash) h
        cross join lateral app.sms_can_send(p_org_id, h.hash, p_purpose) g;
end;
$$;

comment on function public.rpc_sms_can_send_many(uuid, text[], public.sms_consent_purpose) is
    'app.sms_can_send for up to 2,000 numbers in one call, for the Text Requests contact picker. Display only; the send path re-checks.';

revoke all on function public.rpc_sms_can_send_many(uuid, text[], public.sms_consent_purpose)
    from public, anon, authenticated;
grant execute on function public.rpc_sms_can_send_many(uuid, text[], public.sms_consent_purpose)
    to service_role;
