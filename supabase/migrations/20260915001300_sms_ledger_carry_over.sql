-- Credit a business already paid for does not disappear because we changed
-- how credit is stored.
--
-- WHAT WAS WRONG
-- --------------
-- 20260915000800 moved the answer to "how many segments may this business
-- send?" from the `sms_quota_balance` projection to `sms_credit_grants`, and
-- rewrote every reader to ask the grants. It did not carry the old balances
-- across. On a database with real data that is not a refactor, it is a
-- deletion: every organization wakes up with a balance of zero, cannot send,
-- and cannot see where its credit went. Reservations already in flight are
-- worse — they have no slices, so settling them restores nothing to anybody.
--
-- A second gap in the same change: `app.sms_quota_refund` was left as it was.
-- Consumption moved to the grants, but a refund still only decremented the
-- projection nobody reads, so a message that a provider ultimately rejected
-- took the customer's credit with it. Both are fixed here.
--
-- WHAT IS CARRIED, AND WHAT IS NOT
-- --------------------------------
-- Every allocation that has not lapsed becomes a grant carrying its own
-- expiry, so credit that was going to expire still expires and credit that
-- never expires still does not. What is preserved exactly is the number that
-- matters to a business: what it can spend today. Allocations that had
-- already lapsed are not resurrected — they were not spendable before this
-- migration and they are not spendable after it.
--
-- Reservations still in flight are given slices from those grants, so
-- settling or releasing one puts the credit back where it came from rather
-- than nowhere.

-- ========================================================== the refund ======

create or replace function app.sms_quota_refund(
    p_org_id          uuid,
    p_amount          bigint,
    p_correlation_key text,
    p_request_id      uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_slice    record;
    v_inserted uuid;
begin
    perform app.sms_quota_lock_balance(p_org_id);

    insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id)
    values (p_org_id, 'refund', p_amount, p_correlation_key, p_request_id)
    on conflict (org_id, kind, correlation_key) do nothing
    returning id into v_inserted;

    if v_inserted is null then
        return false;
    end if;

    -- Back to the exact grants it was taken from. Credit that came from a
    -- monthly grant returns to that grant — if the month has since ended the
    -- credit is gone, which is correct: a refund is not a way to turn expiring
    -- credit into permanent credit.
    for v_slice in
        select s.grant_id, s.segments
          from public.sms_reservation_slices s
         where s.org_id = p_org_id
           and s.correlation_key = p_correlation_key
           and s.status = 'consumed'
           for update
    loop
        update public.sms_credit_grants
           set consumed = greatest(0, consumed - v_slice.segments)
         where id = v_slice.grant_id;
    end loop;

    update public.sms_reservation_slices
       set status = 'released', settled_at = now()
     where org_id = p_org_id
       and correlation_key = p_correlation_key
       and status = 'consumed';

    update public.sms_quota_balance b
       set consumed = greatest(0, b.consumed - p_amount), updated_at = now()
     where b.org_id = p_org_id;

    return true;
end;
$$;

comment on function app.sms_quota_refund(uuid, bigint, text, uuid) is
    'Gives back credit for a message the provider ultimately rejected, to the grants it was taken from. A refund into an expired monthly grant restores nothing spendable, which is the point.';

-- ========================================================= the carry-over ===

do $$
declare
    v_org        record;
    v_alloc      record;
    v_grant      record;
    v_res        record;
    v_surviving  bigint;
    v_lapsed     bigint;
    v_available  bigint;
    v_placed     bigint;
    v_left       bigint;
    v_take       bigint;
begin
    -- A database that never had the old ledger has nothing to carry.
    if to_regclass('public.sms_quota_balance') is null
       or to_regclass('public.sms_quota_ledger') is null then
        return;
    end if;

    for v_org in
        select b.org_id, b.allocated, b.reserved, b.consumed
          from public.sms_quota_balance b
         where b.allocated > 0 or b.reserved > 0 or b.consumed > 0
         order by b.org_id
    loop
        -- 1. Allocations that are still live become grants, each keeping its
        --    own expiry and its own identity, so this can run twice without
        --    minting anything a second time.
        for v_alloc in
            select l.id, l.amount, l.expires_at, l.effective_at, l.note
              from public.sms_quota_ledger l
             where l.org_id = v_org.org_id
               and l.kind = 'allocation'
               and l.amount > 0
               and (l.expires_at is null or l.expires_at > now())
               and not exists (
                   select 1
                     from public.sms_quota_ledger x
                    where x.org_id = l.org_id
                      and x.kind = 'expiration'
                      and x.correlation_key = 'expire:' || l.id::text)
             order by l.effective_at, l.id
        loop
            insert into public.sms_credit_grants
                (org_id, source, segments, granted_at, expires_at,
                 origin_kind, origin_id, note)
            values (
                v_org.org_id,
                case when v_alloc.expires_at is null then 'purchased' else 'monthly' end,
                v_alloc.amount,
                v_alloc.effective_at,
                v_alloc.expires_at,
                'manual',
                'legacy-allocation:' || v_alloc.id::text,
                coalesce(v_alloc.note, 'carried over from the single-bucket ledger'))
            on conflict (org_id, origin_kind, origin_id) do nothing;
        end loop;

        select coalesce(sum(g.segments), 0)
          into v_surviving
          from public.sms_credit_grants g
         where g.org_id = v_org.org_id;

        if v_surviving = 0 then
            continue;
        end if;

        -- 2. Reservations still in flight get their slices, taken in the order
        --    the new ledger spends: monthly first, soonest expiry first.
        v_placed := 0;

        for v_res in
            select l.correlation_key, l.amount
              from public.sms_quota_ledger l
             where l.org_id = v_org.org_id
               and l.kind = 'reservation'
               and l.amount > 0
               and not exists (
                   select 1
                     from public.sms_quota_ledger s
                    where s.org_id = l.org_id
                      and s.kind in ('consumption', 'release')
                      and s.correlation_key = l.correlation_key)
               and not exists (
                   select 1
                     from public.sms_reservation_slices s
                    where s.org_id = l.org_id
                      and s.correlation_key = l.correlation_key)
             order by l.effective_at, l.id
        loop
            v_left := v_res.amount;

            for v_grant in
                select g.id, (g.segments - g.consumed - g.reserved) as free
                  from public.sms_credit_grants g
                 where g.org_id = v_org.org_id
                   and g.segments > g.consumed + g.reserved
                 order by case g.source when 'monthly' then 0 else 1 end,
                          g.expires_at asc nulls last, g.granted_at, g.id
                   for update
            loop
                exit when v_left <= 0;

                v_take := least(v_left, v_grant.free);
                if v_take > 0 then
                    insert into public.sms_reservation_slices
                        (org_id, correlation_key, grant_id, segments, status)
                    values (v_org.org_id, v_res.correlation_key, v_grant.id, v_take, 'held')
                    on conflict (org_id, correlation_key, grant_id) do nothing;

                    update public.sms_credit_grants
                       set reserved = reserved + v_take
                     where id = v_grant.id;

                    v_left := v_left - v_take;
                    v_placed := v_placed + v_take;
                end if;
            end loop;
        end loop;

        -- 3. What is left spendable must match what was spendable before.
        --
        --    Rather than replaying every historical consumption — which would
        --    charge surviving credit for messages paid out of allocations that
        --    have since lapsed — this preserves the one number a business can
        --    act on: how much it can send today.
        select coalesce(sum(l.amount), 0)
          into v_lapsed
          from public.sms_quota_ledger l
         where l.org_id = v_org.org_id
           and l.kind = 'allocation'
           and l.expires_at is not null
           and l.expires_at <= now()
           and not exists (
               select 1
                 from public.sms_quota_ledger x
                where x.org_id = l.org_id
                  and x.kind = 'expiration'
                  and x.correlation_key = 'expire:' || l.id::text);

        v_available := greatest(
            0,
            v_org.allocated - v_org.reserved - v_org.consumed - v_lapsed);

        v_left := v_surviving - v_placed - v_available;

        for v_grant in
            select g.id, (g.segments - g.consumed - g.reserved) as free
              from public.sms_credit_grants g
             where g.org_id = v_org.org_id
               and g.segments > g.consumed + g.reserved
             order by case g.source when 'monthly' then 0 else 1 end,
                      g.expires_at asc nulls last, g.granted_at, g.id
               for update
        loop
            exit when v_left <= 0;

            v_take := least(v_left, v_grant.free);
            if v_take > 0 then
                update public.sms_credit_grants
                   set consumed = consumed + v_take
                 where id = v_grant.id;
                v_left := v_left - v_take;
            end if;
        end loop;
    end loop;
end
$$;
