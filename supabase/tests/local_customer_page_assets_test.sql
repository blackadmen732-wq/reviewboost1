begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(6);

insert into public.organizations (id, name, slug, timezone, default_locale)
values ('ff100000-0000-4000-8000-000000000001', 'Local asset test', 'local-asset-origin-test', 'UTC', 'en');
insert into public.customer_page_assets (id, org_id, kind, status, storage_path, content_type)
select ('ff200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       'ff100000-0000-4000-8000-000000000001', 'hero', 'pending',
       'local-asset-origin-test/' || n || '.jpg', 'image/jpeg'
from generate_series(1, 6) n;

set local role service_role;
select lives_ok($$select public.rpc_customer_page_asset_confirm('ff200000-0000-4000-8000-000000000001', 'ff100000-0000-4000-8000-000000000001', 'https://assets.example.test/photo.jpg', 100)$$, 'Hosted HTTPS artwork remains valid');
select lives_ok($$select public.rpc_customer_page_asset_confirm('ff200000-0000-4000-8000-000000000002', 'ff100000-0000-4000-8000-000000000001', 'http://127.0.0.1:54321/photo.jpg', 100)$$, 'The local Supabase IPv4 Storage URL can be confirmed');
select lives_ok($$select public.rpc_customer_page_asset_confirm('ff200000-0000-4000-8000-000000000003', 'ff100000-0000-4000-8000-000000000001', 'http://localhost:54321/photo.jpg', 100)$$, 'The local Supabase hostname can be confirmed');
select throws_ok($$select public.rpc_customer_page_asset_confirm('ff200000-0000-4000-8000-000000000004', 'ff100000-0000-4000-8000-000000000001', 'http://assets.example.test/photo.jpg', 100)$$, '23514', null, 'Remote HTTP artwork is still refused');
select throws_ok($$select public.rpc_customer_page_asset_confirm('ff200000-0000-4000-8000-000000000005', 'ff100000-0000-4000-8000-000000000001', 'http://127.0.0.1.evil.test/photo.jpg', 100)$$, '23514', null, 'A hostname that starts with loopback is refused');
select throws_ok($$select public.rpc_customer_page_asset_confirm('ff200000-0000-4000-8000-000000000006', 'ff100000-0000-4000-8000-000000000001', 'http://user@localhost/photo.jpg', 100)$$, '23514', null, 'Loopback URLs with credentials are refused');
reset role;
select * from finish();
rollback;
