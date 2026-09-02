-- ReviewBoost Text Requests — the request model and its provider attempts
--
-- One `text_requests` row is one intended review-request message to one phone.
-- Its lifecycle is an explicit state machine, never a mutable `sent = true`
-- boolean: a boolean cannot tell "accepted by the provider" from "delivered"
-- from "we submitted it and never learned the outcome", and those differences
-- decide whether it is safe to send again.
--
-- One logical request may have several `sms_delivery_attempts` — a provider
-- timeout, a transient failure, a reconciliation. The request holds the
-- business state; the attempts hold what each provider handoff actually did.

-- ----------------------------------------------------------- enums --------

create type public.text_request_status as enum (
    'scheduled',        -- created, waiting for its (quiet-hours-adjusted) window
    'queued',           -- handed to the outbox, not yet dispatched
    'suppressed',       -- the pre-send gate blocked it; terminal
    'sending',          -- an attempt is in flight to the provider
    'submitted',        -- the provider accepted it for delivery
    'delivered',        -- the provider reported delivery; terminal (success)
    'failed',           -- the provider reported failure; terminal
    'provider_unknown', -- submitted, outcome unknown — needs reconciliation
    'cancelled'         -- cancelled before dispatch; terminal
);

create type public.sms_attempt_status as enum (
    'created', 'dispatched', 'submitted', 'delivered', 'failed', 'provider_unknown'
);

-- ------------------------------------------------------ text_requests -----

create table public.text_requests (
    id                        uuid primary key default gen_random_uuid(),
    org_id                    uuid not null references public.organizations (id) on delete cascade,
    location_id               uuid not null,
    stand_id                  uuid not null,

    purpose                   public.sms_consent_purpose not null default 'review_request',
    status                    public.text_request_status not null default 'scheduled',

    -- Recipient identity, stored like every other phone: hashed for matching,
    -- encrypted for the rare read-back, last-four for recognition.
    recipient_phone_hash      text not null check (char_length(recipient_phone_hash) between 16 and 128),
    recipient_phone_encrypted text,
    recipient_phone_key_version smallint not null default 1,
    recipient_last_four       text check (recipient_last_four is null or recipient_last_four ~ '^[0-9]{2,4}$'),

    -- The rendered message, including the /q/<token> link. Encrypted, because
    -- the link contains the stand's opaque token in clear and that token is a
    -- capability — it is keyed-hashed everywhere else and must not sit readable
    -- in a business table.
    message_encrypted         text not null,
    message_key_version       smallint not null default 1,

    -- Segment accounting cached at schedule time; the preview endpoint is the
    -- authoritative recompute.
    encoding                  text not null check (encoding in ('gsm7', 'ucs2')),
    unit_count                integer not null check (unit_count >= 0),
    segments                  integer not null check (segments >= 1),

    -- Money is integer micro-units of the currency, never a float. Provider
    -- prices are quoted per segment in millionths, so cents cannot represent
    -- them without rounding.
    estimated_cost_micros     bigint not null default 0 check (estimated_cost_micros >= 0),
    cost_currency             char(3) not null default 'USD' check (cost_currency ~ '^[A-Z]{3}$'),

    -- IANA zone resolved for the recipient; the send window is computed from it.
    recipient_timezone        text not null default 'UTC',
    scheduled_for             timestamptz not null default now(),

    -- Quota reserved for this request, released or consumed as it settles.
    reserved_quota            integer not null default 0 check (reserved_quota >= 0),

    -- Application-supplied dedupe key: unique per org, so repeated clicks,
    -- retries, and concurrent schedulers converge on one request.
    dedupe_key                text not null check (char_length(dedupe_key) between 8 and 200),

    suppressed_reason         text,
    suppressed_at             timestamptz,
    sent_at                   timestamptz,
    delivered_at              timestamptz,
    failed_at                 timestamptz,
    completed_at              timestamptz,  -- the customer completed the rating flow
    cancelled_at              timestamptz,

    created_by                uuid references auth.users (id) on delete set null,
    request_id                text,

    created_at                timestamptz not null default now(),
    updated_at                timestamptz not null default now(),

    constraint text_requests_id_org_key unique (id, org_id),
    constraint text_requests_dedupe_key unique (org_id, dedupe_key),
    constraint text_requests_location_fk
        foreign key (location_id, org_id) references public.locations (id, org_id) on delete cascade,
    constraint text_requests_stand_fk
        foreign key (stand_id, org_id) references public.review_stands (id, org_id) on delete cascade
);

create index text_requests_org_created_idx on public.text_requests (org_id, created_at desc);
create index text_requests_org_status_idx on public.text_requests (org_id, status, scheduled_for);
create index text_requests_recipient_idx
    on public.text_requests (org_id, recipient_phone_hash, purpose, created_at desc);

create trigger text_requests_touch before update on public.text_requests
    for each row execute function app.touch_updated_at();

-- --------------------------------------------------- delivery attempts ----

create table public.sms_delivery_attempts (
    id                  uuid primary key default gen_random_uuid(),
    org_id              uuid not null references public.organizations (id) on delete cascade,
    request_id          uuid not null,

    attempt_number      integer not null check (attempt_number >= 1),
    provider            text not null check (char_length(provider) between 1 and 40),
    provider_message_id text,

    status              public.sms_attempt_status not null default 'created',
    -- Normalised, vendor-independent error class (e.g. 'invalid_number',
    -- 'rate_limited', 'carrier_rejected', 'timeout'), never a raw provider code.
    error_class         text,

    -- Safe provider metadata only. Never the message body, the number, or
    -- credentials — the raw event lives, encrypted, in the webhook inbox.
    provider_response   jsonb not null default '{}'::jsonb,

    -- 'pending' until the provider's terminal status is known; 'reconciled'
    -- once matched to a webhook or status poll; 'unresolved' when a
    -- provider_unknown could not be settled and needs a human.
    reconciliation_state text not null default 'pending'
        check (reconciliation_state in ('pending', 'reconciled', 'unresolved')),

    dispatched_at       timestamptz,
    settled_at          timestamptz,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),

    constraint sms_delivery_attempts_number_key unique (org_id, request_id, attempt_number),
    constraint sms_delivery_attempts_request_fk
        foreign key (request_id, org_id) references public.text_requests (id, org_id) on delete cascade
);

-- At most one in-flight attempt per request. This is the duplicate-send guard:
-- a second worker cannot open a new attempt while one is still created or
-- dispatched, so the provider is never handed the same request twice
-- concurrently.
create unique index sms_delivery_attempts_one_inflight_idx
    on public.sms_delivery_attempts (request_id)
    where status in ('created', 'dispatched');

create index sms_delivery_attempts_request_idx
    on public.sms_delivery_attempts (org_id, request_id, attempt_number desc);
create index sms_delivery_attempts_provider_msg_idx
    on public.sms_delivery_attempts (provider, provider_message_id)
    where provider_message_id is not null;

create trigger sms_delivery_attempts_touch before update on public.sms_delivery_attempts
    for each row execute function app.touch_updated_at();

-- ------------------------------------------------------------ RLS ---------

alter table public.text_requests enable row level security;
alter table public.sms_delivery_attempts enable row level security;

-- Members may read the request list (owners run the product, staff may need to
-- see what went out); no client role writes — scheduling and lifecycle happen
-- only through definer functions, so a member cannot fabricate a sent request
-- or move one to 'delivered'.
create policy text_requests_select_member on public.text_requests
    for select to authenticated
    using (app.is_org_member(org_id));

create policy sms_delivery_attempts_select_admin on public.sms_delivery_attempts
    for select to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

-- Table privileges (default privileges were revoked in 20260808000700). Read
-- only for every client role: scheduling and lifecycle happen only through the
-- definer functions, so a member cannot fabricate or advance a request.
grant select on public.text_requests to authenticated;
grant select on public.sms_delivery_attempts to authenticated;

-- ------------------------------------------- transition validity ----------

-- The allowed edges of the state machine, in one place. A transition function
-- consults this so no code path can invent an edge (e.g. 'delivered' back to
-- 'sending', or 'cancelled' to anything).
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
        -- Reconciliation resolves an unknown, or a retry re-enters sending.
        ('provider_unknown', 'delivered'),
        ('provider_unknown', 'failed'),
        ('provider_unknown', 'submitted'),
        ('provider_unknown', 'queued'),
        ('submitted', 'delivered'),
        ('submitted', 'failed'),
        -- A transient failure may be re-queued for another attempt.
        ('failed', 'queued')
    );
$$;

revoke all on function app.sms_request_transition_allowed(
    public.text_request_status, public.text_request_status
) from public, anon, authenticated;
grant execute on function app.sms_request_transition_allowed(
    public.text_request_status, public.text_request_status
) to service_role;
