-- Businesses that existed before billing keep working.
--
-- 20260915000400 backfilled every organization that already existed as
-- `trialing` with no plan, and 20260915001200 gave those trials a real end:
-- seven days after the migration runs. A business that did not check out in
-- that week would then read as `suspended` and its Tags — already printed,
-- already on tables — would stop opening. Introducing billing is not a reason
-- for a sticker that worked yesterday to stop working today.
--
-- WHAT THIS DOES
-- --------------
-- A new entitlement status, `legacy`: a business that predates billing. Its
-- public door stays open, indefinitely, with the setup allowance it already
-- has (one location, one Tag, no SMS). It is never expired by the trial
-- sweeper, and it is not a plan — nothing here pretends it paid.
--
-- Checkout is how it leaves `legacy`: the first subscription event for it
-- replaces the row like any other, and from then on normal billing applies
-- (including cancellation closing the door). Ending grandfathering later is a
-- one-line, deliberate update — never a side effect.
--
-- WHO QUALIFIES
-- -------------
-- Exactly the organizations the pre-billing backfill wrote, identified by the
-- `source` those migrations stamped (`pre_billing_backfill`, or
-- `backfill:trial_end_added` once 20260915001200 gave the trial an end) and
-- still in that state: trialing, no plan, no Stripe subscription. An
-- organization created after billing landed has source `onboarding` and is
-- untouched; so is anything a Stripe event has already written.

-- ============================================================ the status ====

alter table public.entitlement_snapshots
    drop constraint if exists entitlement_snapshots_status_check;
alter table public.entitlement_snapshots
    add constraint entitlement_snapshots_status_check
    check (status in ('trialing', 'active', 'past_due', 'cancelled', 'suspended', 'legacy'));

-- Replaces 20260915001200's rule of the same meaning: `legacy`, like
-- never-subscribed `suspended`, has no plan.
alter table public.entitlement_snapshots
    drop constraint if exists entitlement_plan_required_once_subscribed;
alter table public.entitlement_snapshots
    add constraint entitlement_plan_required_once_subscribed
    check (status in ('trialing', 'suspended', 'legacy') or plan_id is not null);

-- A legacy business has no plan and no trial clock.
alter table public.entitlement_snapshots
    drop constraint if exists entitlement_legacy_is_planless;
alter table public.entitlement_snapshots
    add constraint entitlement_legacy_is_planless
    check (status <> 'legacy' or (plan_id is null and trial_ends_at is null));

-- ============================================================ what it gets ==

create or replace function app.entitlement_allows_service(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
    select p_status in ('trialing', 'active', 'past_due', 'legacy');
$$;

create or replace function app.entitlement_tag_limit(p_plan_id text, p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
    select case
        when p_status = 'trialing' then 1
        -- Never subscribed: the setup allowance. Serves nobody.
        when p_status = 'suspended' and p_plan_id is null then 1
        -- Predates billing: the same allowance, and it does serve.
        when p_status = 'legacy' then 1
        when p_status = 'active' and p_plan_id = 'starter' then 3
        when p_status = 'active' and p_plan_id = 'growth' then 8
        when p_status = 'active' and p_plan_id = 'pro' then 25
        else 0
    end;
$$;

create or replace function app.entitlement_location_limit(p_plan_id text, p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
    select case
        when p_status = 'trialing' then 1
        when p_status = 'suspended' and p_plan_id is null then 1
        when p_status = 'legacy' then 1
        when p_status = 'active' and p_plan_id = 'starter' then 1
        when p_status = 'active' and p_plan_id = 'growth' then 2
        when p_status = 'active' and p_plan_id = 'pro' then 5
        else 0
    end;
$$;

revoke all on function app.entitlement_allows_service(text) from public, anon, authenticated;
revoke all on function app.entitlement_tag_limit(text, text) from public, anon, authenticated;
revoke all on function app.entitlement_location_limit(text, text) from public, anon, authenticated;

-- ============================================================ who gets it ===

update public.entitlement_snapshots e
   set status        = 'legacy',
       trial_ends_at = null,
       source        = 'grandfathered:pre_billing',
       updated_at    = now()
 where e.source in ('pre_billing_backfill', 'backfill:trial_end_added')
   and e.status = 'trialing'
   and e.plan_id is null
   and not exists (select 1 from public.billing_subscriptions b where b.org_id = e.org_id);

comment on constraint entitlement_legacy_is_planless on public.entitlement_snapshots is
    'legacy = an organization that predates billing (20260924000400). It serves customers with the setup allowance, has no plan and no trial clock, and leaves this state only through checkout or a deliberate update.';
