-- Setting a business up is not the same as serving its customers.
--
-- Making a never-subscribed organization `suspended` closed the public door,
-- which is right. It also closed the front door: the caps read `suspended` as
-- "no Tags, no locations", so a business that had just signed up could not
-- create the one Tag onboarding exists to give it. Nobody would ever reach
-- checkout, because the product would be unusable before it.
--
-- The two questions are separate, and this separates them:
--
--   may this business SET UP?      one location, one Tag, before paying
--   may its Tags SERVE CUSTOMERS?  only once billing says so
--
-- `app.entitlement_allows_service` is untouched: a suspended organization's
-- Tag still resolves to the same neutral dead link as an unknown token. What
-- changes is that an owner can name their business, set their destination,
-- print their QR code and see exactly what a customer will see — and then be
-- asked for a card to switch it on. A Tag that serves nobody is not a free
-- plan; it is a product someone can look at before buying.
--
-- SUSPENDED AFTER PAYING IS NOT THE SAME STATE
-- --------------------------------------------
-- An organization suspended at the end of dunning has a plan on its
-- entitlement. It gets no setup allowance: its Tags exist already, and it does
-- not get to make more while it owes money. The difference is exactly the one
-- the billing screen already draws — "choose a plan" versus "suspended" — and
-- it is the presence of a plan that tells them apart.

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
        when p_status = 'active' and p_plan_id = 'starter' then 1
        when p_status = 'active' and p_plan_id = 'growth' then 2
        when p_status = 'active' and p_plan_id = 'pro' then 5
        else 0
    end;
$$;

revoke all on function app.entitlement_tag_limit(text, text) from public, anon, authenticated;
revoke all on function app.entitlement_location_limit(text, text) from public, anon, authenticated;

comment on function app.entitlement_tag_limit(text, text) is
    'How many Tags this entitlement allows. A business that has never subscribed gets one, so that it can be set up; that Tag serves no customers until billing opens the door.';
