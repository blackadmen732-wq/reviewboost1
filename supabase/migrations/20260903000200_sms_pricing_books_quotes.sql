-- ReviewBoost SMS pricing — price books, quotes, routing decisions, reconciliation
--
-- Customer prices are STABLE and VERSIONED, never surge-priced message by
-- message. The engine continuously recomputes recommendations, but a new
-- customer-facing rate only becomes active through a new PRICE-BOOK VERSION.
--
-- A QUOTE is the immutable record of one pricing decision — reproducible from
-- its content hash and never re-priced in place. A ROUTE DECISION records which
-- provider carried a message and why. RECONCILIATION stores estimated and
-- actual cost side by side; actuals are only ever written from real provider
-- settlement, never fabricated.

-- ---------------------------------------------------- price books ---------

create type public.sms_price_book_status as enum ('draft', 'active', 'retired');

create table public.sms_price_books (
    id         uuid primary key default gen_random_uuid(),
    org_id     uuid not null references public.organizations (id) on delete cascade,
    name       text not null check (char_length(name) between 1 and 120),
    currency   text not null check (currency ~ '^[A-Z]{3}$'),
    -- Optional customer tier this book applies to (null = default book).
    customer_tier text,
    created_at timestamptz not null default now(),
    constraint sms_price_books_org_name unique (org_id, name)
);

create table public.sms_price_book_versions (
    id            uuid primary key default gen_random_uuid(),
    price_book_id uuid not null references public.sms_price_books (id) on delete cascade,
    org_id        uuid not null references public.organizations (id) on delete cascade,
    version       integer not null check (version >= 1),
    status        public.sms_price_book_status not null default 'draft',
    effective_at  timestamptz not null default now(),
    created_by    uuid,
    created_at    timestamptz not null default now(),
    constraint sms_price_book_versions_key unique (price_book_id, version)
);

-- At most one active version per price book.
create unique index sms_price_book_versions_one_active_idx
    on public.sms_price_book_versions (price_book_id) where status = 'active';

create table public.sms_price_book_entries (
    id            uuid primary key default gen_random_uuid(),
    version_id    uuid not null references public.sms_price_book_versions (id) on delete cascade,
    org_id        uuid not null references public.organizations (id) on delete cascade,
    country       text not null check (country ~ '^[A-Z]{2}$'),
    number_type   public.sms_number_type not null default 'long_code',
    -- The customer-facing price per segment and the margin target it encodes.
    sell_price_micros bigint not null check (sell_price_micros >= 0),
    target_margin_bps integer not null check (target_margin_bps between 1 and 9999),
    created_at    timestamptz not null default now(),
    constraint sms_price_book_entries_key unique (version_id, country, number_type)
);

-- ---------------------------------------------- routing decisions ---------

create table public.sms_route_decisions (
    id            uuid primary key default gen_random_uuid(),
    org_id        uuid not null references public.organizations (id) on delete cascade,
    request_id    uuid,
    chosen_provider text,
    expected_cost_micros bigint check (expected_cost_micros is null or expected_cost_micros >= 0),
    currency      text check (currency is null or currency ~ '^[A-Z]{3}$'),
    multi_provider boolean not null default false,
    rationale     text not null,
    candidates    jsonb not null default '[]'::jsonb,
    created_at    timestamptz not null default now()
);

create index sms_route_decisions_request_idx on public.sms_route_decisions (org_id, request_id);

-- ----------------------------------------------------------- quotes -------

create table public.sms_quotes (
    id            uuid primary key default gen_random_uuid(),
    org_id        uuid not null references public.organizations (id) on delete cascade,
    quote_hash    text not null check (char_length(quote_hash) = 64),
    request_id    uuid,
    provider      text not null,
    encoding      text not null,
    segments      integer not null check (segments >= 1),
    currency      text not null check (currency ~ '^[A-Z]{3}$'),
    expected_cost_micros bigint not null check (expected_cost_micros >= 0),
    sell_micros   bigint not null check (sell_micros >= 0),
    contribution_micros bigint not null,
    target_margin_bps integer not null,
    realised_margin_bps integer not null,
    cost_breakdown jsonb not null,
    routing_id    uuid references public.sms_route_decisions (id) on delete set null,
    created_at    timestamptz not null default now(),
    expires_at    timestamptz not null,
    -- A quote is immutable and reproducible: its hash is unique per org.
    constraint sms_quotes_org_hash unique (org_id, quote_hash)
);

create index sms_quotes_request_idx on public.sms_quotes (org_id, request_id);

-- ------------------------------------------------- reconciliation ---------

create type public.sms_reconciliation_state as enum ('estimated', 'partially_settled', 'settled');

create table public.sms_cost_reconciliation (
    id            uuid primary key default gen_random_uuid(),
    org_id        uuid not null references public.organizations (id) on delete cascade,
    request_id    uuid,
    quote_id      uuid references public.sms_quotes (id) on delete set null,
    currency      text not null check (currency ~ '^[A-Z]{3}$'),

    estimated_provider_cost_micros bigint not null check (estimated_provider_cost_micros >= 0),
    estimated_carrier_cost_micros  bigint not null default 0 check (estimated_carrier_cost_micros >= 0),
    -- Actuals are null until the provider settles; never fabricated.
    actual_provider_cost_micros    bigint check (actual_provider_cost_micros is null or actual_provider_cost_micros >= 0),
    actual_carrier_cost_micros     bigint check (actual_carrier_cost_micros is null or actual_carrier_cost_micros >= 0),

    charged_credits        bigint not null default 0 check (charged_credits >= 0),
    customer_revenue_micros bigint not null default 0 check (customer_revenue_micros >= 0),
    actual_contribution_micros bigint,
    actual_gross_margin_bps integer,
    state         public.sms_reconciliation_state not null default 'estimated',
    updated_at    timestamptz not null default now(),
    created_at    timestamptz not null default now(),
    constraint sms_cost_reconciliation_request unique (org_id, request_id)
);

-- ------------------------------------------------------------- RLS --------

alter table public.sms_price_books enable row level security;
alter table public.sms_price_book_versions enable row level security;
alter table public.sms_price_book_entries enable row level security;
alter table public.sms_route_decisions enable row level security;
alter table public.sms_quotes enable row level security;
alter table public.sms_cost_reconciliation enable row level security;

do $$
declare
    t text;
begin
    foreach t in array array[
        'sms_price_books', 'sms_price_book_versions', 'sms_price_book_entries',
        'sms_route_decisions', 'sms_quotes', 'sms_cost_reconciliation'
    ]
    loop
        execute format(
            'create policy %I_select_admin on public.%I for select to authenticated '
            || 'using (app.has_org_role(org_id, array[''owner'', ''admin'']::public.member_role[]));',
            t, t);
        execute format('grant select on public.%I to authenticated;', t);
    end loop;
end $$;

-- ---------------------------------------------- definer writers -----------

-- Record an immutable quote. Idempotent on (org, quote_hash): re-recording the
-- same quote returns the existing row and never mutates it, so a persisted
-- charge is reproducible and tamper-evident.
create or replace function app.sms_quote_record(
    p_org_id uuid,
    p_quote_hash text,
    p_request_id uuid,
    p_provider text,
    p_encoding text,
    p_segments integer,
    p_currency text,
    p_expected_cost_micros bigint,
    p_sell_micros bigint,
    p_contribution_micros bigint,
    p_target_margin_bps integer,
    p_realised_margin_bps integer,
    p_cost_breakdown jsonb,
    p_routing_id uuid,
    p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    insert into public.sms_quotes
        (org_id, quote_hash, request_id, provider, encoding, segments, currency,
         expected_cost_micros, sell_micros, contribution_micros, target_margin_bps,
         realised_margin_bps, cost_breakdown, routing_id, expires_at)
    values
        (p_org_id, p_quote_hash, p_request_id, p_provider, p_encoding, p_segments, p_currency,
         p_expected_cost_micros, p_sell_micros, p_contribution_micros, p_target_margin_bps,
         p_realised_margin_bps, p_cost_breakdown, p_routing_id, p_expires_at)
    on conflict (org_id, quote_hash) do nothing
    returning id into v_id;

    if v_id is null then
        select id into v_id from public.sms_quotes
         where org_id = p_org_id and quote_hash = p_quote_hash;
    end if;
    return v_id;
end;
$$;

-- Record a routing decision (why a provider was chosen).
create or replace function app.sms_route_decision_record(
    p_org_id uuid,
    p_request_id uuid,
    p_chosen_provider text,
    p_expected_cost_micros bigint,
    p_currency text,
    p_multi_provider boolean,
    p_rationale text,
    p_candidates jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    insert into public.sms_route_decisions
        (org_id, request_id, chosen_provider, expected_cost_micros, currency,
         multi_provider, rationale, candidates)
    values
        (p_org_id, p_request_id, p_chosen_provider, p_expected_cost_micros, p_currency,
         coalesce(p_multi_provider, false), p_rationale, coalesce(p_candidates, '[]'::jsonb))
    returning id into v_id;
    return v_id;
end;
$$;

-- Activate a price-book version, retiring any currently-active version for the
-- same book. This is the ONLY way a new customer-facing rate goes live —
-- prices never change per message.
create or replace function app.sms_price_book_activate_version(
    p_org_id uuid,
    p_version_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_book uuid;
begin
    select price_book_id into v_book from public.sms_price_book_versions
     where id = p_version_id and org_id = p_org_id;
    if v_book is null then
        raise exception 'price book version not found for org';
    end if;

    update public.sms_price_book_versions
       set status = 'retired'
     where price_book_id = v_book and status = 'active';

    update public.sms_price_book_versions
       set status = 'active', effective_at = now()
     where id = p_version_id;
end;
$$;

-- Upsert reconciliation for a send. Actual costs are optional; when both provider
-- and carrier actuals are present the row settles and margin is computed, else
-- it remains estimated/partially settled. Never invents an actual.
create or replace function app.sms_reconcile_upsert(
    p_org_id uuid,
    p_request_id uuid,
    p_quote_id uuid,
    p_currency text,
    p_estimated_provider bigint,
    p_estimated_carrier bigint,
    p_actual_provider bigint,
    p_actual_carrier bigint,
    p_charged_credits bigint,
    p_customer_revenue bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
    v_effective_cost bigint;
    v_state public.sms_reconciliation_state;
    v_contribution bigint;
    v_margin integer;
begin
    v_effective_cost := coalesce(p_actual_provider, p_estimated_provider)
                      + coalesce(p_actual_carrier, p_estimated_carrier);
    if p_actual_provider is not null and p_actual_carrier is not null then
        v_state := 'settled';
    elsif p_actual_provider is not null or p_actual_carrier is not null then
        v_state := 'partially_settled';
    else
        v_state := 'estimated';
    end if;

    v_contribution := p_customer_revenue - v_effective_cost;
    if v_state = 'settled' and p_customer_revenue > 0 then
        v_margin := floor((p_customer_revenue - v_effective_cost) * 10000.0 / p_customer_revenue);
    else
        v_margin := null;
    end if;

    insert into public.sms_cost_reconciliation
        (org_id, request_id, quote_id, currency, estimated_provider_cost_micros,
         estimated_carrier_cost_micros, actual_provider_cost_micros, actual_carrier_cost_micros,
         charged_credits, customer_revenue_micros, actual_contribution_micros,
         actual_gross_margin_bps, state)
    values
        (p_org_id, p_request_id, p_quote_id, p_currency, p_estimated_provider,
         coalesce(p_estimated_carrier, 0), p_actual_provider, p_actual_carrier,
         coalesce(p_charged_credits, 0), coalesce(p_customer_revenue, 0), v_contribution,
         v_margin, v_state)
    -- On conflict, keep the whole snapshot internally consistent: the
    -- derived `actual_contribution_micros` and `actual_gross_margin_bps` were
    -- computed from THESE arguments, so the stored revenue, credits,
    -- currency, and estimated components have to update to match — otherwise
    -- a later corrected revenue would leave `actual_contribution` beside an
    -- older `customer_revenue_micros` and financial reporting would lie.
    on conflict (org_id, request_id) do update set
        quote_id = excluded.quote_id,
        currency = excluded.currency,
        estimated_provider_cost_micros = excluded.estimated_provider_cost_micros,
        estimated_carrier_cost_micros = excluded.estimated_carrier_cost_micros,
        actual_provider_cost_micros = excluded.actual_provider_cost_micros,
        actual_carrier_cost_micros = excluded.actual_carrier_cost_micros,
        charged_credits = excluded.charged_credits,
        customer_revenue_micros = excluded.customer_revenue_micros,
        actual_contribution_micros = excluded.actual_contribution_micros,
        actual_gross_margin_bps = excluded.actual_gross_margin_bps,
        state = excluded.state,
        updated_at = now()
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
        'app.sms_quote_record(uuid, text, uuid, text, text, integer, text, bigint, bigint, bigint, integer, integer, jsonb, uuid, timestamptz)',
        'app.sms_route_decision_record(uuid, uuid, text, bigint, text, boolean, text, jsonb)',
        'app.sms_price_book_activate_version(uuid, uuid)',
        'app.sms_reconcile_upsert(uuid, uuid, uuid, text, bigint, bigint, bigint, bigint, bigint, bigint)'
    ]
    loop
        execute format('revoke all on function %s from public, anon, authenticated;', fn);
        execute format('grant execute on function %s to service_role;', fn);
    end loop;
end $$;
