-- Idempotency table for Stripe webhook events.
--
-- The webhook handler checks this table before processing an event
-- and records the event ID after successful processing. This prevents
-- duplicate processing when Stripe retries delivery.

create table public.stripe_webhook_events (
  event_id     text primary key,
  event_type   text not null,
  processed_at timestamptz not null default now()
);

-- Index for cleanup queries (prune events older than 30 days).
create index stripe_webhook_events_processed_at_idx
    on public.stripe_webhook_events (processed_at);

-- No RLS needed — only the service role writes/reads this table.
-- Revoke all client access.
revoke all on public.stripe_webhook_events from authenticated, anon;
