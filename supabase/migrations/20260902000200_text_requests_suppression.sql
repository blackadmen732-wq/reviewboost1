-- ReviewBoost Text Requests — suppression and the pre-send gate
--
-- Suppression answers one question, and it must be answerable in a single fast
-- lookup immediately before a message is handed to a provider: "is this
-- destination allowed to receive this Text Request right now?"
--
-- The gate combines two independent facts:
--   1. consent must be opted_in (from sms_consent_state) — unknown and
--      opted_out both block, because absence of permission is not permission;
--   2. no active suppression row may exist for the identity and purpose.
--
-- A suppression is durable and reason-tagged. Some reasons are permanent until
-- explicitly cleared (opt_out, stop_keyword, compliance, hard_bounce); others
-- are time-bounded windows (recent_send, completed_flow) that express dedupe as
-- data rather than as application memory.

create type public.sms_suppression_reason as enum (
    'opt_out', 'stop_keyword', 'compliance', 'hard_bounce', 'recent_send', 'completed_flow', 'manual'
);

create table public.sms_suppressions (
    id          uuid primary key default gen_random_uuid(),
    org_id      uuid not null references public.organizations (id) on delete cascade,
    phone_hash  text not null check (char_length(phone_hash) between 16 and 128),
    purpose     public.sms_consent_purpose not null default 'review_request',
    reason      public.sms_suppression_reason not null,

    -- Null means permanent (until explicitly removed). A timestamp means the
    -- suppression lapses on its own — the representation for a dedupe window.
    expires_at  timestamptz,

    -- Safe context only. For recent_send, the request id that set it.
    evidence    jsonb not null default '{}'::jsonb,

    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),

    -- One row per identity/purpose/reason. A repeated signal extends or renews
    -- the same row rather than accumulating duplicates.
    constraint sms_suppressions_identity_key unique (org_id, phone_hash, purpose, reason)
);

create index sms_suppressions_active_idx
    on public.sms_suppressions (org_id, phone_hash, purpose)
    where expires_at is null;
create index sms_suppressions_expiry_idx
    on public.sms_suppressions (expires_at)
    where expires_at is not null;

create trigger sms_suppressions_touch before update on public.sms_suppressions
    for each row execute function app.touch_updated_at();

alter table public.sms_suppressions enable row level security;

-- Owners and admins may read their own suppression list; no client role writes.
create policy sms_suppressions_select_admin on public.sms_suppressions
    for select to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

-- Table privilege (default privileges were revoked in 20260808000700). Read
-- only; suppression is written exclusively through the definer functions.
grant select on public.sms_suppressions to authenticated;

-- --------------------------------------------- add / remove (definer) -----

-- Upsert a suppression. For a permanent reason p_expires_at is null; for a
-- window it is a future timestamp, and a later window never shortens an
-- existing one (the longest protection wins).
create or replace function app.sms_add_suppression(
    p_org_id     uuid,
    p_phone_hash text,
    p_purpose    public.sms_consent_purpose,
    p_reason     public.sms_suppression_reason,
    p_expires_at timestamptz,
    p_evidence   jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    insert into public.sms_suppressions as s
        (org_id, phone_hash, purpose, reason, expires_at, evidence)
    values
        (p_org_id, p_phone_hash, p_purpose, p_reason, p_expires_at, coalesce(p_evidence, '{}'::jsonb))
    on conflict (org_id, phone_hash, purpose, reason) do update
        set expires_at = case
                -- A permanent suppression can never be downgraded to a window.
                when s.expires_at is null or p_expires_at is null then null
                else greatest(s.expires_at, p_expires_at)
            end,
            -- Preserve existing audit evidence when the renewal carries none.
            -- p_evidence defaults to '{}', so a bare renewal must not blank the
            -- context recorded when the suppression was first raised.
            evidence = case
                when p_evidence is null or p_evidence = '{}'::jsonb then s.evidence
                else p_evidence
            end,
            updated_at = now()
    returning id into v_id;

    return v_id;
end;
$$;

-- Remove a suppression reason (used by START to clear opt_out / stop_keyword).
-- Returns the number of rows removed so the caller can tell whether anything
-- changed.
create or replace function app.sms_remove_suppression(
    p_org_id     uuid,
    p_phone_hash text,
    p_purpose    public.sms_consent_purpose,
    p_reason     public.sms_suppression_reason
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_removed integer;
begin
    delete from public.sms_suppressions s
     where s.org_id = p_org_id
       and s.phone_hash = p_phone_hash
       and s.purpose = p_purpose
       and s.reason = p_reason;
    get diagnostics v_removed = row_count;
    return v_removed;
end;
$$;

-- ------------------------------------------ phone-level opt-out -----------
--
-- A STOP is a fact about a phone number, not about one organization. A customer
-- who texts STOP to the platform number before any business has ever recorded
-- consent for them still means "do not text me": without a phone-level record,
-- that STOP would be lost (there is no org row to attach it to) and a later
-- owner import could opt them in and text them anyway.
--
-- This table is the org-agnostic opt-out state. It is a hard gate checked ahead
-- of per-org consent, and only the customer's own START clears it — a business
-- asserting consent afterwards does not override the customer's explicit STOP.
create table public.sms_phone_optout (
    phone_hash  text primary key check (char_length(phone_hash) between 16 and 128),
    opted_out   boolean not null default true,
    last_intent text not null check (last_intent in ('stop', 'start')),
    evidence    jsonb not null default '{}'::jsonb,
    updated_at  timestamptz not null default now(),
    created_at  timestamptz not null default now()
);

-- Infrastructure / compliance state, not tenant data (it is deliberately not
-- org-scoped). RLS on with no policy denies every client role; it is reached
-- only through the definer functions below.
alter table public.sms_phone_optout enable row level security;

-- Record an inbound STOP/START at the phone level. STOP sets opted_out; START
-- clears it. Idempotent: re-applying the same intent just refreshes the row.
create or replace function app.sms_record_phone_intent(
    p_phone_hash text,
    p_intent     text,           -- 'stop' | 'start'
    p_evidence   jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_intent not in ('stop', 'start') then
        return;
    end if;
    insert into public.sms_phone_optout as p (phone_hash, opted_out, last_intent, evidence, updated_at)
    values (p_phone_hash, p_intent = 'stop', p_intent, coalesce(p_evidence, '{}'::jsonb), now())
    on conflict (phone_hash) do update
        set opted_out = (p_intent = 'stop'),
            last_intent = p_intent,
            evidence = case
                when p_evidence is null or p_evidence = '{}'::jsonb then p.evidence
                else p_evidence
            end,
            updated_at = now();
end;
$$;

-- Whether this phone currently holds a phone-level opt-out.
create or replace function app.sms_phone_opted_out(p_phone_hash text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(
        (select p.opted_out from public.sms_phone_optout p where p.phone_hash = p_phone_hash),
        false);
$$;

-- ------------------------------------------------- the pre-send gate ------

-- The single authoritative answer, evaluated immediately before dispatch.
-- Returns whether a send is permitted and, when not, the first blocking reason
-- (a suppression reason, or 'no_consent' when consent is not opted_in).
--
-- Consent is checked first: a missing opt-in blocks regardless of suppression
-- rows. Then active suppressions, most-durable first.
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
begin
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

-- Retention: lapsed windowed suppressions carry no value.
create or replace function app.sms_purge_suppressions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_purged integer;
begin
    delete from public.sms_suppressions s
     where s.expires_at is not null and s.expires_at <= now() - interval '1 day';
    get diagnostics v_purged = row_count;
    return v_purged;
end;
$$;

-- -------------------------------------------------------- grants ----------

revoke all on function app.sms_add_suppression(
    uuid, text, public.sms_consent_purpose, public.sms_suppression_reason, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function app.sms_add_suppression(
    uuid, text, public.sms_consent_purpose, public.sms_suppression_reason, timestamptz, jsonb
) to service_role;

revoke all on function app.sms_remove_suppression(
    uuid, text, public.sms_consent_purpose, public.sms_suppression_reason
) from public, anon, authenticated;
grant execute on function app.sms_remove_suppression(
    uuid, text, public.sms_consent_purpose, public.sms_suppression_reason
) to service_role;

revoke all on function app.sms_can_send(uuid, text, public.sms_consent_purpose)
    from public, anon, authenticated;
grant execute on function app.sms_can_send(uuid, text, public.sms_consent_purpose)
    to service_role;

revoke all on function app.sms_purge_suppressions() from public, anon, authenticated;
grant execute on function app.sms_purge_suppressions() to service_role;

revoke all on function app.sms_record_phone_intent(text, text, jsonb) from public, anon, authenticated;
grant execute on function app.sms_record_phone_intent(text, text, jsonb) to service_role;

revoke all on function app.sms_phone_opted_out(text) from public, anon, authenticated;
grant execute on function app.sms_phone_opted_out(text) to service_role;
