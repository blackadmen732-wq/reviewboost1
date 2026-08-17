-- Replace direct UPDATE on organizations and locations with SECURITY DEFINER RPCs.
-- The authenticated role currently has column-level UPDATE on both tables,
-- letting a Data API caller bypass server-side validation (e.g. Google URL
-- allowlist) and role checks (owner/admin only).

-- ============================================================
-- 1. rpc_update_organization
-- ============================================================

create or replace function public.rpc_update_organization(
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
    v_org_id uuid;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select om.org_id into v_org_id
    from public.organization_members om
    where om.user_id = v_actor
      and om.status = 'active'
      and om.role in ('owner', 'admin')
    limit 1;

    if v_org_id is null then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    if p_name is null and p_timezone is null then
        return;
    end if;

    update public.organizations
    set name = coalesce(p_name, name),
        timezone = coalesce(p_timezone, timezone)
    where id = v_org_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (v_org_id, v_actor, 'user', 'organization.updated', 'organization',
         v_org_id::text, '{}'::jsonb);
end;
$$;

revoke all on function public.rpc_update_organization(text, text) from public, anon;
grant execute on function public.rpc_update_organization(text, text) to authenticated;

-- ============================================================
-- 2. rpc_update_location
-- ============================================================

create or replace function public.rpc_update_location(
    p_location_id      uuid,
    p_name             text default null,
    p_google_review_url text default null,
    p_clear_google_url boolean default false
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
    from public.locations
    where id = p_location_id
    for update;

    if v_org_id is null then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    if not exists (
        select 1 from public.organization_members
        where org_id = v_org_id and user_id = v_actor and status = 'active'
          and role in ('owner', 'admin')
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    if p_name is null and p_google_review_url is null and not p_clear_google_url then
        return;
    end if;

    update public.locations
    set name = coalesce(p_name, name),
        google_review_url = case
            when p_clear_google_url then null
            when p_google_review_url is not null then p_google_review_url
            else google_review_url
        end
    where id = p_location_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (v_org_id, v_actor, 'user', 'location.updated', 'location',
         p_location_id::text, '{}'::jsonb);
end;
$$;

revoke all on function public.rpc_update_location(uuid, text, text, boolean) from public, anon;
grant execute on function public.rpc_update_location(uuid, text, text, boolean) to authenticated;

-- ============================================================
-- 3. Revoke direct column-level UPDATE on both tables
-- ============================================================

revoke update on public.organizations from authenticated;
revoke update on public.locations from authenticated;
