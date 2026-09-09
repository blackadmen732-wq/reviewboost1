-- SENTINEL H5: a second refund/release against one expired grant must not
-- reopen spend. 20260909000600 keyed residual as a singleton
-- ('expire:<id>:residual') and used ON CONFLICT DO NOTHING, so leftover #2
-- was dropped. available() still subtracted the computed leftover (0), but
-- sms_quota_reserve spent raw allocated - reserved - consumed.
--
-- Forward fix after 09000700: residual is additive on conflict, and the
-- reserve spend gate uses the same projection as available().

create or replace function app.sms_quota_apply_expirations(p_org_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    r           record;
    v_used      bigint;
    v_remaining bigint;
    v_residual  bigint;
    v_inserted  uuid;
    v_total     bigint := 0;
    v_count     integer := 0;
begin
    perform app.sms_quota_lock_balance(p_org_id);

    for r in
        select l.id, l.amount
          from public.sms_quota_ledger l
         where l.org_id = p_org_id
           and l.kind = 'allocation'
           and l.expires_at is not null
           and l.expires_at <= now()
           and not exists (
               select 1 from public.sms_quota_ledger e
                where e.org_id = p_org_id
                  and e.kind = 'expiration'
                  and e.correlation_key = 'expire:' || l.id::text)
         order by l.effective_at, l.id
    loop
        v_used := coalesce(app.sms_quota_fifo_used(p_org_id, r.id), 0);
        v_remaining := greatest(0, r.amount - v_used);

        if v_remaining > 0 then
            insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id, note)
            values (p_org_id, 'expiration', v_remaining, 'expire:' || r.id::text, null, 'allocation expired')
            on conflict (org_id, kind, correlation_key) do nothing;
            v_total := v_total + v_remaining;
        else
            insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id, note)
            values (p_org_id, 'expiration', 0, 'expire:' || r.id::text, null, 'fully consumed before expiry')
            on conflict (org_id, kind, correlation_key) do nothing;
        end if;
        v_count := v_count + 1;
    end loop;

    -- Release/refund after a sweep lowers FIFO used. Expire the newly unused
    -- remainder so those credits cannot be spent again. v_residual is the
    -- unrecorded leftover (expired_amount already includes prior residual),
    -- so conflict must add, not drop.
    for r in
        select l.id, l.amount
          from public.sms_quota_ledger l
         where l.org_id = p_org_id
           and l.kind = 'allocation'
           and exists (
               select 1 from public.sms_quota_ledger e
                where e.org_id = p_org_id
                  and e.kind = 'expiration'
                  and e.correlation_key = 'expire:' || l.id::text)
         order by l.effective_at, l.id
    loop
        v_residual := app.sms_quota_expired_residual(p_org_id, r.id);
        if v_residual > 0 then
            v_inserted := null;
            insert into public.sms_quota_ledger as residual
                (org_id, kind, amount, correlation_key, request_id, note)
            values (
                p_org_id, 'expiration', v_residual,
                'expire:' || r.id::text || ':residual', null,
                'expired residual after release or refund')
            on conflict (org_id, kind, correlation_key) do update
                set amount = residual.amount + excluded.amount,
                    note = excluded.note
            returning residual.id into v_inserted;
            if v_inserted is not null then
                v_total := v_total + v_residual;
            end if;
        end if;
    end loop;

    if v_total > 0 then
        update public.sms_quota_balance b
           set allocated = greatest(0, b.allocated - v_total), updated_at = now()
         where b.org_id = p_org_id;
    end if;

    return v_count;
end;
$$;

create or replace function app.sms_quota_reserve(
    p_org_id          uuid,
    p_amount          bigint,
    p_correlation_key text,
    p_request_id      uuid default null
)
returns table (reserved boolean, available_after bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_available bigint;
    v_inserted  uuid;
begin
    perform app.sms_quota_lock_balance(p_org_id);

    -- Expired allocations must not be spendable: sweep them under the lock so
    -- the availability check below sees only currently-valid quota.
    perform app.sms_quota_apply_expirations(p_org_id);

    -- Same projection as the read path. Raw allocated-reserved-consumed would
    -- spend leftover #2 when a singleton residual insert was dropped.
    v_available := app.sms_quota_available(p_org_id);

    -- Already reserved under this key: idempotent success, no double count.
    if exists (
        select 1 from public.sms_quota_ledger l
         where l.org_id = p_org_id and l.kind = 'reservation' and l.correlation_key = p_correlation_key
    ) then
        return query select true, v_available;
        return;
    end if;

    if v_available < p_amount then
        return query select false, v_available;
        return;
    end if;

    insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id)
    values (p_org_id, 'reservation', p_amount, p_correlation_key, p_request_id)
    returning id into v_inserted;

    update public.sms_quota_balance b
       set reserved = b.reserved + p_amount, updated_at = now()
     where b.org_id = p_org_id;

    return query select true, (v_available - p_amount);
end;
$$;
