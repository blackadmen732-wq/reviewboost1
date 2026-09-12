-- Subscription state, projected from Stripe webhooks.
--
-- This is the bridge between Stripe and server-authoritative entitlements.
-- The webhook handler writes here; the entitlement resolver reads here.
-- No client role writes to this table — it is infrastructure.

create type public.subscription_status as enum (
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused'
);

create type public.plan_id as enum ('starter', 'growth', 'pro');

create table public.subscriptions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  plan_id       public.plan_id not null default 'starter',
  status        public.subscription_status not null default 'active',

  stripe_customer_id     text,
  stripe_subscription_id text unique,
  stripe_price_id        text,

  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at              timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint subscriptions_one_per_org unique (org_id)
);

create index subscriptions_stripe_customer_idx
    on public.subscriptions (stripe_customer_id)
    where stripe_customer_id is not null;

-- RLS: only the service role writes subscriptions (via webhooks).
-- Owners may read their own org's subscription for display.
alter table public.subscriptions enable row level security;

create policy subscriptions_select_member on public.subscriptions
    for select to authenticated
    using (app.is_org_member(org_id));

-- No insert/update/delete policies for authenticated.
-- Webhooks write via service role which bypasses RLS.

-- Revoke direct table writes from all client roles.
revoke insert, update, delete on public.subscriptions from authenticated;
grant select on public.subscriptions to authenticated;

-- Trigger to keep updated_at current.
create or replace function public.subscriptions_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row
  execute function public.subscriptions_set_updated_at();
