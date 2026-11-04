-- Two things the account-deletion route needs, both reachable through the API.
--
-- 1. The Stripe ids, through `public`.
--
--    The route read them with `.schema("app").rpc("billing_refs_for_org")`.
--    The Data API serves only `public` (supabase/config.toml), so that call
--    failed on every request and every deletion was refused with "we could not
--    check your subscription". The unit test mocked `.schema()` and could not
--    see it. Every other service-role call goes through a `public.rpc_*`
--    wrapper for this reason (see 20260928000300_billing_customer_lookup).
--
-- 2. The typed confirmation, checked before Stripe is touched.
--
--    The route cancelled the subscription and only then called
--    `rpc_delete_organization`, which is where the business name is checked.
--    A rejected name — a mobile app still showing the old name after a rename,
--    or a character the form trims and Postgres does not — left the business
--    with all its data and no paid plan. This runs the same owner check and the
--    same comparison, without deleting anything, so the route can refuse before
--    the irreversible step. `rpc_delete_organization` still checks again.

create or replace function public.rpc_billing_refs_for_org(p_org_id uuid)
returns table (
    stripe_customer_id     text,
    stripe_subscription_id text,
    stripe_status          text
)
language sql
stable
security definer
set search_path = ''
as $$
    select r.stripe_customer_id, r.stripe_subscription_id, r.stripe_status
      from app.billing_refs_for_org(p_org_id) r;
$$;

revoke all on function public.rpc_billing_refs_for_org(uuid) from public, anon, authenticated;
grant execute on function public.rpc_billing_refs_for_org(uuid) to service_role;

comment on function public.rpc_billing_refs_for_org(uuid) is
    'Service role only. The Stripe customer, subscription and status for one organization, so account deletion can cancel billing before the rows are destroyed.';

create or replace function public.rpc_delete_organization_check(
    p_org_id       uuid,
    p_confirmation text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_name  text;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    if p_org_id is null then
        raise exception 'organization is required' using errcode = 'P0001';
    end if;

    select name into v_name
      from public.organizations
     where id = p_org_id;

    -- Same errors, in the same order, as rpc_delete_organization: a missing
    -- business and one the caller may not delete are indistinguishable.
    if v_name is null then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    if not exists (
        select 1 from public.organization_members
         where org_id = p_org_id
           and user_id = v_actor
           and status = 'active'
           and role = 'owner'
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    if p_confirmation is null
       or lower(btrim(p_confirmation)) <> lower(btrim(v_name)) then
        raise exception 'confirmation_mismatch' using errcode = 'P0001';
    end if;
end;
$$;

revoke all on function public.rpc_delete_organization_check(uuid, text) from public, anon;
grant execute on function public.rpc_delete_organization_check(uuid, text) to authenticated;

comment on function public.rpc_delete_organization_check(uuid, text) is
    'Owner only. Raises exactly what rpc_delete_organization would for the authority and confirmation checks, and deletes nothing. Called before Stripe is cancelled.';
