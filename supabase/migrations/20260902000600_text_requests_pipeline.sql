-- ReviewBoost Text Requests — pipeline orchestration
--
-- Wires the tables together into the send lifecycle. Business state and the
-- outbox job that will act on it are always committed in the same transaction,
-- quota is reserved when a request is scheduled and only consumed once it is
-- actually handed to a provider, and the pre-send gate runs again immediately
-- before dispatch — not only when the request was created.
--
-- The provider call itself is not here: it is Node code that runs between
-- `sms_begin_dispatch` (prepare the attempt) and `sms_settle_attempt` (record
-- what the provider said). SQL owns the durable state; the network call does not.

-- ------------------------------------------- schedule (definer) -----------

-- Create a Text Request and its dispatch job atomically, reserving quota.
--
-- Dedupe: unique (org_id, dedupe_key). A repeated schedule with the same key
-- returns the existing request and does nothing else — no second reservation,
-- no second outbox job.
create or replace function app.sms_schedule_request(
    p_org_id            uuid,
    p_location_id       uuid,
    p_stand_id          uuid,
    p_phone_hash        text,
    p_phone_encrypted   text,
    p_phone_key_version smallint,
    p_last_four         text,
    p_message_encrypted text,
    p_message_key_version smallint,
    p_encoding          text,
    p_unit_count        integer,
    p_segments          integer,
    p_cost_micros       bigint,
    p_cost_currency     char(3),
    p_timezone          text,
    p_scheduled_for     timestamptz,
    p_dedupe_key        text,
    p_created_by        uuid,
    p_request_id        text
)
returns table (request_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id       uuid;
    v_reserved boolean;
begin
    insert into public.text_requests
        (org_id, location_id, stand_id, recipient_phone_hash, recipient_phone_encrypted,
         recipient_phone_key_version, recipient_last_four, message_encrypted, message_key_version,
         encoding, unit_count, segments, estimated_cost_micros, cost_currency,
         recipient_timezone, scheduled_for, reserved_quota, dedupe_key, created_by, request_id)
    values
        (p_org_id, p_location_id, p_stand_id, p_phone_hash, p_phone_encrypted,
         coalesce(p_phone_key_version, 1), p_last_four, p_message_encrypted, coalesce(p_message_key_version, 1),
         p_encoding, p_unit_count, p_segments, coalesce(p_cost_micros, 0), coalesce(p_cost_currency, 'USD'),
         coalesce(p_timezone, 'UTC'), coalesce(p_scheduled_for, now()), p_segments, p_dedupe_key,
         p_created_by, p_request_id)
    on conflict (org_id, dedupe_key) do nothing
    returning id into v_id;

    if v_id is null then
        -- Dedupe hit: return the existing request, unchanged.
        select tr.id into v_id from public.text_requests tr
         where tr.org_id = p_org_id and tr.dedupe_key = p_dedupe_key;
        return query select v_id, false;
        return;
    end if;

    -- Reserve one unit per segment. Insufficient quota fails the whole
    -- transaction, so no request is left half-scheduled with no budget.
    select r.reserved into v_reserved
      from app.sms_quota_reserve(p_org_id, p_segments::bigint, 'req:' || v_id::text, v_id) r;

    if not v_reserved then
        raise exception 'quota_exhausted' using errcode = 'P0001';
    end if;

    insert into public.sms_outbox (org_id, topic, request_id, idempotency_key, payload, available_at)
    values (p_org_id, 'sms.dispatch', v_id, 'dispatch:' || v_id::text,
            jsonb_build_object('requestId', v_id), coalesce(p_scheduled_for, now()));

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
    values
        (p_org_id, p_created_by, case when p_created_by is null then 'system' else 'user' end,
         'text_request.scheduled', 'text_request', v_id::text, p_request_id,
         jsonb_build_object('segments', p_segments, 'encoding', p_encoding));

    return query select v_id, true;
end;
$$;

-- ------------------------------------------- begin dispatch (definer) -----

-- The final pre-send gate, immediately before the provider call. It:
--   * recovers a request stranded in 'sending' (a worker crashed after an
--     attempt was opened but before it settled, and the outbox lease expired):
--     the open attempt and the request move to 'provider_unknown' — the durable
--     "we do not know if it went out" state that reconciliation resolves — never
--     a silent re-send and never a permanent 'sending';
--   * re-checks consent + suppression; if blocked, moves the request to
--     'suppressed', releases the reservation, opens no attempt;
--   * re-checks quiet hours in the recipient's zone (a delayed worker run must
--     not deliver a due job overnight): if now is outside the window it returns
--     'deferred' with the next permitted instant, changing no state;
--   * otherwise moves the request into 'sending' and opens exactly one attempt
--     (the partial unique index guarantees no concurrent second attempt).
--
-- Quiet-hours window is [09:00, 20:00) local, matching DEFAULT_QUIET_HOURS.
create or replace function app.sms_begin_dispatch(
    p_request_id uuid,
    p_org_id     uuid,
    p_provider   text
)
returns table (
    outcome text, attempt_id uuid, attempt_number integer,
    message_encrypted text, message_key_version smallint,
    phone_encrypted text, phone_key_version smallint,
    defer_until timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_req        public.text_requests%rowtype;
    v_gate       record;
    v_next       integer;
    v_attempt    uuid;
    v_stranded   uuid;
    v_tz         text;
    v_local      timestamp;
    v_hour       integer;
    v_target     timestamp;
    v_defer      timestamptz;
    c_open_start constant integer := 9;
    c_open_end   constant integer := 20;
begin
    select * into v_req from public.text_requests tr
     where tr.id = p_request_id and tr.org_id = p_org_id for update;

    if v_req.id is null then
        return query select 'not_found'::text, null::uuid, null::integer, null::text, null::smallint, null::text, null::smallint, null::timestamptz;
        return;
    end if;

    -- Stranded in 'sending': the prior worker never settled and its lease
    -- expired (else this job would not have been re-claimed). We cannot know
    -- whether the provider was reached, so park it as provider_unknown for
    -- reconciliation rather than re-sending or leaving it stuck forever.
    if v_req.status = 'sending' then
        update public.sms_delivery_attempts a
           set status = 'provider_unknown',
               error_class = coalesce(a.error_class, 'worker_lost'),
               reconciliation_state = 'unresolved',
               settled_at = coalesce(a.settled_at, now())
         where a.org_id = p_org_id and a.request_id = p_request_id
           and a.status in ('created', 'dispatched')
        returning a.id into v_stranded;

        update public.text_requests tr set status = 'provider_unknown'
         where tr.id = p_request_id;

        insert into public.audit_events
            (org_id, actor_type, action, target_type, target_id, metadata)
        values
            (p_org_id, 'system', 'text_request.recovered_unknown', 'text_request', p_request_id::text,
             jsonb_build_object('attempt_id', v_stranded));

        return query select 'recovered_unknown'::text, null::uuid, null::integer, null::text, null::smallint, null::text, null::smallint, null::timestamptz;
        return;
    end if;

    -- Any other non-startable status: idempotent no-op for a redelivered job.
    if v_req.status not in ('scheduled', 'queued') then
        return query select ('already_' || v_req.status)::text, null::uuid, null::integer, null::text, null::smallint, null::text, null::smallint, null::timestamptz;
        return;
    end if;

    select g.allowed, g.reason into v_gate
      from app.sms_can_send(p_org_id, v_req.recipient_phone_hash, v_req.purpose) g;

    if not v_gate.allowed then
        update public.text_requests tr
           set status = 'suppressed', suppressed_reason = v_gate.reason, suppressed_at = now()
         where tr.id = p_request_id;

        -- The reservation will never be sent; return it to the pool.
        perform app.sms_quota_release(p_org_id, v_req.reserved_quota::bigint, 'req:' || p_request_id::text, p_request_id);

        insert into public.audit_events
            (org_id, actor_type, action, target_type, target_id, metadata)
        values
            (p_org_id, 'system', 'text_request.suppressed', 'text_request', p_request_id::text,
             jsonb_build_object('reason', v_gate.reason));

        return query select 'suppressed'::text, null::uuid, null::integer, null::text, null::smallint, null::text, null::smallint, null::timestamptz;
        return;
    end if;

    -- Quiet-hours recheck in the recipient's zone. A bad zone falls back to UTC
    -- rather than raising.
    v_tz := coalesce(v_req.recipient_timezone, 'UTC');
    begin
        v_local := now() at time zone v_tz;
    exception when others then
        v_tz := 'UTC';
        v_local := now() at time zone 'UTC';
    end;
    v_hour := extract(hour from v_local)::integer;

    if v_hour < c_open_start or v_hour >= c_open_end then
        if v_hour < c_open_start then
            v_target := date_trunc('day', v_local) + make_interval(hours => c_open_start);
        else
            v_target := date_trunc('day', v_local) + interval '1 day' + make_interval(hours => c_open_start);
        end if;
        -- Interpret the target wall-clock in the recipient's zone (DST-correct).
        v_defer := v_target at time zone v_tz;
        return query select 'deferred'::text, null::uuid, null::integer, null::text, null::smallint, null::text, null::smallint, v_defer;
        return;
    end if;

    -- scheduled -> queued -> sending, both edges valid.
    if v_req.status = 'scheduled' then
        update public.text_requests tr set status = 'queued' where tr.id = p_request_id;
    end if;
    update public.text_requests tr set status = 'sending', sent_at = coalesce(tr.sent_at, now())
     where tr.id = p_request_id;

    select coalesce(max(a.attempt_number), 0) + 1 into v_next
      from public.sms_delivery_attempts a
     where a.org_id = p_org_id and a.request_id = p_request_id;

    insert into public.sms_delivery_attempts
        (org_id, request_id, attempt_number, provider, status, dispatched_at)
    values
        (p_org_id, p_request_id, v_next, p_provider, 'created', now())
    returning id into v_attempt;

    return query select 'sending'::text, v_attempt, v_next,
                        v_req.message_encrypted, v_req.message_key_version,
                        v_req.recipient_phone_encrypted, v_req.recipient_phone_key_version,
                        null::timestamptz;
end;
$$;

-- ------------------------------------------- settle attempt (definer) -----

-- Record the provider's immediate response to a dispatch.
--   'submitted'        -> provider accepted; consume the reservation.
--   'failed'           -> provider rejected; release the reservation (no charge).
--   'provider_unknown' -> we never learned; keep the reservation and mark the
--                         attempt unresolved. Never auto-retried here.
create or replace function app.sms_settle_attempt(
    p_attempt_id        uuid,
    p_org_id            uuid,
    p_outcome           text,
    p_provider_message_id text,
    p_error_class       text,
    p_provider_response jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_attempt public.sms_delivery_attempts%rowtype;
    v_req     public.text_requests%rowtype;
    v_req_id  uuid;
    v_reserved integer;
begin
    select * into v_attempt from public.sms_delivery_attempts a
     where a.id = p_attempt_id and a.org_id = p_org_id for update;
    if v_attempt.id is null then
        return 'not_found';
    end if;

    -- Idempotency: an attempt that has already reached a terminal provider
    -- outcome must not be settled a second time (a redelivered settle call must
    -- not re-consume or re-release quota).
    if v_attempt.status not in ('created', 'dispatched') then
        return 'already_settled';
    end if;

    v_req_id := v_attempt.request_id;
    select * into v_req from public.text_requests tr where tr.id = v_req_id;
    v_reserved := v_req.reserved_quota;

    if p_outcome = 'submitted' then
        update public.sms_delivery_attempts a
           set status = 'submitted', provider_message_id = p_provider_message_id,
               provider_response = coalesce(p_provider_response, '{}'::jsonb),
               reconciliation_state = 'reconciled', settled_at = now()
         where a.id = p_attempt_id;
        update public.text_requests tr set status = 'submitted' where tr.id = v_req_id and tr.status = 'sending';
        perform app.sms_quota_consume(p_org_id, v_reserved::bigint, 'req:' || v_req_id::text, v_req_id);

        -- A durable, rolling send guard: suppress further review-request texts to
        -- this recipient for the dedupe window. This closes the fixed-UTC-bucket
        -- boundary gap in the application dedupe key with a database-backed
        -- window, and expresses "don't text the same person twice this window"
        -- as data rather than application memory.
        perform app.sms_add_suppression(
            p_org_id, v_req.recipient_phone_hash, v_req.purpose, 'recent_send',
            now() + interval '24 hours',
            jsonb_build_object('request_id', v_req_id));

    elsif p_outcome = 'failed' then
        update public.sms_delivery_attempts a
           set status = 'failed', error_class = p_error_class,
               provider_response = coalesce(p_provider_response, '{}'::jsonb),
               reconciliation_state = 'reconciled', settled_at = now()
         where a.id = p_attempt_id;
        update public.text_requests tr set status = 'failed', failed_at = now()
         where tr.id = v_req_id and tr.status = 'sending';
        perform app.sms_quota_release(p_org_id, v_reserved::bigint, 'req:' || v_req_id::text, v_req_id);

    elsif p_outcome = 'provider_unknown' then
        -- The submit request timed out after we sent it: we do not know whether
        -- the provider accepted it. Do NOT retry (that risks a double send) and
        -- do NOT release or consume quota — the outcome is genuinely unknown.
        update public.sms_delivery_attempts a
           set status = 'provider_unknown', error_class = coalesce(p_error_class, 'timeout'),
               provider_response = coalesce(p_provider_response, '{}'::jsonb),
               reconciliation_state = 'unresolved', settled_at = now()
         where a.id = p_attempt_id;
        update public.text_requests tr set status = 'provider_unknown'
         where tr.id = v_req_id and tr.status = 'sending';
    else
        return 'invalid_outcome';
    end if;

    return p_outcome;
end;
$$;

-- ----------------------------------- apply delivery status (webhook) ------

-- A provider delivery receipt (or reconciliation poll) resolves a submitted or
-- unknown request to its terminal state. Idempotent: applying 'delivered' twice
-- is harmless because the transition guard rejects the second.
create or replace function app.sms_apply_delivery_status(
    p_provider   text,
    p_provider_message_id text,
    p_terminal   text,          -- 'delivered' | 'failed'
    p_error_class text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_attempt public.sms_delivery_attempts%rowtype;
    v_req     public.text_requests%rowtype;
    p_org_id  uuid;
begin
    -- A provider message id is unique per provider, so the org is derived from
    -- the matched attempt: a delivery receipt carries no tenant of its own.
    select * into v_attempt from public.sms_delivery_attempts a
     where a.provider = p_provider
       and a.provider_message_id = p_provider_message_id
     order by a.attempt_number desc limit 1;
    if v_attempt.id is null then
        return 'no_matching_attempt';
    end if;
    p_org_id := v_attempt.org_id;

    select * into v_req from public.text_requests tr where tr.id = v_attempt.request_id for update;

    if p_terminal = 'delivered' then
        if app.sms_request_transition_allowed(v_req.status, 'delivered') then
            update public.text_requests tr set status = 'delivered', delivered_at = now() where tr.id = v_req.id;
            update public.sms_delivery_attempts a
               set status = 'delivered', reconciliation_state = 'reconciled', settled_at = now()
             where a.id = v_attempt.id;
            -- If this resolves a previously-unknown attempt, the message did go
            -- out: consume the still-held reservation now.
            if v_req.status = 'provider_unknown' then
                perform app.sms_quota_consume(p_org_id, v_req.reserved_quota::bigint, 'req:' || v_req.id::text, v_req.id);
            end if;
            return 'delivered';
        end if;
        return 'ignored';
    elsif p_terminal = 'failed' then
        if app.sms_request_transition_allowed(v_req.status, 'failed') then
            update public.text_requests tr set status = 'failed', failed_at = now() where tr.id = v_req.id;
            update public.sms_delivery_attempts a
               set status = 'failed', error_class = coalesce(p_error_class, a.error_class),
                   reconciliation_state = 'reconciled', settled_at = now()
             where a.id = v_attempt.id;
            -- Refund if we had already consumed (submitted then later failed);
            -- release if it was still only reserved (unknown then failed).
            if v_req.status = 'submitted' then
                perform app.sms_quota_refund(p_org_id, v_req.reserved_quota::bigint, 'req:' || v_req.id::text, v_req.id);
            else
                perform app.sms_quota_release(p_org_id, v_req.reserved_quota::bigint, 'req:' || v_req.id::text, v_req.id);
            end if;
            return 'failed';
        end if;
        return 'ignored';
    end if;

    return 'invalid_terminal';
end;
$$;

-- ------------------------------------------- cancel (definer) -------------

-- Cancel a request that has not yet been dispatched. Releases the reservation
-- and marks the outbox job done so no worker acts on it.
create or replace function app.sms_cancel_request(
    p_request_id uuid,
    p_org_id     uuid,
    p_actor      uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_req public.text_requests%rowtype;
begin
    select * into v_req from public.text_requests tr
     where tr.id = p_request_id and tr.org_id = p_org_id for update;
    if v_req.id is null then
        return false;
    end if;
    if v_req.status not in ('scheduled', 'queued') then
        return false; -- too late to cancel; already sending or terminal
    end if;

    update public.text_requests tr set status = 'cancelled', cancelled_at = now() where tr.id = p_request_id;
    perform app.sms_quota_release(p_org_id, v_req.reserved_quota::bigint, 'req:' || p_request_id::text, p_request_id);
    update public.sms_outbox o set status = 'done', updated_at = now()
     where o.org_id = p_org_id and o.request_id = p_request_id and o.status in ('pending', 'leased');

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (p_org_id, p_actor, case when p_actor is null then 'system' else 'user' end,
         'text_request.cancelled', 'text_request', p_request_id::text, '{}'::jsonb);
    return true;
end;
$$;

-- ------------------------------ completed-flow dedupe (definer) ------------

-- Record that a recipient completed the rating flow, and suppress further
-- review-request texts to them for the dedupe window. Marks recent matching
-- requests completed for reporting.
create or replace function app.sms_mark_flow_completed(
    p_org_id        uuid,
    p_phone_hash    text,
    p_purpose       public.sms_consent_purpose,
    p_window_seconds integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform app.sms_add_suppression(
        p_org_id, p_phone_hash, p_purpose, 'completed_flow',
        now() + make_interval(secs => greatest(1, p_window_seconds)),
        jsonb_build_object('source', 'rating_flow'));

    update public.text_requests tr
       set completed_at = coalesce(tr.completed_at, now())
     where tr.org_id = p_org_id
       and tr.recipient_phone_hash = p_phone_hash
       and tr.purpose = p_purpose
       and tr.created_at >= now() - make_interval(secs => greatest(1, p_window_seconds));
end;
$$;

-- ------------------------------ inbound keyword (definer) -----------------

-- Apply an inbound STOP / START / HELP to every organization that has a consent
-- relationship with this number. A STOP a customer sends is not scoped to one
-- business in their mind, so it opts them out everywhere they are known and
-- suppresses future sends; START restores permission only where it had been
-- taken away by a stop, and re-opts them in; HELP changes no consent at all.
--
-- Idempotent: re-applying the same inbound keyword records no new state, so a
-- duplicate provider webhook is harmless.
create or replace function app.sms_apply_inbound_keyword(
    p_phone_hash text,
    p_intent     text,          -- 'stop' | 'start' | 'help'
    p_evidence   jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    r          record;
    v_count    integer := 0;
begin
    if p_intent = 'help' then
        return 0; -- HELP never alters consent.
    end if;

    for r in
        select distinct s.org_id, s.purpose, s.phone_encrypted, s.phone_key_version, s.phone_last_four
          from public.sms_consent_state s
         where s.phone_hash = p_phone_hash
    loop
        if p_intent = 'stop' then
            perform app.sms_record_consent(
                r.org_id, p_phone_hash, r.phone_encrypted, r.phone_key_version, r.phone_last_four,
                r.purpose, 'opted_out', 'reply_stop', null, coalesce(p_evidence, '{}'::jsonb), now());
            perform app.sms_add_suppression(r.org_id, p_phone_hash, r.purpose, 'stop_keyword', null,
                coalesce(p_evidence, '{}'::jsonb));
            v_count := v_count + 1;
        elsif p_intent = 'start' then
            perform app.sms_record_consent(
                r.org_id, p_phone_hash, r.phone_encrypted, r.phone_key_version, r.phone_last_four,
                r.purpose, 'opted_in', 'reply_start', null, coalesce(p_evidence, '{}'::jsonb), now());
            -- START only lifts the customer's own stop, never a compliance or
            -- hard-bounce suppression a business must keep.
            perform app.sms_remove_suppression(r.org_id, p_phone_hash, r.purpose, 'stop_keyword');
            perform app.sms_remove_suppression(r.org_id, p_phone_hash, r.purpose, 'opt_out');
            v_count := v_count + 1;
        end if;
    end loop;

    return v_count;
end;
$$;

-- ------------------------------------------- owner rpc wrappers ------------

-- Schedule a Text Request on behalf of an owner/admin. This runs as the service
-- role only: the segment count drives quota reservation and the actual message
-- length, so it must come from the server's own computation over the plaintext
-- body, never from a value an authenticated client could forge by invoking the
-- RPC directly. The Node service authenticates the caller, computes segments
-- from the true body, and passes the acting user as p_actor_user; this wrapper
-- re-verifies that user's membership and role (defence in depth) and the stand's
-- ownership before delegating. All PII is hashed and encrypted before it arrives.
create or replace function public.rpc_schedule_text_request(
    p_org_id            uuid,
    p_actor_user        uuid,
    p_location_id       uuid,
    p_stand_id          uuid,
    p_phone_hash        text,
    p_phone_encrypted   text,
    p_phone_key_version smallint,
    p_last_four         text,
    p_message_encrypted text,
    p_message_key_version smallint,
    p_encoding          text,
    p_unit_count        integer,
    p_segments          integer,
    p_cost_micros       bigint,
    p_cost_currency     char(3),
    p_timezone          text,
    p_scheduled_for     timestamptz,
    p_dedupe_key        text,
    p_request_id        text default null
)
returns table (request_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_role text;
begin
    if p_actor_user is null then
        raise exception 'not_authenticated' using errcode = 'P0001';
    end if;

    select om.role into v_role from public.organization_members om
     where om.org_id = p_org_id and om.user_id = p_actor_user and om.status = 'active';
    if v_role is null or v_role not in ('owner', 'admin') then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    -- Verify the stand belongs to this org (composite FK also enforces it).
    if not exists (
        select 1 from public.review_stands s
         where s.id = p_stand_id and s.org_id = p_org_id and s.location_id = p_location_id
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    return query
    select * from app.sms_schedule_request(
        p_org_id, p_location_id, p_stand_id, p_phone_hash, p_phone_encrypted,
        p_phone_key_version, p_last_four, p_message_encrypted, p_message_key_version,
        p_encoding, p_unit_count, p_segments, p_cost_micros, p_cost_currency,
        p_timezone, p_scheduled_for, p_dedupe_key, p_actor_user, p_request_id);
end;
$$;

create or replace function public.rpc_cancel_text_request(
    p_org_id     uuid,
    p_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user uuid;
    v_role text;
begin
    v_user := auth.uid();
    if v_user is null then
        raise exception 'not_authenticated' using errcode = 'P0001';
    end if;
    select om.role into v_role from public.organization_members om
     where om.org_id = p_org_id and om.user_id = v_user and om.status = 'active';
    if v_role is null or v_role not in ('owner', 'admin') then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    return app.sms_cancel_request(p_request_id, p_org_id, v_user);
end;
$$;

-- -------------------------------------------------------- grants ----------

do $$
declare
    fn text;
begin
    foreach fn in array array[
        'app.sms_schedule_request(uuid, uuid, uuid, text, text, smallint, text, text, smallint, text, integer, integer, bigint, char, text, timestamptz, text, uuid, text)',
        'app.sms_begin_dispatch(uuid, uuid, text)',
        'app.sms_settle_attempt(uuid, uuid, text, text, text, jsonb)',
        'app.sms_apply_delivery_status(text, text, text, text)',
        'app.sms_apply_inbound_keyword(text, text, jsonb)',
        'app.sms_cancel_request(uuid, uuid, uuid)',
        'app.sms_mark_flow_completed(uuid, text, public.sms_consent_purpose, integer)'
    ]
    loop
        execute format('revoke all on function %s from public, anon, authenticated;', fn);
        execute format('grant execute on function %s to service_role;', fn);
    end loop;
end $$;

-- Service-role only: an authenticated client must not be able to invoke this
-- directly with a forged segment count (which would under-reserve quota for a
-- multi-segment send). The Node service calls it with the service-role key after
-- authenticating the owner/admin and computing segments from the true body.
revoke all on function public.rpc_schedule_text_request(
    uuid, uuid, uuid, uuid, text, text, smallint, text, text, smallint, text, integer, integer, bigint, char, text, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.rpc_schedule_text_request(
    uuid, uuid, uuid, uuid, text, text, smallint, text, text, smallint, text, integer, integer, bigint, char, text, timestamptz, text, text
) to service_role;

revoke all on function public.rpc_cancel_text_request(uuid, uuid) from public, anon;
grant execute on function public.rpc_cancel_text_request(uuid, uuid) to authenticated, service_role;
