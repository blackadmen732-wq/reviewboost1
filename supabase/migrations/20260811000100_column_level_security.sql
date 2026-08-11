-- Column-level security and narrow RPC functions.
--
-- THE PROBLEM THIS SOLVES
-- =======================
-- Table-wide UPDATE grants combined with permissive RLS update policies allow
-- any authenticated member to modify ANY column on rows they can see — including
-- rating, encrypted notes, org_id, and attribution fields. The application
-- service layer restricts columns, but the Supabase Data API bypasses it.
--
-- RLS controls WHICH ROWS. Column privileges control WHICH COLUMNS.
-- Neither is sufficient alone.
--
-- This migration:
-- 1. Revokes table-wide UPDATE on sensitive tables
-- 2. Grants UPDATE only on safe triage columns
-- 3. Creates narrow RPC functions for all write operations
-- 4. Revokes DELETE on entity tables to prevent hard-delete cascades
-- 5. Removes the generic audit RPC from authenticated access
-- 6. Creates a praise-safe view that cannot correlate with ratings

-- ============================================================
-- A. CUSTOMER RESPONSES — column-level UPDATE restriction
-- ============================================================

-- Revoke the table-wide UPDATE grant
revoke update on public.customer_responses from authenticated;

-- Grant UPDATE only on the triage columns an owner legitimately sets.
-- rating, note_encrypted, org_id, location_id, stand_id, session_id,
-- response_token_hash, note_key_version, submitted_at, created_at
-- are all now un-updatable by any authenticated user.
grant update (read_at, resolved_at, resolved_by) on public.customer_responses to authenticated;

-- ============================================================
-- B. TEAM PRAISE — column-level UPDATE restriction
-- ============================================================

revoke update on public.team_praise_records from authenticated;

-- Only matching and sharing fields are updatable.
grant update (status, matched_staff_id, matched_by_user_id, matched_at, shared_at, shared_by)
    on public.team_praise_records to authenticated;

-- ============================================================
-- C. STAFF MEMBERS — column-level restrictions
-- ============================================================

revoke update on public.staff_members from authenticated;
revoke insert on public.staff_members from authenticated;

-- Staff name and role are the only editable fields.
-- org_id, id, key_version, created_at are server-controlled.
grant update (name_encrypted, key_version, role_label, is_active) on public.staff_members to authenticated;
grant insert on public.staff_members to authenticated;

-- ============================================================
-- D. LOCATIONS — revoke DELETE to prevent cascade
-- ============================================================

revoke delete on public.locations from authenticated;
-- Keep select, insert, update for admin operations.

-- ============================================================
-- E. REVIEW STANDS — revoke DELETE to prevent cascade
-- ============================================================

revoke delete on public.review_stands from authenticated;

-- ============================================================
-- F. ORGANIZATION MEMBERS — revoke DELETE, add narrow functions
-- ============================================================

revoke delete on public.organization_members from authenticated;

-- Drop the permissive delete policy
drop policy if exists organization_members_delete_admin on public.organization_members;

-- ============================================================
-- G. NARROW RPC FUNCTIONS FOR CUSTOMER RESPONSES
-- ============================================================

-- Mark response as read
create or replace function public.rpc_mark_response_read(p_response_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
    update public.customer_responses
    set read_at = now()
    where id = p_response_id
      and read_at is null;

    if not found then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;
end;
$$;

-- Resolve response
create or replace function public.rpc_resolve_response(
    p_response_id uuid,
    p_note text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
    update public.customer_responses
    set
        resolved_at = now(),
        resolved_by = (select auth.uid())
    where id = p_response_id
      and resolved_at is null;

    if not found then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;
end;
$$;

-- Reopen response
create or replace function public.rpc_reopen_response(p_response_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
    update public.customer_responses
    set
        resolved_at = null,
        resolved_by = null
    where id = p_response_id
      and resolved_at is not null;

    if not found then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;
end;
$$;

grant execute on function public.rpc_mark_response_read(uuid) to authenticated;
grant execute on function public.rpc_resolve_response(uuid, text) to authenticated;
grant execute on function public.rpc_reopen_response(uuid) to authenticated;

revoke all on function public.rpc_mark_response_read(uuid) from public, anon;
revoke all on function public.rpc_resolve_response(uuid, text) from public, anon;
revoke all on function public.rpc_reopen_response(uuid) from public, anon;

-- ============================================================
-- H. NARROW RPC FUNCTIONS FOR TEAM PRAISE
-- ============================================================

-- Match praise to a staff member
create or replace function public.rpc_match_praise(
    p_praise_id uuid,
    p_staff_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_org_id uuid;
begin
    -- Get the org of the praise record (RLS ensures caller can see it)
    select org_id into v_org_id
    from public.team_praise_records
    where id = p_praise_id;

    if v_org_id is null then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    -- Verify the staff member belongs to the same org and is active
    if not exists (
        select 1 from public.staff_members
        where id = p_staff_id
          and org_id = v_org_id
          and is_active = true
    ) then
        raise exception 'invalid_staff_member'
            using errcode = 'P0001';
    end if;

    update public.team_praise_records
    set
        status = 'matched',
        matched_staff_id = p_staff_id,
        matched_by_user_id = (select auth.uid()),
        matched_at = now()
    where id = p_praise_id
      and org_id = v_org_id;
end;
$$;

-- Unmatch praise
create or replace function public.rpc_unmatch_praise(p_praise_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
    update public.team_praise_records
    set
        status = 'unmatched',
        matched_staff_id = null,
        matched_by_user_id = null,
        matched_at = null
    where id = p_praise_id;

    if not found then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;
end;
$$;

-- Mark praise as shared
create or replace function public.rpc_mark_praise_shared(p_praise_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
    update public.team_praise_records
    set
        shared_at = now(),
        shared_by = (select auth.uid())
    where id = p_praise_id
      and shared_at is null;

    if not found then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;
end;
$$;

-- Unmark praise as shared
create or replace function public.rpc_unmark_praise_shared(p_praise_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
    update public.team_praise_records
    set
        shared_at = null,
        shared_by = null
    where id = p_praise_id
      and shared_at is not null;

    if not found then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;
end;
$$;

grant execute on function public.rpc_match_praise(uuid, uuid) to authenticated;
grant execute on function public.rpc_unmatch_praise(uuid) to authenticated;
grant execute on function public.rpc_mark_praise_shared(uuid) to authenticated;
grant execute on function public.rpc_unmark_praise_shared(uuid) to authenticated;

revoke all on function public.rpc_match_praise(uuid, uuid) from public, anon;
revoke all on function public.rpc_unmatch_praise(uuid) from public, anon;
revoke all on function public.rpc_mark_praise_shared(uuid) from public, anon;
revoke all on function public.rpc_unmark_praise_shared(uuid) from public, anon;

-- ============================================================
-- I. PRAISE-RATING SEPARATION VIEW
-- ============================================================
-- Exposes only praise-safe columns. response_id is excluded so
-- authenticated members cannot correlate praise with ratings
-- through the Data API.

create or replace view public.praise_safe_view
with (security_invoker = true) as
select
    tpr.id,
    tpr.org_id,
    tpr.location_id,
    tpr.first_name_encrypted,
    tpr.praise_note_encrypted,
    tpr.encryption_key_version,
    tpr.status,
    tpr.matched_staff_id,
    tpr.matched_by_user_id,
    tpr.matched_at,
    tpr.shared_at,
    tpr.shared_by,
    tpr.created_at,
    tpr.updated_at
from public.team_praise_records tpr;

-- security_invoker = true ensures the view runs as the querying user,
-- so the base table's RLS policies apply to every access.
grant select on public.praise_safe_view to authenticated;
revoke all on public.praise_safe_view from anon;

-- ============================================================
-- J. MEMBERSHIP SECURITY FUNCTIONS
-- ============================================================

-- Last-owner protection: prevent removing or demoting the last active owner
create or replace function public.rpc_change_member_role(
    p_member_id uuid,
    p_new_role public.member_role
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_target_org_id uuid;
    v_target_user_id uuid;
    v_target_current_role public.member_role;
    v_caller_role public.member_role;
    v_owner_count integer;
begin
    -- Get the target member's details
    select org_id, user_id, role
    into v_target_org_id, v_target_user_id, v_target_current_role
    from public.organization_members
    where id = p_member_id
      and status = 'active';

    if v_target_org_id is null then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    -- Get the caller's role
    select role into v_caller_role
    from public.organization_members
    where org_id = v_target_org_id
      and user_id = (select auth.uid())
      and status = 'active';

    if v_caller_role is null then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    -- Self-promotion prevention: users cannot change their own role to a
    -- more privileged one
    if v_target_user_id = (select auth.uid()) then
        if p_new_role = 'owner' and v_target_current_role <> 'owner' then
            raise exception 'cannot_self_promote'
                using errcode = 'P0001';
        end if;
        if p_new_role = 'admin' and v_target_current_role not in ('owner', 'admin') then
            raise exception 'cannot_self_promote'
                using errcode = 'P0001';
        end if;
    end if;

    -- Only owners can create other owners or change owner roles
    if (v_target_current_role = 'owner' or p_new_role = 'owner')
       and v_caller_role <> 'owner' then
        raise exception 'only_owners_manage_owners'
            using errcode = 'P0001';
    end if;

    -- Admins cannot promote to owner
    if v_caller_role = 'admin' and p_new_role = 'owner' then
        raise exception 'admins_cannot_create_owners'
            using errcode = 'P0001';
    end if;

    -- Last-owner protection: if demoting an owner, ensure at least one remains
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
end;
$$;

-- Suspend a member
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

    -- Cannot suspend yourself
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

    -- Only owners can suspend owners
    if v_target_role = 'owner' and v_caller_role <> 'owner' then
        raise exception 'only_owners_manage_owners'
            using errcode = 'P0001';
    end if;

    -- Must be at least admin to suspend
    if v_caller_role not in ('owner', 'admin') then
        raise exception 'insufficient_permission'
            using errcode = 'P0001';
    end if;

    -- Last-owner protection
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

-- Remove a member (soft-delete: status → removed)
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

    if v_caller_role not in ('owner', 'admin') then
        raise exception 'insufficient_permission'
            using errcode = 'P0001';
    end if;

    -- Only owners can remove owners
    if v_target_role = 'owner' and v_caller_role <> 'owner' then
        raise exception 'only_owners_manage_owners'
            using errcode = 'P0001';
    end if;

    -- Last-owner protection
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

grant execute on function public.rpc_change_member_role(uuid, public.member_role) to authenticated;
grant execute on function public.rpc_suspend_member(uuid) to authenticated;
grant execute on function public.rpc_remove_member(uuid) to authenticated;

revoke all on function public.rpc_change_member_role(uuid, public.member_role) from public, anon;
revoke all on function public.rpc_suspend_member(uuid) from public, anon;
revoke all on function public.rpc_remove_member(uuid) from public, anon;

-- ============================================================
-- K. AUDIT INTEGRITY — action allowlist + revoke direct INSERT
-- ============================================================

-- The generic audit RPC stays callable by authenticated (owner-service.ts
-- uses it during token rotation), but the inner function now rejects any
-- action not on a strict allowlist. This prevents a Data-API caller from
-- inserting arbitrary audit entries while letting the app layer record
-- legitimate events.

create or replace function app.record_audit_event(
    p_org_id      uuid,
    p_action      text,
    p_target_type text,
    p_target_id   text,
    p_request_id  text default null,
    p_metadata    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    actor uuid := (select auth.uid());
    allowed_actions constant text[] := array[
        'stand.token_rotated',
        'stand.created',
        'stand.deactivated',
        'location.created',
        'location.updated',
        'member.role_changed',
        'member.suspended',
        'member.removed',
        'member.invited',
        'organization.created',
        'organization.updated',
        'staff.created',
        'staff.updated'
    ];
begin
    if actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    if p_action is null or not (p_action = any(allowed_actions)) then
        raise exception 'unknown audit action: %', coalesce(p_action, '(null)')
            using errcode = '42501';
    end if;

    if not exists (
        select 1 from public.organization_members m
         where m.org_id = p_org_id and m.user_id = actor and m.status = 'active'
    ) then
        raise exception 'not a member of that organization' using errcode = '42501';
    end if;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
    values
        (p_org_id, actor, 'user', p_action, p_target_type, p_target_id, p_request_id, p_metadata);
end;
$$;

-- Direct table manipulation stays locked out.
revoke insert, update, delete, truncate on public.audit_events from authenticated;

-- ============================================================
-- L. RATE LIMIT BUCKET CLEANUP — add expiration index
-- ============================================================

create index if not exists rate_limit_buckets_expires_idx
    on public.rate_limit_buckets (expires_at)
    where expires_at is not null;

-- Function to clean up expired rate limit buckets
create or replace function public.rpc_cleanup_rate_limits()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_deleted integer;
begin
    delete from public.rate_limit_buckets
    where expires_at < now() - interval '1 hour';
    get diagnostics v_deleted = row_count;
    return v_deleted;
end;
$$;

grant execute on function public.rpc_cleanup_rate_limits() to service_role;
revoke all on function public.rpc_cleanup_rate_limits() from public, anon, authenticated;

-- Function to clean up expired idempotency records
create or replace function public.rpc_cleanup_idempotency()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_deleted integer;
begin
    delete from public.idempotency_records
    where expires_at < now();
    get diagnostics v_deleted = row_count;
    return v_deleted;
end;
$$;

grant execute on function public.rpc_cleanup_idempotency() to service_role;
revoke all on function public.rpc_cleanup_idempotency() from public, anon, authenticated;
