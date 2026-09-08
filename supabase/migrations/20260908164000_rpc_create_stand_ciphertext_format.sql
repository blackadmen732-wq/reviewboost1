-- Harden rpc_create_stand ciphertext: trim() is 0x20-only.
--
-- A direct authenticated owner/admin call with tab / NL / CRLF / NBSP
-- or a non-empty string that tryDecrypt cannot read still inserted a
-- stand. Reprint then returns null. Product createStand writes
-- v1:<b64>:<b64>:<b64> from encrypt(); require that shape after a
-- Unicode whitespace strip, and store the stripped value.

begin;

create or replace function public.rpc_create_stand(
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
  v_cipher   text;
  v_ws       text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not_authenticated'
      using errcode = 'P0001';
  end if;

  -- trim() only strips 0x20. Include the whitespace class SENTINEL used
  -- plus the rest of Unicode space separators so empty-after-normalize
  -- cannot sneak a non-reprintable row through.
  v_ws := E' \t\n\r\v\f'
    || chr(160)   -- NBSP
    || chr(5760)  -- Ogham space
    || chr(8192) || chr(8193) || chr(8194) || chr(8195)
    || chr(8196) || chr(8197) || chr(8198) || chr(8199)
    || chr(8200) || chr(8201) || chr(8202)  -- U+2000–U+200A
    || chr(8232) || chr(8233)               -- line / paragraph separator
    || chr(8239)                            -- narrow NBSP
    || chr(8287)                            -- medium mathematical space
    || chr(12288);                          -- ideographic space

  v_cipher := btrim(p_token_ciphertext, v_ws);

  -- encrypt() emits v1:<iv b64>:<tag b64>:<ct b64>. tryDecrypt returns
  -- null for anything else. SQL cannot decrypt; it can refuse a payload
  -- that is not that shape.
  if p_cipher_key_version is null
     or v_cipher is null
     or v_cipher !~ '^v1:[A-Za-z0-9+/]{8,}={0,2}:[A-Za-z0-9+/]{8,}={0,2}:[A-Za-z0-9+/]{8,}={0,2}$'
  then
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
     coalesce(nullif(btrim(p_label), ''), 'Front Desk'), 'printable_qr',
     'active', now(), coalesce(p_token_key_version, 1),
     v_cipher, p_cipher_key_version)
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
