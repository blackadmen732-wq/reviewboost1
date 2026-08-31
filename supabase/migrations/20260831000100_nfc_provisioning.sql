-- NFC provisioning metadata for review stands.
--
-- Tracks which stands have been written to NFC tags, when, and by whom.
-- The stand token/URL is the same for QR and NFC — this records the
-- physical provisioning event so owners know which tags need replacing
-- after a token rotation.

begin;

-- --------------------------------------------------------- new columns --

alter table public.review_stands
  add column nfc_uid          text          default null,
  add column nfc_provisioned_at timestamptz default null,
  add column nfc_provisioned_by uuid        default null;

comment on column public.review_stands.nfc_uid is
  'UID of the NFC tag last written. Informational only — not a security boundary.';
comment on column public.review_stands.nfc_provisioned_at is
  'When the NFC tag was last written for this stand.';
comment on column public.review_stands.nfc_provisioned_by is
  'User who last provisioned the NFC tag.';

-- Allow the RPC to update these columns (direct UPDATE already revoked).
-- The column-level grant list from 20260814211532 needs extending.
-- We do this via a new RPC rather than reopening column grants.

-- ------------------------------------------------- provisioning RPC --

create or replace function public.rpc_record_nfc_provision(
  p_stand_id    uuid,
  p_org_id      uuid,
  p_nfc_uid     text,
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
  -- Authenticate
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not_authenticated'
      using errcode = 'P0001';
  end if;

  -- Require owner or admin role
  select om.role into v_role
    from public.organization_members om
   where om.org_id  = p_org_id
     and om.user_id = v_user_id
     and om.status  = 'active';

  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'not_found_or_forbidden'
      using errcode = 'P0001';
  end if;

  -- Validate NFC UID format (hex, 4-20 chars)
  if p_nfc_uid is not null and p_nfc_uid !~ '^[0-9A-Fa-f]{4,20}$' then
    raise exception 'invalid_nfc_uid'
      using errcode = 'P0001';
  end if;

  -- Update the stand
  update public.review_stands
     set nfc_uid            = p_nfc_uid,
         nfc_provisioned_at = now(),
         nfc_provisioned_by = v_user_id,
         updated_at         = now()
   where id     = p_stand_id
     and org_id = p_org_id;

  if not found then
    raise exception 'not_found_or_forbidden'
      using errcode = 'P0001';
  end if;

  -- Audit event
  insert into public.audit_events (org_id, actor_user_id, action, target_type, target_id, request_id, metadata)
  values (
    p_org_id,
    v_user_id,
    'nfc_provisioned',
    'review_stand',
    p_stand_id::text,
    p_request_id,
    jsonb_build_object('nfc_uid', p_nfc_uid)
  );
end;
$$;

-- Grant execute to authenticated users (RPC enforces role check internally)
grant execute on function public.rpc_record_nfc_provision(uuid, uuid, text, text)
  to authenticated;

commit;
