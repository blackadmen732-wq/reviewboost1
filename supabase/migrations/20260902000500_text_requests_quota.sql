-- ReviewBoost Text Requests — quota ledger
--
-- Usage and billing quota is an append-only ledger. Every movement — an
-- allocation, a reservation before a send, the consumption when it goes out, a
-- release when it is suppressed, a refund, an expiration, a manual adjustment —
-- is one immutable entry with a unique correlation key. The mutable
-- `sms_quota_balance` row is a *projection*: a cache the reserve path reads and
-- updates under a row lock, never the financial source of truth. The ledger can
-- always be replayed to reconstruct it.
--
-- DOUBLE-SPEND IS PREVENTED BY THE LOCK, NOT BY HOPE
-- --------------------------------------------------
-- Reserving locks the org's balance row FOR UPDATE, so two concurrent
-- reservations for the same organization serialise; the second sees the first's
-- effect and cannot also pass an "enough available" check that only one of them
-- should. Idempotency is the unique (org, kind, correlation_key): a retried
-- reservation inserts nothing and increments nothing a second time.

create type public.sms_quota_entry_kind as enum (
    'allocation', 'reservation', 'consumption', 'release', 'refund', 'expiration', 'adjustment'
);

create table public.sms_quota_ledger (
    id              uuid primary key default gen_random_uuid(),
    org_id          uuid not null references public.organizations (id) on delete cascade,
    kind            public.sms_quota_entry_kind not null,

    -- Positive magnitude in whole message-send units. The kind carries the
    -- sign's meaning; the number is never negative.
    amount          bigint not null check (amount >= 0),

    -- Unique per (org, kind): the idempotency key that makes every effect
    -- apply exactly once.
    correlation_key text not null check (char_length(correlation_key) between 8 and 200),

    request_id      uuid,
    note            text,
    effective_at    timestamptz not null default now(),
    expires_at      timestamptz,
    created_at      timestamptz not null default now(),

    constraint sms_quota_ledger_correlation_key unique (org_id, kind, correlation_key)
);

create index sms_quota_ledger_org_time_idx on public.sms_quota_ledger (org_id, effective_at desc);
create index sms_quota_ledger_request_idx on public.sms_quota_ledger (request_id)
    where request_id is not null;

-- Projection. available = allocated - reserved - consumed.
create table public.sms_quota_balance (
    org_id     uuid primary key references public.organizations (id) on delete cascade,
    allocated  bigint not null default 0 check (allocated >= 0),
    reserved   bigint not null default 0 check (reserved >= 0),
    consumed   bigint not null default 0 check (consumed >= 0),
    updated_at timestamptz not null default now()
);

alter table public.sms_quota_ledger enable row level security;
alter table public.sms_quota_balance enable row level security;

-- Owners and admins may read their own usage; no client writes.
create policy sms_quota_ledger_select_admin on public.sms_quota_ledger
    for select to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

create policy sms_quota_balance_select_admin on public.sms_quota_balance
    for select to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

-- ------------------------------------------------ helpers (definer) -------

-- Ensure a locked balance row exists for the org and return it. Internal.
create or replace function app.sms_quota_lock_balance(p_org_id uuid)
returns public.sms_quota_balance
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_row public.sms_quota_balance%rowtype;
begin
    insert into public.sms_quota_balance (org_id) values (p_org_id)
        on conflict (org_id) do nothing;
    select * into v_row from public.sms_quota_balance b where b.org_id = p_org_id for update;
    return v_row;
end;
$$;

-- Allocate quota (a purchase, a plan grant). Idempotent on correlation_key.
create or replace function app.sms_quota_allocate(
    p_org_id          uuid,
    p_amount          bigint,
    p_correlation_key text,
    p_expires_at      timestamptz default null,
    p_note            text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_inserted uuid;
begin
    perform app.sms_quota_lock_balance(p_org_id);

    insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, expires_at, note)
    values (p_org_id, 'allocation', p_amount, p_correlation_key, p_expires_at, p_note)
    on conflict (org_id, kind, correlation_key) do nothing
    returning id into v_inserted;

    if v_inserted is null then
        return false; -- already applied
    end if;

    update public.sms_quota_balance b
       set allocated = b.allocated + p_amount, updated_at = now()
     where b.org_id = p_org_id;
    return true;
end;
$$;

-- Reserve quota ahead of a send. Returns whether it succeeded and the available
-- balance afterwards. A reservation is only taken if enough is available; the
-- balance-row lock makes that check race-free.
create or replace function app.sms_quota_reserve(
    p_org_id          uuid,
    p_amount          bigint,
    p_correlation_key text,
    p_request_id      uuid default null
)
returns table (reserved boolean, available_after bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_bal       public.sms_quota_balance%rowtype;
    v_available bigint;
    v_inserted  uuid;
begin
    v_bal := app.sms_quota_lock_balance(p_org_id);

    -- Already reserved under this key: idempotent success, no double count.
    if exists (
        select 1 from public.sms_quota_ledger l
         where l.org_id = p_org_id and l.kind = 'reservation' and l.correlation_key = p_correlation_key
    ) then
        return query select true, (v_bal.allocated - v_bal.reserved - v_bal.consumed);
        return;
    end if;

    v_available := v_bal.allocated - v_bal.reserved - v_bal.consumed;
    if v_available < p_amount then
        return query select false, v_available;
        return;
    end if;

    insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id)
    values (p_org_id, 'reservation', p_amount, p_correlation_key, p_request_id)
    returning id into v_inserted;

    update public.sms_quota_balance b
       set reserved = b.reserved + p_amount, updated_at = now()
     where b.org_id = p_org_id;

    return query select true, (v_available - p_amount);
end;
$$;

-- Consume a prior reservation (the message actually went out): reserved -> consumed.
create or replace function app.sms_quota_consume(
    p_org_id          uuid,
    p_amount          bigint,
    p_correlation_key text,
    p_request_id      uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_inserted uuid;
begin
    perform app.sms_quota_lock_balance(p_org_id);

    insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id)
    values (p_org_id, 'consumption', p_amount, p_correlation_key, p_request_id)
    on conflict (org_id, kind, correlation_key) do nothing
    returning id into v_inserted;

    if v_inserted is null then
        return false;
    end if;

    update public.sms_quota_balance b
       set reserved = greatest(0, b.reserved - p_amount),
           consumed = b.consumed + p_amount,
           updated_at = now()
     where b.org_id = p_org_id;
    return true;
end;
$$;

-- Release a reservation that will never be sent (suppressed or cancelled).
create or replace function app.sms_quota_release(
    p_org_id          uuid,
    p_amount          bigint,
    p_correlation_key text,
    p_request_id      uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_inserted uuid;
begin
    perform app.sms_quota_lock_balance(p_org_id);

    insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id)
    values (p_org_id, 'release', p_amount, p_correlation_key, p_request_id)
    on conflict (org_id, kind, correlation_key) do nothing
    returning id into v_inserted;

    if v_inserted is null then
        return false;
    end if;

    update public.sms_quota_balance b
       set reserved = greatest(0, b.reserved - p_amount), updated_at = now()
     where b.org_id = p_org_id;
    return true;
end;
$$;

-- Refund consumed quota (a provider ultimately rejected a submitted message).
create or replace function app.sms_quota_refund(
    p_org_id          uuid,
    p_amount          bigint,
    p_correlation_key text,
    p_request_id      uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_inserted uuid;
begin
    perform app.sms_quota_lock_balance(p_org_id);

    insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id)
    values (p_org_id, 'refund', p_amount, p_correlation_key, p_request_id)
    on conflict (org_id, kind, correlation_key) do nothing
    returning id into v_inserted;

    if v_inserted is null then
        return false;
    end if;

    update public.sms_quota_balance b
       set consumed = greatest(0, b.consumed - p_amount), updated_at = now()
     where b.org_id = p_org_id;
    return true;
end;
$$;

-- Available balance (projection read).
create or replace function app.sms_quota_available(p_org_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(
        (select b.allocated - b.reserved - b.consumed
           from public.sms_quota_balance b where b.org_id = p_org_id),
        0::bigint);
$$;

-- -------------------------------------------------------- grants ----------

do $$
declare
    fn text;
begin
    foreach fn in array array[
        'app.sms_quota_lock_balance(uuid)',
        'app.sms_quota_allocate(uuid, bigint, text, timestamptz, text)',
        'app.sms_quota_reserve(uuid, bigint, text, uuid)',
        'app.sms_quota_consume(uuid, bigint, text, uuid)',
        'app.sms_quota_release(uuid, bigint, text, uuid)',
        'app.sms_quota_refund(uuid, bigint, text, uuid)',
        'app.sms_quota_available(uuid)'
    ]
    loop
        execute format('revoke all on function %s from public, anon, authenticated;', fn);
        execute format('grant execute on function %s to service_role;', fn);
    end loop;
end $$;
