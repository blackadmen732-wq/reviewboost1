-- Let an owner read their own SMS balance without a service-role client.
--
-- `rpc_sms_balance` was service-role only, which pushed the owner-facing read
-- onto a client that bypasses row level security — and this repository has a
-- test whose whole job is to stop that happening, because a service-role read
-- in the owner data layer returns every tenant's rows and no mocked test
-- notices.
--
-- So the check moves into the function: it is SECURITY DEFINER, it proves the
-- caller is an active member of the organization it was asked about, and it is
-- callable by `authenticated`. A member asking about someone else's
-- organization gets zeros, which is the same answer they would get for an
-- organization that has never bought anything — nothing is confirmed either way.
create or replace function public.rpc_sms_balance(p_org_id uuid)
returns table (monthly bigint, purchased bigint, total bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
begin
    -- The service role has no JWT and needs no membership: it is the server
    -- acting on a webhook or a worker, and it is already trusted.
    if v_actor is not null and not exists (
        select 1 from public.organization_members m
         where m.org_id = p_org_id
           and m.user_id = v_actor
           and m.status = 'active'
    ) then
        return query select 0::bigint, 0::bigint, 0::bigint;
        return;
    end if;

    return query select * from app.sms_balance(p_org_id);
end;
$$;

revoke all on function public.rpc_sms_balance(uuid) from public, anon;
grant execute on function public.rpc_sms_balance(uuid) to authenticated, service_role;
