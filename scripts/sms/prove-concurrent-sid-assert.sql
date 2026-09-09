-- After two sessions race-attach the same fake SID: exactly one consume,
-- one sid_conflict leftover, never two owners of fake_race_sid.

\set ON_ERROR_STOP on

do $$
declare
    v_owners integer;
    v_consume integer;
    v_unknown integer;
    v_terminal integer;
begin
    select count(*) into v_owners
      from public.sms_delivery_attempts
     where provider = 'fake' and provider_message_id = 'fake_race_sid';

    if v_owners <> 1 then
        raise exception 'expected exactly 1 SID owner, got %', v_owners;
    end if;

    select count(*) into v_consume
      from public.sms_quota_ledger
     where org_id = 'c1000000-0000-0000-0000-00000000000a'
       and kind = 'consumption'
       and correlation_key in (
            'req:' || (select id from public.text_requests where dedupe_key = 'sms-prove-race-a')::text,
            'req:' || (select id from public.text_requests where dedupe_key = 'sms-prove-race-b')::text);

    if v_consume <> 1 then
        raise exception 'expected exactly 1 consumption, got %', v_consume;
    end if;

    select count(*) into v_unknown
      from public.text_requests
     where dedupe_key in ('sms-prove-race-a', 'sms-prove-race-b')
       and status = 'provider_unknown';

    select count(*) into v_terminal
      from public.text_requests
     where dedupe_key in ('sms-prove-race-a', 'sms-prove-race-b')
       and status in ('submitted', 'delivered');

    if v_unknown <> 1 or v_terminal <> 1 then
        raise exception 'expected 1 still-unknown and 1 submitted/delivered, got unknown=% terminal=%',
            v_unknown, v_terminal;
    end if;
end $$;

select 'concurrent SID race: one owner, one consume, no double spend' as prove_concurrent_sid;
