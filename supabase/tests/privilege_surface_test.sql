-- The privileged surface, pinned.
--
-- A SECURITY DEFINER function runs with its owner's rights and bypasses row
-- level security. Every one callable from a browser session is a place where
-- the function body, not RLS, is the tenant boundary. This suite makes that
-- surface a reviewed list rather than whatever the last migration left:
--
--   * no privileged function is callable by an anonymous caller at all;
--   * the set callable by a signed-in user is exactly the list below — adding
--     one fails here until it is reviewed and added (see
--     docs/backend/SECURITY_REVIEW.md for what the review must establish);
--   * every privileged function pins search_path, so an object planted in a
--     writable schema cannot be resolved in its place;
--   * every privileged function a signed-in user can call reads the caller
--     from auth.uid() itself or through a named authorisation helper;
--   * anonymous callers hold no table privilege, signed-in users hold
--     SELECT only, and every public table has RLS on;
--   * every view is security_invoker, so none of them is a way around RLS.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

select is(
    (select count(*)::int
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname in ('public', 'app', 'extensions')
        and has_function_privilege('anon', p.oid, 'execute')),
    0,
    'no SECURITY DEFINER function is executable by anon');

select set_eq(
    $$select p.oid::regprocedure::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where p.prosecdef and n.nspname in ('public', 'app')
         and has_function_privilege('authenticated', p.oid, 'execute')$$,
    array[
        'app.has_org_role(uuid,member_role[])',
        'app.is_org_member(uuid)',
        'app.shares_organization(uuid)',
        'rpc_add_response_note(uuid,uuid,text)',
        'rpc_archive_praise(uuid)',
        'rpc_cancel_text_request(uuid,uuid)',
        'rpc_change_member_role(uuid,member_role)',
        'rpc_create_location(uuid,text,text,text,text)',
        'rpc_create_organization(text,text,text,text,text,text,text,text,text,smallint,text,text,smallint)',
        'rpc_create_staff(uuid,text,text)',
        'rpc_create_stand(uuid,uuid,text,text,text,smallint,text,text,smallint)',
        'rpc_customer_page_asset_begin(uuid,customer_page_asset_kind,text,text)',
        'rpc_customer_page_publish(uuid,uuid)',
        'rpc_customer_page_save_draft(uuid,uuid,jsonb)',
        'rpc_customer_page_unpublish(uuid,uuid)',
        'rpc_delete_organization(uuid,text)',
        'rpc_mark_praise_shared(uuid)',
        'rpc_mark_response_read(uuid)',
        'rpc_match_praise(uuid,uuid)',
        'rpc_praise_count(uuid)',
        'rpc_record_nfc_provision(uuid,uuid,text)',
        'rpc_remove_member(uuid)',
        'rpc_reopen_response(uuid)',
        'rpc_resolve_response(uuid,text)',
        'rpc_restore_praise(uuid)',
        'rpc_rotate_stand_token(uuid,uuid,text,text,smallint,text,text,smallint)',
        'rpc_sms_balance(uuid)',
        'rpc_suspend_member(uuid)',
        'rpc_unmark_praise_shared(uuid)',
        'rpc_unmatch_praise(uuid)',
        'rpc_update_location(uuid,text,text,boolean)',
        'rpc_update_location_destination(uuid,uuid,text,text)',
        'rpc_update_organization(uuid,text,text)',
        'rpc_update_staff(uuid,text,text,boolean,boolean)',
        'rpc_update_stand(uuid,text,text)'
    ],
    'the SECURITY DEFINER functions a signed-in user can call are exactly the reviewed list');

select is(
    (select array_agg(p.oid::regprocedure::text order by 1)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname in ('public', 'app')
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                         where c in ('search_path=""', 'search_path=')) ),
    null,
    'every SECURITY DEFINER function pins an empty search_path');

select is(
    (select array_agg(p.oid::regprocedure::text order by 1)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname = 'public'
        and has_function_privilege('authenticated', p.oid, 'execute')
        and pg_get_functiondef(p.oid) !~ '(auth\.uid\(\)|app\.customer_page_authorize|app\.create_organization_with_first_stand)'),
    null,
    'every privileged function a signed-in user can call establishes the caller itself');

select is(
    (select count(*)::int from information_schema.role_table_grants
      where grantee = 'anon' and table_schema in ('public', 'app')),
    0,
    'anon holds no table privilege at all');

select is(
    (select array_agg(distinct privilege_type::text)
       from information_schema.role_table_grants
      where grantee = 'authenticated' and table_schema in ('public', 'app')),
    array['SELECT'],
    'signed-in users can only read tables; every write goes through a reviewed function');

select is(
    (select array_agg(c.relname::text order by 1)
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and ((c.relkind in ('r', 'p') and not c.relrowsecurity)
          or (c.relkind = 'v' and not coalesce('security_invoker=true' = any(c.reloptions), false)))),
    null,
    'every public table has RLS on and every public view runs as the caller');

select * from finish();
rollback;
