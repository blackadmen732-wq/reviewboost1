-- Connections: the worker's reads go through functions, not tables.
--
-- PR #76's worker read integration_connections, integration_credentials,
-- integration_location_mappings, integration_sync_checkpoints and
-- customer_source_profiles directly with the service-role key. PR #67 holds
-- the service role to a stricter rule (frontend/tests/unit/
-- service-role-containment.test.ts): it may call narrow rpc_* functions, never
-- query a table, because a table read with RLS bypassed is a tenant boundary
-- that lives only in a WHERE clause someone has to remember.
--
-- These three functions are exactly the reads the worker needs, each scoped
-- to one connection, reachable only by service_role. Nothing else changes.

-- One connection with its sealed credentials and the provider places the owner
-- chose. `has_credentials` is false once a disconnect has deleted the keys.
create or replace function app.integration_load_connection(p_connection_id uuid)
returns table (
    id                  uuid,
    org_id              uuid,
    provider_id         text,
    workflow_id         text,
    external_account_id text,
    state               text,
    granted_scopes      text[],
    has_credentials     boolean,
    access_token_enc    text,
    refresh_token_enc   text,
    access_expires_at   timestamptz,
    refresh_expires_at  timestamptz,
    last_refreshed_at   timestamptz,
    mapped_location_ids text[]
)
language sql
stable
security definer
set search_path = ''
as $$
    select c.id,
           c.org_id,
           c.provider_id,
           c.workflow_id,
           c.external_account_id,
           c.state::text,
           c.granted_scopes,
           cr.connection_id is not null,
           cr.access_token_enc,
           cr.refresh_token_enc,
           cr.access_expires_at,
           cr.refresh_expires_at,
           cr.last_refreshed_at,
           coalesce(
               (select array_agg(m.external_location_id order by m.external_location_id)
                  from public.integration_location_mappings m
                 where m.connection_id = c.id),
               '{}'::text[])
      from public.integration_connections c
      left join public.integration_credentials cr on cr.connection_id = c.id
     where c.id = p_connection_id;
$$;

-- The last point a stream was fully applied up to, or null before the first run.
create or replace function app.integration_checkpoint_high_water(p_connection_id uuid, p_stream text)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
    select k.high_water
      from public.integration_sync_checkpoints k
     where k.connection_id = p_connection_id and k.stream = p_stream;
$$;

-- Which of these provider customer ids this connection already holds. A
-- customer update applies only to those: a connection never pulls in the
-- provider's whole directory.
create or replace function app.integration_held_profiles(p_connection_id uuid, p_external_ids text[])
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
    select p.external_id
      from public.customer_source_profiles p
     where p.connection_id = p_connection_id
       and p.external_id = any(coalesce(p_external_ids, '{}'::text[]));
$$;

revoke all on function app.integration_load_connection(uuid) from public, anon, authenticated;
revoke all on function app.integration_checkpoint_high_water(uuid, text) from public, anon, authenticated;
revoke all on function app.integration_held_profiles(uuid, text[]) from public, anon, authenticated;
grant execute on function app.integration_load_connection(uuid) to service_role;
grant execute on function app.integration_checkpoint_high_water(uuid, text) to service_role;
grant execute on function app.integration_held_profiles(uuid, text[]) to service_role;

-- PostgREST wrappers, service role only, no logic.
create or replace function public.rpc_integration_load_connection(p_connection_id uuid)
returns table (
    id                  uuid,
    org_id              uuid,
    provider_id         text,
    workflow_id         text,
    external_account_id text,
    state               text,
    granted_scopes      text[],
    has_credentials     boolean,
    access_token_enc    text,
    refresh_token_enc   text,
    access_expires_at   timestamptz,
    refresh_expires_at  timestamptz,
    last_refreshed_at   timestamptz,
    mapped_location_ids text[]
)
language sql
stable
security definer
set search_path = ''
as $$ select * from app.integration_load_connection(p_connection_id); $$;

create or replace function public.rpc_integration_checkpoint_high_water(p_connection_id uuid, p_stream text)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$ select app.integration_checkpoint_high_water(p_connection_id, p_stream); $$;

create or replace function public.rpc_integration_held_profiles(p_connection_id uuid, p_external_ids text[])
returns setof text
language sql
stable
security definer
set search_path = ''
as $$ select * from app.integration_held_profiles(p_connection_id, p_external_ids); $$;

revoke all on function public.rpc_integration_load_connection(uuid) from public, anon, authenticated;
revoke all on function public.rpc_integration_checkpoint_high_water(uuid, text) from public, anon, authenticated;
revoke all on function public.rpc_integration_held_profiles(uuid, text[]) from public, anon, authenticated;
grant execute on function public.rpc_integration_load_connection(uuid) to service_role;
grant execute on function public.rpc_integration_checkpoint_high_water(uuid, text) to service_role;
grant execute on function public.rpc_integration_held_profiles(uuid, text[]) to service_role;
