-- ATLAS upgrade-path repair. Do not rewrite applied schema_migrations rows.
--
-- Fresh installs already applied:
--   20260908000400_privilege_attack_pass.sql
--   20260908000500_sms_reconcile_sid_conflict.sql
--   and 00200 with the #53 FIFO prior_capacity body.
-- This file is CREATE OR REPLACE / REVOKE+GRANT and is a functional no-op
-- on that path.
--
-- Already-migrated DBs that applied PR #54's SID SQL under version
-- 20260908000400 skipped privilege (same version number, different file).
-- 00500 re-applies SID attach. This 00600 applies privilege and the FIFO
-- function body so those DBs converge without renaming history.
--
-- DBs that applied 00200 before the #53 FIFO isolate also pick up
-- sms_quota_fifo_used here. Historical wrongly attached SIDs are not
-- rewritten.

-- ------------------------------------------- privilege (from 00400) ----

alter default privileges
    revoke all on functions from public;

alter default privileges in schema public
    revoke all on functions from public;

alter default privileges in schema app
    revoke all on functions from public;

revoke all on all functions in schema public from public;
revoke all on all functions in schema app from public;

revoke all on function public._validate_google_review_url(text)
    from public, anon, authenticated;

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

-- ------------------------------------------- FIFO isolate (from 00200) --

create or replace function app.sms_quota_fifo_used(p_org_id uuid, p_allocation_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
    with net as (
        select coalesce(sum(case
                   when u.kind = 'reservation' then u.amount
                   when u.kind in ('release', 'refund') then -u.amount
                   else 0 end), 0) as used
          from public.sms_quota_ledger u
         where u.org_id = p_org_id
           and u.kind in ('reservation', 'release', 'refund')
    ),
    allocs as (
        select l.id,
               l.effective_at,
               greatest(0, l.amount - coalesce((
                   select e.amount
                     from public.sms_quota_ledger e
                    where e.org_id = p_org_id
                      and e.kind = 'expiration'
                      and e.correlation_key = 'expire:' || l.id::text
               ), 0)) as remaining
          from public.sms_quota_ledger l
         where l.org_id = p_org_id
           and l.kind = 'allocation'
    ),
    ranked as (
        select a.id,
               a.remaining,
               coalesce(sum(a.remaining) over (
                   order by a.effective_at, a.id
                   rows between unbounded preceding and 1 preceding
               ), 0) as prior_capacity
          from allocs a
    )
    select least(r.remaining, greatest(0, n.used - r.prior_capacity))
      from ranked r
      cross join net n
     where r.id = p_allocation_id;
$$;

revoke all on function app.sms_quota_fifo_used(uuid, uuid)
    from public, anon, authenticated;
grant execute on function app.sms_quota_fifo_used(uuid, uuid)
    to service_role;
