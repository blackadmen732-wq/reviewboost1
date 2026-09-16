-- ReviewBoost Customers — service-role RPC surface.
--
-- PostgREST exposes only the `public` schema. These thin `public.rpc_customer_*`
-- wrappers are the only way the Node import service can call the pipeline; each
-- is SECURITY DEFINER, delegates to exactly one `app.*` function, and is
-- granted to `service_role` alone (never anon/authenticated). Authorization
-- lives in the app functions and RLS; these wrappers add no logic.

create or replace function public.rpc_customer_upsert_by_phone(
    p_org_id             uuid,
    p_phone_hash         text,
    p_phone_encrypted    text,
    p_phone_key_version  smallint,
    p_phone_last_four    text,
    p_display_name       text,
    p_email_hash         text,
    p_email_encrypted    text,
    p_email_key_version  smallint,
    p_email_domain       text
)
returns table (customer_id uuid, matched boolean)
language sql security definer set search_path = ''
as $$
    select * from app.customer_upsert_by_phone(
        p_org_id, p_phone_hash, p_phone_encrypted, p_phone_key_version, p_phone_last_four,
        p_display_name, p_email_hash, p_email_encrypted, p_email_key_version, p_email_domain);
$$;

create or replace function public.rpc_customer_external_link(
    p_org_id             uuid,
    p_customer_id        uuid,
    p_source_kind        public.customer_source_kind,
    p_source_connection_id uuid,
    p_external_id        text,
    p_metadata           jsonb
)
returns uuid
language sql security definer set search_path = ''
as $$ select app.customer_external_link(p_org_id, p_customer_id, p_source_kind, p_source_connection_id, p_external_id, p_metadata); $$;

create or replace function public.rpc_customer_import_begin(
    p_org_id             uuid,
    p_source_kind        public.customer_source_kind,
    p_source_connection_id uuid,
    p_dry_run            boolean,
    p_idempotency_key    text,
    p_actor              uuid
)
returns table (job_id uuid, existed boolean, status public.customer_import_status)
language sql security definer set search_path = ''
as $$ select * from app.customer_import_begin(p_org_id, p_source_kind, p_source_connection_id, p_dry_run, p_idempotency_key, p_actor); $$;

create or replace function public.rpc_customer_visit_upsert(
    p_org_id      uuid,
    p_customer_id uuid,
    p_source_kind public.customer_source_kind,
    p_external_id text,
    p_occurred_at timestamptz,
    p_note_encrypted text,
    p_meta        jsonb
)
returns uuid
language sql security definer set search_path = ''
as $$ select app.customer_visit_upsert(p_org_id, p_customer_id, p_source_kind, p_external_id, p_occurred_at, p_note_encrypted, p_meta); $$;

create or replace function public.rpc_customer_count_known_consent(
    p_org_id       uuid,
    p_phone_hashes text[]
)
returns integer
language sql security definer set search_path = ''
as $$ select app.customer_count_known_consent(p_org_id, p_phone_hashes); $$;

create or replace function public.rpc_customer_import_record_row(
    p_job_id             uuid,
    p_org_id             uuid,
    p_row_number         integer,
    p_action             public.customer_import_row_action,
    p_matched_customer_id uuid,
    p_external_id        text,
    p_error              text
)
returns void
language sql security definer set search_path = ''
as $$ select app.customer_import_record_row(p_job_id, p_org_id, p_row_number, p_action, p_matched_customer_id, p_external_id, p_error); $$;

create or replace function public.rpc_customer_import_finish(
    p_job_id             uuid,
    p_org_id             uuid,
    p_total              integer,
    p_imported           integer,
    p_matched            integer,
    p_duplicate          integer,
    p_invalid            integer,
    p_skipped            integer,
    p_unknown_consent    integer,
    p_error              text
)
returns void
language sql security definer set search_path = ''
as $$
    select app.customer_import_finish(
        p_job_id, p_org_id, p_total, p_imported, p_matched, p_duplicate,
        p_invalid, p_skipped, p_unknown_consent, p_error);
$$;

do $$
declare
    fn text;
begin
    foreach fn in array array[
        'public.rpc_customer_upsert_by_phone(uuid, text, text, smallint, text, text, text, text, smallint, text)',
        'public.rpc_customer_external_link(uuid, uuid, public.customer_source_kind, uuid, text, jsonb)',
        'public.rpc_customer_import_begin(uuid, public.customer_source_kind, uuid, boolean, text, uuid)',
        'public.rpc_customer_import_record_row(uuid, uuid, integer, public.customer_import_row_action, uuid, text, text)',
        'public.rpc_customer_import_finish(uuid, uuid, integer, integer, integer, integer, integer, integer, integer, text)',
        'public.rpc_customer_visit_upsert(uuid, uuid, public.customer_source_kind, text, timestamptz, text, jsonb)',
        'public.rpc_customer_count_known_consent(uuid, text[])'
    ]
    loop
        execute format('revoke all on function %s from public, anon, authenticated;', fn);
        execute format('grant execute on function %s to service_role;', fn);
    end loop;
end $$;
