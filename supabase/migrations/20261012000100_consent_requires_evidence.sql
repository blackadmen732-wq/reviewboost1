-- An owner's "they agreed" must say how, who, and to what.
--
-- Until now the Text Requests composer sent `consent: { source: 'owner_import' }`
-- with every send, so typing a number recorded an opt-in with empty evidence.
-- The consent gate then let that number through, because it had been told the
-- customer agreed. Nobody had said so.
--
-- The composer no longer does that: consent is recorded only through an
-- explicit owner attestation that names the method, the acting user, and the
-- wording version confirmed. This migration makes the database hold the same
-- line, and undoes the opt-ins that were recorded without it.
--
--   1. app.sms_reset_unevidenced_owner_consent() appends an `unknown` event for
--      every identity whose current consent is an owner_import opt-in without
--      evidence. Appended, not deleted: the ledger stays a true history, and
--      the reset itself is visible in it. A STOP, a START or a customer's own
--      opt-in is never touched; only owner opt-ins without evidence are.
--   2. A check constraint refuses any new owner_import opt-in without the three
--      evidence keys. NOT VALID, so the historical rows stay as they were
--      written (the ledger is append-only); every new row is checked.
--
-- Effect on a business: a number it texted before without a recorded
-- agreement now shows "They haven't agreed to texts from you yet" until the
-- owner confirms how the customer agreed. Requests already scheduled to such a
-- number are refused at dispatch by the existing gate, as no_consent.

create or replace function app.sms_reset_unevidenced_owner_consent()
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
        select s.org_id, s.phone_hash, s.purpose, s.phone_encrypted,
               coalesce(s.phone_key_version, 1::smallint) as phone_key_version,
               s.phone_last_four, s.last_event_id
          from public.sms_consent_state s
          join public.sms_consent_events e on e.id = s.last_event_id
         where s.status = 'opted_in'
           and s.source = 'owner_import'
           and not (e.evidence ? 'method'
                    and e.evidence ? 'attested_by'
                    and e.evidence ? 'wording_version')
    loop
        perform app.sms_record_consent(
            r.org_id, r.phone_hash, r.phone_encrypted, r.phone_key_version, r.phone_last_four,
            r.purpose, 'unknown', 'admin', null,
            jsonb_build_object(
                'reason', 'consent_without_evidence_reset',
                'reset_event_id', r.last_event_id),
            now());
        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;

revoke all on function app.sms_reset_unevidenced_owner_consent() from public, anon, authenticated;
grant execute on function app.sms_reset_unevidenced_owner_consent() to service_role;

select app.sms_reset_unevidenced_owner_consent();

alter table public.sms_consent_events
    drop constraint if exists sms_consent_events_owner_import_evidence;
alter table public.sms_consent_events
    add constraint sms_consent_events_owner_import_evidence
    check (
        source <> 'owner_import'
        or status <> 'opted_in'
        or (evidence ? 'method' and evidence ? 'attested_by' and evidence ? 'wording_version')
    ) not valid;
