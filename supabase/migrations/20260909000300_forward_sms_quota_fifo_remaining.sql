-- FORWARD for databases that already applied #47's 20260908000200.
--
-- #54 fixed FIFO ghost capacity by editing 00200 in place. This branch keeps
-- the #47 00200 blob (never edit a version that may already be recorded) and
-- ships the remaining-capacity body as a new version.
--
-- Expired grant A must not count as prior_capacity: that makes later grant B
-- look unused, expires B in full, and leaves reserved credits against
-- allocated=0 (negative availability).
-- See docs/backend/ATLAS_INTEGRATION_MIGRATION_OWNERSHIP.md.

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
