-- Corrective migration: praise view, state machine, response concurrency, stand token safety.
--
-- Tasks covered:
--   1. Replace praise_safe_view with security_invoker=true + security_barrier=true
--   2. Drop rpc_response_has_praise (praise-to-rating correlation)
--   3. Praise state machine RPCs with FOR UPDATE, idempotency, audit events
--   4. Response RPCs with FOR UPDATE and idempotency
--   5. Stand token: remove defaults, drop obsolete overloads

-- ============================================================
-- 1. PRAISE VIEW — security_invoker + security_barrier + column grants
-- ============================================================

-- Revoke table-wide SELECT that may have been granted elsewhere
revoke select on public.team_praise_records from public, anon, authenticated;

-- Grant column-level SELECT on safe columns only (no response_id)
grant select (
    id, org_id, location_id,
    first_name_encrypted, praise_note_encrypted, encryption_key_version,
    status, matched_staff_id, matched_by_user_id, matched_at,
    shared_at, shared_by, created_at, updated_at
) on public.team_praise_records to authenticated;

-- Recreate view with security_invoker=true so RLS applies to the caller,
-- and security_barrier=true to prevent predicate pushdown attacks.
create or replace view public.praise_safe_view
with (security_invoker = true, security_barrier = true) as
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

-- ============================================================
-- 2. DROP rpc_response_has_praise (praise-to-rating correlation)
-- ============================================================

drop function if exists public.rpc_response_has_praise(uuid, uuid[]);

-- ============================================================
-- 3. PRAISE STATE MACHINE — FOR UPDATE, idempotent, audited
-- ============================================================

-- 3a. rpc_match_praise
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
    v_current_status public.team_praise_status;
    v_current_staff uuid;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select org_id, status, matched_staff_id
    into v_org_id, v_current_status, v_current_staff
    from public.team_praise_records
    where id = p_praise_id
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

    if not exists (
        select 1 from public.staff_members
        where id = p_staff_id and org_id = v_org_id and is_active = true
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    -- Idempotent: already matched to same staff → no-op
    if v_current_status = 'matched' and v_current_staff = p_staff_id then
        return;
    end if;

    -- Cannot match archived praise
    if v_current_status = 'archived' then
        raise exception 'invalid_state_transition' using errcode = 'P0001';
    end if;

    update public.team_praise_records
    set status = 'matched',
        matched_staff_id = p_staff_id,
        matched_by_user_id = v_actor,
        matched_at = now()
    where id = p_praise_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (v_org_id, v_actor, 'user', 'praise.matched', 'team_praise_record',
         p_praise_id::text, jsonb_build_object('staffId', p_staff_id));
end;
$$;

revoke all on function public.rpc_match_praise(uuid, uuid) from public, anon;
grant execute on function public.rpc_match_praise(uuid, uuid) to authenticated;

-- 3b. rpc_unmatch_praise
create or replace function public.rpc_unmatch_praise(p_praise_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_org_id uuid;
    v_current_status public.team_praise_status;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select org_id, status
    into v_org_id, v_current_status
    from public.team_praise_records
    where id = p_praise_id
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

    -- Idempotent: already unmatched → no-op
    if v_current_status = 'unmatched' then
        return;
    end if;

    -- Cannot unmatch archived praise
    if v_current_status = 'archived' then
        raise exception 'invalid_state_transition' using errcode = 'P0001';
    end if;

    update public.team_praise_records
    set status = 'unmatched',
        matched_staff_id = null,
        matched_by_user_id = null,
        matched_at = null
    where id = p_praise_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (v_org_id, v_actor, 'user', 'praise.unmatched', 'team_praise_record',
         p_praise_id::text, '{}'::jsonb);
end;
$$;

revoke all on function public.rpc_unmatch_praise(uuid) from public, anon;
grant execute on function public.rpc_unmatch_praise(uuid) to authenticated;

-- 3c. rpc_mark_praise_shared
create or replace function public.rpc_mark_praise_shared(p_praise_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_org_id uuid;
    v_shared_at timestamptz;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select org_id, shared_at
    into v_org_id, v_shared_at
    from public.team_praise_records
    where id = p_praise_id
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

    -- Idempotent: already shared → no-op
    if v_shared_at is not null then
        return;
    end if;

    update public.team_praise_records
    set shared_at = now(),
        shared_by = v_actor
    where id = p_praise_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (v_org_id, v_actor, 'user', 'praise.shared', 'team_praise_record',
         p_praise_id::text, '{}'::jsonb);
end;
$$;

revoke all on function public.rpc_mark_praise_shared(uuid) from public, anon;
grant execute on function public.rpc_mark_praise_shared(uuid) to authenticated;

-- 3d. rpc_unmark_praise_shared
create or replace function public.rpc_unmark_praise_shared(p_praise_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_org_id uuid;
    v_shared_at timestamptz;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select org_id, shared_at
    into v_org_id, v_shared_at
    from public.team_praise_records
    where id = p_praise_id
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

    -- Idempotent: already not shared → no-op
    if v_shared_at is null then
        return;
    end if;

    update public.team_praise_records
    set shared_at = null,
        shared_by = null
    where id = p_praise_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (v_org_id, v_actor, 'user', 'praise.unshared', 'team_praise_record',
         p_praise_id::text, '{}'::jsonb);
end;
$$;

revoke all on function public.rpc_unmark_praise_shared(uuid) from public, anon;
grant execute on function public.rpc_unmark_praise_shared(uuid) to authenticated;

-- 3e. rpc_archive_praise
create or replace function public.rpc_archive_praise(p_praise_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_org_id uuid;
    v_current_status public.team_praise_status;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select org_id, status
    into v_org_id, v_current_status
    from public.team_praise_records
    where id = p_praise_id
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

    -- Idempotent: already archived → no-op
    if v_current_status = 'archived' then
        return;
    end if;

    update public.team_praise_records
    set status = 'archived'
    where id = p_praise_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (v_org_id, v_actor, 'user', 'praise.archived', 'team_praise_record',
         p_praise_id::text, '{}'::jsonb);
end;
$$;

revoke all on function public.rpc_archive_praise(uuid) from public, anon;
grant execute on function public.rpc_archive_praise(uuid) to authenticated;

-- 3f. rpc_restore_praise
create or replace function public.rpc_restore_praise(p_praise_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_org_id uuid;
    v_current_status public.team_praise_status;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select org_id, status
    into v_org_id, v_current_status
    from public.team_praise_records
    where id = p_praise_id
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

    -- Idempotent: not archived → no-op
    if v_current_status <> 'archived' then
        return;
    end if;

    update public.team_praise_records
    set status = 'unmatched',
        matched_staff_id = null,
        matched_by_user_id = null,
        matched_at = null
    where id = p_praise_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (v_org_id, v_actor, 'user', 'praise.restored', 'team_praise_record',
         p_praise_id::text, '{}'::jsonb);
end;
$$;

revoke all on function public.rpc_restore_praise(uuid) from public, anon;
grant execute on function public.rpc_restore_praise(uuid) to authenticated;

-- ============================================================
-- 4. RESPONSE RPCs — FOR UPDATE + idempotent audit
-- ============================================================

-- 4a. rpc_mark_response_read — add FOR UPDATE
create or replace function public.rpc_mark_response_read(p_response_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_org_id uuid;
    v_read_at timestamptz;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select org_id, read_at
    into v_org_id, v_read_at
    from public.customer_responses
    where id = p_response_id
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

    -- Idempotent: already read → no-op
    if v_read_at is not null then
        return;
    end if;

    update public.customer_responses
    set read_at = now()
    where id = p_response_id;
end;
$$;

-- 4b. rpc_resolve_response — add FOR UPDATE, idempotent audit
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
    where id = p_response_id
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

    -- Idempotent: already resolved → no-op (no duplicate audit)
    if v_already_resolved then
        return;
    end if;

    update public.customer_responses
    set resolved_at = now(),
        resolved_by = v_actor,
        read_at = coalesce(read_at, now())
    where id = p_response_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (v_org_id, v_actor, 'user', 'response.resolved', 'customer_response',
         p_response_id::text, '{}'::jsonb);
end;
$$;

-- 4c. rpc_reopen_response — add FOR UPDATE, idempotent audit
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
    where id = p_response_id
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

    -- Idempotent: not resolved → no-op (no duplicate audit)
    if not v_was_resolved then
        return;
    end if;

    update public.customer_responses
    set resolved_at = null, resolved_by = null
    where id = p_response_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (v_org_id, v_actor, 'user', 'response.reopened', 'customer_response',
         p_response_id::text, '{}'::jsonb);
end;
$$;

-- 4d. rpc_add_response_note — add FOR UPDATE, atomic mark-read + audit
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
    v_response_org uuid;
    v_was_unread boolean;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select org_id, (read_at is null)
    into v_response_org, v_was_unread
    from public.customer_responses
    where id = p_response_id
    for update;

    if v_response_org is null or v_response_org <> p_org_id then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    if not exists (
        select 1 from public.organization_members
        where org_id = p_org_id and user_id = v_actor and status = 'active'
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    -- Auto-mark as read when writing a note
    if v_was_unread then
        update public.customer_responses
        set read_at = now()
        where id = p_response_id;
    end if;

    return query
    insert into public.response_notes (org_id, response_id, author_id, body_encrypted)
    values (p_org_id, p_response_id, v_actor, p_body_encrypted)
    returning id as note_id, public.response_notes.created_at;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (p_org_id, v_actor, 'user', 'response.note_added', 'customer_response',
         p_response_id::text, '{}'::jsonb);
end;
$$;

-- ============================================================
-- 5. STAND TOKEN SAFETY — remove defaults, drop obsolete overloads
-- ============================================================

-- 5a. Drop the current 8-param version (has defaults on last 3 params)
drop function if exists public.rpc_rotate_stand_token(uuid, uuid, text, text, smallint, text, text, smallint);

-- 5b. Recreate with all params required (no defaults)
create or replace function public.rpc_rotate_stand_token(
    p_stand_id             uuid,
    p_org_id               uuid,
    p_new_token_hash       text,
    p_new_token_prefix     text,
    p_key_version          smallint,
    p_request_id           text,
    p_token_ciphertext     text,
    p_cipher_key_version   smallint
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
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    update public.review_stands
    set public_token_hash = p_new_token_hash,
        public_token_prefix = p_new_token_prefix,
        public_token_key_version = p_key_version,
        token_rotated_at = now(),
        public_token_encrypted = p_token_ciphertext,
        token_encryption_key_version = p_cipher_key_version
    where id = p_stand_id
      and org_id = p_org_id;

    if not found then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
    values
        (p_org_id, v_actor, 'user', 'stand.token_rotated', 'review_stand',
         p_stand_id::text, p_request_id, '{}'::jsonb);
end;
$$;

revoke all on function public.rpc_rotate_stand_token(uuid, uuid, text, text, smallint, text, text, smallint) from public, anon;
grant execute on function public.rpc_rotate_stand_token(uuid, uuid, text, text, smallint, text, text, smallint) to authenticated;

-- 5c. Drop standalone ciphertext functions entirely
drop function if exists public.rpc_set_stand_token_ciphertext(uuid, text, smallint);
drop function if exists app.set_stand_token_ciphertext(uuid, text, smallint);

-- 5d. Drop ALL overloads of create_organization so we can recreate without defaults
drop function if exists public.rpc_create_organization(text, text, text, text, text, text, text, text, text, smallint, text);
drop function if exists app.create_organization_with_first_stand(text, text, text, text, text, text, text, text, text, smallint, text);
drop function if exists public.rpc_create_organization(text, text, text, text, text, text, text, text, text, smallint, text, text, smallint);
drop function if exists app.create_organization_with_first_stand(text, text, text, text, text, text, text, text, text, smallint, text, text, smallint);

-- 5e. Recreate 13-param create_organization with no defaults on security params
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
    p_request_id          text,
    p_token_ciphertext    text,
    p_cipher_key_version  smallint
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
         p_token_key_version, p_token_ciphertext, p_cipher_key_version)
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
    p_request_id          text,
    p_token_ciphertext    text,
    p_cipher_key_version  smallint
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

revoke all on function app.create_organization_with_first_stand(text, text, text, text, text, text, text, text, text, smallint, text, text, smallint) from public, anon;
grant execute on function app.create_organization_with_first_stand(text, text, text, text, text, text, text, text, text, smallint, text, text, smallint) to authenticated;
revoke all on function public.rpc_create_organization(text, text, text, text, text, text, text, text, text, smallint, text, text, smallint) from public, anon;
grant execute on function public.rpc_create_organization(text, text, text, text, text, text, text, text, text, smallint, text, text, smallint) to authenticated;

-- 5f. Revoke audit RPC from authenticated (only SECURITY DEFINER functions should insert)
revoke execute on function public.rpc_record_audit_event(uuid, text, text, text, text, jsonb) from authenticated;
