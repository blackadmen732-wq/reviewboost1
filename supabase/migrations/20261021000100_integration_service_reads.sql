-- Connections: the service role reads through functions, not tables.
--
-- PR #67's rule (frontend/tests/unit/service-role-containment.test.ts) is
-- that server code holding the service-role key calls reviewed `public.rpc_*`
-- functions and never queries a table directly, because a direct read with
-- that key ignores row-level security and is invisible to review. The
-- Connections code was written on a branch without that rule and read three
-- things directly. These functions are those three reads, unchanged in what
-- they return, now reachable only by the service role.

-- One connection, only if it belongs to the named business. Used before acting
-- on a connection with the service role.
create or replace function public.rpc_integration_owned_connection(
    p_org_id        uuid,
    p_connection_id uuid
)
returns table (
    id             uuid,
    org_id         uuid,
    provider_id    text,
    workflow_id    text,
    state          text,
    config_version integer
)
language sql
stable
security definer
set search_path = ''
as $$
    select c.id, c.org_id, c.provider_id, c.workflow_id, c.state::text, c.config_version
    from public.integration_connections c
    where c.id = p_connection_id and c.org_id = p_org_id;
$$;

-- Where a stream's last sync got to, or null if it never ran.
create or replace function public.rpc_integration_checkpoint_high_water(
    p_connection_id uuid,
    p_stream        text
)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
    select cp.high_water
    from public.integration_sync_checkpoints cp
    where cp.connection_id = p_connection_id and cp.stream = p_stream;
$$;

-- Which of these provider customer ids this connection already holds. A
-- connection applies updates only to customers it brought in.
create or replace function public.rpc_integration_held_external_ids(
    p_connection_id uuid,
    p_external_ids  text[]
)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
    select p.external_id
    from public.customer_source_profiles p
    where p.connection_id = p_connection_id
      and p.external_id = any (p_external_ids);
$$;

do $$
declare
    fn text;
begin
    foreach fn in array array[
        'public.rpc_integration_owned_connection(uuid, uuid)',
        'public.rpc_integration_checkpoint_high_water(uuid, text)',
        'public.rpc_integration_held_external_ids(uuid, text[])'
    ]
    loop
        execute format('revoke all on function %s from public, anon, authenticated;', fn);
        execute format('grant execute on function %s to service_role;', fn);
    end loop;
end $$;
