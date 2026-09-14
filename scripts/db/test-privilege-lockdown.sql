-- Privilege lockdown, asserted against the schema rather than against a PR
-- description.
--
-- This file exists because writing `create or replace function` grants EXECUTE
-- to PUBLIC by default, and every one of these properties is one line away from
-- being lost by a migration whose author was thinking about something else.
-- It caught exactly that during the change that added it.

\set ON_ERROR_STOP on
\set QUIET on

-- --------------------------------- 1. no function reachable by PUBLIC/anon --

do $$
declare v_bad text;
begin
    select string_agg(n.nspname || '.' || p.proname, ', ' order by p.proname)
      into v_bad
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'app')
       and (has_function_privilege('public', p.oid, 'EXECUTE')
         or has_function_privilege('anon', p.oid, 'EXECUTE'));

    if v_bad is not null then
        raise exception 'functions executable by PUBLIC or anon: %', v_bad;
    end if;
    raise notice 'PASS no function in public or app is executable by PUBLIC or anon';
end
$$;

-- ------------------------- 2. the Data API cannot write to a tenant table ---

do $$
declare v_bad text;
begin
    -- Every write goes through a SECURITY DEFINER function. A direct INSERT
    -- grant to anon or authenticated would let the Data API bypass the
    -- validation those functions exist to perform.
    select string_agg(c.relname || ' <- ' || r.rolname, ', ')
      into v_bad
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('anon'), ('authenticated')) as r(rolname)
     where n.nspname = 'public' and c.relkind = 'r'
       and (has_table_privilege(r.rolname, c.oid, 'INSERT')
         or has_table_privilege(r.rolname, c.oid, 'UPDATE')
         or has_table_privilege(r.rolname, c.oid, 'DELETE'));

    if v_bad is not null then
        raise exception 'Data API roles can write directly to: %', v_bad;
    end if;
    raise notice 'PASS anon and authenticated cannot INSERT, UPDATE, or DELETE any public table';
end
$$;

-- ------------------------------------- 3. every public table enforces RLS ---

do $$
declare v_bad text;
begin
    select string_agg(c.relname, ', ')
      into v_bad
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

    if v_bad is not null then
        raise exception 'public tables with row level security disabled: %', v_bad;
    end if;
    raise notice 'PASS every table in public has row level security enabled';
end
$$;

-- --------------------- 4. no definer function has a mutable search_path -----

do $$
declare v_bad text;
begin
    -- A SECURITY DEFINER function without a pinned search_path can be made to
    -- call an attacker's function by anyone who can create a schema.
    select string_agg(n.nspname || '.' || p.proname, ', ')
      into v_bad
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'app') and p.prosecdef
       and (p.proconfig is null
            or not exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%'));

    if v_bad is not null then
        raise exception 'SECURITY DEFINER functions with a mutable search_path: %', v_bad;
    end if;
    raise notice 'PASS every SECURITY DEFINER function pins its search_path';
end
$$;

-- -------------------------- 5. the app schema exposes only RLS helpers ------

do $$
declare v_bad text; v_expected constant text[] := array['is_org_member', 'has_org_role', 'shares_organization'];
begin
    -- `authenticated` holds USAGE on the app schema deliberately: RLS policies
    -- call these three helpers, and they evaluate as the calling user. USAGE
    -- alone grants nothing, so what matters is that the list of functions it
    -- can actually execute stays exactly these three.
    select string_agg(p.proname, ', ' order by p.proname)
      into v_bad
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and not (p.proname = any(v_expected));

    if v_bad is not null then
        raise exception 'authenticated can execute unexpected app functions: %', v_bad;
    end if;
    raise notice 'PASS authenticated can execute only the three RLS helpers in app';
end
$$;

-- ------------------------------ 6. no table in app is reachable at all ------

do $$
declare v_bad text;
begin
    select string_agg(c.relname || ' <- ' || r.rolname, ', ')
      into v_bad
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('anon'), ('authenticated')) as r(rolname)
     where n.nspname = 'app' and c.relkind = 'r'
       and has_table_privilege(r.rolname, c.oid, 'SELECT');

    if v_bad is not null then
        raise exception 'app tables readable through the Data API: %', v_bad;
    end if;
    raise notice 'PASS no app table is readable by anon or authenticated';
end
$$;

-- ---------------- 7. onboarding still works with the grant removed ---------

-- The revoke above is only safe because the public wrapper is SECURITY DEFINER.
-- Asserting that from the schema is not enough: this calls it as a real
-- `authenticated` role and checks a business comes out the other side.
insert into auth.users (id, email)
    values ('55555555-5555-5555-5555-555555555555', 'onboarder@example.test');

do $$
declare v_org uuid; v_stand uuid; v_ent text;
begin
    perform set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
    set local role authenticated;

    select org_id, stand_id into v_org, v_stand
      from public.rpc_create_organization(
        'Fresh Pizza', 'fresh-pizza', 'America/New_York', 'en', 'Main',
        'https://search.google.com/local/writereview?placeid=NEW',
        'hash-onboard-1', 'onb001', 'Front Desk', 1::smallint, 'req-onboard',
        'cipher-onboard', 1::smallint);

    reset role;

    if v_org is null or v_stand is null then
        raise exception 'onboarding produced no organization or stand';
    end if;

    -- And it wrote the trial snapshot, so the next Tag is already constrained.
    select status into v_ent from public.entitlement_snapshots where org_id = v_org;
    if v_ent is distinct from 'trialing' then
        raise exception 'onboarding did not start a trial: %', coalesce(v_ent, '(no row)');
    end if;

    raise notice 'PASS onboarding works as authenticated with no direct app grant, and starts a trial';
end
$$;

select 'ALL PRIVILEGE LOCKDOWN TESTS PASSED' as result;
