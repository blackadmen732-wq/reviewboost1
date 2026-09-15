-- Billing state, and the one place Stripe is allowed to write it.
--
-- THE AUTHORITY
-- -------------
-- Stripe's webhooks and this database are what decide whether a business is
-- entitled to anything. A browser landing on a success page is not: it proves
-- a redirect happened, not that money moved, and it can be opened by anyone
-- who knows the URL. Nothing in this schema is reachable from a browser.
--
-- WHAT MAKES A WEBHOOK SAFE
-- -------------------------
-- Stripe delivers at least once, out of order, and retries for days. So:
--   * the event is written to a durable inbox keyed by Stripe's own event id,
--     which is what makes a redelivery a no-op rather than a second charge of
--     consequences;
--   * the signature is verified *before* anything is written, so the inbox
--     cannot be filled by anyone who can reach the URL;
--   * every subscription write carries the event's timestamp, and an older
--     event cannot overwrite a newer one — a `customer.subscription.updated`
--     that arrives after the `deleted` that followed it must not resurrect a
--     cancelled plan;
--   * the subscription row and the entitlement it implies are written in the
--     same transaction, so there is no moment where a business is paid-up in
--     one table and cut off in the other.

-- ===================================================== stripe customers =====

create table if not exists public.billing_customers (
    org_id             uuid primary key references public.organizations (id) on delete cascade,
    stripe_customer_id text not null unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

comment on table public.billing_customers is
    'One Stripe customer per organization. The unique constraint is what stops a second checkout creating a second customer and a second subscription for the same business.';

alter table public.billing_customers enable row level security;
revoke all on public.billing_customers from public, anon, authenticated;
-- Deliberately not readable by members: it carries no information an owner
-- needs and every reason not to be enumerable.

-- ================================================ stripe subscriptions ======

create table if not exists public.billing_subscriptions (
    org_id                 uuid primary key references public.organizations (id) on delete cascade,
    stripe_subscription_id text not null unique check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
    stripe_price_id        text,
    plan_id                text check (plan_id is null or plan_id in ('starter', 'growth', 'pro')),
    -- Stripe's own vocabulary, stored as Stripe says it. The product's
    -- entitlement status is derived from this, never conflated with it.
    stripe_status          text not null,
    cancel_at_period_end   boolean not null default false,
    current_period_start   timestamptz,
    current_period_end     timestamptz,
    trial_ends_at          timestamptz,
    -- Out-of-order protection. An event older than the one already applied is
    -- discarded rather than replayed over newer truth.
    last_event_at          timestamptz not null,
    last_event_id          text not null,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now()
);

alter table public.billing_subscriptions enable row level security;
revoke all on public.billing_subscriptions from public, anon, authenticated;
grant select on public.billing_subscriptions to authenticated;

drop policy if exists billing_subscriptions_select on public.billing_subscriptions;
create policy billing_subscriptions_select on public.billing_subscriptions
    for select to authenticated
    using (app.is_org_member(org_id));

-- ==================================================== the webhook inbox =====

create table if not exists public.stripe_webhook_events (
    id            text primary key check (id ~ '^evt_[A-Za-z0-9]+$'),
    type          text not null,
    payload       jsonb not null,
    event_created timestamptz not null,
    received_at   timestamptz not null default now(),
    processed_at  timestamptz,
    attempts      integer not null default 0,
    last_error    text
);

comment on table public.stripe_webhook_events is
    'Durable inbox. The primary key is Stripe''s own event id, so a redelivery collides instead of being handled twice. A row is written only after the signature has been verified.';

create index if not exists stripe_webhook_events_unprocessed_idx
    on public.stripe_webhook_events (received_at)
    where processed_at is null;

alter table public.stripe_webhook_events enable row level security;
revoke all on public.stripe_webhook_events from public, anon, authenticated;

-- ======================================================= the projection =====

-- Stripe's subscription status, translated into what the product means by it.
--
-- `incomplete` is a subscription whose first payment never succeeded: not a
-- trial, not active, and not something to give service for. `unpaid` is the
-- end of dunning. Anything unrecognised suspends rather than defaulting to
-- service — a status Stripe adds later must not silently grant a plan.
create or replace function app.entitlement_status_from_stripe(p_stripe_status text)
returns text
language sql
immutable
set search_path = ''
as $$
    select case p_stripe_status
        when 'trialing' then 'trialing'
        when 'active' then 'active'
        when 'past_due' then 'past_due'
        when 'canceled' then 'cancelled'
        when 'incomplete_expired' then 'cancelled'
        when 'unpaid' then 'suspended'
        when 'incomplete' then 'suspended'
        when 'paused' then 'suspended'
        else 'suspended'
    end;
$$;

revoke all on function app.entitlement_status_from_stripe(text) from public, anon, authenticated;

-- ========================================================= inbox writes =====

-- Returns 'stored' for a new event and 'duplicate' for one already seen. The
-- caller does the work only for 'stored', which is what makes Stripe's
-- at-least-once delivery harmless.
create or replace function public.rpc_stripe_event_record(
    p_event_id      text,
    p_type          text,
    p_payload       jsonb,
    p_event_created timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.stripe_webhook_events (id, type, payload, event_created)
    values (p_event_id, p_type, p_payload, p_event_created)
    on conflict (id) do nothing;

    if not found then
        return 'duplicate';
    end if;

    return 'stored';
end;
$$;

create or replace function public.rpc_stripe_event_complete(p_event_id text)
returns void
language sql
security definer
set search_path = ''
as $$
    update public.stripe_webhook_events
       set processed_at = now(),
           attempts = attempts + 1,
           last_error = null
     where id = p_event_id;
$$;

create or replace function public.rpc_stripe_event_fail(p_event_id text, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
    update public.stripe_webhook_events
       set attempts = attempts + 1,
           last_error = left(p_error, 2000)
     where id = p_event_id;
$$;

revoke all on function public.rpc_stripe_event_record(text, text, jsonb, timestamptz)
    from public, anon, authenticated;
revoke all on function public.rpc_stripe_event_complete(text) from public, anon, authenticated;
revoke all on function public.rpc_stripe_event_fail(text, text) from public, anon, authenticated;
grant execute on function public.rpc_stripe_event_record(text, text, jsonb, timestamptz) to service_role;
grant execute on function public.rpc_stripe_event_complete(text) to service_role;
grant execute on function public.rpc_stripe_event_fail(text, text) to service_role;

-- ==================================================== customer linkage ======

create or replace function public.rpc_billing_link_customer(
    p_org_id             uuid,
    p_stripe_customer_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.billing_customers (org_id, stripe_customer_id)
    values (p_org_id, p_stripe_customer_id)
    on conflict (org_id) do update
        set stripe_customer_id = excluded.stripe_customer_id,
            updated_at = now();
end;
$$;

revoke all on function public.rpc_billing_link_customer(uuid, text) from public, anon, authenticated;
grant execute on function public.rpc_billing_link_customer(uuid, text) to service_role;

-- ================================================== the subscription write ==

-- The one write that changes what a business may do.
--
-- Returns 'applied' or 'stale'. Stale means an older event arrived after a
-- newer one — Stripe does that — and nothing was changed.
create or replace function public.rpc_billing_apply_subscription(
    p_org_id                 uuid,
    p_stripe_subscription_id text,
    p_stripe_price_id        text,
    p_plan_id                text,
    p_stripe_status          text,
    p_cancel_at_period_end   boolean,
    p_current_period_start   timestamptz,
    p_current_period_end     timestamptz,
    p_trial_ends_at          timestamptz,
    p_event_id               text,
    p_event_created          timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_existing   public.billing_subscriptions%rowtype;
    v_status     text;
begin
    if p_plan_id is not null and p_plan_id not in ('starter', 'growth', 'pro') then
        raise exception 'unknown_plan' using errcode = 'P0001';
    end if;

    select * into v_existing
      from public.billing_subscriptions
     where org_id = p_org_id
       for update;

    if found and v_existing.last_event_at > p_event_created then
        -- An event older than what has already been applied. Discarding it is
        -- the whole point: a `subscription.updated` delivered after the
        -- `deleted` that followed it must not resurrect a cancelled plan.
        return 'stale';
    end if;

    v_status := app.entitlement_status_from_stripe(p_stripe_status);

    insert into public.billing_subscriptions as b
        (org_id, stripe_subscription_id, stripe_price_id, plan_id, stripe_status,
         cancel_at_period_end, current_period_start, current_period_end, trial_ends_at,
         last_event_at, last_event_id)
    values
        (p_org_id, p_stripe_subscription_id, p_stripe_price_id, p_plan_id, p_stripe_status,
         coalesce(p_cancel_at_period_end, false), p_current_period_start, p_current_period_end,
         p_trial_ends_at, p_event_created, p_event_id)
    on conflict (org_id) do update
        set stripe_subscription_id = excluded.stripe_subscription_id,
            stripe_price_id        = excluded.stripe_price_id,
            plan_id                = excluded.plan_id,
            stripe_status          = excluded.stripe_status,
            cancel_at_period_end   = excluded.cancel_at_period_end,
            current_period_start   = excluded.current_period_start,
            current_period_end     = excluded.current_period_end,
            trial_ends_at          = excluded.trial_ends_at,
            last_event_at          = excluded.last_event_at,
            last_event_id          = excluded.last_event_id,
            updated_at             = now();

    -- Same transaction. There is no moment where a business is paid-up in one
    -- table and cut off in the other.
    insert into public.entitlement_snapshots as e
        (org_id, plan_id, status, cancel_at_period_end, trial_ends_at, current_period_end, source)
    values
        (p_org_id, p_plan_id, v_status, coalesce(p_cancel_at_period_end, false),
         p_trial_ends_at, p_current_period_end, 'stripe:' || p_event_id)
    on conflict (org_id) do update
        set plan_id              = excluded.plan_id,
            status               = excluded.status,
            cancel_at_period_end = excluded.cancel_at_period_end,
            trial_ends_at        = excluded.trial_ends_at,
            current_period_end   = excluded.current_period_end,
            source               = excluded.source,
            updated_at           = now();

    return 'applied';
end;
$$;

revoke all on function public.rpc_billing_apply_subscription(
    uuid, text, text, text, text, boolean, timestamptz, timestamptz, timestamptz, text, timestamptz)
    from public, anon, authenticated;
grant execute on function public.rpc_billing_apply_subscription(
    uuid, text, text, text, text, boolean, timestamptz, timestamptz, timestamptz, text, timestamptz)
    to service_role;

-- ================================================ finding the org again =====

-- Stripe events carry the customer, not the organization. This is the lookup,
-- and it is deliberately the only one: an event whose customer is unknown is
-- left unprocessed and visible in the inbox rather than guessed at.
create or replace function public.rpc_billing_org_for_customer(p_stripe_customer_id text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
    select org_id from public.billing_customers where stripe_customer_id = p_stripe_customer_id;
$$;

revoke all on function public.rpc_billing_org_for_customer(text) from public, anon, authenticated;
grant execute on function public.rpc_billing_org_for_customer(text) to service_role;
