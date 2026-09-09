-- After a grant is swept, a later release/refund lowers FIFO "used" and
-- would otherwise resurrect that grant's credits as spendable. Expire the
-- residual unused amount so expired credits cannot fund another send.

create or replace function app.sms_quota_expired_amount(p_org_id uuid, p_allocation_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(sum(e.amount), 0)
      from public.sms_quota_ledger e
     where e.org_id = p_org_id
       and e.kind = 'expiration'
       and (
            e.correlation_key = 'expire:' || p_allocation_id::text
         or e.correlation_key = 'expire:' || p_allocation_id::text || ':residual'
       );
$$;

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
               greatest(0, l.amount - app.sms_quota_expired_amount(p_org_id, l.id)) as remaining
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
    v_already   bigint;
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
    -- remainder so those credits cannot be spent again.
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
        v_used := coalesce(app.sms_quota_fifo_used(p_org_id, r.id), 0);
        v_already := app.sms_quota_expired_amount(p_org_id, r.id);
        v_residual := greatest(0, r.amount - v_already - v_used);
        if v_residual > 0 then
            v_inserted := null;
            insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id, note)
            values (
                p_org_id, 'expiration', v_residual,
                'expire:' || r.id::text || ':residual', null,
                'expired residual after release or refund')
            on conflict (org_id, kind, correlation_key) do nothing
            returning id into v_inserted;
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

create or replace function app.sms_quota_available(p_org_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_base     bigint;
    v_unswept  bigint := 0;
    r          record;
    v_used     bigint;
    v_already  bigint;
begin
    v_base := coalesce(
        (select b.allocated - b.reserved - b.consumed
           from public.sms_quota_balance b where b.org_id = p_org_id),
        0::bigint);

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
        v_unswept := v_unswept + greatest(0, r.amount - v_used);
    end loop;

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
        v_used := coalesce(app.sms_quota_fifo_used(p_org_id, r.id), 0);
        v_already := app.sms_quota_expired_amount(p_org_id, r.id);
        v_unswept := v_unswept + greatest(0, r.amount - v_already - v_used);
    end loop;

    return v_base - v_unswept;
end;
$$;

create or replace function app.sms_quota_release(
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
    v_inserted uuid;
begin
    perform app.sms_quota_lock_balance(p_org_id);

    insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id)
    values (p_org_id, 'release', p_amount, p_correlation_key, p_request_id)
    on conflict (org_id, kind, correlation_key) do nothing
    returning id into v_inserted;

    if v_inserted is null then
        return false;
    end if;

    update public.sms_quota_balance b
       set reserved = greatest(0, b.reserved - p_amount), updated_at = now()
     where b.org_id = p_org_id;

    perform app.sms_quota_apply_expirations(p_org_id);
    return true;
end;
$$;

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

    update public.sms_quota_balance b
       set consumed = greatest(0, b.consumed - p_amount), updated_at = now()
     where b.org_id = p_org_id;

    perform app.sms_quota_apply_expirations(p_org_id);
    return true;
end;
$$;

do $$
begin
    revoke all on function app.sms_quota_expired_amount(uuid, uuid)
        from public, anon, authenticated;
    grant execute on function app.sms_quota_expired_amount(uuid, uuid)
        to service_role;
end $$;
