-- NFC provisioning metadata for review stands.
--
-- Tracks which stands have been written to NFC tags, when, and by whom.
-- The stand token/URL is the same for QR and NFC — this records the
-- physical provisioning event so owners know which tags need replacing
-- after a token rotation.
--
-- v1 does NOT store NFC UID. Owners see provisioning status only, not
-- hardware identifiers.

begin;

-- --------------------------------------------------------- new columns --

alter table public.review_stands
  add column nfc_provisioned_at timestamptz default null,
  add column nfc_provisioned_by uuid        default null;

comment on column public.review_stands.nfc_provisioned_at is
  'When the NFC tag was last written for this stand.';
comment on column public.review_stands.nfc_provisioned_by is
  'User who last provisioned the NFC tag.';

-- ------------------------------------------------- provisioning RPC --

create or replace function public.rpc_record_nfc_provision(
  p_stand_id    uuid,
  p_org_id      uuid,
  p_request_id  text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_role    text;
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

  update public.review_stands
     set nfc_provisioned_at = now(),
         nfc_provisioned_by = v_user_id,
         updated_at         = now()
   where id     = p_stand_id
     and org_id = p_org_id;

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
end;
$$;

grant execute on function public.rpc_record_nfc_provision(uuid, uuid, text)
  to authenticated;

-- ------------------------------------------------- create stand RPC --

create or replace function public.rpc_create_stand(
  p_org_id            uuid,
  p_location_id       uuid,
  p_label             text,
  p_stand_token_hash  text,
  p_stand_token_prefix text,
  p_token_key_version smallint,
  p_request_id        text default null
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

  select om.role into v_role
    from public.organization_members om
   where om.org_id  = p_org_id
     and om.user_id = v_user_id
     and om.status  = 'active';

  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'not_found_or_forbidden'
      using errcode = 'P0001';
  end if;

  -- Composite FK (location_id, org_id) prevents cross-org linkage at DB level,
  -- but verify the location belongs to this org explicitly.
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
     stand_type, status, activated_at, public_token_key_version)
  values
    (p_org_id, p_location_id, p_stand_token_hash, p_stand_token_prefix,
     coalesce(nullif(trim(p_label), ''), 'Front Desk'), 'printable_qr',
     'active', now(), coalesce(p_token_key_version, 1))
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

grant execute on function public.rpc_create_stand(uuid, uuid, text, text, text, smallint, text)
  to authenticated;
revoke all on function public.rpc_create_stand(uuid, uuid, text, text, text, smallint, text)
  from public, anon;

commit;
