-- ReviewBoost Text Requests — transactional outbox and webhook inbox
--
-- Two durable queues, both owned by the database so a crash cannot lose or
-- double an intent.
--
-- OUTBOX: when a request that needs external work is committed, its job is
-- committed in the *same transaction*. An in-memory queue would be a second,
-- non-transactional source of truth that a crash between "commit request" and
-- "enqueue job" silently desynchronises. Workers claim with a lease under
-- FOR UPDATE SKIP LOCKED, so many workers run without handing the same job to
-- two of them, and an expired lease is reclaimable after a crash.
--
-- WEBHOOK INBOX: every provider event is written here first, deduplicated by
-- the provider's own event id, before any business processing. A provider that
-- retries a delivery receipt therefore cannot double-apply it, and a malformed
-- or unverified event is captured rather than lost.

-- ----------------------------------------------------------- outbox -------

create type public.sms_outbox_status as enum (
    'pending', 'leased', 'done', 'failed', 'dead_letter'
);

create table public.sms_outbox (
    id              uuid primary key default gen_random_uuid(),
    org_id          uuid not null references public.organizations (id) on delete cascade,
    topic           text not null check (char_length(topic) between 1 and 60),

    -- The business row this job acts on, when there is one. Composite FK keeps
    -- the job and its request in the same organization.
    request_id      uuid,

    -- Globally unique. The same intent enqueued twice (a retry of the schedule
    -- call) collapses to one job.
    idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),

    payload         jsonb not null default '{}'::jsonb,

    status          public.sms_outbox_status not null default 'pending',
    attempts        integer not null default 0 check (attempts >= 0),
    max_attempts    integer not null default 8 check (max_attempts >= 1),

    -- Not eligible for claim until now >= available_at. Backoff moves this
    -- forward on each transient failure.
    available_at    timestamptz not null default now(),
    leased_until    timestamptz,
    lease_owner     text,
    last_error      text,

    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    constraint sms_outbox_request_fk
        foreign key (request_id, org_id) references public.text_requests (id, org_id) on delete cascade
);

-- The claim hot path: eligible rows ordered by availability.
create index sms_outbox_claimable_idx
    on public.sms_outbox (available_at)
    where status in ('pending', 'leased');

create trigger sms_outbox_touch before update on public.sms_outbox
    for each row execute function app.touch_updated_at();

-- --------------------------------------------------------- webhook inbox --

create type public.sms_webhook_status as enum (
    'received', 'processing', 'processed', 'failed'
);

create table public.sms_webhook_inbox (
    id                uuid primary key default gen_random_uuid(),
    provider          text not null check (char_length(provider) between 1 and 40),
    -- The provider's own event identifier, when present. Kept for forensics.
    provider_event_id text,
    -- What we deduplicate on: the provider event id, or a digest of the raw
    -- body when the provider sends none. Unique per provider.
    dedupe_key        text not null check (char_length(dedupe_key) between 8 and 200),

    event_type        text,
    -- Whether the provider signature verified. An unverified event is stored
    -- but must not drive business state.
    signature_verified boolean not null default false,

    -- Redacted headers only (no Authorization, no signature secret).
    headers           jsonb not null default '{}'::jsonb,
    -- The raw payload, encrypted: it can contain a phone number.
    raw_body_encrypted text,

    -- Resolved during processing, once the event is matched to a request.
    org_id            uuid references public.organizations (id) on delete set null,

    status            public.sms_webhook_status not null default 'received',
    attempts          integer not null default 0 check (attempts >= 0),
    received_at       timestamptz not null default now(),
    processed_at      timestamptz,
    last_error        text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),

    constraint sms_webhook_inbox_dedupe_key unique (provider, dedupe_key)
);

create index sms_webhook_inbox_unprocessed_idx
    on public.sms_webhook_inbox (received_at)
    where status in ('received', 'processing');

create trigger sms_webhook_inbox_touch before update on public.sms_webhook_inbox
    for each row execute function app.touch_updated_at();

-- ------------------------------------------------------------ RLS ---------
--
-- Both tables are infrastructure, not tenant data. RLS is enabled with no
-- policy, which denies every client role; the server reaches them only through
-- the definer functions below (as the service role).

alter table public.sms_outbox enable row level security;
alter table public.sms_webhook_inbox enable row level security;

-- ------------------------------------------- outbox claim / settle --------

-- Claim up to p_limit eligible jobs for one worker, atomically.
--
-- Eligible means: pending and due, OR leased with an expired lease (the worker
-- that held it crashed). SKIP LOCKED lets concurrent workers claim disjoint
-- sets without blocking each other. Each claim increments attempts and takes a
-- fresh lease.
create or replace function app.sms_outbox_claim(
    p_worker        text,
    p_limit         integer,
    p_lease_seconds integer
)
returns setof public.sms_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
    return query
    with claimable as (
        select o.id
          from public.sms_outbox o
         where o.available_at <= now()
           and (
                 o.status = 'pending'
              or (o.status = 'leased' and o.leased_until is not null and o.leased_until <= now())
               )
         order by o.available_at
         for update skip locked
         limit greatest(1, p_limit)
    )
    update public.sms_outbox o
       set status = 'leased',
           attempts = o.attempts + 1,
           lease_owner = p_worker,
           leased_until = now() + make_interval(secs => greatest(1, p_lease_seconds)),
           updated_at = now()
      from claimable c
     where o.id = c.id
     returning o.*;
end;
$$;

-- Mark a claimed job done.
create or replace function app.sms_outbox_complete(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
    update public.sms_outbox o
       set status = 'done', leased_until = null, lease_owner = null, updated_at = now()
     where o.id = p_id;
$$;

-- Record a transient failure: back off and retry, or dead-letter once attempts
-- reach max_attempts. Dead-letter is a durable "needs a human", never a silent
-- drop.
create or replace function app.sms_outbox_fail(
    p_id             uuid,
    p_error          text,
    p_backoff_seconds integer
)
returns public.sms_outbox_status
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_row    public.sms_outbox%rowtype;
    v_status public.sms_outbox_status;
begin
    select * into v_row from public.sms_outbox o where o.id = p_id for update;
    if v_row.id is null then
        return null;
    end if;

    if v_row.attempts >= v_row.max_attempts then
        v_status := 'dead_letter';
    else
        v_status := 'pending';
    end if;

    update public.sms_outbox o
       set status = v_status,
           last_error = left(coalesce(p_error, ''), 500),
           leased_until = null,
           lease_owner = null,
           available_at = case
               when v_status = 'pending'
               then now() + make_interval(secs => greatest(1, p_backoff_seconds))
               else o.available_at
           end,
           updated_at = now()
     where o.id = p_id;

    return v_status;
end;
$$;

-- ------------------------------------------- webhook receive / claim ------

-- Write a provider event durably. On a duplicate (provider, dedupe_key) this is
-- a harmless no-op that returns the existing row's id — a retried webhook does
-- not create a second record and cannot double-apply.
create or replace function app.sms_webhook_receive(
    p_provider          text,
    p_provider_event_id text,
    p_dedupe_key        text,
    p_event_type        text,
    p_signature_verified boolean,
    p_headers           jsonb,
    p_raw_body_encrypted text
)
returns table (inbox_id uuid, inserted boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    insert into public.sms_webhook_inbox
        (provider, provider_event_id, dedupe_key, event_type,
         signature_verified, headers, raw_body_encrypted)
    values
        (p_provider, p_provider_event_id, p_dedupe_key, p_event_type,
         coalesce(p_signature_verified, false), coalesce(p_headers, '{}'::jsonb), p_raw_body_encrypted)
    on conflict (provider, dedupe_key) do nothing
    returning id into v_id;

    if v_id is not null then
        return query select v_id, true;
        return;
    end if;

    select w.id into v_id
      from public.sms_webhook_inbox w
     where w.provider = p_provider and w.dedupe_key = p_dedupe_key;

    return query select v_id, false;
end;
$$;

-- Mark a webhook event's processing outcome.
create or replace function app.sms_webhook_settle(
    p_id     uuid,
    p_status public.sms_webhook_status,
    p_org_id uuid,
    p_error  text
)
returns void
language sql
security definer
set search_path = ''
as $$
    update public.sms_webhook_inbox w
       set status = p_status,
           org_id = coalesce(p_org_id, w.org_id),
           attempts = w.attempts + 1,
           processed_at = case when p_status = 'processed' then now() else w.processed_at end,
           last_error = case when p_error is null then w.last_error else left(p_error, 500) end,
           updated_at = now()
     where w.id = p_id;
$$;

-- -------------------------------------------------------- grants ----------

do $$
declare
    fn text;
begin
    foreach fn in array array[
        'app.sms_outbox_claim(text, integer, integer)',
        'app.sms_outbox_complete(uuid)',
        'app.sms_outbox_fail(uuid, text, integer)',
        'app.sms_webhook_receive(text, text, text, text, boolean, jsonb, text)',
        'app.sms_webhook_settle(uuid, public.sms_webhook_status, uuid, text)'
    ]
    loop
        execute format('revoke all on function %s from public, anon, authenticated;', fn);
        execute format('grant execute on function %s to service_role;', fn);
    end loop;
end $$;
