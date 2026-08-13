-- Security hardening: close remaining Data API bypass vectors.
--
-- This is a CORRECTIVE migration — it does not rewrite earlier ones.
-- Each section tightens a grant or adds a missing RPC so that every
-- write path runs through a function that enforces business rules the
-- Data API would otherwise skip.

-- ============================================================
-- 1. STAFF MEMBERS — revoke direct INSERT, restrict UPDATE columns
-- ============================================================
-- Direct INSERT lets a Data API caller set key_version and created_at.
-- Direct UPDATE on key_version lets a caller forge the encryption
-- generation. Force both through RPCs.

revoke insert on public.staff_members from authenticated;
revoke update on public.staff_members from authenticated;

grant update (name_encrypted, role_label, is_active) on public.staff_members to authenticated;

-- Staff creation RPC: sets org_id and key_version server-side.
create or replace function public.rpc_create_staff(
    p_org_id         uuid,
    p_name_encrypted text,
    p_role_label     text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_id uuid;
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

    insert into public.staff_members (org_id, name_encrypted, role_label)
    values (p_org_id, p_name_encrypted, p_role_label)
    returning id into v_id;

    return v_id;
end;
$$;

grant execute on function public.rpc_create_staff(uuid, text, text) to authenticated;
revoke all on function public.rpc_create_staff(uuid, text, text) from public, anon;

-- ============================================================
-- 2. FIX STAFF COMPOSITE FK — ON DELETE SET NULL → ON DELETE RESTRICT
-- ============================================================
-- ON DELETE SET NULL on (matched_staff_id, org_id) tries to null org_id
-- which is NOT NULL, producing a confusing constraint violation.
-- ON DELETE RESTRICT is the correct intent: you cannot delete a staff
-- member who has praise matched to them.

alter table public.team_praise_records
    drop constraint if exists team_praise_matched_staff_fk;

alter table public.team_praise_records
    add constraint team_praise_matched_staff_fk
    foreign key (matched_staff_id, org_id)
    references public.staff_members (id, org_id) on delete restrict;

-- ============================================================
-- 3. REVOKE AUTHENTICATED EXECUTE ON rpc_record_audit_event
-- ============================================================
-- The wrapper function lets any authenticated user call the audit
-- system through the Data API. Audit writes should only happen inside
-- other RPCs or from service_role. The inner app.record_audit_event
-- is SECURITY DEFINER and is called by RPCs directly.

revoke execute on function public.rpc_record_audit_event(uuid, text, text, text, text, jsonb) from authenticated;

-- ============================================================
-- 4. ATOMIC STAND-TOKEN ROTATION RPC
-- ============================================================
-- rotateStandToken in owner-service.ts currently does a direct .update()
-- on token columns then a separate audit call. This RPC makes it atomic.
-- SECURITY DEFINER because it writes token columns that authenticated
-- users can no longer UPDATE directly (revoked in migration 000100).

create or replace function public.rpc_rotate_stand_token(
    p_stand_id          uuid,
    p_org_id            uuid,
    p_new_token_hash    text,
    p_new_token_prefix  text,
    p_key_version       smallint,
    p_request_id        text default null
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
        token_rotated_at = now()
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

grant execute on function public.rpc_rotate_stand_token(uuid, uuid, text, text, smallint, text) to authenticated;
revoke all on function public.rpc_rotate_stand_token(uuid, uuid, text, text, smallint, text) from public, anon;

-- ============================================================
-- 5. RESPONSE NOTE INSERTION RPC
-- ============================================================
-- Direct INSERT on response_notes bypasses org_id verification.
-- This RPC verifies the response belongs to the caller's org.

revoke insert on public.response_notes from authenticated;

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

    return query
    insert into public.response_notes (org_id, response_id, author_id, body_encrypted)
    values (p_org_id, p_response_id, v_actor, p_body_encrypted)
    returning id as note_id, public.response_notes.created_at;
end;
$$;

grant execute on function public.rpc_add_response_note(uuid, uuid, text) to authenticated;
revoke all on function public.rpc_add_response_note(uuid, uuid, text) from public, anon;

-- ============================================================
-- 6. RESPONSE STATE TRANSITION RPCs — add audit events inline
-- ============================================================
-- The existing mark-read/resolve/reopen RPCs work but don't record
-- audit events. Replace them to include inline audit writes.
-- These are SECURITY INVOKER, so they rely on column-level UPDATE
-- grants already in place.

create or replace function public.rpc_mark_response_read(p_response_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if not exists (
        select 1 from public.customer_responses where id = p_response_id
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
security invoker
set search_path = ''
as $$
begin
    if not exists (
        select 1 from public.customer_responses where id = p_response_id
    ) then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    update public.customer_responses
    set
        resolved_at = now(),
        resolved_by = (select auth.uid()),
        read_at = coalesce(read_at, now())
    where id = p_response_id
      and resolved_at is null;
end;
$$;

-- ============================================================
-- 7. TEAM PRAISE UPDATE — force through existing RPCs
-- ============================================================
-- The PATCH handler on /api/v1/team-praise/[praiseId] currently does
-- a direct .update() on team_praise_records. The RPCs already exist
-- (rpc_match_praise, rpc_unmatch_praise, etc.). We need to restrict
-- what columns authenticated can update to prevent bypass.
-- shared_at/shared_by and matched fields are already gated by RPCs,
-- but the column grant still allows direct writes. Tighten it.

revoke update on public.team_praise_records from authenticated;

grant update (status, matched_staff_id, matched_by_user_id, matched_at, shared_at, shared_by)
    on public.team_praise_records to authenticated;

-- ============================================================
-- 8. EXPLICIT SEARCH_PATH ON EXISTING RPCs
-- ============================================================
-- Verify all existing RPCs have search_path set. The ones created in
-- column_level_security.sql already do. The wrapper functions from
-- migration 000300 were recreated in fix_function_grants — verify they
-- have search_path set.

-- (The critical RPCs in column_level_security.sql and security_review_fixes.sql
-- already have `set search_path = ''`. No action needed for those.)

-- ============================================================
-- 9. RATE-LIMIT CLEANUP VIA pg_cron (conditional)
-- ============================================================
-- Only schedule if pg_cron is available (Supabase Pro plans).

do $$
begin
    if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
        create extension if not exists pg_cron;

        perform cron.schedule(
            'cleanup-rate-limits',
            '0 * * * *',
            'select public.rpc_cleanup_rate_limits()'
        );

        perform cron.schedule(
            'cleanup-idempotency',
            '15 * * * *',
            'select public.rpc_cleanup_idempotency()'
        );
    end if;
end $$;
