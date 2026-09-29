-- SMS packs: selling them, taking them back, and proving the two agree.
--
-- WHAT WAS MISSING
-- ----------------
-- `rpc_billing_apply_credit_purchase` could mint purchased credit, but nothing
-- recorded what was bought, for how much, or what happened to the payment
-- afterwards. A pack refunded in the Stripe dashboard, or lost to a
-- chargeback, left every one of its segments spendable: free credit, with no
-- row anywhere that could even say so.
--
-- WHAT IS TRUE NOW
-- ----------------
-- 1. The pack card lives here (`app.sms_pack_catalog`). A paid Checkout
--    Session is granted the catalog's segments only if Stripe collected the
--    catalog's price; anything else is recorded as paid-without-credit and
--    surfaced, never guessed at.
-- 2. Every pack payment has one row in `sms_pack_purchases`, keyed by the
--    PaymentIntent, whichever event arrives first — a refund can be recorded
--    before the payment it refunds, and it applies the moment the grant does.
-- 3. A refund or an open/lost dispute sets a CLAWBACK TARGET on the grant.
--    The grant revokes as much of that target as is unspent right now, and
--    keeps revoking as in-flight reservations come back. Revocation never
--    exceeds what is unspent, so a balance cannot go negative.
-- 4. Whatever part of the target was already spent cannot be taken back from
--    the ledger. It is not hidden and it is not turned into a debt on the
--    business's balance: it becomes an explicit accounting state
--    (`needs_review`) with the exact number of segments, until an operator
--    resolves it.
-- 5. A dispute the business wins, or an inquiry that closes, lowers the
--    target again and the credit comes back.

-- ============================================================ catalog =======

-- The locked pack card (docs/MONEY.md §4). Integer cents, lowercase ISO
-- currency as Stripe reports it. A price change is a diff here and in
-- `frontend/lib/server/sms-packs.ts`, whose test asserts they agree.
create or replace function app.sms_pack_catalog(p_pack_id text)
returns table (segments bigint, price_cents bigint, currency text)
language sql
immutable
set search_path = ''
as $$
    select c.segments, c.price_cents, c.currency
      from (values
          ('pack_50',  50::bigint,  400::bigint,  'usd'),
          ('pack_200', 200::bigint, 1600::bigint, 'usd'),
          ('pack_500', 500::bigint, 4000::bigint, 'usd')
      ) as c (pack_id, segments, price_cents, currency)
     where c.pack_id = p_pack_id;
$$;

revoke all on function app.sms_pack_catalog(text) from public, anon, authenticated;

-- ============================================== grants can be clawed back ===

alter table public.sms_credit_grants
    add column if not exists revoked bigint not null default 0,
    add column if not exists clawback_target bigint not null default 0;

alter table public.sms_credit_grants
    drop constraint if exists sms_credit_grants_revoked_nonnegative,
    drop constraint if exists sms_credit_grants_clawback_bounds,
    drop constraint if exists sms_credit_grants_revoked_within_target,
    drop constraint if exists sms_credit_grants_not_overspent;

alter table public.sms_credit_grants
    add constraint sms_credit_grants_revoked_nonnegative check (revoked >= 0),
    add constraint sms_credit_grants_clawback_bounds
        check (clawback_target >= 0 and clawback_target <= segments),
    add constraint sms_credit_grants_revoked_within_target check (revoked <= clawback_target),
    -- The no-negative-balance rule, as a constraint rather than a hope: what
    -- was spent, what is in flight and what was taken back can never add up
    -- to more than the grant.
    add constraint sms_credit_grants_not_overspent
        check (consumed + reserved + revoked <= segments);

comment on column public.sms_credit_grants.clawback_target is
    'Segments a refund or dispute says should be taken back. Only unspent credit is ever revoked; the gap between this and `revoked` is credit already spent.';
comment on column public.sms_credit_grants.revoked is
    'Segments actually taken back. Never more than the target, never more than was unspent.';

-- Every write to a grant passes through here, so a reservation released back
-- to a refunded grant is revoked in the same statement that released it. That
-- is what stops "refund while the message is in flight, then the send fails"
-- from handing the credit back as free.
create or replace function app.sms_credit_grant_apply_clawback()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_free bigint;
    v_owed bigint;
begin
    -- A lowered target (a dispute won) gives revoked credit back.
    if new.revoked > new.clawback_target then
        new.revoked := new.clawback_target;
    end if;

    v_free := new.segments - new.consumed - new.reserved - new.revoked;
    v_owed := new.clawback_target - new.revoked;

    if v_owed > 0 and v_free > 0 then
        new.revoked := new.revoked + least(v_owed, v_free);
    end if;

    return new;
end;
$$;

revoke all on function app.sms_credit_grant_apply_clawback() from public, anon, authenticated;

drop trigger if exists sms_credit_grants_clawback on public.sms_credit_grants;
create trigger sms_credit_grants_clawback
    before insert or update on public.sms_credit_grants
    for each row execute function app.sms_credit_grant_apply_clawback();

-- ============================================ spendable excludes revoked ====

create or replace function app.sms_balance(p_org_id uuid)
returns table (monthly bigint, purchased bigint, total bigint)
language sql
stable
security definer
set search_path = ''
as $$
    with spendable as (
        select g.source, sum(g.segments - g.consumed - g.reserved - g.revoked) as available
          from public.sms_credit_grants g
         where g.org_id = p_org_id
           and (g.expires_at is null or g.expires_at > now())
         group by g.source
    )
    select
        coalesce((select available from spendable where source = 'monthly'), 0)::bigint,
        coalesce((select available from spendable where source = 'purchased'), 0)::bigint,
        coalesce((select sum(available) from spendable), 0)::bigint;
$$;

revoke all on function app.sms_balance(uuid) from public, anon, authenticated;

-- Re-emitted with one change: a grant's free credit is net of what was
-- revoked. Everything else is 20260915000800 verbatim.
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
    v_needed    bigint;
    v_take      bigint;
    v_grant     record;
begin
    perform app.sms_quota_lock_balance(p_org_id);

    if exists (
        select 1 from public.sms_reservation_slices s
         where s.org_id = p_org_id and s.correlation_key = p_correlation_key
    ) then
        return query select true, (select total from app.sms_balance(p_org_id));
        return;
    end if;

    select total into v_available from app.sms_balance(p_org_id);

    if p_amount is null or p_amount <= 0 then
        raise exception 'invalid_reserve_amount' using errcode = 'P0001';
    end if;

    if v_available < p_amount then
        return query select false, v_available;
        return;
    end if;

    v_needed := p_amount;

    for v_grant in
        select g.id, (g.segments - g.consumed - g.reserved - g.revoked) as available
          from public.sms_credit_grants g
         where g.org_id = p_org_id
           and (g.expires_at is null or g.expires_at > now())
           and (g.segments - g.consumed - g.reserved - g.revoked) > 0
         order by
            case g.source when 'monthly' then 0 else 1 end,
            g.expires_at asc nulls last,
            g.granted_at asc,
            g.id asc
           for update
    loop
        exit when v_needed <= 0;

        v_take := least(v_needed, v_grant.available);

        insert into public.sms_reservation_slices
            (org_id, correlation_key, grant_id, segments, status)
        values (p_org_id, p_correlation_key, v_grant.id, v_take, 'held');

        update public.sms_credit_grants g
           set reserved = g.reserved + v_take
         where g.id = v_grant.id;

        v_needed := v_needed - v_take;
    end loop;

    if v_needed > 0 then
        raise exception 'quota_slice_shortfall' using errcode = 'P0001';
    end if;

    insert into public.sms_quota_ledger (org_id, kind, amount, correlation_key, request_id)
    values (p_org_id, 'reservation', p_amount, p_correlation_key, p_request_id)
    on conflict (org_id, kind, correlation_key) do nothing;

    update public.sms_quota_balance b
       set reserved = b.reserved + p_amount, updated_at = now()
     where b.org_id = p_org_id;

    return query select true, (v_available - p_amount);
end;
$$;

revoke all on function app.sms_quota_reserve(uuid, bigint, text, uuid) from public, anon, authenticated;

-- ========================================================== purchases =======

create table if not exists public.sms_pack_purchases (
    id                       uuid primary key default gen_random_uuid(),
    org_id                   uuid not null references public.organizations (id) on delete cascade,
    payment_intent_id        text not null unique check (payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
    checkout_session_id      text unique check (checkout_session_id is null
                                                or checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'),
    pack_id                  text,
    segments                 bigint check (segments is null or segments > 0),
    amount_cents             bigint check (amount_cents is null or amount_cents > 0),
    currency                 text check (currency is null or currency ~ '^[a-z]{3}$'),
    paid_at                  timestamptz,
    grant_id                 uuid unique references public.sms_credit_grants (id) on delete set null,
    -- Why a paid pack has no credit. Null once it has.
    grant_failure            text check (grant_failure is null
                                         or grant_failure in ('unknown_pack', 'amount_mismatch')),
    -- Cumulative, as Stripe reports it on the charge. Only ever rises here:
    -- an older event carrying a smaller number must not un-refund anything.
    amount_refunded_cents    bigint not null default 0 check (amount_refunded_cents >= 0),
    dispute_id               text,
    dispute_status           text,
    dispute_event_at         timestamptz,
    -- Manual review: the spent-and-refunded segments an operator has accounted
    -- for. Review is open while the outstanding clawback exceeds this.
    review_resolved_segments bigint not null default 0 check (review_resolved_segments >= 0),
    review_resolution        text check (review_resolution is null
                                         or review_resolution in ('written_off', 'recovered_externally')),
    review_note              text check (review_note is null or char_length(review_note) <= 2000),
    review_resolved_at       timestamptz,
    last_event_id            text,
    created_at               timestamptz not null default now(),
    updated_at               timestamptz not null default now(),

    constraint sms_pack_purchases_paid_has_amount
        check (paid_at is null or (amount_cents is not null and currency is not null)),
    constraint sms_pack_purchases_grant_has_segments
        check (grant_id is null or segments is not null)
);

comment on table public.sms_pack_purchases is
    'One row per Stripe PaymentIntent for an SMS pack: what was bought, what was paid, what was refunded or disputed, and which grant it minted. The truth reconciliation compares Stripe against.';

create index if not exists sms_pack_purchases_org_idx on public.sms_pack_purchases (org_id, created_at desc);
create index if not exists sms_pack_purchases_ungranted_idx
    on public.sms_pack_purchases (paid_at) where grant_id is null;

alter table public.sms_pack_purchases enable row level security;
revoke all on public.sms_pack_purchases from public, anon, authenticated;

drop trigger if exists sms_pack_purchases_touch on public.sms_pack_purchases;
create trigger sms_pack_purchases_touch
    before update on public.sms_pack_purchases
    for each row execute function app.touch_updated_at();

-- ======================================================= the target =========

-- How many of a pack's segments should be taken back.
--
-- An open dispute takes all of them: the money has been pulled, and leaving
-- the credit spendable while the outcome is argued is exactly the free credit
-- this exists to prevent. A dispute status nobody recognises is treated as
-- open. A partial refund takes back its share, rounded UP — never leave a
-- fraction of a segment behind as free.
create or replace function app.sms_pack_clawback_target(
    p_segments       bigint,
    p_amount_cents   bigint,
    p_refunded_cents bigint,
    p_dispute_status text
)
returns bigint
language sql
immutable
set search_path = ''
as $$
    select case
        when p_segments is null then 0
        when p_dispute_status is not null
             and p_dispute_status not in ('won', 'warning_closed', 'prevented') then p_segments
        when coalesce(p_refunded_cents, 0) <= 0 then 0
        when p_amount_cents is null or p_refunded_cents >= p_amount_cents then p_segments
        else least(p_segments, (p_segments * p_refunded_cents + p_amount_cents - 1) / p_amount_cents)
    end::bigint;
$$;

revoke all on function app.sms_pack_clawback_target(bigint, bigint, bigint, text)
    from public, anon, authenticated;

-- Push a purchase's current target onto its grant. The caller holds the
-- org's balance lock. Returns the outstanding (spent or in-flight) segments.
create or replace function app.sms_pack_sync(p_purchase_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_p           public.sms_pack_purchases%rowtype;
    v_target      bigint;
    v_outstanding bigint;
    v_before      bigint;
begin
    select * into v_p from public.sms_pack_purchases where id = p_purchase_id for update;
    if v_p.id is null or v_p.grant_id is null then
        return 0;
    end if;

    v_target := app.sms_pack_clawback_target(
        v_p.segments, v_p.amount_cents, v_p.amount_refunded_cents, v_p.dispute_status);

    select g.clawback_target - g.revoked into v_before
      from public.sms_credit_grants g where g.id = v_p.grant_id for update;

    update public.sms_credit_grants g
       set clawback_target = least(v_target, g.segments)
     where g.id = v_p.grant_id
    returning g.clawback_target - g.revoked into v_outstanding;

    if coalesce(v_outstanding, 0) > coalesce(v_before, 0) then
        -- Credit that should come back could not, because it was already
        -- spent or is in flight. That is an accounting event, and it is
        -- written down where an owner's admin and an operator can both see it.
        insert into public.audit_events
            (org_id, actor_type, action, target_type, target_id, metadata)
        values
            (v_p.org_id, 'system', 'sms_pack.clawback_shortfall', 'sms_pack_purchase', v_p.id::text,
             jsonb_build_object('outstandingSegments', v_outstanding, 'targetSegments', v_target,
                                'paymentIntent', v_p.payment_intent_id));
    end if;

    return coalesce(v_outstanding, 0);
end;
$$;

revoke all on function app.sms_pack_sync(uuid) from public, anon, authenticated;

-- One purchase row per PaymentIntent, whichever event arrives first.
create or replace function app.sms_pack_row(p_org_id uuid, p_payment_intent_id text)
returns public.sms_pack_purchases
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_row public.sms_pack_purchases%rowtype;
begin
    insert into public.sms_pack_purchases (org_id, payment_intent_id)
    values (p_org_id, p_payment_intent_id)
    on conflict (payment_intent_id) do nothing;

    select * into v_row from public.sms_pack_purchases
     where payment_intent_id = p_payment_intent_id for update;

    if v_row.org_id <> p_org_id then
        -- A payment cannot move between businesses. Refuse loudly rather than
        -- grant or claw back against the wrong one.
        raise exception 'pack_org_mismatch' using errcode = 'P0001';
    end if;

    return v_row;
end;
$$;

revoke all on function app.sms_pack_row(uuid, text) from public, anon, authenticated;

-- ======================================================= the payment =======

-- A paid Checkout Session for a pack. Idempotent: a redelivery, a
-- reconciliation pass and the async-payment event for the same PaymentIntent
-- all produce one grant.
create or replace function public.rpc_billing_apply_pack_payment(
    p_org_id              uuid,
    p_payment_intent_id   text,
    p_checkout_session_id text,
    p_pack_id             text,
    p_amount_cents        bigint,
    p_currency            text,
    p_event_id            text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_row     public.sms_pack_purchases%rowtype;
    v_cat     record;
    v_grant   uuid;
    v_failure text;
begin
    perform app.sms_quota_lock_balance(p_org_id);
    v_row := app.sms_pack_row(p_org_id, p_payment_intent_id);

    if v_row.grant_id is not null then
        return 'duplicate';
    end if;

    -- The same refused payment seen again (a redelivery, the daily
    -- reconciliation) is the same finding, not a new one.
    if v_row.grant_failure is not null
       and v_row.pack_id is not distinct from p_pack_id
       and v_row.amount_cents is not distinct from p_amount_cents
       and v_row.currency is not distinct from lower(p_currency) then
        return v_row.grant_failure;
    end if;

    update public.sms_pack_purchases
       set checkout_session_id = coalesce(checkout_session_id, p_checkout_session_id),
           pack_id = p_pack_id,
           amount_cents = p_amount_cents,
           currency = lower(p_currency),
           paid_at = coalesce(paid_at, now()),
           last_event_id = p_event_id
     where id = v_row.id;

    select * into v_cat from app.sms_pack_catalog(p_pack_id);

    if v_cat.segments is null then
        v_failure := 'unknown_pack';
    elsif p_amount_cents is distinct from v_cat.price_cents
          or lower(coalesce(p_currency, '')) <> v_cat.currency then
        -- Money moved, but not the money this pack costs. Granting the pack
        -- anyway would sell it at whatever a misconfigured price says;
        -- granting nothing silently would keep a customer's money. Neither:
        -- it is recorded, surfaced by health and reconciliation, and a human
        -- decides.
        v_failure := 'amount_mismatch';
    end if;

    if v_failure is not null then
        update public.sms_pack_purchases set grant_failure = v_failure where id = v_row.id;
        insert into public.audit_events
            (org_id, actor_type, action, target_type, target_id, metadata)
        values
            (p_org_id, 'system', 'sms_pack.paid_without_credit', 'sms_pack_purchase', v_row.id::text,
             jsonb_build_object('reason', v_failure, 'packId', p_pack_id,
                                'amountCents', p_amount_cents, 'currency', p_currency));
        return v_failure;
    end if;

    v_grant := app.sms_grant_credits(
        p_org_id, 'purchased', v_cat.segments, 'purchase', p_payment_intent_id, null,
        'sms pack ' || p_pack_id);

    if v_grant is null then
        -- Minted earlier by the legacy purchase path under the same payment.
        select g.id into v_grant from public.sms_credit_grants g
         where g.org_id = p_org_id and g.origin_kind = 'purchase' and g.origin_id = p_payment_intent_id;
    end if;

    update public.sms_pack_purchases
       set segments = v_cat.segments, grant_id = v_grant, grant_failure = null
     where id = v_row.id;

    -- A refund or dispute that arrived before this payment applies now.
    perform app.sms_pack_sync(v_row.id);

    insert into public.audit_events
        (org_id, actor_type, action, target_type, target_id, metadata)
    values
        (p_org_id, 'system', 'sms_pack.granted', 'sms_pack_purchase', v_row.id::text,
         jsonb_build_object('packId', p_pack_id, 'segments', v_cat.segments));

    return 'granted';
end;
$$;

-- ======================================================= the refund ========

create or replace function public.rpc_billing_apply_pack_refund(
    p_org_id                uuid,
    p_payment_intent_id     text,
    p_charge_amount_cents   bigint,
    p_amount_refunded_cents bigint,
    p_event_id              text
)
returns table (outcome text, outstanding_segments bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_row public.sms_pack_purchases%rowtype;
    v_out bigint;
begin
    if p_amount_refunded_cents is null or p_amount_refunded_cents < 0 then
        raise exception 'invalid_refund_amount' using errcode = 'P0001';
    end if;

    perform app.sms_quota_lock_balance(p_org_id);
    v_row := app.sms_pack_row(p_org_id, p_payment_intent_id);

    update public.sms_pack_purchases
       set amount_refunded_cents = greatest(amount_refunded_cents, p_amount_refunded_cents),
           amount_cents = coalesce(amount_cents, p_charge_amount_cents),
           last_event_id = p_event_id
     where id = v_row.id;

    v_out := app.sms_pack_sync(v_row.id);

    insert into public.audit_events
        (org_id, actor_type, action, target_type, target_id, metadata)
    values
        (p_org_id, 'system', 'sms_pack.refund_recorded', 'sms_pack_purchase', v_row.id::text,
         jsonb_build_object('amountRefundedCents', p_amount_refunded_cents,
                            'outstandingSegments', v_out));

    return query select
        case when v_row.grant_id is null then 'recorded_before_grant' else 'applied' end,
        v_out;
end;
$$;

-- ======================================================= the dispute =======

create or replace function public.rpc_billing_apply_pack_dispute(
    p_org_id            uuid,
    p_payment_intent_id text,
    p_dispute_id        text,
    p_dispute_status    text,
    p_event_created     timestamptz,
    p_event_id          text
)
returns table (outcome text, outstanding_segments bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_row        public.sms_pack_purchases%rowtype;
    v_out        bigint;
    v_old_final  boolean;
    v_new_final  boolean;
begin
    if p_dispute_status is null or btrim(p_dispute_status) = '' then
        raise exception 'invalid_dispute_status' using errcode = 'P0001';
    end if;

    perform app.sms_quota_lock_balance(p_org_id);
    v_row := app.sms_pack_row(p_org_id, p_payment_intent_id);

    v_old_final := v_row.dispute_status in ('won', 'lost', 'warning_closed', 'prevented');
    v_new_final := p_dispute_status in ('won', 'lost', 'warning_closed', 'prevented');

    -- Out-of-order protection, same shape as subscriptions: an older event
    -- is discarded, and a late "needs_response" never reopens a closed
    -- dispute on the same id.
    if v_row.dispute_status is not null
       and (
            (v_row.dispute_event_at is not null and v_row.dispute_event_at > p_event_created)
            or (v_old_final and not v_new_final and v_row.dispute_id is not distinct from p_dispute_id)
       ) then
        return query select 'stale'::text,
            (select g.clawback_target - g.revoked from public.sms_credit_grants g where g.id = v_row.grant_id);
        return;
    end if;

    update public.sms_pack_purchases
       set dispute_id = p_dispute_id,
           dispute_status = p_dispute_status,
           dispute_event_at = p_event_created,
           last_event_id = p_event_id
     where id = v_row.id;

    v_out := app.sms_pack_sync(v_row.id);

    insert into public.audit_events
        (org_id, actor_type, action, target_type, target_id, metadata)
    values
        (p_org_id, 'system', 'sms_pack.dispute_recorded', 'sms_pack_purchase', v_row.id::text,
         jsonb_build_object('disputeStatus', p_dispute_status, 'outstandingSegments', v_out));

    return query select
        case when v_row.grant_id is null then 'recorded_before_grant' else 'applied' end,
        v_out;
end;
$$;

-- ================================================= is this purchase ours? ==

-- A dispute carries a charge and a PaymentIntent, not a customer. A pack
-- already recorded is found here; anything else is asked of Stripe.
create or replace function public.rpc_billing_pack_org(p_payment_intent_id text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
    select org_id from public.sms_pack_purchases where payment_intent_id = p_payment_intent_id;
$$;

-- ==================================================== the accounting view ===

-- Computed from the facts, so it cannot drift from them.
--
-- review_state:
--   none              nothing outstanding
--   pending_in_flight what is outstanding is still reserved by an unsettled
--                     send; it resolves itself (released → revoked, sent →
--                     needs_review)
--   needs_review      refunded or disputed credit that was already spent.
--                     Not a negative balance, and not silently forgiven: a
--                     number of segments waiting on a human decision
--   resolved          an operator accounted for it
create or replace view public.sms_pack_accounting
with (security_invoker = true)
as
select
    p.id                         as purchase_id,
    p.org_id,
    p.payment_intent_id,
    p.checkout_session_id,
    p.pack_id,
    p.segments,
    p.amount_cents,
    p.currency,
    p.paid_at,
    p.amount_refunded_cents,
    p.dispute_status,
    p.grant_id,
    p.grant_failure,
    coalesce(g.consumed, 0)      as consumed_segments,
    coalesce(g.reserved, 0)      as reserved_segments,
    coalesce(g.revoked, 0)       as revoked_segments,
    coalesce(g.clawback_target, 0) as clawback_target,
    coalesce(g.clawback_target - g.revoked, 0) as outstanding_segments,
    greatest(0, coalesce(g.clawback_target - g.revoked, 0) - coalesce(g.reserved, 0))
                                 as unrecoverable_segments,
    case
        when p.paid_at is null then 'awaiting_payment'
        when p.grant_id is null then 'paid_without_credit'
        when p.dispute_status = 'lost' then 'chargeback_lost'
        when p.dispute_status is not null
             and p.dispute_status not in ('won', 'warning_closed', 'prevented') then 'disputed'
        when p.amount_refunded_cents >= p.amount_cents then 'refunded'
        when p.amount_refunded_cents > 0 then 'partially_refunded'
        else 'granted'
    end                          as accounting_state,
    case
        when coalesce(g.clawback_target - g.revoked, 0) = 0 then 'none'
        when coalesce(g.clawback_target - g.revoked, 0) <= p.review_resolved_segments then 'resolved'
        when coalesce(g.clawback_target - g.revoked, 0) <= coalesce(g.reserved, 0) then 'pending_in_flight'
        else 'needs_review'
    end                          as review_state,
    p.review_resolution,
    p.review_resolved_segments,
    p.review_resolved_at,
    p.created_at,
    p.updated_at
  from public.sms_pack_purchases p
  left join public.sms_credit_grants g on g.id = p.grant_id;

revoke all on public.sms_pack_accounting from public, anon, authenticated;
grant select on public.sms_pack_accounting to service_role;

-- ===================================================== manual resolution ===

create or replace function public.rpc_billing_resolve_pack_review(
    p_purchase_id uuid,
    p_resolution  text,
    p_note        text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_org uuid;
    v_out bigint;
begin
    if p_resolution not in ('written_off', 'recovered_externally') then
        raise exception 'invalid_resolution' using errcode = 'P0001';
    end if;

    select p.org_id into v_org from public.sms_pack_purchases p where p.id = p_purchase_id;
    if v_org is null then
        raise exception 'not_found' using errcode = 'P0001';
    end if;

    perform app.sms_quota_lock_balance(v_org);

    select a.outstanding_segments into v_out
      from public.sms_pack_accounting a where a.purchase_id = p_purchase_id;

    update public.sms_pack_purchases
       set review_resolved_segments = v_out,
           review_resolution = p_resolution,
           review_note = p_note,
           review_resolved_at = now()
     where id = p_purchase_id;

    insert into public.audit_events
        (org_id, actor_type, action, target_type, target_id, metadata)
    values
        (v_org, 'service', 'sms_pack.review_resolved', 'sms_pack_purchase', p_purchase_id::text,
         jsonb_build_object('resolution', p_resolution, 'segments', v_out));

    return v_out;
end;
$$;

-- ========================================================= reconciliation ==

create table if not exists public.billing_reconciliation_runs (
    id           uuid primary key default gen_random_uuid(),
    kind         text not null check (kind in ('sms_packs')),
    started_at   timestamptz not null,
    finished_at  timestamptz not null default now(),
    ok           boolean not null,
    checked      integer not null default 0 check (checked >= 0),
    healed       integer not null default 0 check (healed >= 0),
    findings     integer not null default 0 check (findings >= 0),
    detail       jsonb not null default '{}'::jsonb
);

create index if not exists billing_reconciliation_runs_recent_idx
    on public.billing_reconciliation_runs (kind, finished_at desc);

alter table public.billing_reconciliation_runs enable row level security;
revoke all on public.billing_reconciliation_runs from public, anon, authenticated;

create or replace function public.rpc_billing_record_reconciliation_run(
    p_kind       text,
    p_started_at timestamptz,
    p_ok         boolean,
    p_checked    integer,
    p_healed     integer,
    p_findings   integer,
    p_detail     jsonb
)
returns uuid
language sql
security definer
set search_path = ''
as $$
    insert into public.billing_reconciliation_runs
        (kind, started_at, ok, checked, healed, findings, detail)
    values (p_kind, p_started_at, p_ok, greatest(p_checked, 0), greatest(p_healed, 0),
            greatest(p_findings, 0), coalesce(p_detail, '{}'::jsonb))
    returning id;
$$;

-- What the ledger says that it should not. Every row is something a human
-- should look at; an empty result is a reconciled ledger.
create or replace function public.rpc_billing_pack_reconciliation_findings()
returns table (kind text, purchase_id uuid, org_id uuid, detail jsonb)
language sql
stable
security definer
set search_path = ''
as $$
    -- Money taken, no credit given.
    select 'paid_without_credit'::text, a.purchase_id, a.org_id,
           jsonb_build_object('reason', coalesce(a.grant_failure, 'not_granted'),
                              'paymentIntent', a.payment_intent_id,
                              'paidAt', a.paid_at)
      from public.sms_pack_accounting a
     where a.accounting_state = 'paid_without_credit'
    union all
    -- The grant does not match what was sold.
    select 'grant_mismatch', p.id, p.org_id,
           jsonb_build_object('purchaseSegments', p.segments, 'grantSegments', g.segments)
      from public.sms_pack_purchases p
      join public.sms_credit_grants g on g.id = p.grant_id
     where g.segments is distinct from p.segments
        or g.source <> 'purchased'
        or g.org_id <> p.org_id
    union all
    -- Purchased credit with no purchase behind it.
    select 'grant_without_purchase', null::uuid, g.org_id,
           jsonb_build_object('grantId', g.id, 'originId', g.origin_id, 'segments', g.segments)
      from public.sms_credit_grants g
     where g.origin_kind = 'purchase'
       and not exists (select 1 from public.sms_pack_purchases p where p.grant_id = g.id)
    union all
    -- A refund or dispute for a payment nobody has seen succeed.
    select 'refund_without_payment', p.id, p.org_id,
           jsonb_build_object('paymentIntent', p.payment_intent_id,
                              'refundedCents', p.amount_refunded_cents,
                              'disputeStatus', p.dispute_status)
      from public.sms_pack_purchases p
     where p.paid_at is null
       and p.created_at < now() - interval '1 day'
    union all
    -- Should be impossible: owed credit that is sitting unspent.
    select 'clawback_unapplied', p.id, p.org_id,
           jsonb_build_object('owed', g.clawback_target - g.revoked,
                              'free', g.segments - g.consumed - g.reserved - g.revoked)
      from public.sms_pack_purchases p
      join public.sms_credit_grants g on g.id = p.grant_id
     where g.clawback_target > g.revoked
       and g.segments - g.consumed - g.reserved - g.revoked > 0
    union all
    -- Spent credit that was refunded, waiting on a decision.
    select 'needs_review', a.purchase_id, a.org_id,
           jsonb_build_object('segments', a.unrecoverable_segments,
                              'accountingState', a.accounting_state)
      from public.sms_pack_accounting a
     where a.review_state = 'needs_review';
$$;

-- ============================================================ health =======

-- Everything an operator needs to know is wrong, in one read. Counts, ages
-- and ids of nothing: no phone number, no body, no organization.
create or replace function public.rpc_ops_health()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'dispatch', jsonb_build_object(
            'duePending', (select count(*) from public.sms_outbox
                            where status = 'pending' and available_at <= now()),
            'oldestDueAgeSeconds', (select coalesce(extract(epoch from now() - min(available_at))::bigint, 0)
                                      from public.sms_outbox
                                     where status = 'pending' and available_at <= now()),
            'expiredLeases', (select count(*) from public.sms_outbox
                               where status = 'leased' and leased_until < now() - interval '1 minute'),
            'stuckSending', (select count(*) from public.text_requests
                              where status = 'sending' and sent_at < now() - interval '10 minutes')
        ),
        'deadLetters', jsonb_build_object(
            'total', (select count(*) from public.sms_outbox where status = 'dead_letter'),
            'last24h', (select count(*) from public.sms_outbox
                         where status = 'dead_letter' and updated_at > now() - interval '24 hours'),
            'unreleased', (select count(*)
                             from public.sms_outbox o
                             join public.text_requests tr on tr.id = o.request_id
                            where o.status = 'dead_letter'
                              and tr.status in ('queued', 'sending')
                              and coalesce(tr.reserved_quota, 0) > 0)
        ),
        'providerUnknown', jsonb_build_object(
            'count', (select count(*) from public.sms_delivery_attempts
                       where status = 'provider_unknown' and reconciliation_state = 'unresolved'),
            'oldestAgeSeconds', (select coalesce(extract(epoch from now() - min(settled_at))::bigint, 0)
                                   from public.sms_delivery_attempts
                                  where status = 'provider_unknown' and reconciliation_state = 'unresolved')
        ),
        'smsWebhooks', jsonb_build_object(
            'failed', (select count(*) from public.sms_webhook_inbox
                        where signature_verified and status = 'failed' and processed_at is null),
            'stuck', (select count(*) from public.sms_webhook_inbox
                       where signature_verified and processed_at is null
                         and status in ('received', 'processing')
                         and received_at < now() - interval '5 minutes'),
            'unverifiedLastHour', (select count(*) from public.sms_webhook_inbox
                                    where not signature_verified
                                      and received_at > now() - interval '1 hour')
        ),
        'stripeWebhooks', jsonb_build_object(
            'unprocessed', (select count(*) from public.stripe_webhook_events where processed_at is null),
            'oldestUnprocessedAgeSeconds', (select coalesce(extract(epoch from now() - min(received_at))::bigint, 0)
                                              from public.stripe_webhook_events where processed_at is null)
        ),
        'packs', jsonb_build_object(
            'paidWithoutCredit', (select count(*) from public.sms_pack_accounting
                                   where accounting_state = 'paid_without_credit'),
            'needsReview', (select count(*) from public.sms_pack_accounting
                             where review_state = 'needs_review'),
            'needsReviewSegments', (select coalesce(sum(unrecoverable_segments), 0) from public.sms_pack_accounting
                                     where review_state = 'needs_review'),
            'refundWithoutPayment', (select count(*) from public.sms_pack_purchases
                                      where paid_at is null and created_at < now() - interval '1 day')
        ),
        'reconciliation', jsonb_build_object(
            'lastRunAt', (select max(finished_at) from public.billing_reconciliation_runs where kind = 'sms_packs'),
            'lastOkAt', (select max(finished_at) from public.billing_reconciliation_runs
                          where kind = 'sms_packs' and ok),
            'lastFindings', (select r.findings from public.billing_reconciliation_runs r
                              where r.kind = 'sms_packs' order by r.finished_at desc limit 1),
            'lastHealed', (select r.healed from public.billing_reconciliation_runs r
                            where r.kind = 'sms_packs' order by r.finished_at desc limit 1)
        )
    );
$$;

-- ============================================================= grants ======

-- The legacy mint had no purchase record behind it: credit from nowhere, as
-- far as reconciliation can tell. It stays for history and for tests run as
-- the database owner; the service role now buys packs only through the path
-- that records what was paid.
revoke all on function public.rpc_billing_apply_credit_purchase(uuid, text, bigint)
    from public, anon, authenticated, service_role;

do $$
declare
    fn text;
begin
    foreach fn in array array[
        'public.rpc_billing_apply_pack_payment(uuid, text, text, text, bigint, text, text)',
        'public.rpc_billing_apply_pack_refund(uuid, text, bigint, bigint, text)',
        'public.rpc_billing_apply_pack_dispute(uuid, text, text, text, timestamptz, text)',
        'public.rpc_billing_pack_org(text)',
        'public.rpc_billing_resolve_pack_review(uuid, text, text)',
        'public.rpc_billing_record_reconciliation_run(text, timestamptz, boolean, integer, integer, integer, jsonb)',
        'public.rpc_billing_pack_reconciliation_findings()',
        'public.rpc_ops_health()'
    ]
    loop
        execute format('revoke all on function %s from public, anon, authenticated;', fn);
        execute format('grant execute on function %s to service_role;', fn);
    end loop;
end $$;
