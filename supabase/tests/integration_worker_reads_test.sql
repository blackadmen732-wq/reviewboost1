-- The Connections worker's reads: reachable by the service role only.
--
-- They return sealed credentials, so a signed-in owner — of this business or
-- any other — must not be able to call them, and neither may a visitor.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

select ok(has_function_privilege('service_role', 'public.rpc_integration_load_connection(uuid)', 'execute'),
    'the worker can load a connection');
select ok(not has_function_privilege('authenticated', 'public.rpc_integration_load_connection(uuid)', 'execute'),
    'a signed-in user cannot load a connection and its sealed credentials');
select ok(not has_function_privilege('anon', 'public.rpc_integration_load_connection(uuid)', 'execute'),
    'a visitor cannot load a connection');

select ok(has_function_privilege('service_role', 'public.rpc_integration_checkpoint_high_water(uuid, text)', 'execute'),
    'the worker can read a checkpoint');
select ok(not has_function_privilege('authenticated', 'public.rpc_integration_checkpoint_high_water(uuid, text)', 'execute'),
    'a signed-in user cannot read a checkpoint through the worker function');

select ok(has_function_privilege('service_role', 'public.rpc_integration_held_profiles(uuid, text[])', 'execute'),
    'the worker can check which customers a connection holds');
select ok(not has_function_privilege('authenticated', 'public.rpc_integration_held_profiles(uuid, text[])', 'execute'),
    'a signed-in user cannot probe another connection''s customers');

select is(
    (select count(*)::int from public.rpc_integration_load_connection(gen_random_uuid())),
    0, 'an unknown connection returns nothing');

select is(
    public.rpc_integration_checkpoint_high_water(gen_random_uuid(), 'payments'),
    null, 'no checkpoint before the first run');

select * from finish();
rollback;
