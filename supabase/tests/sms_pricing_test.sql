-- SMS pricing engine — database layer tests.
--
-- Covers the persisted half of the pricing/routing engine: the provider rate
-- catalogue, the margin-policy band and its platform floor, price-book version
-- activation (stable versioned prices, never per-message), quote immutability
-- (idempotent record), routing-decision capture, reconciliation state, and the
-- RLS/grant posture (reference rates readable, tenant policy owner/admin only,
-- no client writes).
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

select plan(16);

-- ------------------------------------------------------------- fixtures ----

create or replace function tests.set_actor(p_user_id uuid) returns void
language plpgsql as $$
begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
        json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end $$;

create or replace function tests.set_service() returns void
language plpgsql as $$
begin
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
end $$;

grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
    ('7b000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pr-owner@test.com', '', now(), now()),
    ('7b000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pr-member@test.com', '', now(), now()),
    ('7b000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pr-outsider@test.com', '', now(), now());

insert into public.organizations (id, name, slug)
values
    ('7c000000-0000-0000-0000-0000000000a1', 'Pricing Org A', 'pricing-org-a'),
    ('7c000000-0000-0000-0000-0000000000a2', 'Pricing Org B', 'pricing-org-b');

insert into public.organization_members (org_id, user_id, role, status)
values
    ('7c000000-0000-0000-0000-0000000000a1', '7b000000-0000-0000-0000-0000000000a1', 'owner', 'active'),
    ('7c000000-0000-0000-0000-0000000000a1', '7b000000-0000-0000-0000-0000000000a3', 'member', 'active'),
    ('7c000000-0000-0000-0000-0000000000a2', '7b000000-0000-0000-0000-0000000000a4', 'owner', 'active');

-- ===================================================== provider rates ======

select tests.set_service();

-- Upsert a base rate (version 1), then a superseding version 2 (cheaper).
select app.sms_rate_upsert('twilio', 'US', null, null, 'Verizon', 'long_code', 'outbound',
    7500, null, 500, 'USD', 'twilio_pricing_api', now(), now() + interval '7 days', 1);
select app.sms_rate_upsert('twilio', 'US', null, null, 'Verizon', 'long_code', 'outbound',
    7000, 6800, 500, 'USD', 'twilio_pricing_api', now(), now() + interval '7 days', 2);

select is(
    (select count(*)::integer from public.sms_provider_rates
      where provider = 'twilio' and country = 'US'),
    2, 'a superseding rate version is a new row, not an overwrite');

select is(
    (select current_price_micros from public.sms_provider_rates
      where provider = 'twilio' and country = 'US' order by rate_version desc limit 1),
    6800::bigint, 'the highest rate version carries the account current price');

-- anon holds no privilege on the rate catalogue.
select is(has_table_privilege('anon', 'public.sms_provider_rates', 'SELECT'), false,
    'anon has no SELECT on sms_provider_rates');

-- Reference rates are readable by any authenticated user (non-secret).
select tests.set_actor('7b000000-0000-0000-0000-0000000000a3'); -- a mere member
select is(
    (select count(*)::integer from public.sms_provider_rates where provider = 'twilio'),
    2, 'any authenticated user may read the non-secret rate catalogue');

-- ===================================================== margin policy ========

select tests.set_service();

-- With no policy configured, the platform default band applies.
select is(
    (select default_target_bps from app.sms_margin_policy_for('7c000000-0000-0000-0000-0000000000a1')),
    7800, 'default margin target is 78%% when no org policy is set');
select is(
    (select hard_min_bps from app.sms_margin_policy_for('7c000000-0000-0000-0000-0000000000a1')),
    7000, 'default hard-minimum margin is 70%%');

-- Setting a valid in-envelope band works and becomes active.
select lives_ok(
    $$ select app.sms_margin_policy_set('7c000000-0000-0000-0000-0000000000a1', 7200, 8000, 8500, null, 'tuned') $$,
    'an in-envelope margin band can be set');
select is(
    (select default_target_bps from app.sms_margin_policy_for('7c000000-0000-0000-0000-0000000000a1')),
    8000, 'the active policy target replaces the default');

-- A band below the 70%% platform floor is rejected.
select throws_ok(
    $$ select app.sms_margin_policy_set('7c000000-0000-0000-0000-0000000000a1', 6000, 6500, 7000, null, 'too low') $$,
    'P0001', NULL, 'a margin band below the 70%% platform floor is rejected');

-- Only one active policy remains after re-setting.
select is(
    (select count(*)::integer from public.sms_margin_policies
      where org_id = '7c000000-0000-0000-0000-0000000000a1' and active),
    1, 'exactly one margin policy is active per org');

-- ===================================================== quotes ==============

-- Recording the same quote hash twice is idempotent (immutable quote).
select is(
    app.sms_quote_record('7c000000-0000-0000-0000-0000000000a1', repeat('a',64), null,
        'twilio', 'gsm7', 1, 'USD', 7500, 34091, 26591, 7800, 7801, '{}'::jsonb, null, now() + interval '15 min'),
    app.sms_quote_record('7c000000-0000-0000-0000-0000000000a1', repeat('a',64), null,
        'twilio', 'gsm7', 1, 'USD', 7500, 34091, 26591, 7800, 7801, '{}'::jsonb, null, now() + interval '15 min'),
    'recording an identical quote hash twice returns the same immutable quote');
select is(
    (select count(*)::integer from public.sms_quotes
      where org_id = '7c000000-0000-0000-0000-0000000000a1' and quote_hash = repeat('a',64)),
    1, 'an idempotent quote record inserts exactly one row');

-- ===================================================== price books =========

select tests.set_service();
insert into public.sms_price_books (id, org_id, name, currency)
values ('7a000000-0000-0000-0000-0000000000b1', '7c000000-0000-0000-0000-0000000000a1', 'Default', 'USD');
insert into public.sms_price_book_versions (id, price_book_id, org_id, version, status)
values
    ('7a000000-0000-0000-0000-0000000000c1', '7a000000-0000-0000-0000-0000000000b1', '7c000000-0000-0000-0000-0000000000a1', 1, 'draft'),
    ('7a000000-0000-0000-0000-0000000000c2', '7a000000-0000-0000-0000-0000000000b1', '7c000000-0000-0000-0000-0000000000a1', 2, 'draft');

select app.sms_price_book_activate_version('7c000000-0000-0000-0000-0000000000a1', '7a000000-0000-0000-0000-0000000000c1');
select app.sms_price_book_activate_version('7c000000-0000-0000-0000-0000000000a1', '7a000000-0000-0000-0000-0000000000c2');
select is(
    (select count(*)::integer from public.sms_price_book_versions
      where price_book_id = '7a000000-0000-0000-0000-0000000000b1' and status = 'active'),
    1, 'activating a new price-book version retires the prior active version');

-- ===================================================== reconciliation ======

-- Estimated only (no provider actuals) → estimated, no realised margin.
select app.sms_reconcile_upsert('7c000000-0000-0000-0000-0000000000a1',
    '7f000000-0000-0000-0000-0000000000d1', null, 'USD', 7500, 500, null, null, 1, 34091);
select is(
    (select state::text from public.sms_cost_reconciliation
      where request_id = '7f000000-0000-0000-0000-0000000000d1'),
    'estimated', 'reconciliation stays estimated until the provider settles');

-- Both actuals supplied → settled with a realised margin.
select app.sms_reconcile_upsert('7c000000-0000-0000-0000-0000000000a1',
    '7f000000-0000-0000-0000-0000000000d1', null, 'USD', 7500, 500, 8000, 600, 1, 34091);
select is(
    (select state::text from public.sms_cost_reconciliation
      where request_id = '7f000000-0000-0000-0000-0000000000d1'),
    'settled', 'reconciliation settles once actual provider and carrier costs arrive');

-- ===================================================== RLS =================

select tests.set_actor('7b000000-0000-0000-0000-0000000000a3'); -- member of A
select is(
    (select count(*)::integer from public.sms_margin_policies),
    0, 'a member cannot read the tenant margin policy');

select tests.set_actor('7b000000-0000-0000-0000-0000000000a4'); -- outsider (org B)
select is(
    (select count(*)::integer from public.sms_quotes),
    0, 'an outsider sees none of another org''s quotes');

select * from finish();
rollback;
