-- Entitlements that say what is true, and a Tag cap the database enforces.
--
-- TWO PROBLEMS THIS FIXES
-- -----------------------
-- 1. There was no entitlement record at all, and the application code that
--    wanted one resolved a missing row to Starter/active -- a paid plan, handed
--    out for free, to every organization that had never paid. A snapshot that
--    lies in the customer's favour is still a snapshot that lies, and every
--    limit computed from it is fiction.
--
-- 2. The Tag cap lived only in the HTTP route. `rpc_create_stand` is granted to
--    `authenticated`, so any signed-in owner could call it directly and mint
--    Tags without limit. Two concurrent POSTs both passed the pre-check and
--    both inserted, because nothing serialised them.
--
-- WHAT THIS IS NOT
-- ----------------
-- Not the money system. There is no Stripe here, no SMS allowance, no credit
-- ledger, and no price. `sms_included` is deliberately absent rather than set
-- to zero: this table does not get to have an opinion about SMS until the
-- money change lands with the catalog, Stripe, and the ledger together.
--
-- The tag and location numbers below are enforcement limits only. When the
-- money change lands it owns the catalog, and these have to be reconciled with
-- it in one place rather than drifting in two.

begin;

-- ------------------------------------------------------------- snapshot ----

create table public.entitlement_snapshots (
    org_id                  uuid primary key
                                references public.organizations (id) on delete cascade,

    -- Null means no plan has been bought. That is a real state, and it is the
    -- state nearly every row is in today, so it is representable rather than
    -- papered over with a default.
    plan_id                 text
        check (plan_id is null or plan_id in ('starter', 'growth', 'pro')),

    -- No default. A row is written by something that knows which of these is
    -- true; a default here is how "we never checked" becomes "active".
    status                  text not null
        check (status in ('trialing', 'active', 'past_due', 'cancelled', 'suspended')),

    trial_started_at        timestamptz,
    stripe_customer_id      text,
    stripe_subscription_id  text,

    -- How this row came to say what it says, so a support question about a
    -- business's limits has an answer.
    source                  text not null
        check (source in ('trial_bootstrap', 'backfill', 'manual', 'stripe')),

    status_changed_at       timestamptz not null default now(),
    updated_at              timestamptz not null default now(),

    -- An organization cannot be on a paid plan without saying which one.
    constraint entitlement_active_requires_plan
        check (status <> 'active' or plan_id is not null)
);

comment on table public.entitlement_snapshots is
    'What an organization is entitled to, and why. Not billing: no price, no '
    'SMS allowance, no credit ledger. The money change owns those.';
comment on column public.entitlement_snapshots.status is
    'trialing | active | past_due | cancelled | suspended. A failed payment '
    'suspends paid features; it never silently becomes a free plan, because '
    'there is no free plan.';

alter table public.entitlement_snapshots enable row level security;

revoke all on public.entitlement_snapshots from public, anon, authenticated;
grant select on public.entitlement_snapshots to authenticated;

-- Members may read their own organization's entitlement. Nobody writes through
-- the Data API: every write goes through a definer function below.
create policy entitlement_snapshots_select on public.entitlement_snapshots
    for select to authenticated
    using (app.is_org_member(org_id));

-- ---------------------------------------------------------------- limits ----

create or replace function app.plan_tag_limit(p_plan_id text)
returns integer
language sql
immutable
set search_path = ''
as $$
    select case p_plan_id
        when 'starter' then 3
        when 'growth'  then 8
        when 'pro'     then 25
        -- No plan is not a generous plan. Unknown input fails closed.
        else 0
    end;
$$;

create or replace function app.plan_location_limit(p_plan_id text)
returns integer
language sql
immutable
set search_path = ''
as $$
    select case p_plan_id
        when 'starter' then 1
        when 'growth'  then 2
        when 'pro'     then 5
        else 0
    end;
$$;

-- The limit that actually applies: plan AND status together.
--
-- Status is not decoration. A cancelled or unpaid organization keeps the Tags
-- it already printed -- those are physical objects in a shop, and breaking them
-- would punish the customer standing in front of them -- but it does not get to
-- print more until the account is good again.
create or replace function app.entitlement_tag_limit(p_plan_id text, p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
    select case p_status
        when 'trialing' then 1
        when 'active'   then app.plan_tag_limit(p_plan_id)
        when 'past_due' then 0
        when 'suspended' then 0
        when 'cancelled' then 0
        else 0
    end;
$$;

create or replace function app.entitlement_location_limit(p_plan_id text, p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
    select case p_status
        when 'trialing' then 1
        when 'active'   then app.plan_location_limit(p_plan_id)
        else 0
    end;
$$;

-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default, and
-- `authenticated` holds USAGE on the app schema so RLS policies can call the
-- membership helpers. Without these revokes the limit functions would be the
-- only reachable ones in the schema that nothing revoked -- harmless in
-- themselves, since they map a plan name to an integer and touch no data, but
-- the project's rule is that a grant is deliberate or it is not there.
revoke all on function app.plan_tag_limit(text) from public, anon, authenticated;
revoke all on function app.plan_location_limit(text) from public, anon, authenticated;
revoke all on function app.entitlement_tag_limit(text, text) from public, anon, authenticated;
revoke all on function app.entitlement_location_limit(text, text) from public, anon, authenticated;

-- ------------------------------------------------------------ the lock ----

-- Take the organization's entitlement row and hold it for the rest of the
-- transaction, creating an explicit trial row if there is none.
--
-- This is the whole concurrency argument. Two simultaneous creates contend on
-- this one row: the second blocks here until the first commits, and only then
-- runs its count -- which now sees the row the first one inserted. Counting
-- before locking, or not locking at all, is what let two requests each see
-- "2 of 3 used" and both insert.
create or replace function app.lock_entitlement(p_org_id uuid)
returns public.entitlement_snapshots
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_row public.entitlement_snapshots;
begin
    select * into v_row
      from public.entitlement_snapshots
     where org_id = p_org_id
       for update;

    if found then
        return v_row;
    end if;

    -- No row yet. Write what is true -- an organization that has never paid is
    -- on trial -- rather than resolving the absence to a paid plan.
    insert into public.entitlement_snapshots
        (org_id, plan_id, status, trial_started_at, source)
    values
        (p_org_id, null, 'trialing', now(), 'trial_bootstrap')
    on conflict (org_id) do nothing;

    -- Re-read under the lock. The ON CONFLICT covers the case where a
    -- concurrent transaction inserted the row between the select and here.
    select * into v_row
      from public.entitlement_snapshots
     where org_id = p_org_id
       for update;

    if not found then
        raise exception 'entitlement_unavailable' using errcode = 'P0001';
    end if;

    return v_row;
end;
$$;

revoke all on function app.lock_entitlement(uuid) from public, anon, authenticated;

-- Only the definer functions above call these, and they run as their owner.

-- --------------------------------------------------------- create stand ----

-- The signature gains the reprint ciphertext, so the old one has to go rather
-- than sit alongside as an overload PostgREST could still resolve.
--
-- WHY THE CIPHERTEXT MOVES IN HERE
-- --------------------------------
-- createStand wrote it with a second call to
-- `public.rpc_set_stand_token_ciphertext`, and that function was dropped by
-- 20260813215530_praise_view_and_state_machine.sql. The call has been failing
-- ever since, and nothing checked the result -- so every Tag created through
-- POST /api/v1/review-stands has no stored ciphertext and can never be
-- reprinted. The owner sees the token once, and it is gone.
--
-- Two calls could never have been right even with the function present: a Tag
-- that exists without its reprint ciphertext is a Tag the owner cannot replace
-- when the printed one wears out. One transaction, or neither row.
drop function if exists public.rpc_create_stand(uuid, uuid, text, text, text, smallint, text);

create or replace function public.rpc_create_stand(
  p_org_id            uuid,
  p_location_id       uuid,
  p_label             text,
  p_stand_token_hash  text,
  p_stand_token_prefix text,
  p_token_key_version smallint,
  p_request_id        text default null,
  p_token_ciphertext  text default null,
  p_cipher_key_version smallint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id  uuid;
  v_role     text;
  v_stand_id uuid;
  v_ent      public.entitlement_snapshots;
  v_limit    integer;
  v_used     integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not_authenticated'
      using errcode = 'P0001';
  end if;

  select om.role into v_role
    from public.organization_members om
   where om.org_id  = p_org_id
     and om.user_id = v_user_id
     and om.status  = 'active';

  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'not_found_or_forbidden'
      using errcode = 'P0001';
  end if;

  -- Fail closed on reprintability. A Tag whose token ciphertext was never
  -- stored is one the owner saw once and can never reprint, and there is no
  -- way to recover it afterwards -- only the digest is kept. Refusing to
  -- create it is the recoverable outcome; creating it is not.
  --
  -- Checked here rather than trusted from the route, because this function is
  -- granted to `authenticated` and can be called directly.
  if p_token_ciphertext is null or btrim(p_token_ciphertext) = '' then
    raise exception 'reprint_ciphertext_required' using errcode = 'P0001';
  end if;

  -- Composite FK (location_id, org_id) prevents cross-org linkage at DB level,
  -- but verify the location belongs to this org explicitly.
  if not exists (
    select 1 from public.locations
     where id = p_location_id
       and org_id = p_org_id
  ) then
    raise exception 'not_found_or_forbidden'
      using errcode = 'P0001';
  end if;

  -- The cap, and the authority for it. The HTTP route checks this too, so an
  -- owner gets a fast 403 instead of a database error, but that check is a
  -- courtesy: this function is granted to `authenticated` and can be called
  -- directly, so the limit has to hold here or it does not hold.
  --
  -- Order matters: lock, then count. See app.lock_entitlement.
  v_ent := app.lock_entitlement(p_org_id);
  v_limit := app.entitlement_tag_limit(v_ent.plan_id, v_ent.status);

  select count(*) into v_used
    from public.review_stands
   where org_id = p_org_id
     and status <> 'retired';

  if v_used >= v_limit then
    raise exception 'tag_limit_reached'
      using errcode = 'P0001',
            detail = format('plan=%s status=%s limit=%s used=%s',
                            coalesce(v_ent.plan_id, 'none'), v_ent.status, v_limit, v_used);
  end if;

  insert into public.review_stands
    (org_id, location_id, public_token_hash, public_token_prefix, label,
     stand_type, status, activated_at, public_token_key_version,
     public_token_encrypted, token_encryption_key_version)
  values
    (p_org_id, p_location_id, p_stand_token_hash, p_stand_token_prefix,
     coalesce(nullif(trim(p_label), ''), 'Front Desk'), 'printable_qr',
     'active', now(), coalesce(p_token_key_version, 1),
     p_token_ciphertext, coalesce(p_cipher_key_version, 1))
  returning id into v_stand_id;

  insert into public.audit_events
    (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
  values
    (p_org_id, v_user_id, 'user', 'stand.created', 'review_stand',
     v_stand_id::text, p_request_id,
     jsonb_build_object('locationId', p_location_id,
                        'tagsUsed', v_used + 1, 'tagLimit', v_limit));

  return v_stand_id;
end;
$$;

revoke all on function public.rpc_create_stand(uuid, uuid, text, text, text, smallint, text, text, smallint)
  from public, anon;
grant execute on function public.rpc_create_stand(uuid, uuid, text, text, text, smallint, text, text, smallint)
  to authenticated;

-- ---------------------------------------------------------- onboarding ----

-- Onboarding mints the first Tag directly, bypassing rpc_create_stand. Without
-- a snapshot written here, the organization's *second* Tag would be the first
-- thing to create one -- and lock_entitlement would correctly start a trial at
-- that moment, dating the trial from the wrong day.
create or replace function app.create_organization_with_first_stand(
    p_name                text,
    p_slug                text,
    p_timezone            text,
    p_default_locale      text,
    p_location_name       text,
    p_google_review_url   text,
    p_stand_token_hash    text,
    p_stand_token_prefix  text,
    p_stand_label         text,
    p_token_key_version   smallint,
    p_request_id          text,
    p_token_ciphertext    text,
    p_cipher_key_version  smallint
)
returns table (org_id uuid, location_id uuid, stand_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
    actor        uuid := (select auth.uid());
    new_org      uuid;
    new_location uuid;
    new_stand    uuid;
    owned        integer;
begin
    if actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select count(*) into owned
      from public.organization_members m
     where m.user_id = actor and m.role = 'owner' and m.status = 'active';

    if owned >= app.owned_organization_limit() then
        raise exception 'organization limit reached' using errcode = '54000';
    end if;

    insert into public.organizations (name, slug, timezone, default_locale)
    values (p_name, p_slug, coalesce(p_timezone, 'UTC'), coalesce(p_default_locale, 'en'))
    returning id into new_org;

    insert into public.organization_members (org_id, user_id, role, status, joined_at)
    values (new_org, actor, 'owner', 'active', now());

    -- Before the first stand, so the trial is dated from the day the business
    -- was created and the next create is already constrained.
    insert into public.entitlement_snapshots
        (org_id, plan_id, status, trial_started_at, source)
    values
        (new_org, null, 'trialing', now(), 'trial_bootstrap');

    insert into public.locations
        (org_id, name, timezone, default_locale, google_review_url)
    values
        (new_org, p_location_name, coalesce(p_timezone, 'UTC'),
         coalesce(p_default_locale, 'en'), p_google_review_url)
    returning id into new_location;

    insert into public.review_stands
        (org_id, location_id, public_token_hash, public_token_prefix, label,
         stand_type, status, activated_at, public_token_key_version,
         public_token_encrypted, token_encryption_key_version)
    values
        (new_org, new_location, p_stand_token_hash, p_stand_token_prefix,
         coalesce(p_stand_label, 'Front Desk'), 'printable_qr', 'active', now(),
         p_token_key_version, p_token_ciphertext, p_cipher_key_version)
    returning id into new_stand;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
    values
        (new_org, actor, 'user', 'organization.created', 'organization', new_org::text,
         p_request_id, jsonb_build_object('locationId', new_location, 'standId', new_stand));

    return query select new_org, new_location, new_stand;
end;
$$;

revoke all on function app.create_organization_with_first_stand(text, text, text, text, text, text, text, text, text, smallint, text, text, smallint) from public, anon;
grant execute on function app.create_organization_with_first_stand(text, text, text, text, text, text, text, text, text, smallint, text, text, smallint) to authenticated;

-- ------------------------------------------------------- writing status ----

-- The one way an entitlement changes. Service role only: a status is a
-- statement about money, and a signed-in owner must never be able to make it.
--
-- The money change replaces the body of this with something driven by verified
-- Stripe events. Until then it exists so a status can be set deliberately and
-- audited, instead of being implied by a missing row.
create or replace function public.rpc_set_entitlement(
    p_org_id                 uuid,
    p_plan_id                text,
    p_status                 text,
    p_source                 text,
    p_stripe_customer_id     text default null,
    p_stripe_subscription_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_previous public.entitlement_snapshots;
begin
    if p_status is null or p_status not in
        ('trialing', 'active', 'past_due', 'cancelled', 'suspended') then
        raise exception 'invalid_status' using errcode = '22023';
    end if;
    if p_plan_id is not null and p_plan_id not in ('starter', 'growth', 'pro') then
        raise exception 'invalid_plan' using errcode = '22023';
    end if;
    if p_status = 'active' and p_plan_id is null then
        raise exception 'active_requires_plan' using errcode = '22023';
    end if;
    if p_source is null or p_source not in ('trial_bootstrap', 'backfill', 'manual', 'stripe') then
        raise exception 'invalid_source' using errcode = '22023';
    end if;

    select * into v_previous from public.entitlement_snapshots where org_id = p_org_id;

    insert into public.entitlement_snapshots as e
        (org_id, plan_id, status, trial_started_at, source,
         stripe_customer_id, stripe_subscription_id, status_changed_at)
    values
        (p_org_id, p_plan_id, p_status,
         case when p_status = 'trialing' then now() else null end,
         p_source, p_stripe_customer_id, p_stripe_subscription_id, now())
    on conflict (org_id) do update
    set plan_id = excluded.plan_id,
        status = excluded.status,
        trial_started_at = coalesce(e.trial_started_at, excluded.trial_started_at),
        source = excluded.source,
        stripe_customer_id = coalesce(excluded.stripe_customer_id, e.stripe_customer_id),
        stripe_subscription_id = coalesce(excluded.stripe_subscription_id, e.stripe_subscription_id),
        status_changed_at = case
            when e.status is distinct from excluded.status then now()
            else e.status_changed_at
        end,
        updated_at = now();

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (p_org_id, null, 'service', 'entitlement.changed', 'organization', p_org_id::text,
         jsonb_build_object(
             'fromPlan', v_previous.plan_id, 'fromStatus', v_previous.status,
             'toPlan', p_plan_id, 'toStatus', p_status, 'source', p_source));
end;
$$;

revoke all on function public.rpc_set_entitlement(uuid, text, text, text, text, text)
    from public, anon, authenticated;
grant execute on function public.rpc_set_entitlement(uuid, text, text, text, text, text)
    to service_role;

-- ---------------------------------------------------------- the backfill ----

-- Every organization that exists today has never paid: there was no billing to
-- pay through. Writing them as trialing is not a downgrade, it is the first
-- time the row says anything true.
--
-- An organization that already holds more Tags than a trial allows keeps every
-- one of them -- the cap is `used >= limit` on create, and never retires
-- anything -- but cannot add more until a plan is recorded. That is the correct
-- behaviour for an account with no plan, and it is visible rather than silent:
-- the create fails with tag_limit_reached naming the plan and the status.
insert into public.entitlement_snapshots
    (org_id, plan_id, status, trial_started_at, source)
select o.id, null, 'trialing', coalesce(o.created_at, now()), 'backfill'
  from public.organizations o
 where not exists (
     select 1 from public.entitlement_snapshots e where e.org_id = o.id
 );

commit;
