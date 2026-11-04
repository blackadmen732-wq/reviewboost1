-- The Stripe Price is the only thing that decides a plan.
--
-- Until now the subscription webhook resolved a plan as "the price we
-- recognise, OR `subscription.metadata.plan_id`", and this function trusted
-- whatever `p_plan_id` it was handed. Metadata is a free-text field on the
-- Stripe object: anything that can write a subscription in the Stripe account
-- (a dashboard edit, a support tool, a test script pointed at the wrong key)
-- could put `plan_id=pro` on a subscription for a price this product does not
-- sell, and the business would get Pro. Payment authority cannot live in a
-- field nobody pays for.
--
-- THE RULE
-- --------
--   Stripe Price ID  ->  ReviewBoost plan, read from `billing_plan_prices`.
--
-- The mapping lives here, in the database that grants the entitlement, so the
-- grant does not depend on the application having been configured the same
-- way. The application's STRIPE_PRICE_* variables are only used to *create*
-- checkouts; the production readiness gate refuses to promote a deployment
-- whose variables disagree with this table.
--
-- AN UNKNOWN PRICE
-- ----------------
-- Fails closed and loudly. The function raises `unknown_price`, the webhook
-- inbox row keeps `processed_at` null with the error recorded, Stripe gets a
-- 500 and retries, and `/internal/health` reports the stuck event. Once an
-- operator adds the price to `billing_plan_prices`, the next retry (or a
-- manual resend from the Stripe dashboard) applies it. Nothing is granted in
-- between, and nothing is lost.
--
-- The one exception is an event that can only take access *away*
-- (cancelled / suspended) for an organization that already has a plan on
-- record: revoking is always safe, so it applies against the plan already
-- held rather than leaving a cancelled subscription entitled.
--
-- `p_plan_id` stays in the signature so an application build that still sends
-- it keeps working through the deploy, but it is now only a cross-check: if it
-- disagrees with the price, the event fails (`plan_price_mismatch`) rather than
-- one of the two being silently believed.

-- ============================================================ the mapping ===

create table if not exists public.billing_plan_prices (
    stripe_price_id text primary key
        check (stripe_price_id ~ '^price_[A-Za-z0-9_]+$'),
    plan_id         text not null check (plan_id in ('starter', 'growth', 'pro')),
    created_at      timestamptz not null default now()
);

comment on table public.billing_plan_prices is
    'Authoritative Stripe Price -> ReviewBoost plan mapping. Subscriptions and invoices for a price not listed here grant nothing and fail visibly. Maintained by an operator per environment; never derived from Stripe metadata.';

alter table public.billing_plan_prices enable row level security;
-- No policies: nothing but service_role and definer functions reads it.
revoke all on table public.billing_plan_prices from public, anon, authenticated;
grant select, insert, update, delete on table public.billing_plan_prices to service_role;

create or replace function app.plan_for_price(p_stripe_price_id text)
returns text
language sql
stable
set search_path = ''
as $$
    select p.plan_id
      from public.billing_plan_prices p
     where p.stripe_price_id = p_stripe_price_id
$$;

revoke all on function app.plan_for_price(text) from public, anon, authenticated;

-- The readiness gate reads the mapping through this, so it can prove the
-- deployment's STRIPE_PRICE_* variables are the prices the database grants on.
create or replace function public.rpc_billing_price_catalog()
returns table (stripe_price_id text, plan_id text)
language sql
stable
security definer
set search_path = ''
as $$
    select p.stripe_price_id, p.plan_id
      from public.billing_plan_prices p
     order by p.plan_id, p.stripe_price_id
$$;

revoke all on function public.rpc_billing_price_catalog() from public, anon, authenticated;
grant execute on function public.rpc_billing_price_catalog() to service_role;

-- ================================================== subscription events ====

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
    v_existing    public.billing_subscriptions%rowtype;
    v_has_row     boolean;
    v_plan        text;
    v_status      text;
    v_trial_ends  timestamptz;
    v_held_plan   text;
begin
    if p_org_id is null or p_stripe_subscription_id is null
       or p_event_id is null or p_event_created is null then
        raise exception 'malformed_subscription_event' using errcode = 'P0001';
    end if;

    select * into v_existing
      from public.billing_subscriptions
     where org_id = p_org_id
       for update;
    v_has_row := found;

    if v_has_row and v_existing.last_event_at > p_event_created then
        -- An event older than what has already been applied. A
        -- `subscription.updated` delivered after the `deleted` that followed
        -- it must not resurrect a cancelled plan.
        return 'stale';
    end if;

    v_status := app.entitlement_status_from_stripe(p_stripe_status);
    v_plan   := app.plan_for_price(p_stripe_price_id);

    if v_plan is null then
        -- Revoking access never needs to know the plan: apply a
        -- cancellation or suspension against the plan already on record.
        select e.plan_id into v_held_plan
          from public.entitlement_snapshots e
         where e.org_id = p_org_id;

        if v_status in ('cancelled', 'suspended') and v_held_plan is not null then
            v_plan := v_held_plan;
        else
            raise exception 'unknown_price'
                using errcode = 'P0001',
                      detail  = format('Stripe price %s is not in billing_plan_prices', coalesce(p_stripe_price_id, '<none>')),
                      hint    = 'Add the price to public.billing_plan_prices, then resend the event.';
        end if;
    elsif p_plan_id is not null and p_plan_id is distinct from v_plan then
        raise exception 'plan_price_mismatch'
            using errcode = 'P0001',
                  detail  = format('caller said %s, price %s is %s', p_plan_id, p_stripe_price_id, v_plan);
    end if;

    -- A trial with no end is the permanent free plan this product does not
    -- have. Take the period end, and if there is none, do not open the door
    -- on the strength of a date nobody supplied.
    v_trial_ends := coalesce(p_trial_ends_at, p_current_period_end);
    if v_status = 'trialing' and v_trial_ends is null then
        v_status := 'suspended';
    end if;

    insert into public.billing_subscriptions as b
        (org_id, stripe_subscription_id, stripe_price_id, plan_id, stripe_status,
         cancel_at_period_end, current_period_start, current_period_end, trial_ends_at,
         last_event_at, last_event_id)
    values
        (p_org_id, p_stripe_subscription_id, p_stripe_price_id, v_plan, p_stripe_status,
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

    insert into public.entitlement_snapshots as e
        (org_id, plan_id, status, cancel_at_period_end, trial_ends_at, current_period_end, source)
    values
        (p_org_id, v_plan, v_status, coalesce(p_cancel_at_period_end, false),
         v_trial_ends, p_current_period_end, 'stripe:' || p_event_id)
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

-- ======================================================= paid invoices =====

-- Same argument types, but the third argument is now the Stripe price, not a
-- plan name the caller chose. The parameter is renamed, which Postgres only
-- allows by dropping the old function. An application build still sending
-- `p_plan_id` gets "function not found", the event stays unprocessed and
-- Stripe retries it — so this migration must land before the build that calls
-- the new signature, and a paid invoice in that window is delayed, not lost.
drop function if exists public.rpc_billing_apply_invoice_paid(uuid, text, text, timestamptz, timestamptz, bigint);

create function public.rpc_billing_apply_invoice_paid(
    p_org_id          uuid,
    p_invoice_id      text,
    p_stripe_price_id text,
    p_period_start    timestamptz,
    p_period_end      timestamptz,
    p_amount_paid     bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_plan     text;
    v_segments integer;
    v_grant    uuid;
begin
    if p_org_id is null or p_invoice_id is null then
        raise exception 'malformed_invoice_event' using errcode = 'P0001';
    end if;

    if p_amount_paid is null or p_amount_paid <= 0 then
        -- A zero-amount invoice is a trial's invoice. A trial includes no SMS.
        return 'not_paid';
    end if;

    if p_stripe_price_id is null then
        -- An invoice with no subscription price on it is not a plan renewal.
        return 'no_plan';
    end if;

    v_plan := app.plan_for_price(p_stripe_price_id);
    if v_plan is null then
        -- Money moved for a price this product does not know. Not the
        -- cheapest tier's allowance, not nothing-and-forget: fail, stay in
        -- the inbox, and be applied once the price is mapped.
        raise exception 'unknown_price'
            using errcode = 'P0001',
                  detail  = format('Stripe price %s is not in billing_plan_prices', p_stripe_price_id),
                  hint    = 'Add the price to public.billing_plan_prices, then resend the event.';
    end if;

    if p_period_end is null then
        raise exception 'invoice_missing_period' using errcode = 'P0001';
    end if;

    v_segments := app.entitlement_monthly_sms(v_plan);
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
        'monthly included for ' || v_plan);

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
