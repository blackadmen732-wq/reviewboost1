-- Fix organization targeting and staff authorization.
--
-- 1. rpc_update_organization: accept p_org_id, lock the exact row, authorize
--    against that org. Replaces the LIMIT 1 query that picked an arbitrary org
--    for multi-org users.
-- 2. rpc_update_staff: require owner/admin role instead of any active member.

-- ============================================================
-- 1. rpc_update_organization — accept p_org_id
-- ============================================================

drop function if exists public.rpc_update_organization(text, text);

create function public.rpc_update_organization(
    p_org_id   uuid,
    p_name     text default null,
    p_timezone text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    perform 1
    from public.organizations
    where id = p_org_id
    for update;

    if not found then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    if not exists (
        select 1 from public.organization_members
        where org_id = p_org_id
          and user_id = v_actor
          and status = 'active'
          and role in ('owner', 'admin')
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    if p_name is null and p_timezone is null then
        return;
    end if;

    update public.organizations
    set name = coalesce(p_name, name),
        timezone = coalesce(p_timezone, timezone)
    where id = p_org_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (p_org_id, v_actor, 'user', 'organization.updated', 'organization',
         p_org_id::text, '{}'::jsonb);
end;
$$;

revoke all on function public.rpc_update_organization(uuid, text, text) from public, anon;
grant execute on function public.rpc_update_organization(uuid, text, text) to authenticated;

-- ============================================================
-- 2. rpc_update_staff — require owner/admin
-- ============================================================

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
        where org_id = v_org_id
          and user_id = v_actor
          and status = 'active'
          and role in ('owner', 'admin')
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
