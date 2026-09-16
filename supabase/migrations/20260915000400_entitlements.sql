-- What a business is entitled to, in one place the database can enforce.
--
-- This is not the money system. Stripe, the seven-day clock, invoices and SMS
-- credits land later and write into this table. What lands here is the single
-- honest answer to "may this organization do that?", held where a concurrent
-- request cannot get a different answer than the one before it.
--
-- THE RULES THIS ENCODES
-- ----------------------
-- There is no permanent free plan. An organization that has not paid is
-- `trialing`, never a free Starter, and a missing entitlement row is not a
-- generous default — it is a closed door. Every limit below is enforced by the
-- database; an HTTP pre-check exists only so an owner gets a sentence instead
-- of a 500.
--
--   plan      price   locations  Tags  monthly SMS segments
--   trial     $0          1        1     0
--   starter   $49         1        3   150
--   growth    $79         2        8   500
--   pro       $129        5       25  1500
--
-- PAST_DUE IS A GRACE PERIOD, NOT A SHUTDOWN
-- ------------------------------------------
-- A failed card closes nothing a customer can see. The door stays open while
-- `past_due` so a business does not lose a day of reviews to a bank's fraud
-- heuristic, but nothing new may be created. Suspension — the end of dunning,
-- or a deliberate act — is what closes the door. Cancellation closes it too,
-- and neither deletes anything: the Tags, the ratings and the destination all
-- survive so that paying again reopens the same physical Tag.

-- ============================================================ the table =====

create table if not exists public.entitlement_snapshots (
    org_id                uuid primary key references public.organizations (id) on delete cascade,
    -- Null only before a plan has been chosen. A trial requires a selected
    -- future paid plan, so this stops being null once billing lands; a status
    -- other than `trialing` may never have a null plan.
    plan_id               text check (plan_id is null or plan_id in ('starter', 'growth', 'pro')),
    status                text not null
        check (status in ('trialing', 'active', 'past_due', 'cancelled', 'suspended')),
    -- Tracked separately from `status`, because "cancelling at the end of the
    -- period" is an active subscription that still works, and conflating the
    -- two is how a business loses service it has paid for.
    cancel_at_period_end  boolean not null default false,
    trial_ends_at         timestamptz,
    current_period_end    timestamptz,
    -- Where this state came from: a Stripe event id, a backfill, an admin
    -- action. An entitlement nobody can explain is one nobody can correct.
    source                text not null check (char_length(source) between 1 and 200),
    updated_at            timestamptz not null default now(),

    constraint entitlement_plan_required_when_not_trialing
        check (status = 'trialing' or plan_id is not null)
);

comment on table public.entitlement_snapshots is
    'The authoritative answer to what an organization may do. Written only by the service role and by the billing pipeline; readable by that organization''s members. A missing row means no entitlement, which fails closed.';

alter table public.entitlement_snapshots enable row level security;

revoke all on public.entitlement_snapshots from public, anon, authenticated;
grant select on public.entitlement_snapshots to authenticated;

drop policy if exists entitlement_snapshots_select on public.entitlement_snapshots;
create policy entitlement_snapshots_select on public.entitlement_snapshots
    for select to authenticated
    using (app.is_org_member(org_id));

-- ========================================================== the limits ======

-- One mapping, in the database, because the database is what enforces it. A
-- frontend constant is a label; it is never the authority.
create or replace function app.entitlement_tag_limit(p_plan_id text, p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
    select case
        when p_status = 'trialing' then 1
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
        when p_status = 'active' and p_plan_id = 'starter' then 1
        when p_status = 'active' and p_plan_id = 'growth' then 2
        when p_status = 'active' and p_plan_id = 'pro' then 5
        else 0
    end;
$$;

-- The monthly included allowance a *successful paid invoice* mints. Nothing
-- mints it on checkout or on subscription creation, and a trial gets none.
create or replace function app.entitlement_monthly_sms(p_plan_id text)
returns integer
language sql
immutable
set search_path = ''
as $$
    select case p_plan_id
        when 'starter' then 150
        when 'growth' then 500
        when 'pro' then 1500
        else 0
    end;
$$;

-- Whether the public door opens at all. See the note above on past_due.
create or replace function app.entitlement_allows_service(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
    select p_status in ('trialing', 'active', 'past_due');
$$;

revoke all on function app.entitlement_tag_limit(text, text) from public, anon, authenticated;
revoke all on function app.entitlement_location_limit(text, text) from public, anon, authenticated;
revoke all on function app.entitlement_monthly_sms(text) from public, anon, authenticated;
revoke all on function app.entitlement_allows_service(text) from public, anon, authenticated;

-- ========================================================== the backfill ====

-- Organizations that existed before billing are trialing. They are explicitly
-- NOT called active Starter: inventing a paid plan for someone who never paid
-- is the exact failure this table exists to prevent.
insert into public.entitlement_snapshots (org_id, plan_id, status, source)
select o.id, null, 'trialing', 'pre_billing_backfill'
  from public.organizations o
on conflict (org_id) do nothing;

-- Every organization created from here on gets its entitlement in the same
-- transaction as the organization itself, so there is no window in which a
-- business exists with no answer to "what may it do?".
create or replace function app.initialize_entitlement_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.entitlement_snapshots (org_id, plan_id, status, source)
    values (new.id, null, 'trialing', 'onboarding')
    on conflict (org_id) do nothing;
    return new;
end;
$$;

revoke all on function app.initialize_entitlement_snapshot() from public, anon, authenticated;

drop trigger if exists organizations_initialize_entitlement on public.organizations;
create trigger organizations_initialize_entitlement
    after insert on public.organizations
    for each row
    execute function app.initialize_entitlement_snapshot();

-- ==================================================== payment and the door ==

-- The door now also asks whether the account is entitled to service. A
-- suspended or cancelled business's Tags resolve to exactly the same neutral
-- dead link as an unknown token: the customer standing at the counter is not
-- who "this business has not paid" is for, and saying it would be a disclosure
-- about the business to anyone holding a token.
--
-- Nothing is deleted. The Tag, its token, its QR, its NFC chip and every
-- rating survive, so paying again reopens the same physical Tag rather than
-- requiring a reprint.
--
-- The return shape is unchanged, so this one can be replaced in place.
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
       and app.entitlement_allows_service(e.status);
$$;

revoke all on function app.resolve_public_stand(text, text)
    from public, anon, authenticated;
grant execute on function app.resolve_public_stand(text, text) to service_role;
