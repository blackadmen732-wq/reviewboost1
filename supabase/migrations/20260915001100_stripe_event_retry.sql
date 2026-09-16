-- A Stripe event that failed once must be able to succeed later.
--
-- The inbox was keyed on Stripe's event id so that a redelivery could not
-- apply the same event twice. It did that. What it also did was refuse the
-- retry: the row existed, so the second delivery was called a duplicate and
-- answered 200, whether or not the first attempt had ever finished.
--
-- Stripe retries a webhook for days precisely so a transient failure — a
-- database blip, a customer row that had not yet been linked — does not cost
-- the event. Nothing else in this system reprocesses that row: there is no
-- sweeper over `stripe_webhook_events`. So one unlucky second was enough to
-- lose a subscription change or a month's SMS allowance permanently, and the
-- only evidence was a row with `processed_at` still null.
--
-- A delivery is a duplicate when the event has been *processed*. Until then
-- it is a retry, and it runs. That is safe because every handler is
-- idempotent at the database: the subscription apply is ordered by Stripe's
-- own event timestamps, and a monthly grant is unique on the invoice that
-- minted it. Concurrent redeliveries of the same unprocessed event serialise
-- on the inbox row rather than racing each other.

create or replace function public.rpc_stripe_event_record(
    p_event_id      text,
    p_type          text,
    p_payload       jsonb,
    p_event_created timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_processed_at timestamptz;
begin
    insert into public.stripe_webhook_events (id, type, payload, event_created)
    values (p_event_id, p_type, p_payload, p_event_created)
    on conflict (id) do nothing;

    if found then
        return 'stored';
    end if;

    -- The row was already here. Take it, so that two deliveries arriving
    -- together do not both decide they are the one that should apply it.
    select e.processed_at
      into v_processed_at
      from public.stripe_webhook_events e
     where e.id = p_event_id
       for update;

    if v_processed_at is not null then
        return 'duplicate';
    end if;

    -- Recorded but never finished: this delivery is the retry.
    return 'stored';
end;
$$;

revoke all on function public.rpc_stripe_event_record(text, text, jsonb, timestamptz)
    from public, anon, authenticated;
grant execute on function public.rpc_stripe_event_record(text, text, jsonb, timestamptz)
    to service_role;

comment on function public.rpc_stripe_event_record(text, text, jsonb, timestamptz) is
    'Records one Stripe event in the durable inbox. Returns ''duplicate'' only for an event that has already been processed to completion; an event recorded but not yet processed returns ''stored'' so that Stripe''s retry actually retries it.';
