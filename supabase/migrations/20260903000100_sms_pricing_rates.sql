-- ReviewBoost SMS pricing — provider rate tables & margin policies
--
-- The economics engine that turns provider rates into a margin-protected
-- customer price is computed in TypeScript (`frontend/lib/server/sms/pricing`),
-- but its inputs and decisions are durable Postgres rows. This migration adds
-- the provider-independent RATE catalogue and the MARGIN POLICY band. A later
-- migration adds price books, quotes, routing decisions, and reconciliation.
--
-- Provider rates are org-agnostic reference data (a Twilio US carrier price is
-- the same for every tenant), so they live in a single catalogue with no
-- org_id, readable by any authenticated user and written only by the service
-- role. Margin policies ARE tenant policy and are org-scoped with RLS.
--
-- Money is integer micro-units (bigint). Margins are integer basis points.

-- --------------------------------------------------------- enums ----------

create type public.sms_rate_source as enum (
    'twilio_pricing_api', 'manual_deck', 'provider_api'
);

create type public.sms_number_type as enum (
    'long_code', 'toll_free', 'short_code', 'sender_id', 'unknown'
);

create type public.sms_rate_direction as enum ('outbound', 'inbound');

-- ------------------------------------------- provider rate catalogue ------

-- One normalized rate per (provider, country, mcc, mnc, number_type, direction,
-- rate_version). Higher rate_version supersedes; the active price for a key is
-- the highest non-expired version. base_price is the provider list price;
-- current_price is the account-specific negotiated/volume price when known.
create table public.sms_provider_rates (
    id                     uuid primary key default gen_random_uuid(),
    provider               text not null check (char_length(provider) between 2 and 40),
    country                text not null check (country ~ '^[A-Z]{2}$'),
    mcc                    text check (mcc ~ '^[0-9]{1,4}$'),
    mnc                    text check (mnc ~ '^[0-9]{1,4}$'),
    carrier                text,
    number_type            public.sms_number_type not null default 'unknown',
    direction              public.sms_rate_direction not null default 'outbound',

    base_price_micros      bigint not null check (base_price_micros >= 0),
    current_price_micros   bigint check (current_price_micros is null or current_price_micros >= 0),
    carrier_surcharge_micros bigint check (carrier_surcharge_micros is null or carrier_surcharge_micros >= 0),

    currency               text not null check (currency ~ '^[A-Z]{3}$'),
    source                 public.sms_rate_source not null,

    effective_at           timestamptz not null default now(),
    fetched_at             timestamptz not null default now(),
    expires_at             timestamptz,
    rate_version           bigint not null,

    created_at             timestamptz not null default now(),

    -- One row per logical key + version. mcc/mnc null collapses to '' for the
    -- uniqueness scope so a country-level rate has exactly one row per version.
    constraint sms_provider_rates_key unique
        (provider, country, mcc, mnc, number_type, direction, rate_version)
);

create index sms_provider_rates_lookup_idx on public.sms_provider_rates
    (provider, country, number_type, direction, rate_version desc);
create index sms_provider_rates_fresh_idx on public.sms_provider_rates (expires_at)
    where expires_at is not null;

-- ------------------------------------------------- margin policies --------

-- Tenant margin policy in basis points. Exactly one active policy per org at a
-- time (partial unique index on active). The engine may target anywhere in
-- [hard_min_bps, max_target_bps] but never prices below hard_min_bps.
create table public.sms_margin_policies (
    id                 uuid primary key default gen_random_uuid(),
    org_id             uuid not null references public.organizations (id) on delete cascade,
    hard_min_bps       integer not null check (hard_min_bps between 1 and 9999),
    default_target_bps integer not null check (default_target_bps between 1 and 9999),
    max_target_bps     integer not null check (max_target_bps between 1 and 9999),
    active             boolean not null default true,
    note               text,
    created_by         uuid,
    created_at         timestamptz not null default now(),

    constraint sms_margin_policy_band check
        (hard_min_bps <= default_target_bps and default_target_bps <= max_target_bps)
);

create unique index sms_margin_policies_one_active_idx
    on public.sms_margin_policies (org_id) where active;

alter table public.sms_provider_rates enable row level security;
alter table public.sms_margin_policies enable row level security;

-- Provider rates are non-secret reference data: any authenticated user may read
-- them; no client writes (service role only via definer functions).
create policy sms_provider_rates_select on public.sms_provider_rates
    for select to authenticated using (true);

-- Margin policy is tenant configuration: owners/admins read their own.
create policy sms_margin_policies_select_admin on public.sms_margin_policies
    for select to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

grant select on public.sms_provider_rates to authenticated;
grant select on public.sms_margin_policies to authenticated;

-- ---------------------------------------------- definer writers -----------

-- Upsert a normalized provider rate. Service role only; the TS rate adapters
-- (Twilio pricing API / manual deck) call this to persist what they ingest.
create or replace function app.sms_rate_upsert(
    p_provider   text,
    p_country    text,
    p_mcc        text,
    p_mnc        text,
    p_carrier    text,
    p_number_type public.sms_number_type,
    p_direction  public.sms_rate_direction,
    p_base_price_micros bigint,
    p_current_price_micros bigint,
    p_carrier_surcharge_micros bigint,
    p_currency   text,
    p_source     public.sms_rate_source,
    p_effective_at timestamptz,
    p_expires_at timestamptz,
    p_rate_version bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    insert into public.sms_provider_rates
        (provider, country, mcc, mnc, carrier, number_type, direction,
         base_price_micros, current_price_micros, carrier_surcharge_micros,
         currency, source, effective_at, fetched_at, expires_at, rate_version)
    values
        (p_provider, p_country, p_mcc, p_mnc, p_carrier, p_number_type, p_direction,
         p_base_price_micros, p_current_price_micros, p_carrier_surcharge_micros,
         p_currency, p_source, coalesce(p_effective_at, now()), now(), p_expires_at, p_rate_version)
    on conflict (provider, country, mcc, mnc, number_type, direction, rate_version)
    do update set
        base_price_micros = excluded.base_price_micros,
        current_price_micros = excluded.current_price_micros,
        carrier_surcharge_micros = excluded.carrier_surcharge_micros,
        currency = excluded.currency,
        source = excluded.source,
        effective_at = excluded.effective_at,
        fetched_at = now(),
        expires_at = excluded.expires_at
    returning id into v_id;
    return v_id;
end;
$$;

-- Resolve the active margin policy for an org, falling back to the platform
-- default band (70 / 78 / 85) when the org has set none. Never returns a band
-- that violates hard_min <= default <= max.
create or replace function app.sms_margin_policy_for(p_org_id uuid)
returns table (hard_min_bps integer, default_target_bps integer, max_target_bps integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v record;
begin
    select p.hard_min_bps, p.default_target_bps, p.max_target_bps into v
      from public.sms_margin_policies p
     where p.org_id = p_org_id and p.active
     limit 1;
    if v.hard_min_bps is null then
        return query select 7000, 7800, 8500;
    else
        return query select v.hard_min_bps, v.default_target_bps, v.max_target_bps;
    end if;
end;
$$;

-- Set (replace) the active margin policy for an org. Validates the band and the
-- 70–85 platform envelope so a tenant cannot configure below the floor.
create or replace function app.sms_margin_policy_set(
    p_org_id uuid,
    p_hard_min_bps integer,
    p_default_target_bps integer,
    p_max_target_bps integer,
    p_actor uuid,
    p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    if p_hard_min_bps < 7000 or p_max_target_bps > 8500
       or not (p_hard_min_bps <= p_default_target_bps and p_default_target_bps <= p_max_target_bps) then
        raise exception 'margin band out of platform policy (70-85%%) or misordered';
    end if;

    update public.sms_margin_policies set active = false
     where org_id = p_org_id and active;

    insert into public.sms_margin_policies
        (org_id, hard_min_bps, default_target_bps, max_target_bps, active, note, created_by)
    values
        (p_org_id, p_hard_min_bps, p_default_target_bps, p_max_target_bps, true, p_note, p_actor)
    returning id into v_id;
    return v_id;
end;
$$;

-- --------------------------------------------------------- grants ----------

do $$
declare
    fn text;
begin
    foreach fn in array array[
        'app.sms_rate_upsert(text, text, text, text, text, public.sms_number_type, public.sms_rate_direction, bigint, bigint, bigint, text, public.sms_rate_source, timestamptz, timestamptz, bigint)',
        'app.sms_margin_policy_for(uuid)',
        'app.sms_margin_policy_set(uuid, integer, integer, integer, uuid, text)'
    ]
    loop
        execute format('revoke all on function %s from public, anon, authenticated;', fn);
        execute format('grant execute on function %s to service_role;', fn);
    end loop;
end $$;
