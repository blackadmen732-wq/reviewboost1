-- Grants for the functions migration 800 replaced.
--
-- FOUND BY RUNNING THE CUSTOMER FLOW, NOT BY READING IT.
--
-- Migration 800 gave `resolve_public_stand` a second parameter so a token
-- digest key could be rotated. In PostgreSQL a new signature is a **new
-- function** — `CREATE OR REPLACE` only replaces an exact signature match — so
-- the grants written in migration 400 stayed attached to the one-argument
-- version and the new one was created with none.
--
-- The wrapper in `public` is SECURITY INVOKER, so it executes as the caller:
-- `service_role`. With no EXECUTE grant, every single request to
-- `GET /api/v1/public/q/{token}` failed with
--
--     42501  permission denied for function resolve_public_stand
--
-- which the API correctly reported as an opaque 503. Correct handling, total
-- outage: the entire customer flow was dead and no test caught it, because
-- every test mocks Supabase and mocks do not have privileges.
--
-- The same applies to `upgrade_stand_token_digest`, which was new in 800 and
-- never granted at all.

grant execute on function app.resolve_public_stand(text, text) to service_role;
grant execute on function app.upgrade_stand_token_digest(text, text, smallint) to service_role;

-- The orphaned one-argument overload.
--
-- Migration 800 dropped the *wrapper* `public.rpc_public_resolve_stand(text)`
-- but left `app.resolve_public_stand(text)` behind, so two overloads existed
-- with different behaviour: the old one cannot resolve a stand mid-rotation and
-- silently returns nothing. An overload that is wrong in exactly one situation
-- is worse than no overload, because the situation is rare enough to ship.
drop function if exists app.resolve_public_stand(text);

-- Everything the anonymous flow reaches, asserted in one place. If a future
-- migration replaces one of these signatures, this list is where to fix it.
do $$
declare
    missing text;
begin
    select string_agg(signature, ', ')
      into missing
      from (
        values
          ('app.resolve_public_stand(text, text)'),
          ('app.public_create_session(text, text, text, text, text, text, integer, integer, boolean, text)'),
          ('app.public_submit_response(text, text, text, text, text, smallint, text, smallint, integer, text)'),
          ('app.public_record_google_click(text, text, text, text, text, integer)'),
          ('app.public_submit_team_praise(text, text, text, text, text, uuid, text, text, smallint, integer, text)'),
          ('app.consume_rate_limit(text, text, integer, integer)'),
          ('app.upgrade_stand_token_digest(text, text, smallint)')
      ) as required(signature)
     where not has_function_privilege('service_role', signature, 'EXECUTE');

    if missing is not null then
        raise exception 'service_role cannot execute: %', missing;
    end if;
end $$;
