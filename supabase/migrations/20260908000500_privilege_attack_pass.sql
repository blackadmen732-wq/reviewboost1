-- ATLAS ownership: privilege train (#45/#48).
-- Unique version 20260908000500. Does NOT use 20260908000100 (SMS settle)
-- or 20260908000400 (SMS SID conflict). See
-- docs/backend/ATLAS_INTEGRATION_MIGRATION_OWNERSHIP.md.
--
-- Privilege / grant leftover pass.
--
-- Found by attacking the live schema as anon and authenticated, not by
-- reading comments. Two leftover holes, plus the default-privilege gap
-- that shipped NFC provision to PUBLIC/anon in 20260831000100:
--
-- 1. ALTER DEFAULT PRIVILEGES revoked EXECUTE from anon/authenticated but
--    not from PUBLIC. CREATE FUNCTION still grants EXECUTE to PUBLIC, so
--    the next public wrapper is reachable at /rest/v1/rpc/* without a
--    sign-in unless every author remembers the revoke. Close it at the
--    default, the way grant_lockdown already did for tables.
--
-- 2. text_requests had table-wide SELECT. The list API only returns
--    last-four / status / schedule; the Data API also handed every member
--    the phone hash, phone ciphertext, and the encrypted message (which
--    contains the stand token). Same class of hole as praise response_id.
--
-- 3. review_stands had table-wide SELECT, including public_token_encrypted.
--    Reprint goes through a DEFINER RPC so the ciphertext is not a Data
--    API column. Hash and prefix stay selectable — the SMS resolve path
--    looks a stand up by hash as the authenticated caller.

begin;

-- ------------------------------------------------ default privileges ----
--
-- Per-schema ALTER DEFAULT PRIVILEGES is *added* to the global default.
-- The global default for functions still grants EXECUTE to PUBLIC, which
-- is how CREATE FUNCTION keeps producing `{=X/postgres,...}` even after
-- the schema-level revoke. The NFC provision RPC shipped that way. Close
-- it globally for role postgres, then again per-schema so a later
-- IN SCHEMA grant cannot reopen it by itself.

alter default privileges
    revoke all on functions from public;

alter default privileges in schema public
    revoke all on functions from public;

alter default privileges in schema app
    revoke all on functions from public;

-- Belt: no existing public/app function should keep the implicit PUBLIC
-- grant either. Explicit authenticated / service_role grants are untouched.
revoke all on all functions in schema public from public;
revoke all on all functions in schema app from public;

-- Internal helper — only DEFINER functions (running as postgres) need it.
revoke all on function public._validate_google_review_url(text)
    from public, anon, authenticated;

-- ------------------------------------------- text_requests columns ----

revoke select on public.text_requests from authenticated;

grant select (
    id,
    org_id,
    location_id,
    stand_id,
    purpose,
    status,
    recipient_last_four,
    encoding,
    unit_count,
    segments,
    estimated_cost_micros,
    cost_currency,
    recipient_timezone,
    scheduled_for,
    reserved_quota,
    dedupe_key,
    suppressed_reason,
    suppressed_at,
    sent_at,
    delivered_at,
    failed_at,
    completed_at,
    cancelled_at,
    created_by,
    request_id,
    created_at,
    updated_at
) on public.text_requests to authenticated;

-- ------------------------------------------- review_stands columns ----

revoke select on public.review_stands from authenticated;

grant select (
    id,
    org_id,
    location_id,
    label,
    stand_type,
    status,
    hardware_reference,
    public_token_hash,
    public_token_prefix,
    public_token_key_version,
    token_rotated_at,
    last_opened_at,
    activated_at,
    nfc_provisioned_at,
    nfc_provisioned_by,
    created_at,
    updated_at
) on public.review_stands to authenticated;

-- ------------------------------------------- reprint RPC --------------

create or replace function public.rpc_get_stand_token_ciphertext(
    p_stand_id uuid,
    p_org_id   uuid
)
returns table (token_ciphertext text, label text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user   uuid;
    v_role   text;
    v_cipher text;
    v_label  text;
begin
    v_user := auth.uid();
    if v_user is null then
        raise exception 'not_authenticated'
            using errcode = 'P0001';
    end if;

    select om.role into v_role
      from public.organization_members om
     where om.org_id  = p_org_id
       and om.user_id = v_user
       and om.status  = 'active';

    if v_role is null or v_role not in ('owner', 'admin') then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    select s.public_token_encrypted, s.label
      into v_cipher, v_label
      from public.review_stands s
     where s.id     = p_stand_id
       and s.org_id = p_org_id;

    if not found then
        raise exception 'not_found_or_forbidden'
            using errcode = 'P0001';
    end if;

    token_ciphertext := v_cipher;
    label := v_label;
    return next;
end;
$$;

revoke all on function public.rpc_get_stand_token_ciphertext(uuid, uuid)
    from public, anon;
grant execute on function public.rpc_get_stand_token_ciphertext(uuid, uuid)
    to authenticated, service_role;

commit;
