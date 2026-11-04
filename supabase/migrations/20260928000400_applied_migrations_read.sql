-- Let the release gate see which migrations this database has.
--
-- A build is only safe on a database that already has every migration the
-- build was written against. The readiness gate compares the migration names
-- compiled into the build (frontend/lib/server/schema-manifest.ts) with this
-- ledger and refuses promotion if any is missing.
--
-- Names, not versions: migrations applied through the dashboard/MCP were
-- re-stamped with server-generated versions (three on the hosted project),
-- but keep their names.
--
-- plpgsql so the body is not resolved at creation: the plain-Postgres test
-- shim has no supabase_migrations schema. There it raises, and the gate
-- reports the ledger as unreadable — which is the fail-closed answer.

create or replace function public.rpc_applied_migrations()
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    return query select m.name::text from supabase_migrations.schema_migrations m;
end;
$$;

revoke all on function public.rpc_applied_migrations() from public, anon, authenticated;
grant execute on function public.rpc_applied_migrations() to service_role;
