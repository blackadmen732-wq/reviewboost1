-- Tag entitlement gate before Customer Page / billing.
--
-- This is deliberately NOT the money system. It gives the database one honest
-- source of truth for whether another Tag may be created, so HTTP pre-checks
-- cannot be bypassed and two concurrent creates cannot both slip through.
-- Stripe, the seven-day clock, included SMS, and purchased credits land later.
--
-- Important product rules captured here:
--   * no permanent Free plan
--   * pre-billing organizations are trialing, not paid Starter
--   * trialing allows 1 non-retired Tag
--   * active Starter/Growth/Pro allow 3/8/25 non-retired Tags
--   * past_due/cancelled/suspended allow no new Tags
--   * missing entitlement state fails closed
--
-- This version intentionally occupies 20260909000500, the gap before the
-- Customer Page migration currently used by #67 (20260909000900). A future
-- corrected #67 descendant must reuse this table instead of creating a second
-- entitlement_snapshots definition.

begin;

-- ------------------------------------------------ entitlement snapshot ----

create table public.entitlement_snapshots (
    org_id      uuid primary key references public.organizations (id) on delete cascade,
    -- Nullable only while the pre-billing trial does not yet know which paid
    -- plan the owner selected. The Money PR will make plan selection explicit
    -- before starting the real seven-day trial.
    plan_id     text check (plan_id is null or plan_id in ('starter', 'growth', 'pro')),
    status      text not null
        check (status in ('trialing', 'active', 'past_due', 'cancelled', 'suspended')),
    source      text not null check (char_length(source) between 1 and 80),
    updated_at  timestamptz not null default now()
);

alter table public.entitlement_snapshots enable row level security;

-- Future-table default privileges are intentionally empty in this repository.
-- Owners may read their own snapshot; no browser/mobile role may write it.
revoke all on public.entitlement_snapshots from public, anon, authenticated;
grant select on public.entitlement_snapshots to authenticated;

create policy entitlement_snapshots_select on public.entitlement_snapshots
    for select to authenticated
    using (app.is_org_member(org_id));

-- Existing pre-launch organizations get an explicit trialing snapshot. We do
-- NOT silently call them Starter/active. Existing rows are preserved exactly as
-- they are; this only governs future creates.
insert into public.entitlement_snapshots (org_id, plan_id, status, source)
select o.id, null, 'trialing', 'pre_billing_backfill'
  from public.organizations o
on conflict (org_id) do nothing;

-- Every newly-created organization gets entitlement state in the SAME outer
-- transaction as onboarding. The first stand is created by the onboarding
-- function itself; subsequent rpc_create_stand calls are constrained below.
create or replace function app.initialize_entitlement_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.entitlement_snapshots (org_id, plan_id, status, source)
    values (new.id, null, 'trialing', 'pre_billing_onboarding')
    on conflict (org_id) do nothing;
    return new;
end;
$$;

revoke all on function app.initialize_entitlement_snapshot() from public, anon, authenticated;

drop trigger if exists organizations_initialize_entitlement on public.organizations;
create trigger organizations_initialize_entitlement
after insert on public.organizations
for each row execute function app.initialize_entitlement_snapshot();

-- One mapping, used by the database authority. Frontend labels are not the
-- source of truth for enforcement.
create or replace function app.entitlement_tag_limit(p_plan_id text, p_status text)
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$
    select case
        when p_status = 'trialing' then 1
        when p_status = 'active' and p_plan_id = 'starter' then 3
        when p_status = 'active' and p_plan_id = 'growth' then 8
        when p_status = 'active' and p_plan_id = 'pro' then 25
        else 0
    end;
$$;

revoke all on function app.entitlement_tag_limit(text, text) from public, anon, authenticated;

-- ------------------------------------------------ atomic Tag create -------
--
-- #56 already moved reprint ciphertext into this same RPC. Keep that
-- fail-closed shape and add the entitlement-row lock before counting/inserting.

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
  v_user_id   uuid;
  v_role      text;
  v_stand_id  uuid;
  v_cipher    text;
  v_ws        text;
  v_plan_id   text;
  v_status    text;
  v_tag_limit integer;
  v_tag_count integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not_authenticated'
      using errcode = 'P0001';
  end if;

  -- Same ciphertext validation as #56. SQL cannot decrypt, but it can reject
  -- anything that is not the v1:<b64>:<b64>:<b64> envelope encrypt() writes.
  v_ws := E' \t\n\r\v\f'
    || chr(160)
    || chr(5760)
    || chr(8192) || chr(8193) || chr(8194) || chr(8195)
    || chr(8196) || chr(8197) || chr(8198) || chr(8199)
    || chr(8200) || chr(8201) || chr(8202)
    || chr(8232) || chr(8233)
    || chr(8239)
    || chr(8287)
    || chr(12288);

  v_cipher := btrim(p_token_ciphertext, v_ws);

  if p_cipher_key_version is null
     or v_cipher is null
     or v_cipher !~ '^v1:[A-Za-z0-9+/]{8,}={0,2}:[A-Za-z0-9+/]{8,}={0,2}:[A-Za-z0-9+/]{8,}={0,2}$'
  then
    raise exception 'ciphertext_required'
      using errcode = 'P0001';
  end if;

  select om.role into v_role
    from public.organization_members om
   where om.org_id = p_org_id
     and om.user_id = v_user_id
     and om.status = 'active';

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

  -- This row lock is the concurrency boundary. Two create requests for the
  -- same org serialize here; the second counts after the first has committed.
  select e.plan_id, e.status
    into v_plan_id, v_status
    from public.entitlement_snapshots e
   where e.org_id = p_org_id
   for update;

  if not found then
    raise exception 'entitlement_missing'
      using errcode = 'P0001';
  end if;

  v_tag_limit := app.entitlement_tag_limit(v_plan_id, v_status);

  if v_tag_limit <= 0 then
    raise exception 'entitlement_inactive'
      using errcode = 'P0001';
  end if;

  select count(*)::integer
    into v_tag_count
    from public.review_stands s
   where s.org_id = p_org_id
     and s.status <> 'retired';

  if v_tag_count >= v_tag_limit then
    raise exception 'tag_limit_reached'
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

-- ------------------------------------------------ NFC readiness -----------
-- A rotated token makes any previously-written NFC tag stale. Make the server
-- state say that explicitly instead of relying on UI inference.

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
        token_encryption_key_version = p_cipher_key_version,
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

commit;
