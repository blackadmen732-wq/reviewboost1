-- rpc_tag_key_sample: what readiness and health read to prove that the keys a
-- deployment holds still open the Tags in the field (migration 20261103000200,
-- frontend/lib/server/tag-keys.ts).
--
-- Key versions 6–8 are used so no other fixture can be counted with them.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

-- ------------------------------------------------------------- fixtures -----

insert into public.organizations (id, name, slug, status)
values ('00000000-b020-0000-0000-000000000001', 'Key Check Org', 'key-check-org', 'active');

insert into public.locations (id, org_id, name, google_review_url, status)
values ('00000000-b020-0000-0000-000000000002', '00000000-b020-0000-0000-000000000001',
        'Key Check Location', 'https://g.page/r/keycheck/review', 'active');

insert into public.review_stands
    (id, org_id, location_id, public_token_hash, public_token_prefix, status,
     public_token_key_version, public_token_encrypted, created_at)
values
    -- Version 7: live, paused, retired, and one made before saved copies.
    ('00000000-b020-0000-0000-000000000071', '00000000-b020-0000-0000-000000000001',
     '00000000-b020-0000-0000-000000000002', 'kc-v7-active', 'kc71', 'active', 7, 'copy-v7-active', now() - interval '3 days'),
    ('00000000-b020-0000-0000-000000000072', '00000000-b020-0000-0000-000000000001',
     '00000000-b020-0000-0000-000000000002', 'kc-v7-paused', 'kc72', 'paused', 7, 'copy-v7-paused', now() - interval '2 days'),
    ('00000000-b020-0000-0000-000000000073', '00000000-b020-0000-0000-000000000001',
     '00000000-b020-0000-0000-000000000002', 'kc-v7-retired', 'kc73', 'retired', 7, 'copy-v7-retired', now() - interval '1 day'),
    ('00000000-b020-0000-0000-000000000074', '00000000-b020-0000-0000-000000000001',
     '00000000-b020-0000-0000-000000000002', 'kc-v7-no-copy', 'kc74', 'active', 7, null, now() - interval '4 days'),
    -- Version 8: three live Tags, newest last inserted.
    ('00000000-b020-0000-0000-000000000081', '00000000-b020-0000-0000-000000000001',
     '00000000-b020-0000-0000-000000000002', 'kc-v8-old', 'kc81', 'active', 8, 'copy-v8-old', now() - interval '3 hours'),
    ('00000000-b020-0000-0000-000000000082', '00000000-b020-0000-0000-000000000001',
     '00000000-b020-0000-0000-000000000002', 'kc-v8-mid', 'kc82', 'active', 8, 'copy-v8-mid', now() - interval '2 hours'),
    ('00000000-b020-0000-0000-000000000083', '00000000-b020-0000-0000-000000000001',
     '00000000-b020-0000-0000-000000000002', 'kc-v8-new', 'kc83', 'active', 8, 'copy-v8-new', now() - interval '1 hour'),
    -- Version 6: only a Tag with no saved copy.
    ('00000000-b020-0000-0000-000000000061', '00000000-b020-0000-0000-000000000001',
     '00000000-b020-0000-0000-000000000002', 'kc-v6-no-copy', 'kc61', 'active', 6, null, now() - interval '5 days');

-- ----------------------------------------------------------- privileges -----

select ok(
    not has_function_privilege('anon', 'public.rpc_tag_key_sample(integer)', 'execute'),
    'a visitor cannot read saved Tag links');
select ok(
    not has_function_privilege('authenticated', 'public.rpc_tag_key_sample(integer)', 'execute'),
    'a signed-in owner cannot read every business''s saved Tag links');
select ok(
    has_function_privilege('service_role', 'public.rpc_tag_key_sample(integer)', 'execute'),
    'the server can');

set local role service_role;

-- ------------------------------------------------------------- behaviour ----

select is(
    (select distinct tags from public.rpc_tag_key_sample(3) where key_version = 7),
    3::bigint,
    'counts live and paused Tags, and Tags without a saved copy, but not retired ones');

select set_eq(
    $$select token_encrypted from public.rpc_tag_key_sample(3) where key_version = 7$$,
    array['copy-v7-active', 'copy-v7-paused'],
    'samples only saved copies of Tags that can still open');

select results_eq(
    $$select token_encrypted from public.rpc_tag_key_sample(2) where key_version = 8$$,
    array['copy-v8-new', 'copy-v8-mid'],
    'samples the newest Tags first, no more than asked');

select results_eq(
    $$select token_hash from public.rpc_tag_key_sample(2) where key_version = 8$$,
    array['kc-v8-new', 'kc-v8-mid'],
    'each copy comes with the digest it must match');

select results_eq(
    $$select tags, token_encrypted from public.rpc_tag_key_sample(3) where key_version = 6$$,
    $$values (1::bigint, null::text)$$,
    'a version whose Tags have no saved copy is still counted');

select is(
    (select count(*)::int from public.rpc_tag_key_sample(0) where key_version = 8),
    1,
    'asking for none still samples one, so a version is never left unchecked');

reset role;

select * from finish();

rollback;
