-- Security fixes from code review.
--
-- 1. NULL caller-role bypass in rpc_suspend_member and rpc_remove_member
-- 2. Remove organizations.status from authenticated UPDATE grant
-- 3. Remove token columns from review_stands UPDATE grant
-- 4. Revoke PUBLIC EXECUTE on wrapper functions from migration 000300
-- 5. Revoke direct UPDATE on organization_members (force RPC path)

-- ============================================================
-- 1. FIX NULL CALLER-ROLE BYPASS
-- ============================================================
-- rpc_suspend_member and rpc_remove_member compare v_caller_role with
-- NOT IN, which evaluates to NULL (not true) when v_caller_role is NULL.
-- This lets a non-member reach the final UPDATE. Add explicit null checks
-- matching the pattern already used by rpc_change_member_role.

create or replace function public.rpc_suspend_member(p_member_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_target_org_id uuid;
    v_target_role public.member_role;
    v_caller_role public.member_role;
    v_owner_count integer;
begin
    select org_id, role into v_target_org_id, v_target_role
    from public.organization_members
    where id = p_member_id
      and status = 'active';

    if v_target_org_id is null then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    if exists (
        select 1 from public.organization_members
        where id = p_member_id and user_id = (select auth.uid())
    ) then
        raise exception 'cannot_suspend_self'
            using errcode = 'P0001';
    end if;

    select role into v_caller_role
    from public.organization_members
    where org_id = v_target_org_id
      and user_id = (select auth.uid())
      and status = 'active';

    if v_caller_role is null then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    if v_target_role = 'owner' and v_caller_role <> 'owner' then
        raise exception 'only_owners_manage_owners'
            using errcode = 'P0001';
    end if;

    if v_caller_role not in ('owner', 'admin') then
        raise exception 'insufficient_permission'
            using errcode = 'P0001';
    end if;

    if v_target_role = 'owner' then
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
    set status = 'suspended'
    where id = p_member_id;
end;
$$;

create or replace function public.rpc_remove_member(p_member_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_target_org_id uuid;
    v_target_role public.member_role;
    v_caller_role public.member_role;
    v_owner_count integer;
begin
    select org_id, role into v_target_org_id, v_target_role
    from public.organization_members
    where id = p_member_id
      and status in ('active', 'suspended');

    if v_target_org_id is null then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    select role into v_caller_role
    from public.organization_members
    where org_id = v_target_org_id
      and user_id = (select auth.uid())
      and status = 'active';

    if v_caller_role is null then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    if v_caller_role not in ('owner', 'admin') then
        raise exception 'insufficient_permission'
            using errcode = 'P0001';
    end if;

    if v_target_role = 'owner' and v_caller_role <> 'owner' then
        raise exception 'only_owners_manage_owners'
            using errcode = 'P0001';
    end if;

    if v_target_role = 'owner' then
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
    set status = 'removed'
    where id = p_member_id;
end;
$$;

-- ============================================================
-- 2. REMOVE organizations.status FROM AUTHENTICATED UPDATE GRANT
-- ============================================================
-- status is a lifecycle column (active/suspended/closed), not a setting.
-- Any member with matching RLS could set the org to 'closed'.

revoke update on public.organizations from authenticated;
grant update (name, timezone, default_locale) on public.organizations to authenticated;

-- ============================================================
-- 3. REMOVE TOKEN COLUMNS FROM review_stands UPDATE GRANT
-- ============================================================
-- Token columns should only be written through the rotateStandToken RPC,
-- which records an audit event. Direct Data API writes bypass auditing.

revoke update on public.review_stands from authenticated;
grant update (label, status, last_opened_at) on public.review_stands to authenticated;

-- ============================================================
-- 4. REVOKE PUBLIC EXECUTE ON WRAPPER FUNCTIONS
-- ============================================================
-- Migration 000300 recreated these as SECURITY DEFINER but DROP+CREATE
-- resets ACLs to PostgreSQL's default (EXECUTE to PUBLIC), making them
-- callable by anon.

revoke execute on function public.rpc_record_audit_event(uuid, text, text, text, text, jsonb) from public;
revoke execute on function public.rpc_create_organization(text, text, text, text, text, text, text, text, text, smallint, text) from public;
revoke execute on function public.rpc_set_stand_token_ciphertext(uuid, text, smallint) from public;

grant execute on function public.rpc_record_audit_event(uuid, text, text, text, text, jsonb) to authenticated;
grant execute on function public.rpc_create_organization(text, text, text, text, text, text, text, text, text, smallint, text) to authenticated;
grant execute on function public.rpc_set_stand_token_ciphertext(uuid, text, smallint) to authenticated;

-- ============================================================
-- 5. RESTRICT UPDATE ON organization_members TO RPC-USED COLUMNS
-- ============================================================
-- A table-wide UPDATE grant lets an owner/admin bypass self-promotion,
-- last-owner, and self-suspension checks via the Data API. Restrict to
-- only the columns the SECURITY INVOKER RPCs need (role, status).

revoke update on public.organization_members from authenticated;
grant update (role, status) on public.organization_members to authenticated;
