-- Replace direct UPDATE on staff_members with a SECURITY DEFINER RPC.
-- The authenticated role currently has column-level UPDATE on staff_members,
-- which lets a Data API caller write arbitrary values without the server
-- validating ownership or encrypting the name first.

create or replace function public.rpc_update_staff(
    p_staff_id   uuid,
    p_name_encrypted text default null,
    p_role_label text default null,
    p_is_active  boolean default null,
    p_clear_role_label boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_org_id uuid;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select org_id into v_org_id
    from public.staff_members
    where id = p_staff_id
    for update;

    if v_org_id is null then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    if not exists (
        select 1 from public.organization_members
        where org_id = v_org_id and user_id = v_actor and status = 'active'
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    update public.staff_members
    set name_encrypted = coalesce(p_name_encrypted, name_encrypted),
        role_label = case
            when p_clear_role_label then null
            when p_role_label is not null then p_role_label
            else role_label
        end,
        is_active = coalesce(p_is_active, is_active)
    where id = p_staff_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (v_org_id, v_actor, 'user', 'staff.updated', 'staff_member',
         p_staff_id::text, '{}'::jsonb);
end;
$$;

revoke all on function public.rpc_update_staff(uuid, text, text, boolean, boolean) from public, anon;
grant execute on function public.rpc_update_staff(uuid, text, text, boolean, boolean) to authenticated;

-- Revoke direct column-level UPDATE now that all writes go through RPCs.
revoke update on public.staff_members from authenticated;
