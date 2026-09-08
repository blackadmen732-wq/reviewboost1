-- Fold stand-token ciphertext into rpc_create_stand.
--
-- Evidence: 20260813210557 / 20260813215530 dropped
-- rpc_set_stand_token_ciphertext and made create-organization / rotate
-- require ciphertext in the same statement. NFC later added
-- rpc_create_stand without those columns, and the service called the
-- dropped setter then ignored the result — createStand reported success
-- for a stand that could never reprint.
--
-- Product rule: a stand is not created unless the reprint ciphertext
-- is stored. One RPC, required params, no leftover 7-param overload.

begin;

drop function if exists public.rpc_create_stand(uuid, uuid, text, text, text, smallint, text);

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
  v_user_id  uuid;
  v_role     text;
  v_stand_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not_authenticated'
      using errcode = 'P0001';
  end if;

  if p_token_ciphertext is null or length(trim(p_token_ciphertext)) = 0
     or p_cipher_key_version is null then
    raise exception 'ciphertext_required'
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

  -- Composite FK (location_id, org_id) prevents cross-org linkage at DB
  -- level, but verify the location belongs to this org explicitly.
  if not exists (
    select 1 from public.locations
     where id = p_location_id
       and org_id = p_org_id
  ) then
    raise exception 'not_found_or_forbidden'
      using errcode = 'P0001';
  end if;

  insert into public.review_stands
    (org_id, location_id, public_token_hash, public_token_prefix, label,
     stand_type, status, activated_at, public_token_key_version,
     public_token_encrypted, token_encryption_key_version)
  values
    (p_org_id, p_location_id, p_stand_token_hash, p_stand_token_prefix,
     coalesce(nullif(trim(p_label), ''), 'Front Desk'), 'printable_qr',
     'active', now(), coalesce(p_token_key_version, 1),
     p_token_ciphertext, p_cipher_key_version)
  returning id into v_stand_id;

  insert into public.audit_events
    (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
  values
    (p_org_id, v_user_id, 'user', 'stand.created', 'review_stand',
     v_stand_id::text, p_request_id,
     jsonb_build_object('locationId', p_location_id));

  return v_stand_id;
end;
$$;

revoke all on function public.rpc_create_stand(uuid, uuid, text, text, text, smallint, text, text, smallint)
  from public, anon;
grant execute on function public.rpc_create_stand(uuid, uuid, text, text, text, smallint, text, text, smallint)
  to authenticated;

commit;
