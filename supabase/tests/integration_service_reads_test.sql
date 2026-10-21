-- The three Connections reads that the service role now makes through
-- functions (migration 20261021000100): server-only, and scoped to the
-- connection and business they are asked about.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

insert into public.organizations (id, name, slug)
values
    ('9e000000-0000-0000-0000-00000000000a', 'Reads Org', 'reads-org'),
    ('9e000000-0000-0000-0000-00000000000b', 'Other Org', 'reads-other');

insert into public.integration_connections (id, org_id, provider_id, workflow_id, external_account_id, state)
values ('9e000000-0000-0000-0000-0000000000c1', '9e000000-0000-0000-0000-00000000000a',
        'fake', 'payments', 'READS-1', 'active');

select results_eq(
    $$ select provider_id, workflow_id, state from public.rpc_integration_owned_connection(
         '9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-0000000000c1') $$,
    $$ values ('fake'::text, 'payments'::text, 'active'::text) $$,
    'a business reads its own connection');

select is_empty(
    $$ select * from public.rpc_integration_owned_connection(
         '9e000000-0000-0000-0000-00000000000b', '9e000000-0000-0000-0000-0000000000c1') $$,
    'naming another business returns nothing');

select is(
    public.rpc_integration_checkpoint_high_water('9e000000-0000-0000-0000-0000000000c1', 'payments'),
    null::timestamptz,
    'a stream that never ran has no high-water mark');

select is_empty(
    $$ select * from public.rpc_integration_held_external_ids(
         '9e000000-0000-0000-0000-0000000000c1', array['nobody']) $$,
    'a connection holds no customers it never brought in');

select function_privs_are('public', 'rpc_integration_owned_connection', array['uuid', 'uuid'],
    'authenticated', array[]::text[], 'signed-in clients cannot read a connection by id');
select function_privs_are('public', 'rpc_integration_checkpoint_high_water', array['uuid', 'text'],
    'authenticated', array[]::text[], 'signed-in clients cannot read checkpoints');
select function_privs_are('public', 'rpc_integration_held_external_ids', array['uuid', 'text[]'],
    'authenticated', array[]::text[], 'signed-in clients cannot list held customers');
select function_privs_are('public', 'rpc_integration_held_external_ids', array['uuid', 'text[]'],
    'anon', array[]::text[], 'anonymous callers cannot either');
select function_privs_are('public', 'rpc_integration_owned_connection', array['uuid', 'uuid'],
    'service_role', array['EXECUTE'], 'the server can');

select * from finish();

rollback;
