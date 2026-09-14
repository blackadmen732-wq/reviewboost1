-- NFC readiness is server truth, not a hopeful flag.
--
-- THE PROBLEM
-- -----------
-- `nfc_provisioned_at` records that someone wrote this stand's URL to a
-- physical tag. Rotating the token changes that URL: every tag written before
-- the rotation now points at a token the server will not resolve. Nothing
-- cleared the stamp, so the stand still read as "provisioned" while the tag in
-- the shop was dead. The owner had no way to know which tags needed rewriting
-- except to remember.
--
-- Rotation now clears the provisioning stamp in the same statement that
-- changes the token. Same transaction, so there is no moment where the token
-- has moved and the readiness has not.
--
-- WHAT IS DELIBERATELY NOT HERE
-- -----------------------------
-- No NFC UID column, in V1 or in this migration. The server records whether a
-- write was reported, and nothing about the hardware it was reported for.
-- Detecting that a tag was overwritten by something else is a Web NFC problem
-- on the client; the server cannot observe it and must not pretend to.

begin;

-- Kept for evidence: an owner asking "did I ever provision this?" after a
-- rotation deserves a better answer than silence.
alter table public.review_stands
    add column if not exists nfc_provision_invalidated_at timestamptz;

comment on column public.review_stands.nfc_provision_invalidated_at is
    'When a token rotation last invalidated a recorded NFC write. Non-null with '
    'a null nfc_provisioned_at means: this tag was written once, and the write '
    'is now stale because the URL changed.';

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
    v_was_provisioned boolean;
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

    select (nfc_provisioned_at is not null) into v_was_provisioned
      from public.review_stands
     where id = p_stand_id and org_id = p_org_id;

    update public.review_stands
    set public_token_hash = p_new_token_hash,
        public_token_prefix = p_new_token_prefix,
        public_token_key_version = p_key_version,
        token_rotated_at = now(),
        public_token_encrypted = coalesce(p_token_ciphertext, public_token_encrypted),
        token_encryption_key_version = coalesce(p_cipher_key_version, token_encryption_key_version),
        -- The physical tag now points at a token this server will not resolve.
        -- Clearing the stamp in the same statement is what makes "Needs NFC"
        -- something the server knows rather than something the UI remembers.
        nfc_provisioned_at = null,
        nfc_provisioned_by = null,
        nfc_provision_invalidated_at = case
            when nfc_provisioned_at is not null then now()
            else nfc_provision_invalidated_at
        end
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
         p_stand_id::text, p_request_id,
         jsonb_build_object('nfcNeedsRewrite', coalesce(v_was_provisioned, false)));
end;
$$;

revoke all on function public.rpc_rotate_stand_token(uuid, uuid, text, text, smallint, text, text, smallint) from public, anon;
grant execute on function public.rpc_rotate_stand_token(uuid, uuid, text, text, smallint, text, text, smallint) to authenticated;

-- ------------------------------------------------- recording a provision ----

-- Returns what happened instead of void.
--
-- The old signature returned nothing, so a caller could not distinguish
-- "recorded" from "the RPC failed and something swallowed it". The client does
-- ignore this result today -- that is a client bug -- but the route must not be
-- able to answer 204 for a write that did not happen.
--
-- `recorded_at` is the server's own timestamp: the point is that the client
-- does not get to assert when, or whether, this happened.
drop function if exists public.rpc_record_nfc_provision(uuid, uuid, text);

create or replace function public.rpc_record_nfc_provision(
  p_stand_id    uuid,
  p_org_id      uuid,
  p_request_id  text
)
returns table (recorded_at timestamptz, token_rotated_at timestamptz, needs_rewrite boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_role    text;
  v_now     timestamptz := now();
  v_rotated timestamptz;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not_authenticated'
      using errcode = 'P0001';
  end if;

  select om.role into v_role
    from public.organization_members om
   where om.org_id  = p_org_id
     and om.user_id = v_user_id
     and om.status  = 'active';

  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'not_found_or_forbidden'
      using errcode = 'P0001';
  end if;

  -- Only an active stand can be provisioned. Writing a retired stand's URL to
  -- a physical tag produces a tag that 404s the moment a customer taps it.
  update public.review_stands
     set nfc_provisioned_at = v_now,
         nfc_provisioned_by = v_user_id,
         nfc_provision_invalidated_at = null,
         updated_at         = v_now
   where id     = p_stand_id
     and org_id = p_org_id
     and status = 'active'
  returning public.review_stands.token_rotated_at into v_rotated;

  if not found then
    raise exception 'not_found_or_forbidden'
      using errcode = 'P0001';
  end if;

  insert into public.audit_events (org_id, actor_user_id, action, target_type, target_id, request_id, metadata)
  values (
    p_org_id,
    v_user_id,
    'nfc_provisioned',
    'review_stand',
    p_stand_id::text,
    p_request_id,
    '{}'::jsonb
  );

  -- A retry after a partial success -- the physical write landed, the server
  -- call did not -- is this same call again. It is idempotent by construction:
  -- it restamps, and the tag in the shop is already correct.
  return query select v_now, v_rotated, false;
end;
$$;

revoke all on function public.rpc_record_nfc_provision(uuid, uuid, text) from public, anon;
grant execute on function public.rpc_record_nfc_provision(uuid, uuid, text) to authenticated;

commit;
