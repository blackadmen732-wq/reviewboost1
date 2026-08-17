-- Add database-level input validation and idempotent auditing.
--
-- Authenticated users can call RPCs directly without the Next.js routes,
-- so validation must live in PostgreSQL too.
--
-- Each RPC now:
--   1. Validates inputs (name length, timezone, Google URL allowlist)
--   2. Locks the target row before comparing values
--   3. Updates only when a value actually changes
--   4. Inserts exactly one audit event for a real change
--   5. Repeated identical calls create zero additional audit events

-- ============================================================
-- Helper: validate Google review URL against the same allowlist
-- as the TypeScript server (lib/server/google-review-url.ts).
-- ============================================================

create or replace function public._validate_google_review_url(p_url text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
    v_scheme text;
    v_host   text;
    v_path   text;
    v_at_pos integer;
begin
    if p_url is null or char_length(p_url) = 0 or char_length(p_url) > 2048 then
        return false;
    end if;

    if not (p_url ~ '^https://') then
        return false;
    end if;

    -- Reject credentials in authority (https://user:pass@host)
    v_at_pos := position('@' in substring(p_url from 9));
    if v_at_pos > 0 then
        declare
            v_authority text := substring(p_url from 9 for v_at_pos - 1);
        begin
            if position('/' in v_authority) = 0 then
                return false;
            end if;
        end;
    end if;

    v_host := lower(substring(p_url from 9));
    v_host := substring(v_host from 1 for position('/' in v_host) - 1);
    if v_host is null or v_host = '' then
        return false;
    end if;
    v_host := rtrim(v_host, '.');

    v_path := substring(p_url from 9 + char_length(
        substring(substring(p_url from 9) from 1 for position('/' in substring(p_url from 9)) - 1)
    ));
    if v_path is null then v_path := '/'; end if;

    if v_host in ('g.page', 'maps.app.goo.gl') then
        return true;
    end if;

    if v_host = 'search.google.com' then
        return v_path ~ '^/local/writereview\?'
           and v_path ~ '[?&]placeid=[^&]+';
    end if;

    if v_host in ('www.google.com', 'maps.google.com') then
        return v_path ~ '^/maps/';
    end if;

    return false;
end;
$$;

revoke all on function public._validate_google_review_url(text) from public, anon;
grant execute on function public._validate_google_review_url(text) to authenticated;

-- ============================================================
-- 1. rpc_update_organization — with validation + idempotent audit
-- ============================================================

create or replace function public.rpc_update_organization(
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
    v_cur_name text;
    v_cur_tz   text;
    v_changed  boolean := false;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    -- Validate inputs
    if p_name is not null then
        p_name := btrim(p_name);
        if char_length(p_name) < 1 or char_length(p_name) > 160 then
            raise exception 'name must be between 1 and 160 characters'
                using errcode = 'P0001';
        end if;
    end if;

    if p_timezone is not null then
        if not exists (
            select 1 from pg_timezone_names where name = p_timezone
        ) then
            raise exception 'invalid timezone'
                using errcode = 'P0001';
        end if;
    end if;

    -- Lock and read current values
    select name, timezone into v_cur_name, v_cur_tz
    from public.organizations
    where id = p_org_id
    for update;

    if not found then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    -- Authorize caller
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

    -- Check what actually changed
    if p_name is not null and p_name is distinct from v_cur_name then
        v_changed := true;
    end if;
    if p_timezone is not null and p_timezone is distinct from v_cur_tz then
        v_changed := true;
    end if;

    if not v_changed then
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

-- ============================================================
-- 2. rpc_update_staff — with validation + idempotent audit
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
    v_cur_name text;
    v_cur_label text;
    v_cur_active boolean;
    v_new_label text;
    v_changed boolean := false;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    -- Validate inputs
    if p_name_encrypted is not null and char_length(p_name_encrypted) < 1 then
        raise exception 'name must not be empty'
            using errcode = 'P0001';
    end if;

    if p_role_label is not null then
        if char_length(p_role_label) < 1 or char_length(p_role_label) > 60 then
            raise exception 'role label must be between 1 and 60 characters'
                using errcode = 'P0001';
        end if;
    end if;

    -- Lock and read current values
    select org_id, name_encrypted, role_label, is_active
    into v_org_id, v_cur_name, v_cur_label, v_cur_active
    from public.staff_members
    where id = p_staff_id
    for update;

    if v_org_id is null then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    -- Authorize: owner/admin only
    if not exists (
        select 1 from public.organization_members
        where org_id = v_org_id
          and user_id = v_actor
          and status = 'active'
          and role in ('owner', 'admin')
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    -- Compute new label value
    v_new_label := case
        when p_clear_role_label then null
        when p_role_label is not null then p_role_label
        else v_cur_label
    end;

    -- Check what actually changed
    if p_name_encrypted is not null and p_name_encrypted is distinct from v_cur_name then
        v_changed := true;
    end if;
    if v_new_label is distinct from v_cur_label then
        v_changed := true;
    end if;
    if p_is_active is not null and p_is_active is distinct from v_cur_active then
        v_changed := true;
    end if;

    if not v_changed then
        return;
    end if;

    update public.staff_members
    set name_encrypted = coalesce(p_name_encrypted, name_encrypted),
        role_label = v_new_label,
        is_active = coalesce(p_is_active, is_active)
    where id = p_staff_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (v_org_id, v_actor, 'user', 'staff.updated', 'staff_member',
         p_staff_id::text, '{}'::jsonb);
end;
$$;

-- ============================================================
-- 3. rpc_update_location — with validation + idempotent audit
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
    v_cur_name text;
    v_cur_url  text;
    v_new_url  text;
    v_changed  boolean := false;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    -- Validate inputs
    if p_name is not null then
        p_name := btrim(p_name);
        if char_length(p_name) < 1 or char_length(p_name) > 160 then
            raise exception 'name must be between 1 and 160 characters'
                using errcode = 'P0001';
        end if;
    end if;

    if p_google_review_url is not null then
        if not public._validate_google_review_url(p_google_review_url) then
            raise exception 'invalid Google review URL'
                using errcode = 'P0001';
        end if;
    end if;

    -- Lock and read current values
    select org_id, name, google_review_url
    into v_org_id, v_cur_name, v_cur_url
    from public.locations
    where id = p_location_id
    for update;

    if v_org_id is null then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    -- Authorize: owner/admin only
    if not exists (
        select 1 from public.organization_members
        where org_id = v_org_id
          and user_id = v_actor
          and status = 'active'
          and role in ('owner', 'admin')
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    if p_name is null and p_google_review_url is null and not p_clear_google_url then
        return;
    end if;

    -- Compute new URL value
    v_new_url := case
        when p_clear_google_url then null
        when p_google_review_url is not null then p_google_review_url
        else v_cur_url
    end;

    -- Check what actually changed
    if p_name is not null and p_name is distinct from v_cur_name then
        v_changed := true;
    end if;
    if v_new_url is distinct from v_cur_url then
        v_changed := true;
    end if;

    if not v_changed then
        return;
    end if;

    update public.locations
    set name = coalesce(p_name, name),
        google_review_url = v_new_url
    where id = p_location_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (v_org_id, v_actor, 'user', 'location.updated', 'location',
         p_location_id::text, '{}'::jsonb);
end;
$$;
