-- ReviewBoost Text Requests — service-role RPC surface
--
-- PostgREST exposes only the `public` schema, so the Node server (the worker and
-- the webhook handler, acting as the service role) cannot call the `app.*`
-- pipeline functions directly. These thin `public.rpc_sms_*` wrappers are the
-- only way in: each is SECURITY DEFINER, delegates to exactly one `app.*`
-- function, and is granted to `service_role` alone — never to anon or
-- authenticated. They add no logic; the authorization that matters lives in the
-- app functions and in RLS.

-- --------------------------------------------------- outbox -----------------

create or replace function public.rpc_sms_claim_outbox(
    p_worker text, p_limit integer, p_lease_seconds integer
)
returns setof public.sms_outbox
language sql security definer set search_path = ''
as $$ select * from app.sms_outbox_claim(p_worker, p_limit, p_lease_seconds); $$;

create or replace function public.rpc_sms_complete_outbox(p_id uuid)
returns void language sql security definer set search_path = ''
as $$ select app.sms_outbox_complete(p_id); $$;

create or replace function public.rpc_sms_fail_outbox(p_id uuid, p_error text, p_backoff_seconds integer)
returns public.sms_outbox_status language sql security definer set search_path = ''
as $$ select app.sms_outbox_fail(p_id, p_error, p_backoff_seconds); $$;

-- --------------------------------------------------- dispatch lifecycle -----

create or replace function public.rpc_sms_begin_dispatch(p_request_id uuid, p_org_id uuid, p_provider text)
returns table (
    outcome text, attempt_id uuid, attempt_number integer,
    message_encrypted text, message_key_version smallint,
    phone_encrypted text, phone_key_version smallint
)
language sql security definer set search_path = ''
as $$ select * from app.sms_begin_dispatch(p_request_id, p_org_id, p_provider); $$;

create or replace function public.rpc_sms_settle_attempt(
    p_attempt_id uuid, p_org_id uuid, p_outcome text,
    p_provider_message_id text, p_error_class text, p_provider_response jsonb
)
returns text language sql security definer set search_path = ''
as $$ select app.sms_settle_attempt(p_attempt_id, p_org_id, p_outcome, p_provider_message_id, p_error_class, p_provider_response); $$;

create or replace function public.rpc_sms_apply_delivery_status(
    p_provider text, p_provider_message_id text, p_terminal text, p_error_class text
)
returns text language sql security definer set search_path = ''
as $$ select app.sms_apply_delivery_status(p_provider, p_provider_message_id, p_terminal, p_error_class); $$;

create or replace function public.rpc_sms_apply_inbound_keyword(
    p_phone_hash text, p_intent text, p_evidence jsonb
)
returns integer language sql security definer set search_path = ''
as $$ select app.sms_apply_inbound_keyword(p_phone_hash, p_intent, p_evidence); $$;

-- --------------------------------------------------- webhook inbox ----------

create or replace function public.rpc_sms_webhook_receive(
    p_provider text, p_provider_event_id text, p_dedupe_key text, p_event_type text,
    p_signature_verified boolean, p_headers jsonb, p_raw_body_encrypted text
)
returns table (inbox_id uuid, inserted boolean)
language sql security definer set search_path = ''
as $$ select * from app.sms_webhook_receive(p_provider, p_provider_event_id, p_dedupe_key, p_event_type, p_signature_verified, p_headers, p_raw_body_encrypted); $$;

create or replace function public.rpc_sms_webhook_settle(
    p_id uuid, p_status public.sms_webhook_status, p_org_id uuid, p_error text
)
returns void language sql security definer set search_path = ''
as $$ select app.sms_webhook_settle(p_id, p_status, p_org_id, p_error); $$;

-- --------------------------------------------------- consent / suppression --

create or replace function public.rpc_sms_record_consent(
    p_org_id uuid, p_phone_hash text, p_phone_encrypted text, p_phone_key_version smallint,
    p_phone_last_four text, p_purpose public.sms_consent_purpose, p_status public.sms_consent_status,
    p_source public.sms_consent_source, p_location_id uuid, p_evidence jsonb, p_occurred_at timestamptz
)
returns table (event_id uuid, appended boolean)
language sql security definer set search_path = ''
as $$ select * from app.sms_record_consent(p_org_id, p_phone_hash, p_phone_encrypted, p_phone_key_version, p_phone_last_four, p_purpose, p_status, p_source, p_location_id, p_evidence, p_occurred_at); $$;

create or replace function public.rpc_sms_add_suppression(
    p_org_id uuid, p_phone_hash text, p_purpose public.sms_consent_purpose,
    p_reason public.sms_suppression_reason, p_expires_at timestamptz, p_evidence jsonb
)
returns uuid language sql security definer set search_path = ''
as $$ select app.sms_add_suppression(p_org_id, p_phone_hash, p_purpose, p_reason, p_expires_at, p_evidence); $$;

create or replace function public.rpc_sms_remove_suppression(
    p_org_id uuid, p_phone_hash text, p_purpose public.sms_consent_purpose, p_reason public.sms_suppression_reason
)
returns integer language sql security definer set search_path = ''
as $$ select app.sms_remove_suppression(p_org_id, p_phone_hash, p_purpose, p_reason); $$;

create or replace function public.rpc_sms_can_send(
    p_org_id uuid, p_phone_hash text, p_purpose public.sms_consent_purpose
)
returns table (allowed boolean, reason text)
language sql security definer set search_path = ''
as $$ select * from app.sms_can_send(p_org_id, p_phone_hash, p_purpose); $$;

create or replace function public.rpc_sms_mark_flow_completed(
    p_org_id uuid, p_phone_hash text, p_purpose public.sms_consent_purpose, p_window_seconds integer
)
returns void language sql security definer set search_path = ''
as $$ select app.sms_mark_flow_completed(p_org_id, p_phone_hash, p_purpose, p_window_seconds); $$;

-- --------------------------------------------------- quota ------------------

create or replace function public.rpc_sms_quota_allocate(
    p_org_id uuid, p_amount bigint, p_correlation_key text, p_expires_at timestamptz, p_note text
)
returns boolean language sql security definer set search_path = ''
as $$ select app.sms_quota_allocate(p_org_id, p_amount, p_correlation_key, p_expires_at, p_note); $$;

create or replace function public.rpc_sms_quota_available(p_org_id uuid)
returns bigint language sql security definer set search_path = ''
as $$ select app.sms_quota_available(p_org_id); $$;

-- --------------------------------------------------- grants -----------------
-- Every wrapper is service-role only. Revoke the default PUBLIC execute grant
-- (which anon and authenticated inherit) and grant service_role explicitly.

do $$
declare
    fn text;
begin
    foreach fn in array array[
        'public.rpc_sms_claim_outbox(text, integer, integer)',
        'public.rpc_sms_complete_outbox(uuid)',
        'public.rpc_sms_fail_outbox(uuid, text, integer)',
        'public.rpc_sms_begin_dispatch(uuid, uuid, text)',
        'public.rpc_sms_settle_attempt(uuid, uuid, text, text, text, jsonb)',
        'public.rpc_sms_apply_delivery_status(text, text, text, text)',
        'public.rpc_sms_apply_inbound_keyword(text, text, jsonb)',
        'public.rpc_sms_webhook_receive(text, text, text, text, boolean, jsonb, text)',
        'public.rpc_sms_webhook_settle(uuid, public.sms_webhook_status, uuid, text)',
        'public.rpc_sms_record_consent(uuid, text, text, smallint, text, public.sms_consent_purpose, public.sms_consent_status, public.sms_consent_source, uuid, jsonb, timestamptz)',
        'public.rpc_sms_add_suppression(uuid, text, public.sms_consent_purpose, public.sms_suppression_reason, timestamptz, jsonb)',
        'public.rpc_sms_remove_suppression(uuid, text, public.sms_consent_purpose, public.sms_suppression_reason)',
        'public.rpc_sms_can_send(uuid, text, public.sms_consent_purpose)',
        'public.rpc_sms_mark_flow_completed(uuid, text, public.sms_consent_purpose, integer)',
        'public.rpc_sms_quota_allocate(uuid, bigint, text, timestamptz, text)',
        'public.rpc_sms_quota_available(uuid)'
    ]
    loop
        execute format('revoke all on function %s from public, anon, authenticated;', fn);
        execute format('grant execute on function %s to service_role;', fn);
    end loop;
end $$;
