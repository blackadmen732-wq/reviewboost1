-- Foundation hardening: close remaining bypass vectors and enforce atomicity.
--
-- Corrective migration — does not rewrite earlier ones.
--
-- 1. Organization-member RPCs → SECURITY DEFINER, revoke column UPDATE
-- 2. Response state transitions → SECURITY DEFINER with audit events
-- 3. Stand token ciphertext → folded into rpc_rotate_stand_token
-- 4. Team praise: revoke base-table SELECT from authenticated (force view)

-- ============================================================
-- 1. ORGANIZATION MEMBERS — SECURITY DEFINER + revoke column UPDATE
-- ============================================================
-- The three member RPCs are currently SECURITY INVOKER, relying on
-- `grant update (role, status)` on organization_members. That column-level
-- grant lets a Data API caller bypass every RPC check (self-promotion,
-- last-owner, audit). Making the RPCs SECURITY DEFINER means they run as
-- the function owner (postgres), so the column grant is no longer needed.

-- 1a. rpc_change_member_role → SECURITY DEFINER with audit
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

-- 1b. rpc_suspend_member → SECURITY DEFINER with audit
create or replace function public.rpc_suspend_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_target_org_id uuid;
    v_target_user_id uuid;
    v_target_role public.member_role;
    v_caller_role public.member_role;
    v_owner_count integer;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select org_id, user_id, role
    into v_target_org_id, v_target_user_id, v_target_role
    from public.organization_members
    where id = p_member_id
      and status = 'active';

    if v_target_org_id is null then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    if v_target_user_id = v_actor then
        raise exception 'cannot_suspend_self'
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

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (v_target_org_id, v_actor, 'user', 'member.suspended', 'organization_member',
         p_member_id::text, '{}'::jsonb);
end;
$$;

-- 1c. rpc_remove_member → SECURITY DEFINER with audit
create or replace function public.rpc_remove_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_target_org_id uuid;
    v_target_user_id uuid;
    v_target_role public.member_role;
    v_caller_role public.member_role;
    v_owner_count integer;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select org_id, user_id, role
    into v_target_org_id, v_target_user_id, v_target_role
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
      and user_id = v_actor
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

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (v_target_org_id, v_actor, 'user', 'member.removed', 'organization_member',
         p_member_id::text, '{}'::jsonb);
end;
$$;

-- 1d. Revoke column-level UPDATE entirely — all writes go through RPCs
revoke update on public.organization_members from authenticated;
revoke insert on public.organization_members from authenticated;

-- ============================================================
-- 2. RESPONSE STATE TRANSITIONS — SECURITY DEFINER with audit
-- ============================================================
-- The existing RPCs are SECURITY INVOKER, relying on column-level
-- UPDATE grants on (read_at, resolved_at, resolved_by). That grant
-- lets a Data API caller set these columns directly, bypassing audit.
-- Making them SECURITY DEFINER and revoking the column grant closes this.

create or replace function public.rpc_mark_response_read(p_response_id uuid)
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
    from public.customer_responses
    where id = p_response_id;

    if v_org_id is null then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    if not exists (
        select 1 from public.organization_members
        where org_id = v_org_id
          and user_id = v_actor
          and status = 'active'
    ) then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    update public.customer_responses
    set read_at = now()
    where id = p_response_id
      and read_at is null;
end;
$$;

create or replace function public.rpc_resolve_response(
    p_response_id uuid,
    p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_org_id uuid;
    v_already_resolved boolean;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select org_id, (resolved_at is not null)
    into v_org_id, v_already_resolved
    from public.customer_responses
    where id = p_response_id;

    if v_org_id is null then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    if not exists (
        select 1 from public.organization_members
        where org_id = v_org_id
          and user_id = v_actor
          and status = 'active'
    ) then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    if not v_already_resolved then
        update public.customer_responses
        set
            resolved_at = now(),
            resolved_by = v_actor,
            read_at = coalesce(read_at, now())
        where id = p_response_id
          and resolved_at is null;

        insert into public.audit_events
            (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
        values
            (v_org_id, v_actor, 'user', 'response.resolved', 'customer_response',
             p_response_id::text, '{}'::jsonb);
    end if;
end;
$$;

create or replace function public.rpc_reopen_response(p_response_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_org_id uuid;
    v_was_resolved boolean;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select org_id, (resolved_at is not null)
    into v_org_id, v_was_resolved
    from public.customer_responses
    where id = p_response_id;

    if v_org_id is null then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    if not exists (
        select 1 from public.organization_members
        where org_id = v_org_id
          and user_id = v_actor
          and status = 'active'
    ) then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    if v_was_resolved then
        update public.customer_responses
        set resolved_at = null, resolved_by = null
        where id = p_response_id
          and resolved_at is not null;

        insert into public.audit_events
            (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
        values
            (v_org_id, v_actor, 'user', 'response.reopened', 'customer_response',
             p_response_id::text, '{}'::jsonb);
    end if;
end;
$$;

-- Also make rpc_add_response_note auto-mark-read atomically
create or replace function public.rpc_add_response_note(
    p_response_id    uuid,
    p_org_id         uuid,
    p_body_encrypted text
)
returns table(note_id uuid, created_at timestamptz)
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

    if not exists (
        select 1 from public.customer_responses
        where id = p_response_id
          and org_id = p_org_id
    ) then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    if not exists (
        select 1 from public.organization_members
        where org_id = p_org_id
          and user_id = v_actor
          and status = 'active'
    ) then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    -- Auto-mark as read when writing a note
    update public.customer_responses
    set read_at = now()
    where id = p_response_id
      and read_at is null;

    return query
    insert into public.response_notes (org_id, response_id, author_id, body_encrypted)
    values (p_org_id, p_response_id, v_actor, p_body_encrypted)
    returning id as note_id, public.response_notes.created_at;
end;
$$;

-- Revoke column-level UPDATE on customer_responses — all writes go through RPCs
revoke update on public.customer_responses from authenticated;

-- ============================================================
-- 3. STAND TOKEN CIPHERTEXT — fold into rpc_rotate_stand_token
-- ============================================================
-- storeReprintableToken in owner-service.ts calls rpc_set_stand_token_ciphertext
-- as a separate non-atomic step. Extend rpc_rotate_stand_token to accept the
-- ciphertext and store it atomically. Then revoke the standalone RPC.

create or replace function public.rpc_rotate_stand_token(
    p_stand_id             uuid,
    p_org_id               uuid,
    p_new_token_hash       text,
    p_new_token_prefix     text,
    p_key_version          smallint,
    p_request_id           text default null,
    p_token_ciphertext     text default null,
    p_cipher_key_version   smallint default null
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

    if not exists (
        select 1 from public.organization_members
        where org_id = p_org_id
          and user_id = v_actor
          and status = 'active'
          and role in ('owner', 'admin')
    ) then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    update public.review_stands
    set public_token_hash = p_new_token_hash,
        public_token_prefix = p_new_token_prefix,
        public_token_key_version = p_key_version,
        token_rotated_at = now(),
        public_token_encrypted = coalesce(p_token_ciphertext, public_token_encrypted),
        token_encryption_key_version = coalesce(p_cipher_key_version, token_encryption_key_version)
    where id = p_stand_id
      and org_id = p_org_id;

    if not found then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
    values
        (p_org_id, v_actor, 'user', 'stand.token_rotated', 'review_stand',
         p_stand_id::text, p_request_id, '{}'::jsonb);
end;
$$;

-- Revoke the standalone ciphertext RPC — ciphertext is now set atomically
revoke execute on function public.rpc_set_stand_token_ciphertext(uuid, text, smallint) from authenticated;

-- Extend rpc_create_organization to also store ciphertext atomically
create or replace function app.create_organization_with_first_stand(
    p_name                text,
    p_slug                text,
    p_timezone            text,
    p_default_locale      text,
    p_location_name       text,
    p_google_review_url   text,
    p_stand_token_hash    text,
    p_stand_token_prefix  text,
    p_stand_label         text,
    p_token_key_version   smallint,
    p_request_id          text default null,
    p_token_ciphertext    text default null,
    p_cipher_key_version  smallint default null
)
returns table (org_id uuid, location_id uuid, stand_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
    actor        uuid := (select auth.uid());
    new_org      uuid;
    new_location uuid;
    new_stand    uuid;
    owned        integer;
begin
    if actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select count(*) into owned
      from public.organization_members m
     where m.user_id = actor and m.role = 'owner' and m.status = 'active';

    if owned >= app.owned_organization_limit() then
        raise exception 'organization limit reached' using errcode = '54000';
    end if;

    insert into public.organizations (name, slug, timezone, default_locale)
    values (p_name, p_slug, coalesce(p_timezone, 'UTC'), coalesce(p_default_locale, 'en'))
    returning id into new_org;

    insert into public.organization_members (org_id, user_id, role, status, joined_at)
    values (new_org, actor, 'owner', 'active', now());

    insert into public.locations
        (org_id, name, timezone, default_locale, google_review_url)
    values
        (new_org, p_location_name, coalesce(p_timezone, 'UTC'),
         coalesce(p_default_locale, 'en'), p_google_review_url)
    returning id into new_location;

    insert into public.review_stands
        (org_id, location_id, public_token_hash, public_token_prefix, label,
         stand_type, status, activated_at, public_token_key_version,
         public_token_encrypted, token_encryption_key_version)
    values
        (new_org, new_location, p_stand_token_hash, p_stand_token_prefix,
         coalesce(p_stand_label, 'Front Desk'), 'printable_qr', 'active', now(),
         coalesce(p_token_key_version, 1),
         p_token_ciphertext, p_cipher_key_version)
    returning id into new_stand;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
    values
        (new_org, actor, 'user', 'organization.created', 'organization', new_org::text,
         p_request_id, jsonb_build_object('locationId', new_location, 'standId', new_stand));

    return query select new_org, new_location, new_stand;
end;
$$;

create or replace function public.rpc_create_organization(
    p_name                text,
    p_slug                text,
    p_timezone            text,
    p_default_locale      text,
    p_location_name       text,
    p_google_review_url   text,
    p_stand_token_hash    text,
    p_stand_token_prefix  text,
    p_stand_label         text,
    p_token_key_version   smallint,
    p_request_id          text default null,
    p_token_ciphertext    text default null,
    p_cipher_key_version  smallint default null
)
returns table (org_id uuid, location_id uuid, stand_id uuid)
language sql
security invoker
set search_path = ''
as $$
    select * from app.create_organization_with_first_stand(
        p_name, p_slug, p_timezone, p_default_locale, p_location_name,
        p_google_review_url, p_stand_token_hash, p_stand_token_prefix,
        p_stand_label, p_token_key_version, p_request_id,
        p_token_ciphertext, p_cipher_key_version);
$$;

grant execute on function public.rpc_create_organization(text, text, text, text, text, text, text, text, text, smallint, text, text, smallint) to authenticated;
revoke all on function public.rpc_create_organization(text, text, text, text, text, text, text, text, text, smallint, text, text, smallint) from public, anon;

-- ============================================================
-- 4. TEAM PRAISE — revoke base-table SELECT, force praise_safe_view
-- ============================================================
-- owner-data.ts queries team_praise_records directly in two places (listVisits
-- and getVisitSummary). These queries only use response_id and id+count, but
-- the base table SELECT grant lets a Data API caller read response_id and
-- correlate praise with ratings. Revoking SELECT forces everything through
-- praise_safe_view which excludes response_id.

revoke select on public.team_praise_records from authenticated;

-- The praise RPCs are SECURITY INVOKER and need SELECT on team_praise_records
-- to look up org_id. Convert them to SECURITY DEFINER.

create or replace function public.rpc_match_praise(
    p_praise_id uuid,
    p_staff_id uuid
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
    from public.team_praise_records
    where id = p_praise_id;

    if v_org_id is null then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    if not exists (
        select 1 from public.organization_members
        where org_id = v_org_id
          and user_id = v_actor
          and status = 'active'
    ) then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    if not exists (
        select 1 from public.staff_members
        where id = p_staff_id
          and org_id = v_org_id
          and is_active = true
    ) then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    update public.team_praise_records
    set status = 'matched',
        matched_staff_id = p_staff_id,
        matched_by_user_id = v_actor,
        matched_at = now()
    where id = p_praise_id;
end;
$$;

create or replace function public.rpc_unmatch_praise(p_praise_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_org_id uuid;
    v_updated integer;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select org_id into v_org_id
    from public.team_praise_records
    where id = p_praise_id;

    if v_org_id is null then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    if not exists (
        select 1 from public.organization_members
        where org_id = v_org_id
          and user_id = v_actor
          and status = 'active'
    ) then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    update public.team_praise_records
    set status = 'unmatched',
        matched_staff_id = null,
        matched_by_user_id = null,
        matched_at = null
    where id = p_praise_id;

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;
end;
$$;

create or replace function public.rpc_mark_praise_shared(p_praise_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_org_id uuid;
    v_updated integer;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select org_id into v_org_id
    from public.team_praise_records
    where id = p_praise_id;

    if v_org_id is null then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    if not exists (
        select 1 from public.organization_members
        where org_id = v_org_id
          and user_id = v_actor
          and status = 'active'
    ) then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    update public.team_praise_records
    set shared_at = now(),
        shared_by = v_actor
    where id = p_praise_id
      and shared_at is null;

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;
end;
$$;

create or replace function public.rpc_unmark_praise_shared(p_praise_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_org_id uuid;
    v_updated integer;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select org_id into v_org_id
    from public.team_praise_records
    where id = p_praise_id;

    if v_org_id is null then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    if not exists (
        select 1 from public.organization_members
        where org_id = v_org_id
          and user_id = v_actor
          and status = 'active'
    ) then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    update public.team_praise_records
    set shared_at = null,
        shared_by = null
    where id = p_praise_id
      and shared_at is not null;

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;
end;
$$;

-- Revoke column-level UPDATE that was granted in security_hardening
-- (the SECURITY DEFINER RPCs write directly as the function owner)
revoke update on public.team_praise_records from authenticated;

-- ============================================================
-- 5. PRAISE COUNT RPCs for owner-data.ts
-- ============================================================
-- With base-table SELECT revoked, owner-data.ts needs RPCs for the
-- two queries that used team_praise_records directly.

-- Which responses had praise (for listVisits "praisedSomeone" boolean)
create or replace function public.rpc_response_has_praise(
    p_org_id uuid,
    p_response_ids uuid[]
)
returns table(response_id uuid)
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

    if not exists (
        select 1 from public.organization_members
        where org_id = p_org_id
          and user_id = v_actor
          and status = 'active'
    ) then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    return query
    select distinct tpr.response_id
    from public.team_praise_records tpr
    where tpr.org_id = p_org_id
      and tpr.response_id = any(p_response_ids);
end;
$$;

grant execute on function public.rpc_response_has_praise(uuid, uuid[]) to authenticated;
revoke all on function public.rpc_response_has_praise(uuid, uuid[]) from public, anon;

-- Total praise count (for getVisitSummary)
create or replace function public.rpc_praise_count(p_org_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_count integer;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    if not exists (
        select 1 from public.organization_members
        where org_id = p_org_id
          and user_id = v_actor
          and status = 'active'
    ) then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    select count(*)::integer into v_count
    from public.team_praise_records
    where org_id = p_org_id;

    return v_count;
end;
$$;

grant execute on function public.rpc_praise_count(uuid) to authenticated;
revoke all on function public.rpc_praise_count(uuid) from public, anon;
