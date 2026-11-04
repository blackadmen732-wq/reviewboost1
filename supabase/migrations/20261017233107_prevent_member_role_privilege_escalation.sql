-- Security hotfix deployed to ReviewBoost Supabase on 2026-10-17.
-- This version matches the migration ledger entry already present on the host.
-- Non-destructive replacement of rpc_change_member_role; prevents lateral
-- privilege escalation while retaining owner-only transitions, last-owner
-- protection, and audit events.
create or replace function public.rpc_change_member_role(
    p_member_id uuid,
    p_new_role public.member_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_target_org_id uuid;
    v_target_user_id uuid;
    v_target_current_role public.member_role;
    v_caller_role public.member_role;
    v_owner_count integer;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select org_id, user_id, role
    into v_target_org_id, v_target_user_id, v_target_current_role
    from public.organization_members
    where id = p_member_id
      and status = 'active';

    if v_target_org_id is null then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    select role into v_caller_role
    from public.organization_members
    where org_id = v_target_org_id
      and user_id = v_actor
      and status = 'active';

    if v_caller_role is null then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    -- Only owners and admins may alter a member role; membership alone
    -- must never confer permission to promote another member.
    if v_caller_role not in ('owner', 'admin') then
        raise exception 'insufficient_permission'
            using errcode = 'P0001';
    end if;

    if v_target_user_id = v_actor then
        if p_new_role = 'owner' and v_target_current_role <> 'owner' then
            raise exception 'cannot_self_promote'
                using errcode = 'P0001';
        end if;
        if p_new_role = 'admin' and v_target_current_role not in ('owner', 'admin') then
            raise exception 'cannot_self_promote'
                using errcode = 'P0001';
        end if;
    end if;

    if (v_target_current_role = 'owner' or p_new_role = 'owner')
       and v_caller_role <> 'owner' then
        raise exception 'only_owners_manage_owners'
            using errcode = 'P0001';
    end if;

    if v_caller_role = 'admin' and p_new_role = 'owner' then
        raise exception 'admins_cannot_create_owners'
            using errcode = 'P0001';
    end if;

    if v_target_current_role = 'owner' and p_new_role <> 'owner' then
        perform 1
        from public.organization_members
        where org_id = v_target_org_id
          and role = 'owner'
          and status = 'active'
        for update;

        select count(*) into v_owner_count
        from public.organization_members
        where org_id = v_target_org_id
          and role = 'owner'
          and status = 'active';

        if v_owner_count <= 1 then
            raise exception 'cannot_remove_last_owner'
                using errcode = 'P0001';
        end if;
    end if;

    update public.organization_members
    set role = p_new_role
    where id = p_member_id
      and org_id = v_target_org_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (v_target_org_id, v_actor, 'user', 'member.role_changed', 'organization_member',
         p_member_id::text,
         jsonb_build_object('new_role', p_new_role::text, 'old_role', v_target_current_role::text));
end;
$$;

