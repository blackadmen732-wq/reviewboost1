-- One live subscription per business.
--
-- billing_subscriptions holds one row per organization, and every
-- subscription event used to overwrite it. A business with two Stripe
-- subscriptions (two checkout tabs, or a new checkout while an old one was
-- still `incomplete`) had them write over each other: the
-- `incomplete_expired` of an abandoned checkout switched off the plan the
-- business was paying for.
--
-- Same signature and return type as 20260928000100_stripe_price_authority, so
-- `create or replace` keeps every grant and caller. The only change is the
-- `other_subscription` branch. The caller (billing-service.ts) treats it like
-- `stale`: Stripe is answered 200 and nothing is applied.

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

    -- One business, one subscription that counts. While the one on record is
    -- live, an event about a different subscription that is not live (an
    -- abandoned checkout expiring, a second one that never got paid) says
    -- nothing about this business's plan and must not switch it off.
    -- Checkout refuses to open a second subscription in the first place
    -- (billing-service.ts); this is the guard for one that exists anyway.
    if v_has_row
       and v_existing.stripe_subscription_id is distinct from p_stripe_subscription_id
       and v_existing.stripe_status in ('trialing', 'active', 'past_due')
       and p_stripe_status not in ('trialing', 'active', 'past_due') then
        return 'other_subscription';
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
