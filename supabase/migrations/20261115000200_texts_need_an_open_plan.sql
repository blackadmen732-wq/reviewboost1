-- A text goes out only while the business is open for customers.
--
-- WHY
-- ---
-- Every text path asks one gate, `app.sms_can_send`: the owner's preview, the
-- contact picker, scheduling (before any credit is reserved) and the worker
-- immediately before it calls the provider. The gate checked the customer —
-- opt-out, consent, suppression — but never the business. So a business whose
-- plan had lapsed could keep texting on credit it still held (an unexpired
-- month, or a pack), and a text queued the day before a cancellation still
-- went out. Purchased credit buys texts, not software access
-- (20260915000800), and the text's own link opens the same Tag page, which a
-- lapsed business no longer serves: the customer would be asked to rate and
-- shown "This review link isn't active", and the owner charged for it.
--
-- WHAT CHANGES
-- ------------
-- The gate first asks the same question the Tags ask,
-- `app.entitlement_allows_service` over the effective status (trialing,
-- active, or the past-due grace). If the business is not open, the answer is
-- no with reason `plan_inactive`, before any per-number check. Nothing else
-- moves: dispatch already turns a closed gate into `suppressed` and releases
-- the reservation, so a queued text is not sent and its credit comes back.
-- A missing entitlement row is closed, never a generous default.
--
-- Texting is switched off in the app until the owner launches it
-- (`NEXT_PUBLIC_TEXTING_ENABLED`); this makes it safe to switch on.
--
-- Same signature and return type, so `create or replace` keeps every grant.

create or replace function app.sms_can_send(
    p_org_id     uuid,
    p_phone_hash text,
    p_purpose    public.sms_consent_purpose default 'review_request'
)
returns table (allowed boolean, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_consent public.sms_consent_status;
    v_reason  public.sms_suppression_reason;
    v_status  text;
begin
    -- The business first. A closed business sends nothing, whoever the
    -- customer is, so the owner is told the one thing they can act on.
    select app.entitlement_effective_status(e.status, e.trial_ends_at)
      into v_status
      from public.entitlement_snapshots e
     where e.org_id = p_org_id;

    if v_status is null or not app.entitlement_allows_service(v_status) then
        return query select false, 'plan_inactive'::text;
        return;
    end if;

    -- Phone-level opt-out is a hard block ahead of per-org consent: a customer's
    -- STOP applies even if this org has never recorded consent for them, and a
    -- later owner opt-in does not override it (only the customer's START does).
    if app.sms_phone_opted_out(p_phone_hash) then
        return query select false, 'opt_out'::text;
        return;
    end if;

    v_consent := app.sms_current_consent(p_org_id, p_phone_hash, p_purpose);
    if v_consent is distinct from 'opted_in'::public.sms_consent_status then
        return query select false, 'no_consent'::text;
        return;
    end if;

    select s.reason into v_reason
      from public.sms_suppressions s
     where s.org_id = p_org_id
       and s.phone_hash = p_phone_hash
       and s.purpose = p_purpose
       and (s.expires_at is null or s.expires_at > now())
     order by (s.expires_at is null) desc, s.expires_at desc nulls first
     limit 1;

    if v_reason is not null then
        return query select false, v_reason::text;
        return;
    end if;

    return query select true, null::text;
end;
$$;

revoke all on function app.sms_can_send(uuid, text, public.sms_consent_purpose)
    from public, anon, authenticated;
grant execute on function app.sms_can_send(uuid, text, public.sms_consent_purpose)
    to service_role;
