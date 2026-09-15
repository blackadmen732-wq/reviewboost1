-- A trial is something Stripe starts, not something signing up grants.
--
-- WHAT WAS WRONG
-- --------------
-- Creating an organization wrote `trialing` with no plan, no card and no end
-- date. `app.entitlement_allows_service` opens the door for `trialing`, and
-- nothing anywhere expired a row whose `trial_ends_at` was null. So anyone who
-- could create an organization got an unlimited free customer flow, forever —
-- a permanent free plan, arrived at by accident, in a product whose money
-- rules begin "there is no free plan".
--
-- WHAT IS TRUE NOW
-- ----------------
-- A new organization starts `suspended` with no plan: it exists, it can be set
-- up, and its Tags do not serve customers until a verified Stripe subscription
-- says otherwise. That is the fail-closed default this table was built for.
-- The seven-day trial still exists and is still free — it starts when Stripe
-- says a subscription entered `trialing`, which is after a card and a plan.
--
-- A trial now has to have an end, and an ended trial stops opening the door
-- whether or not anything swept it. `app.entitlement_effective_status` is that
-- rule, applied where the answer is used, so a lapsed trial cannot be kept
-- alive by a maintenance job that did not run.
--
-- THE ONE DAY OF GRACE
-- --------------------
-- Stripe's own `customer.subscription.updated` arrives moments after a trial
-- converts, but "moments" is not a guarantee, and closing a paying business's
-- door over a webhook's latency is the worse failure. A trial that ended more
-- than a day ago with nothing from Stripe is over; before that it still works.
-- This is the same reasoning that keeps `past_due` open.
--
-- ORGANIZATIONS THAT EXISTED BEFORE BILLING
-- -----------------------------------------
-- They were backfilled `trialing` with no end. They are given a real seven-day
-- trial from this migration rather than being cut off mid-sentence, and it
-- expires like any other. Nobody keeps a permanent free plan.

-- ======================================================= what a trial is ====

create or replace function app.entitlement_effective_status(
    p_status        text,
    p_trial_ends_at timestamptz
)
returns text
language sql
stable
set search_path = ''
as $$
    select case
        when p_status = 'trialing'
             and p_trial_ends_at is not null
             and p_trial_ends_at <= now() - interval '1 day'
        then 'suspended'
        else p_status
    end;
$$;

revoke all on function app.entitlement_effective_status(text, timestamptz)
    from public, anon, authenticated;

comment on function app.entitlement_effective_status(text, timestamptz) is
    'The status that actually governs, given the clock. A trial whose end passed more than a day ago reads as suspended; everything else reads as itself.';

-- ========================================================= the constraints ==

-- Existing planless trials become real, finite trials rather than permanent
-- ones. Done before the constraint so the constraint can be trusted.
update public.entitlement_snapshots
   set trial_ends_at = now() + interval '7 days',
       source = 'backfill:trial_end_added',
       updated_at = now()
 where status = 'trialing'
   and trial_ends_at is null;

alter table public.entitlement_snapshots
    drop constraint if exists entitlement_plan_required_when_not_trialing;

-- `suspended` with no plan is the state of an organization that has never
-- subscribed. `active`, `past_due` and `cancelled` are states that can only be
-- reached through a subscription, so they still cannot exist without a plan.
alter table public.entitlement_snapshots
    add constraint entitlement_plan_required_once_subscribed
    check (status in ('trialing', 'suspended') or plan_id is not null);

alter table public.entitlement_snapshots
    drop constraint if exists entitlement_trial_has_an_end;

alter table public.entitlement_snapshots
    add constraint entitlement_trial_has_an_end
    check (status <> 'trialing' or trial_ends_at is not null);

-- ====================================================== the new front door ==

create or replace function app.initialize_entitlement_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- Fail closed. A business that has not been through checkout has an
    -- entitlement that says so, rather than no row (which would also fail
    -- closed, but with no way to tell "never subscribed" from "lost the row").
    insert into public.entitlement_snapshots (org_id, plan_id, status, source)
    values (new.id, null, 'suspended', 'awaiting_checkout')
    on conflict (org_id) do nothing;
    return new;
end;
$$;

revoke all on function app.initialize_entitlement_snapshot() from public, anon, authenticated;

-- ============================================ the door asks about the clock =

create or replace function app.resolve_public_stand(
    p_token_hash          text,
    p_previous_token_hash text default null
)
returns table (
    org_id               uuid,
    location_id          uuid,
    stand_id             uuid,
    business_name        text,
    location_name        text,
    google_review_url    text,
    destination_provider text,
    destination_url      text,
    customer_page        jsonb,
    default_locale       text,
    matched_key_version  smallint
)
language sql
stable
security definer
set search_path = ''
as $$
    select o.id,
           l.id,
           s.id,
           o.name,
           l.name,
           l.google_review_url,
           l.destination_provider,
           l.destination_url,
           app.resolve_customer_page(o.id, l.id),
           coalesce(l.default_locale, o.default_locale),
           s.public_token_key_version
      from public.review_stands s
      join public.locations l on l.id = s.location_id and l.org_id = s.org_id
      join public.organizations o on o.id = s.org_id
      join public.entitlement_snapshots e on e.org_id = o.id
     where (s.public_token_hash = p_token_hash
            or (p_previous_token_hash is not null
                and s.public_token_hash = p_previous_token_hash))
       and s.status = 'active'
       and l.status = 'active'
       and o.status = 'active'
       and app.entitlement_allows_service(
               app.entitlement_effective_status(e.status, e.trial_ends_at));
$$;

revoke all on function app.resolve_public_stand(text, text)
    from public, anon, authenticated;
grant execute on function app.resolve_public_stand(text, text) to service_role;

-- ================================================ and so do the cap checks ==

create or replace function public.rpc_create_stand(
    p_org_id             uuid,
    p_location_id        uuid,
    p_label              text,
    p_stand_token_hash   text,
    p_stand_token_prefix text,
    p_token_key_version  smallint,
    p_request_id         text,
    p_token_ciphertext   text,
    p_cipher_key_version smallint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor     uuid := (select auth.uid());
    v_role      text;
    v_stand_id  uuid;
    v_plan_id   text;
    v_status    text;
    v_limit     integer;
    v_count     integer;
begin
    if v_actor is null then
        raise exception 'not_authenticated' using errcode = 'P0001';
    end if;

    -- SQL cannot decrypt, but it can refuse anything that is not the
    -- `v1:<b64>:<b64>:<b64>` envelope `encrypt()` produces — which is enough to
    -- stop a truncated, empty, or plaintext value being stored as if it were
    -- recoverable key material.
    if p_cipher_key_version is null
       or p_token_ciphertext is null
       or btrim(p_token_ciphertext) !~
          '^v1:[A-Za-z0-9+/]{8,}={0,2}:[A-Za-z0-9+/]{8,}={0,2}:[A-Za-z0-9+/]{8,}={0,2}$'
    then
        raise exception 'ciphertext_required' using errcode = 'P0001';
    end if;

    select om.role into v_role
      from public.organization_members om
     where om.org_id = p_org_id
       and om.user_id = v_actor
       and om.status = 'active';

    if v_role is null or v_role not in ('owner', 'admin') then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    if not exists (
        select 1 from public.locations
         where id = p_location_id and org_id = p_org_id
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    -- The concurrency boundary. Two creates for one organization serialize
    -- here; the second counts after the first has committed.
    select e.plan_id, app.entitlement_effective_status(e.status, e.trial_ends_at)
      into v_plan_id, v_status
      from public.entitlement_snapshots e
     where e.org_id = p_org_id
       for update;

    if not found then
        -- No entitlement is not a generous default.
        raise exception 'entitlement_missing' using errcode = 'P0001';
    end if;

    v_limit := app.entitlement_tag_limit(v_plan_id, v_status);
    if v_limit <= 0 then
        raise exception 'entitlement_inactive' using errcode = 'P0001';
    end if;

    -- Retired Tags do not count: a business that retires one has freed the
    -- slot, and charging them for a sticker in a drawer would be absurd.
    select count(*)::integer into v_count
      from public.review_stands s
     where s.org_id = p_org_id
       and s.status <> 'retired';

    if v_count >= v_limit then
        raise exception 'tag_limit_reached' using errcode = 'P0001';
    end if;

    insert into public.review_stands
        (org_id, location_id, public_token_hash, public_token_prefix, label,
         stand_type, status, activated_at, public_token_key_version,
         public_token_encrypted, token_encryption_key_version)
    values
        (p_org_id, p_location_id, p_stand_token_hash, p_stand_token_prefix,
         coalesce(nullif(btrim(p_label), ''), 'Front Desk'), 'printable_qr',
         'active', now(), coalesce(p_token_key_version, 1),
         btrim(p_token_ciphertext), p_cipher_key_version)
    returning id into v_stand_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
    values
        (p_org_id, v_actor, 'user', 'stand.created', 'review_stand',
         v_stand_id::text, p_request_id,
         jsonb_build_object('locationId', p_location_id));

    return v_stand_id;
end;
$$;

create or replace function public.rpc_create_location(
    p_org_id     uuid,
    p_name       text,
    p_timezone   text default null,
    p_locale     text default null,
    p_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor       uuid := (select auth.uid());
    v_role        text;
    v_location_id uuid;
    v_plan_id     text;
    v_status      text;
    v_limit       integer;
    v_count       integer;
    v_name        text;
begin
    if v_actor is null then
        raise exception 'not_authenticated' using errcode = 'P0001';
    end if;

    v_name := btrim(coalesce(p_name, ''));
    if char_length(v_name) < 1 or char_length(v_name) > 160 then
        raise exception 'invalid_location_name' using errcode = 'P0001';
    end if;

    select om.role into v_role
      from public.organization_members om
     where om.org_id = p_org_id
       and om.user_id = v_actor
       and om.status = 'active';

    if v_role is null or v_role not in ('owner', 'admin') then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    select e.plan_id, app.entitlement_effective_status(e.status, e.trial_ends_at)
      into v_plan_id, v_status
      from public.entitlement_snapshots e
     where e.org_id = p_org_id
       for update;

    if not found then
        raise exception 'entitlement_missing' using errcode = 'P0001';
    end if;

    v_limit := app.entitlement_location_limit(v_plan_id, v_status);
    if v_limit <= 0 then
        raise exception 'entitlement_inactive' using errcode = 'P0001';
    end if;

    select count(*)::integer into v_count
      from public.locations l
     where l.org_id = p_org_id
       and l.status = 'active';

    if v_count >= v_limit then
        raise exception 'location_limit_reached' using errcode = 'P0001';
    end if;

    -- No destination is set here. A new location's door starts closed, and the
    -- owner points it somewhere deliberately through the destination write.
    insert into public.locations (org_id, name, timezone, default_locale)
    select p_org_id,
           v_name,
           coalesce(p_timezone, o.timezone, 'UTC'),
           coalesce(p_locale, o.default_locale, 'en')
      from public.organizations o
     where o.id = p_org_id
    returning id into v_location_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
    values
        (p_org_id, v_actor, 'user', 'location.created', 'location',
         v_location_id::text, p_request_id, '{}'::jsonb);

    return v_location_id;
end;
$$;

revoke all on function public.rpc_create_stand(uuid, uuid, text, text, text, smallint, text, text, smallint)
    from public, anon, authenticated;
grant execute on function public.rpc_create_stand(uuid, uuid, text, text, text, smallint, text, text, smallint)
    to authenticated, service_role;

revoke all on function public.rpc_create_location(uuid, text, text, text, text)
    from public, anon, authenticated;
grant execute on function public.rpc_create_location(uuid, text, text, text, text)
    to authenticated, service_role;

-- ======================================= and the state stops lying visibly ==

-- The read-time rule above is what governs. This exists so that what an owner
-- and an operator *see* matches it: a lapsed trial that still reads
-- `trialing` in the billing screen is a support call waiting to happen.
-- Idempotent, and safe to miss: skipping it changes no decision.
create or replace function public.rpc_entitlements_expire_trials()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_count integer;
begin
    with lapsed as (
        update public.entitlement_snapshots e
           set status = 'suspended',
               source = 'trial_expired',
               updated_at = now()
         where e.status = 'trialing'
           and e.trial_ends_at is not null
           and e.trial_ends_at <= now() - interval '1 day'
        returning 1
    )
    select count(*)::integer into v_count from lapsed;

    return v_count;
end;
$$;

revoke all on function public.rpc_entitlements_expire_trials() from public, anon, authenticated;
grant execute on function public.rpc_entitlements_expire_trials() to service_role;

-- ===================================== and Stripe cannot start an endless one

-- Same function, one rule added: see the note inside. Re-emitted here rather
-- than edited in place, because a landed migration is history.

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
    v_status      text;
    v_trial_ends  timestamptz;
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

    -- A trial with no end is the permanent free plan this product does not
    -- have. Stripe always sends `trial_end` for a trialing subscription, so
    -- this is the case where it did not: take the period end, and if there is
    -- no end to be had, do not open the door on the strength of a date nobody
    -- supplied.
    v_trial_ends := coalesce(p_trial_ends_at, p_current_period_end);
    if v_status = 'trialing' and v_trial_ends is null then
        v_status := 'suspended';
    end if;

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
