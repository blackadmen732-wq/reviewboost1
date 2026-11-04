-- The maintenance worker can run every step it calls
-- (20261104000300_maintenance_grants).
--
-- The worker runs as service_role. Two of its steps called invoker wrappers
-- whose `app` function service_role could not execute, so they failed with
-- "permission denied" on every run. These cases call them as service_role,
-- the way the worker does, and check that no other service-role wrapper has
-- the same gap.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(3);

set local role service_role;

select lives_ok(
    $$select public.rpc_sms_reconcile_aged_unknowns(900)$$,
    'service_role can settle sends the provider never confirmed');

select lives_ok(
    $$select public.rpc_sms_release_dead_letters()$$,
    'service_role can release credit held by dead-lettered sends');

reset role;

-- A service-role entry point that runs with the caller's rights is only as
-- good as the rights behind it: every `app` function such a wrapper calls
-- must itself be executable by service_role.
select is(
    (select coalesce(string_agg(w.proname || ' -> app.' || a.proname, ', ' order by w.proname), '')
       from pg_proc w
       join pg_namespace wn on wn.oid = w.pronamespace
       join pg_proc a on position('app.' || a.proname || '(' in w.prosrc) > 0
       join pg_namespace an on an.oid = a.pronamespace and an.nspname = 'app'
      where wn.nspname = 'public'
        and not w.prosecdef
        and has_function_privilege('service_role', w.oid, 'EXECUTE')
        and not has_function_privilege('service_role', a.oid, 'EXECUTE')),
    '',
    'no service-role wrapper calls an app function service_role cannot run');

select * from finish();

rollback;
