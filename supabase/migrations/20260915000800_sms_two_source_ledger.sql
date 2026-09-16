-- SMS credit has exactly two sources, and they are not interchangeable.
--
-- 1. MONTHLY INCLUDED — minted only by a *paid* invoice for a billing period,
--    expires at the end of that period, never rolls over.
-- 2. PURCHASED PREPAID — bought once, persists across renewals, survives
--    cancellation in storage, and grants no software access by itself.
--
-- Monthly is always spent first. A business that has 2 monthly and 100
-- purchased, sending a 3-segment message, ends with 0 monthly and 99
-- purchased — never 2 monthly and 97 purchased, and never a single pooled
-- number that loses the distinction and lets expiring credit sit unspent
-- while prepaid credit is burned.
--
-- WHY GRANTS AND SLICES
-- ---------------------
-- A single "available" integer cannot answer "which of these expires on
-- Thursday?". So credit lives in grants, and a reservation records exactly
-- which grants it took from and how much from each. Settling consumes those
-- same slices; releasing gives back to those same grants. The source a refund
-- returns to is the source it came from, not whichever is convenient.
--
-- The existing append-only `sms_quota_ledger` keeps its job as the audit
-- record and its idempotency keys. What changes is that the numbers it
-- describes now have a source.

-- ============================================================== grants ======

create table if not exists public.sms_credit_grants (
    id           uuid primary key default gen_random_uuid(),
    org_id       uuid not null references public.organizations (id) on delete cascade,
    source       text not null check (source in ('monthly', 'purchased')),
    segments     bigint not null check (segments > 0),
    consumed     bigint not null default 0 check (consumed >= 0),
    reserved     bigint not null default 0 check (reserved >= 0),
    granted_at   timestamptz not null default now(),
    -- Monthly expires at the billing period boundary. Purchased never does.
    expires_at   timestamptz,
    -- What caused this grant, and the id that makes it happen exactly once no
    -- matter how many times Stripe delivers the event.
    origin_kind  text not null check (origin_kind in ('invoice', 'purchase', 'manual')),
    origin_id    text not null check (char_length(origin_id) between 1 and 200),
    note         text,

    constraint sms_credit_grants_not_overspent check (consumed + reserved <= segments),
    constraint sms_credit_grants_monthly_expires
        check (source <> 'monthly' or expires_at is not null),
    constraint sms_credit_grants_purchased_persists
        check (source <> 'purchased' or expires_at is null),
    constraint sms_credit_grants_origin_key unique (org_id, origin_kind, origin_id)
);

comment on table public.sms_credit_grants is
    'Every SMS segment a business has, and where it came from. Monthly grants expire at their billing period boundary and never roll over; purchased grants never expire and survive cancellation. Spending takes monthly first.';

create index if not exists sms_credit_grants_spendable_idx
    on public.sms_credit_grants (org_id, source, expires_at, granted_at);

alter table public.sms_credit_grants enable row level security;
revoke all on public.sms_credit_grants from public, anon, authenticated;
grant select on public.sms_credit_grants to authenticated;

drop policy if exists sms_credit_grants_select on public.sms_credit_grants;
create policy sms_credit_grants_select on public.sms_credit_grants
    for select to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

-- ============================================================= slices =======

create table if not exists public.sms_reservation_slices (
    org_id          uuid not null references public.organizations (id) on delete cascade,
    correlation_key text not null,
    grant_id        uuid not null references public.sms_credit_grants (id) on delete cascade,
    segments        bigint not null check (segments > 0),
    status          text not null default 'held' check (status in ('held', 'consumed', 'released')),
    created_at      timestamptz not null default now(),
    settled_at      timestamptz,

    primary key (org_id, correlation_key, grant_id)
);

comment on table public.sms_reservation_slices is
    'Which grants one reservation took from, and how much from each. Settlement and release act on these exact slices, so credit always returns to the source it came from.';

create index if not exists sms_reservation_slices_grant_idx
    on public.sms_reservation_slices (grant_id) where status = 'held';

alter table public.sms_reservation_slices enable row level security;
revoke all on public.sms_reservation_slices from public, anon, authenticated;

-- ============================================================ granting ======

-- Idempotent on (org, origin_kind, origin_id). Fifty deliveries of the same
-- Stripe invoice produce one grant.
create or replace function app.sms_grant_credits(
    p_org_id      uuid,
    p_source      text,
    p_segments    bigint,
    p_origin_kind text,
    p_origin_id   text,
    p_expires_at  timestamptz default null,
    p_note        text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_grant_id uuid;
begin
    if p_segments is null or p_segments <= 0 then
        raise exception 'invalid_grant_amount' using errcode = 'P0001';
    end if;

    perform app.sms_quota_lock_balance(p_org_id);

    insert into public.sms_credit_grants
        (org_id, source, segments, expires_at, origin_kind, origin_id, note)
    values (p_org_id, p_source, p_segments, p_expires_at, p_origin_kind, p_origin_id, p_note)
    on conflict (org_id, origin_kind, origin_id) do nothing
    returning id into v_grant_id;

    if v_grant_id is null then
        -- Already granted. Not an error: this is what a redelivered webhook
        -- looks like, and it must change nothing.
        return null;
    end if;

    insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, expires_at, note)
    values (p_org_id, 'allocation', p_segments,
            p_origin_kind || ':' || p_origin_id, p_expires_at,
            coalesce(p_note, p_source))
    on conflict (org_id, kind, correlation_key) do nothing;

    update public.sms_quota_balance b
       set allocated = b.allocated + p_segments, updated_at = now()
     where b.org_id = p_org_id;

    return v_grant_id;
end;
$$;

revoke all on function app.sms_grant_credits(uuid, text, bigint, text, text, timestamptz, text)
    from public, anon, authenticated;

-- ============================================================ balances ======

-- What is actually spendable right now, by source. Expired monthly credit is
-- simply not counted; nothing has to sweep it for the number to be right.
create or replace function app.sms_balance(p_org_id uuid)
returns table (monthly bigint, purchased bigint, total bigint)
language sql
stable
security definer
set search_path = ''
as $$
    with spendable as (
        select g.source, sum(g.segments - g.consumed - g.reserved) as available
          from public.sms_credit_grants g
         where g.org_id = p_org_id
           and (g.expires_at is null or g.expires_at > now())
         group by g.source
    )
    select
        coalesce((select available from spendable where source = 'monthly'), 0)::bigint,
        coalesce((select available from spendable where source = 'purchased'), 0)::bigint,
        coalesce((select sum(available) from spendable), 0)::bigint;
$$;

revoke all on function app.sms_balance(uuid) from public, anon, authenticated;

create or replace function public.rpc_sms_balance(p_org_id uuid)
returns table (monthly bigint, purchased bigint, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select * from app.sms_balance(p_org_id);
$$;

revoke all on function public.rpc_sms_balance(uuid) from public, anon, authenticated;
grant execute on function public.rpc_sms_balance(uuid) to service_role;

-- ========================================================== reserving =======

-- Monthly first, then purchased; within a source, the credit that expires
-- soonest goes first. Records exactly what it took from where.
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
    v_available bigint;
    v_needed    bigint;
    v_take      bigint;
    v_grant     record;
begin
    perform app.sms_quota_lock_balance(p_org_id);

    -- Already reserved under this key: idempotent success, nothing taken twice.
    if exists (
        select 1 from public.sms_reservation_slices s
         where s.org_id = p_org_id and s.correlation_key = p_correlation_key
    ) then
        return query select true, (select total from app.sms_balance(p_org_id));
        return;
    end if;

    select total into v_available from app.sms_balance(p_org_id);

    if p_amount is null or p_amount <= 0 then
        raise exception 'invalid_reserve_amount' using errcode = 'P0001';
    end if;

    if v_available < p_amount then
        return query select false, v_available;
        return;
    end if;

    v_needed := p_amount;

    for v_grant in
        select g.id, (g.segments - g.consumed - g.reserved) as available
          from public.sms_credit_grants g
         where g.org_id = p_org_id
           and (g.expires_at is null or g.expires_at > now())
           and (g.segments - g.consumed - g.reserved) > 0
         order by
            -- Monthly before purchased, always.
            case g.source when 'monthly' then 0 else 1 end,
            -- Within a source, whatever expires soonest.
            g.expires_at asc nulls last,
            g.granted_at asc,
            g.id asc
           for update
    loop
        exit when v_needed <= 0;

        v_take := least(v_needed, v_grant.available);

        insert into public.sms_reservation_slices
            (org_id, correlation_key, grant_id, segments, status)
        values (p_org_id, p_correlation_key, v_grant.id, v_take, 'held');

        -- Qualified: this function's RETURNS TABLE also declares `reserved`,
        -- and an unqualified reference resolves to the variable, not the column.
        update public.sms_credit_grants g
           set reserved = g.reserved + v_take
         where g.id = v_grant.id;

        v_needed := v_needed - v_take;
    end loop;

    if v_needed > 0 then
        -- The balance said there was enough and the grants disagreed. That is
        -- a corrupted ledger, not a business without credit, and it must not
        -- be rounded down into a partial send.
        raise exception 'quota_slice_shortfall' using errcode = 'P0001';
    end if;

    insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id)
    values (p_org_id, 'reservation', p_amount, p_correlation_key, p_request_id)
    on conflict (org_id, kind, correlation_key) do nothing;

    update public.sms_quota_balance b
       set reserved = b.reserved + p_amount, updated_at = now()
     where b.org_id = p_org_id;

    return query select true, (v_available - p_amount);
end;
$$;

-- ========================================================== settling ========

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
    v_slice    record;
    v_inserted uuid;
begin
    perform app.sms_quota_lock_balance(p_org_id);

    insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id)
    values (p_org_id, 'consumption', p_amount, p_correlation_key, p_request_id)
    on conflict (org_id, kind, correlation_key) do nothing
    returning id into v_inserted;

    if v_inserted is null then
        return false; -- already settled
    end if;

    for v_slice in
        select s.grant_id, s.segments
          from public.sms_reservation_slices s
         where s.org_id = p_org_id
           and s.correlation_key = p_correlation_key
           and s.status = 'held'
           for update
    loop
        update public.sms_credit_grants
           set reserved = greatest(0, reserved - v_slice.segments),
               consumed = consumed + v_slice.segments
         where id = v_slice.grant_id;
    end loop;

    update public.sms_reservation_slices
       set status = 'consumed', settled_at = now()
     where org_id = p_org_id and correlation_key = p_correlation_key and status = 'held';

    update public.sms_quota_balance b
       set reserved = greatest(0, b.reserved - p_amount),
           consumed = b.consumed + p_amount,
           updated_at = now()
     where b.org_id = p_org_id;

    return true;
end;
$$;

-- ========================================================== releasing =======

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
    v_slice    record;
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

    -- Back to the grants it came from. A release that returned monthly credit
    -- as purchased would quietly hand a business permanent credit for a
    -- message it never sent.
    for v_slice in
        select s.grant_id, s.segments
          from public.sms_reservation_slices s
         where s.org_id = p_org_id
           and s.correlation_key = p_correlation_key
           and s.status = 'held'
           for update
    loop
        update public.sms_credit_grants
           set reserved = greatest(0, reserved - v_slice.segments)
         where id = v_slice.grant_id;
    end loop;

    update public.sms_reservation_slices
       set status = 'released', settled_at = now()
     where org_id = p_org_id and correlation_key = p_correlation_key and status = 'held';

    update public.sms_quota_balance b
       set reserved = greatest(0, b.reserved - p_amount), updated_at = now()
     where b.org_id = p_org_id;

    return true;
end;
$$;

-- ====================================================== legacy allocate =====

-- The old single-bucket allocate stays callable so nothing that used it
-- breaks, but credit it creates now has a source like everything else.
--
-- The mapping is the honest one: credit with an expiry behaves exactly as
-- monthly included credit does — spent first, gone at its boundary — and
-- credit without one behaves as prepaid. There is no third kind.
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
    v_grant uuid;
begin
    v_grant := app.sms_grant_credits(
        p_org_id,
        case when p_expires_at is null then 'purchased' else 'monthly' end,
        p_amount,
        'manual',
        p_correlation_key,
        p_expires_at,
        p_note);
    return v_grant is not null;
end;
$$;

-- ==================================================== available, once =======

-- One definition of "spendable", derived from the grants rather than from a
-- projection that has to be swept. Expired monthly credit stops counting the
-- moment it expires, with nothing to run and nothing to get behind.
create or replace function app.sms_quota_available(p_org_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
    select total from app.sms_balance(p_org_id);
$$;

-- ============================================= invoices mint monthly ========

-- The ONLY thing that creates monthly allowance.
--
-- Not checkout — a checkout session is an intent. Not subscription creation —
-- a subscription can exist unpaid. A *paid invoice for a billing period* is
-- the event that means money moved, and it mints exactly the plan's allowance,
-- once, expiring at the end of the period it paid for.
--
-- A failed invoice mints nothing at all, which is why there is no branch here
-- for one: the caller only reaches this on `invoice.paid`.
create or replace function public.rpc_billing_apply_invoice_paid(
    p_org_id       uuid,
    p_invoice_id   text,
    p_plan_id      text,
    p_period_start timestamptz,
    p_period_end   timestamptz,
    p_amount_paid  bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_segments integer;
    v_grant    uuid;
begin
    if p_plan_id is null or p_plan_id not in ('starter', 'growth', 'pro') then
        -- A plan nobody recognises gets nothing, rather than the cheapest
        -- tier's allowance.
        return 'no_plan';
    end if;

    if p_amount_paid is null or p_amount_paid <= 0 then
        -- A zero-amount invoice is a trial's invoice. A trial includes no SMS.
        return 'not_paid';
    end if;

    if p_period_end is null then
        raise exception 'invoice_missing_period' using errcode = 'P0001';
    end if;

    v_segments := app.entitlement_monthly_sms(p_plan_id);
    if v_segments <= 0 then
        return 'no_allowance';
    end if;

    v_grant := app.sms_grant_credits(
        p_org_id,
        'monthly',
        v_segments,
        'invoice',
        p_invoice_id,
        p_period_end,
        'monthly included for ' || p_plan_id);

    if v_grant is null then
        return 'duplicate';
    end if;

    return 'granted';
end;
$$;

revoke all on function public.rpc_billing_apply_invoice_paid(uuid, text, text, timestamptz, timestamptz, bigint)
    from public, anon, authenticated;
grant execute on function public.rpc_billing_apply_invoice_paid(uuid, text, text, timestamptz, timestamptz, bigint)
    to service_role;

-- ============================================= purchased credit packs =======

-- A one-off purchase. Duplicate delivery of the same payment produces one
-- allocation, and the credit never expires.
create or replace function public.rpc_billing_apply_credit_purchase(
    p_org_id     uuid,
    p_payment_id text,
    p_segments   bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_grant uuid;
begin
    if p_segments is null or p_segments <= 0 then
        raise exception 'invalid_purchase_amount' using errcode = 'P0001';
    end if;

    v_grant := app.sms_grant_credits(
        p_org_id, 'purchased', p_segments, 'purchase', p_payment_id, null, 'purchased pack');

    if v_grant is null then
        return 'duplicate';
    end if;

    return 'granted';
end;
$$;

revoke all on function public.rpc_billing_apply_credit_purchase(uuid, text, bigint)
    from public, anon, authenticated;
grant execute on function public.rpc_billing_apply_credit_purchase(uuid, text, bigint)
    to service_role;
