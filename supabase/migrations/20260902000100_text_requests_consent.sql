-- ReviewBoost Text Requests — consent ledger and phone identity
--
-- The first phone number ReviewBoost ever stores. The anonymous customer flow
-- deliberately collects no phone; Text Requests introduce one, so this file
-- establishes how a phone is stored and how consent to text it is recorded.
--
-- PHONE IDENTITY
-- --------------
-- A phone is stored the way tokens are: a keyed digest for matching, and a
-- separately-keyed AES-256-GCM ciphertext for the rare case it must be read
-- back. `phone_hash` is computed by the application with the same HMAC used for
-- stand tokens (domain-separated 'sms_phone'), so a database disclosure does
-- not yield a dialable number, and two rows for the same number collide on the
-- hash without the number appearing in clear. `phone_last_four` is the only
-- non-secret fragment, so an owner can recognise a recipient in a list.
--
-- CONSENT IS A LEDGER, NOT A FLAG
-- -------------------------------
-- The existence of a phone number is never consent. Consent is an event with a
-- purpose, a status, a source, and evidence, appended to `sms_consent_events`
-- and never overwritten — the history of how permission changed is itself the
-- compliance record. `sms_consent_state` is a *projection* of the latest event
-- per (org, phone, purpose): a cache the pre-send check can read in one lookup,
-- maintained inside the same transaction as the event it reflects. The events
-- are the source of truth; the state is derived.

-- ----------------------------------------------------------- enums --------

-- Why a customer may be texted. Extensible; the product only sends review
-- requests today, and marketing is deliberately absent.
create type public.sms_consent_purpose as enum ('review_request');

-- opted_in grants a send. opted_out blocks it. unknown is the honest default
-- for a number we have never asked about — never treated as permission.
create type public.sms_consent_status as enum ('opted_in', 'opted_out', 'unknown');

-- Where the consent signal came from. Inbound STOP/START land as reply_stop /
-- reply_start so the audit trail distinguishes a customer's own keyword from an
-- owner action.
create type public.sms_consent_source as enum (
    'customer_flow', 'owner_import', 'reply_start', 'reply_stop', 'api', 'admin'
);

-- ------------------------------------------------- consent events ---------

-- Append-only. No update or delete policy exists, and the server never rewrites
-- a row: correcting a mistake is another event, so the record of what was known
-- and when is preserved.
create table public.sms_consent_events (
    id                 uuid primary key default gen_random_uuid(),
    org_id             uuid not null references public.organizations (id) on delete cascade,

    -- Keyed digest of the E.164 number. Never the number itself.
    phone_hash         text not null check (char_length(phone_hash) between 16 and 128),
    -- AES-256-GCM ciphertext, so the number can be shown to its own owner when
    -- strictly necessary. The key version travels with the row so a rotation
    -- does not orphan old ciphertext.
    phone_encrypted    text,
    phone_key_version  smallint not null default 1,
    -- The only non-secret fragment. Recognition, not identity.
    phone_last_four    text check (phone_last_four is null or phone_last_four ~ '^[0-9]{2,4}$'),

    purpose            public.sms_consent_purpose not null default 'review_request',
    status             public.sms_consent_status not null,
    source             public.sms_consent_source not null,

    -- The location the consent relates to, when it was captured at one. Optional
    -- and carries org_id so the composite FK refuses a cross-org link.
    location_id        uuid,

    -- Safe context only: never a raw number, a token, or a decrypted note. A
    -- keyword reply stores the normalized keyword and the inbound event id.
    evidence           jsonb not null default '{}'::jsonb,

    occurred_at        timestamptz not null default now(),
    created_at         timestamptz not null default now(),

    constraint sms_consent_events_location_fk
        foreign key (location_id, org_id) references public.locations (id, org_id) on delete set null
);

create index sms_consent_events_lookup_idx
    on public.sms_consent_events (org_id, phone_hash, purpose, occurred_at desc);
create index sms_consent_events_org_time_idx
    on public.sms_consent_events (org_id, occurred_at desc);

-- ------------------------------------------------- consent state ----------

-- The current effective consent per (org, phone, purpose). A projection of the
-- latest event, not an independent source of truth.
create table public.sms_consent_state (
    org_id             uuid not null references public.organizations (id) on delete cascade,
    phone_hash         text not null,
    purpose            public.sms_consent_purpose not null,

    status             public.sms_consent_status not null,
    source             public.sms_consent_source not null,

    phone_encrypted    text,
    phone_key_version  smallint not null default 1,
    phone_last_four    text,

    last_event_id      uuid not null references public.sms_consent_events (id) on delete cascade,
    updated_at         timestamptz not null default now(),

    primary key (org_id, phone_hash, purpose)
);

create index sms_consent_state_org_status_idx
    on public.sms_consent_state (org_id, purpose, status);

-- ------------------------------------------------------------ RLS ---------

alter table public.sms_consent_events enable row level security;
alter table public.sms_consent_state  enable row level security;

-- Owners and admins may read the consent history for their own organization;
-- members and viewers cannot, because a phone number and its opt-out state are
-- more sensitive than the feedback body. No client role may write: consent is
-- only ever recorded through the definer functions below, so a member cannot
-- fabricate an opt-in.
create policy sms_consent_events_select_admin on public.sms_consent_events
    for select to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

create policy sms_consent_state_select_admin on public.sms_consent_state
    for select to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

-- ------------------------------------------- record consent (definer) -----

-- Append one consent event and refresh the projection atomically.
--
-- Idempotent on (org, phone, purpose, source, status, occurred_at): re-running
-- the same signal — a retried import row, a duplicate inbound webhook — does not
-- append a second identical event. A genuinely new signal (different status or
-- a later time) always appends.
--
-- Runs as the service role only. The number is hashed and encrypted by the
-- application before it ever reaches this function.
create or replace function app.sms_record_consent(
    p_org_id            uuid,
    p_phone_hash        text,
    p_phone_encrypted   text,
    p_phone_key_version smallint,
    p_phone_last_four   text,
    p_purpose           public.sms_consent_purpose,
    p_status            public.sms_consent_status,
    p_source            public.sms_consent_source,
    p_location_id       uuid,
    p_evidence          jsonb,
    p_occurred_at       timestamptz default now()
)
returns table (event_id uuid, appended boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_event_id uuid;
    v_current  public.sms_consent_state%rowtype;
begin
    -- Lock the projection row for this identity so two concurrent signals for
    -- the same number serialise rather than racing to write the state.
    select * into v_current
      from public.sms_consent_state s
     where s.org_id = p_org_id
       and s.phone_hash = p_phone_hash
       and s.purpose = p_purpose
       for update;

    -- Exact-duplicate suppression: same status from the same source at the same
    -- instant is a replay, not a new fact.
    if v_current.org_id is not null
       and v_current.status = p_status
       and v_current.source = p_source then
        return query select v_current.last_event_id, false;
        return;
    end if;

    insert into public.sms_consent_events
        (org_id, phone_hash, phone_encrypted, phone_key_version, phone_last_four,
         purpose, status, source, location_id, evidence, occurred_at)
    values
        (p_org_id, p_phone_hash, p_phone_encrypted, p_phone_key_version, p_phone_last_four,
         p_purpose, p_status, p_source, p_location_id, coalesce(p_evidence, '{}'::jsonb), p_occurred_at)
    returning id into v_event_id;

    insert into public.sms_consent_state as st
        (org_id, phone_hash, purpose, status, source,
         phone_encrypted, phone_key_version, phone_last_four, last_event_id, updated_at)
    values
        (p_org_id, p_phone_hash, p_purpose, p_status, p_source,
         p_phone_encrypted, p_phone_key_version, p_phone_last_four, v_event_id, now())
    on conflict (org_id, phone_hash, purpose) do update
        set status = excluded.status,
            source = excluded.source,
            -- Keep the newest ciphertext we were given, but never blank an
            -- existing one with a null (an inbound STOP carries no ciphertext).
            phone_encrypted = coalesce(excluded.phone_encrypted, st.phone_encrypted),
            phone_key_version = coalesce(excluded.phone_key_version, st.phone_key_version),
            phone_last_four = coalesce(excluded.phone_last_four, st.phone_last_four),
            last_event_id = excluded.last_event_id,
            updated_at = now();

    return query select v_event_id, true;
end;
$$;

-- Current effective consent for one identity. Returns 'unknown' when no event
-- has ever been recorded — the number's existence is not permission.
create or replace function app.sms_current_consent(
    p_org_id     uuid,
    p_phone_hash text,
    p_purpose    public.sms_consent_purpose default 'review_request'
)
returns public.sms_consent_status
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(
        (select s.status
           from public.sms_consent_state s
          where s.org_id = p_org_id
            and s.phone_hash = p_phone_hash
            and s.purpose = p_purpose),
        'unknown'::public.sms_consent_status);
$$;

-- -------------------------------------------------------- grants ----------

revoke all on function app.sms_record_consent(
    uuid, text, text, smallint, text,
    public.sms_consent_purpose, public.sms_consent_status, public.sms_consent_source,
    uuid, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function app.sms_record_consent(
    uuid, text, text, smallint, text,
    public.sms_consent_purpose, public.sms_consent_status, public.sms_consent_source,
    uuid, jsonb, timestamptz
) to service_role;

revoke all on function app.sms_current_consent(uuid, text, public.sms_consent_purpose)
    from public, anon, authenticated;
grant execute on function app.sms_current_consent(uuid, text, public.sms_consent_purpose)
    to service_role;
