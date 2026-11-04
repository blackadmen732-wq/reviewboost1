-- The last direct table read through the service-role client.
--
-- `ensureStripeCustomer` looked up an organization's Stripe customer with
-- `service.from("billing_customers")` — the one place the server's
-- RLS-bypassing client queried a table rather than calling a narrow function.
-- This is that lookup as a function: one organization in, one id out,
-- service_role only. The static guard in
-- frontend/tests/unit/service-role-containment.test.ts keeps it the last.

create or replace function public.rpc_billing_customer_for_org(p_org_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select c.stripe_customer_id
      from public.billing_customers c
     where c.org_id = p_org_id
$$;

revoke all on function public.rpc_billing_customer_for_org(uuid) from public, anon, authenticated;
grant execute on function public.rpc_billing_customer_for_org(uuid) to service_role;
