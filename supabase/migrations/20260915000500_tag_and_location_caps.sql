-- Caps the database enforces, and a Tag that cannot be created half-made.
--
-- TWO DEFECTS THIS CLOSES
-- -----------------------
-- 1. `rpc_create_stand` inserted the Tag, and the encrypted copy of its token —
--    the only thing that makes a reprint or an NFC rewrite possible — was
--    stored by a *second* call afterwards, whose error was discarded. A Tag
--    could therefore exist, be reported as created, and be impossible to
--    reprint. Creation now takes the ciphertext and stores it in the same
--    statement, and refuses anything that is not the envelope `encrypt()`
--    writes. If the ciphertext is not there, the Tag is not there.
--
-- 2. Nothing counted. Plan limits lived in HTTP handlers, where two concurrent
--    creates both read "2 of 3 used" and both insert. The count now happens
--    behind a lock on the organization's entitlement row, so the second
--    request counts what the first one committed.
--
-- The lock is on `entitlement_snapshots`, not on the Tags: it is one row per
-- organization, it is the thing being spent, and taking it also means a
-- concurrent billing write cannot change the plan underneath a create that is
-- already counting against the old one.

-- ======================================================= Tag creation =======

-- The old seven-argument form is dropped rather than left beside the new one.
-- An overload without the ciphertext is a path back to the defect.
drop function if exists public.rpc_create_stand(uuid, uuid, text, text, text, smallint, text);
drop function if exists public.rpc_create_stand(uuid, uuid, text, text, text, smallint, text, text, smallint);

create function public.rpc_create_stand(
    p_org_id             uuid,
    p_location_id        uuid,
    p_label              text,
    p_stand_token_hash   text,
    p_stand_token_prefix text,
    p_token_key_version  smallint,
    p_request_id         text,
    p_token_ciphertext   text,
    p_cipher_key_version smallint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor     uuid := (select auth.uid());
    v_role      text;
    v_stand_id  uuid;
    v_plan_id   text;
    v_status    text;
    v_limit     integer;
    v_count     integer;
begin
    if v_actor is null then
        raise exception 'not_authenticated' using errcode = 'P0001';
    end if;

    -- SQL cannot decrypt, but it can refuse anything that is not the
    -- `v1:<b64>:<b64>:<b64>` envelope `encrypt()` produces — which is enough to
    -- stop a truncated, empty, or plaintext value being stored as if it were
    -- recoverable key material.
    if p_cipher_key_version is null
       or p_token_ciphertext is null
       or btrim(p_token_ciphertext) !~
          '^v1:[A-Za-z0-9+/]{8,}={0,2}:[A-Za-z0-9+/]{8,}={0,2}:[A-Za-z0-9+/]{8,}={0,2}$'
    then
        raise exception 'ciphertext_required' using errcode = 'P0001';
    end if;

    select om.role into v_role
      from public.organization_members om
     where om.org_id = p_org_id
       and om.user_id = v_actor
       and om.status = 'active';

    if v_role is null or v_role not in ('owner', 'admin') then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    if not exists (
        select 1 from public.locations
         where id = p_location_id and org_id = p_org_id
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    -- The concurrency boundary. Two creates for one organization serialize
    -- here; the second counts after the first has committed.
    select e.plan_id, e.status
      into v_plan_id, v_status
      from public.entitlement_snapshots e
     where e.org_id = p_org_id
       for update;

    if not found then
        -- No entitlement is not a generous default.
        raise exception 'entitlement_missing' using errcode = 'P0001';
    end if;

    v_limit := app.entitlement_tag_limit(v_plan_id, v_status);
    if v_limit <= 0 then
        raise exception 'entitlement_inactive' using errcode = 'P0001';
    end if;

    -- Retired Tags do not count: a business that retires one has freed the
    -- slot, and charging them for a sticker in a drawer would be absurd.
    select count(*)::integer into v_count
      from public.review_stands s
     where s.org_id = p_org_id
       and s.status <> 'retired';

    if v_count >= v_limit then
        raise exception 'tag_limit_reached' using errcode = 'P0001';
    end if;

    insert into public.review_stands
        (org_id, location_id, public_token_hash, public_token_prefix, label,
         stand_type, status, activated_at, public_token_key_version,
         public_token_encrypted, token_encryption_key_version)
    values
        (p_org_id, p_location_id, p_stand_token_hash, p_stand_token_prefix,
         coalesce(nullif(btrim(p_label), ''), 'Front Desk'), 'printable_qr',
         'active', now(), coalesce(p_token_key_version, 1),
         btrim(p_token_ciphertext), p_cipher_key_version)
    returning id into v_stand_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
    values
        (p_org_id, v_actor, 'user', 'stand.created', 'review_stand',
         v_stand_id::text, p_request_id,
         jsonb_build_object('locationId', p_location_id));

    return v_stand_id;
end;
$$;

revoke all on function public.rpc_create_stand(uuid, uuid, text, text, text, smallint, text, text, smallint)
    from public, anon;
grant execute on function public.rpc_create_stand(uuid, uuid, text, text, text, smallint, text, text, smallint)
    to authenticated;

-- ================================================== location creation =======

-- Locations could only be created by onboarding, which makes exactly one. A
-- plan that sells two or five of them needs a way to add the others, and that
-- way has to count under the same lock as Tags do.
create or replace function public.rpc_create_location(
    p_org_id     uuid,
    p_name       text,
    p_timezone   text default null,
    p_locale     text default null,
    p_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor       uuid := (select auth.uid());
    v_role        text;
    v_location_id uuid;
    v_plan_id     text;
    v_status      text;
    v_limit       integer;
    v_count       integer;
    v_name        text;
begin
    if v_actor is null then
        raise exception 'not_authenticated' using errcode = 'P0001';
    end if;

    v_name := btrim(coalesce(p_name, ''));
    if char_length(v_name) < 1 or char_length(v_name) > 160 then
        raise exception 'invalid_location_name' using errcode = 'P0001';
    end if;

    select om.role into v_role
      from public.organization_members om
     where om.org_id = p_org_id
       and om.user_id = v_actor
       and om.status = 'active';

    if v_role is null or v_role not in ('owner', 'admin') then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    select e.plan_id, e.status
      into v_plan_id, v_status
      from public.entitlement_snapshots e
     where e.org_id = p_org_id
       for update;

    if not found then
        raise exception 'entitlement_missing' using errcode = 'P0001';
    end if;

    v_limit := app.entitlement_location_limit(v_plan_id, v_status);
    if v_limit <= 0 then
        raise exception 'entitlement_inactive' using errcode = 'P0001';
    end if;

    select count(*)::integer into v_count
      from public.locations l
     where l.org_id = p_org_id
       and l.status = 'active';

    if v_count >= v_limit then
        raise exception 'location_limit_reached' using errcode = 'P0001';
    end if;

    -- No destination is set here. A new location's door starts closed, and the
    -- owner points it somewhere deliberately through the destination write.
    insert into public.locations (org_id, name, timezone, default_locale)
    select p_org_id,
           v_name,
           coalesce(p_timezone, o.timezone, 'UTC'),
           coalesce(p_locale, o.default_locale, 'en')
      from public.organizations o
     where o.id = p_org_id
    returning id into v_location_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
    values
        (p_org_id, v_actor, 'user', 'location.created', 'location',
         v_location_id::text, p_request_id, '{}'::jsonb);

    return v_location_id;
end;
$$;

revoke all on function public.rpc_create_location(uuid, text, text, text, text)
    from public, anon;
grant execute on function public.rpc_create_location(uuid, text, text, text, text)
    to authenticated;

-- ================================================ rotation and the chip =====

-- A rotated token makes every NFC chip already written for that Tag stale:
-- tapping one leads to a token that no longer resolves. The server has to say
-- so rather than leave the owner to infer it, so provisioning state is cleared
-- and the Tag reads as needing a rewrite until it is programmed again.
--
-- The QR is not invalidated by this in the same way — a reprint uses the new
-- token — but the same rule applies: rotation is the deliberate act that
-- retires printed copies, which is exactly why changing a *destination* must
-- never rotate a token.
create or replace function public.rpc_rotate_stand_token(
    p_stand_id           uuid,
    p_org_id             uuid,
    p_new_token_hash     text,
    p_new_token_prefix   text,
    p_key_version        smallint,
    p_request_id         text,
    p_token_ciphertext   text,
    p_cipher_key_version smallint
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

    -- Same envelope check as creation: a rotation that stored an unusable
    -- ciphertext would leave a live Tag nobody can reprint.
    if p_cipher_key_version is null
       or p_token_ciphertext is null
       or btrim(p_token_ciphertext) !~
          '^v1:[A-Za-z0-9+/]{8,}={0,2}:[A-Za-z0-9+/]{8,}={0,2}:[A-Za-z0-9+/]{8,}={0,2}$'
    then
        raise exception 'ciphertext_required' using errcode = 'P0001';
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
           public_token_encrypted = btrim(p_token_ciphertext),
           token_encryption_key_version = p_cipher_key_version,
           -- Needs rewriting.
           nfc_provisioned_at = null,
           nfc_provisioned_by = null
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

revoke all on function public.rpc_rotate_stand_token(uuid, uuid, text, text, smallint, text, text, smallint)
    from public, anon;
grant execute on function public.rpc_rotate_stand_token(uuid, uuid, text, text, smallint, text, text, smallint)
    to authenticated;
