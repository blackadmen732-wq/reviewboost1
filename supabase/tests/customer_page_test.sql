-- Customer Page V2 schema and RPC tests.
--
-- Covers: tenant isolation, draft/publish model, location fallback,
-- asset ownership, template validation, publish atomicity, and the
-- public resolver returning only safe data.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

select plan(44);

-- ------------------------------------------------------------- fixtures ----

create or replace function tests.set_actor(p_user_id uuid) returns void
language plpgsql as $$
begin
    perform set_config('role', 'authenticated', true);
    perform set_config(
        'request.jwt.claims',
        json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
        true);
end $$;

create or replace function tests.set_service() returns void
language plpgsql as $$
begin
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function tests.set_anon() returns void
language plpgsql as $$
begin
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '', true);
end $$;

grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

-- Users: org1_owner, org1_admin, org2_owner
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
    ('aa100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'o1owner@test.com', '', now(), now()),
    ('aa100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'o1admin@test.com', '', now(), now()),
    ('aa100000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'o2owner@test.com', '', now(), now()),
    ('aa100000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@test.com', '', now(), now());

-- Org 1
insert into public.organizations (id, name, slug)
values ('a1000000-0000-0000-0000-00000000000a', 'Test Org One', 'cp-test-one');

insert into public.organization_members (id, org_id, user_id, role, status)
values
    ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-00000000000a', 'aa100000-0000-0000-0000-000000000001', 'owner', 'active'),
    ('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000a', 'aa100000-0000-0000-0000-000000000002', 'admin', 'active'),
    ('b1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-00000000000a', 'aa100000-0000-0000-0000-000000000004', 'viewer', 'active');

insert into public.locations (id, org_id, name, google_review_url)
values
    ('c1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-00000000000a', 'Org1 Location', 'https://g.page/r/o1/review'),
    ('c1000000-0000-0000-0000-00000000000b', 'a1000000-0000-0000-0000-00000000000a', 'Org1 Second Location', 'https://g.page/r/o1b/review');

-- Org 2
insert into public.organizations (id, name, slug)
values ('a2000000-0000-0000-0000-00000000000a', 'Test Org Two', 'cp-test-two');

insert into public.organization_members (id, org_id, user_id, role, status)
values
    ('b2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-00000000000a', 'aa100000-0000-0000-0000-000000000003', 'owner', 'active');

insert into public.locations (id, org_id, name, google_review_url)
values ('c2000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-00000000000a', 'Org2 Location', 'https://g.page/r/o2/review');

-- =================== 1. RLS: anon cannot see profiles ======================

select tests.set_anon();

select throws_ok(
    $$ select 1 from public.customer_page_profiles $$,
    '42501', null,
    'anon cannot read customer_page_profiles'
);

-- =================== 2. RLS: outsider org2 cannot see org1 profiles ========

-- First insert org-level profile for org1 as service
select tests.set_service();

insert into public.customer_page_profiles
    (id, org_id, scope, draft)
values
    ('d1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-00000000000a', 'organization', '{"templateId":"modern"}'::jsonb);

-- Org2 owner should not see org1's profile
select tests.set_actor('aa100000-0000-0000-0000-000000000003');

select is(
    (select count(*) from public.customer_page_profiles where org_id = 'a1000000-0000-0000-0000-00000000000a'),
    0::bigint,
    'org2 owner cannot see org1 profiles'
);

-- But can see if they had one in org2
select tests.set_service();
insert into public.customer_page_profiles
    (id, org_id, scope, draft)
values
    ('d2000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-00000000000a', 'organization', '{"templateId":"bold"}'::jsonb);

select tests.set_actor('aa100000-0000-0000-0000-000000000003');

select is(
    (select count(*) from public.customer_page_profiles where org_id = 'a2000000-0000-0000-0000-00000000000a'),
    1::bigint,
    'org2 owner can see org2 profiles'
);

-- =================== 3. Org1 owner can see org1 profile ====================

select tests.set_actor('aa100000-0000-0000-0000-000000000001');

select is(
    (select count(*) from public.customer_page_profiles where org_id = 'a1000000-0000-0000-0000-00000000000a'),
    1::bigint,
    'org1 owner can see org1 profiles'
);

-- =================== 4. Direct INSERT blocked for authenticated ============

select tests.set_actor('aa100000-0000-0000-0000-000000000001');

select throws_ok(
    $$insert into public.customer_page_profiles (org_id, scope, draft) values ('a1000000-0000-0000-0000-00000000000a', 'organization', '{}')$$,
    '42501', null,
    'direct INSERT blocked for authenticated on customer_page_profiles'
);

-- =================== 5. Direct UPDATE blocked for authenticated ============

select throws_ok(
    $$update public.customer_page_profiles set draft = '{"templateId":"bold"}' where org_id = 'a1000000-0000-0000-0000-00000000000a'$$,
    '42501', null,
    'direct UPDATE blocked for authenticated on customer_page_profiles'
);

-- =================== 6. Direct DELETE blocked for authenticated ============

select throws_ok(
    $$delete from public.customer_page_profiles where org_id = 'a1000000-0000-0000-0000-00000000000a'$$,
    '42501', null,
    'direct DELETE blocked for authenticated on customer_page_profiles'
);

-- =================== 7-8. RPC: owner can patch draft ======================

select tests.set_actor('aa100000-0000-0000-0000-000000000001');

-- Reset: remove the service-inserted row so the upsert creates fresh
select tests.set_service();
delete from public.customer_page_profiles where org_id = 'a1000000-0000-0000-0000-00000000000a';

select tests.set_actor('aa100000-0000-0000-0000-000000000001');

select is(
    (select count(*) from public.rpc_customer_page_patch_draft(
        p_org_id => 'a1000000-0000-0000-0000-00000000000a',
        p_location_id => null,
        p_draft => '{"templateId":"modern","hero":{"focalX":0.3,"focalY":0.7,"zoom":1.2}}'::jsonb
    )),
    1::bigint,
    'owner can patch org-level draft'
);

-- Draft persisted
select tests.set_service();
select is(
    (select (draft ->> 'templateId') from public.customer_page_profiles
     where org_id = 'a1000000-0000-0000-0000-00000000000a' and scope = 'organization'),
    'modern',
    'draft templateId persisted'
);

-- =================== 9. RPC: admin can also patch ==========================

select tests.set_actor('aa100000-0000-0000-0000-000000000002');

select is(
    (select count(*) from public.rpc_customer_page_patch_draft(
        p_org_id => 'a1000000-0000-0000-0000-00000000000a',
        p_location_id => null,
        p_draft => '{"templateId":"bold"}'::jsonb
    )),
    1::bigint,
    'admin can patch org-level draft'
);

-- =================== 10. RPC: viewer cannot patch ==========================

select tests.set_actor('aa100000-0000-0000-0000-000000000004');

select throws_ok(
    $$select * from public.rpc_customer_page_patch_draft(
        p_org_id => 'a1000000-0000-0000-0000-00000000000a',
        p_location_id => null,
        p_draft => '{"templateId":"bold"}'::jsonb
    )$$,
    '42501', null,
    'viewer cannot patch draft'
);

-- =================== 11. RPC: org2 owner cannot patch org1 ================

select tests.set_actor('aa100000-0000-0000-0000-000000000003');

select throws_ok(
    $$select * from public.rpc_customer_page_patch_draft(
        p_org_id => 'a1000000-0000-0000-0000-00000000000a',
        p_location_id => null,
        p_draft => '{"templateId":"minimal"}'::jsonb
    )$$,
    '42501', null,
    'org2 owner cannot patch org1 draft'
);

-- =================== 12. Invalid template rejected =========================

select tests.set_actor('aa100000-0000-0000-0000-000000000001');

select throws_ok(
    $$select * from public.rpc_customer_page_patch_draft(
        p_org_id => 'a1000000-0000-0000-0000-00000000000a',
        p_location_id => null,
        p_draft => '{"templateId":"neon_glow"}'::jsonb
    )$$,
    '22023', null,
    'invalid template rejected on patch'
);

-- =================== 13. Location override ==================================

select tests.set_actor('aa100000-0000-0000-0000-000000000001');

select is(
    (select count(*) from public.rpc_customer_page_patch_draft(
        p_org_id => 'a1000000-0000-0000-0000-00000000000a',
        p_location_id => 'c1000000-0000-0000-0000-00000000000a',
        p_draft => '{"templateId":"classic"}'::jsonb
    )),
    1::bigint,
    'owner can create location override draft'
);

select tests.set_service();
select is(
    (select count(*) from public.customer_page_profiles
     where org_id = 'a1000000-0000-0000-0000-00000000000a' and scope = 'location'),
    1::bigint,
    'location override profile row created'
);

-- =================== 14. Cross-org location blocked ========================

select tests.set_actor('aa100000-0000-0000-0000-000000000001');

select throws_ok(
    $$select * from public.rpc_customer_page_patch_draft(
        p_org_id => 'a1000000-0000-0000-0000-00000000000a',
        p_location_id => 'c2000000-0000-0000-0000-00000000000a',
        p_draft => '{"templateId":"minimal"}'::jsonb
    )$$,
    '42704', null,
    'cross-org location blocked'
);

-- =================== 15. Publish requires draft ============================

select tests.set_service();
delete from public.customer_page_profiles where org_id = 'a2000000-0000-0000-0000-00000000000a';
select tests.set_actor('aa100000-0000-0000-0000-000000000003');

select throws_ok(
    $$select * from public.rpc_customer_page_publish(
        p_org_id => 'a2000000-0000-0000-0000-00000000000a'
    )$$,
    'P0002', null,
    'publish without draft raises error'
);

-- =================== 16-19. Publish creates snapshot =======================

select tests.set_actor('aa100000-0000-0000-0000-000000000001');

-- Ensure org-level draft exists
select * from public.rpc_customer_page_patch_draft(
    p_org_id => 'a1000000-0000-0000-0000-00000000000a',
    p_location_id => null,
    p_draft => '{"templateId":"signature","hero":{"focalX":0.5,"focalY":0.5,"zoom":1.0}}'::jsonb
);

select is(
    (select count(*) from public.rpc_customer_page_publish(
        p_org_id => 'a1000000-0000-0000-0000-00000000000a'
    )),
    1::bigint,
    'publish succeeds'
);

select tests.set_service();

select is(
    (select published_version from public.customer_page_profiles
     where org_id = 'a1000000-0000-0000-0000-00000000000a' and scope = 'organization'),
    1,
    'published_version is 1 after first publish'
);

select isnt(
    (select published from public.customer_page_profiles
     where org_id = 'a1000000-0000-0000-0000-00000000000a' and scope = 'organization'),
    null,
    'published snapshot is not null'
);

select is(
    (select (published ->> 'templateId') from public.customer_page_profiles
     where org_id = 'a1000000-0000-0000-0000-00000000000a' and scope = 'organization'),
    'signature',
    'published snapshot contains correct templateId'
);

-- =================== 20. Second publish increments version ================

select tests.set_actor('aa100000-0000-0000-0000-000000000001');

select * from public.rpc_customer_page_publish(
    p_org_id => 'a1000000-0000-0000-0000-00000000000a'
);

select tests.set_service();
select is(
    (select published_version from public.customer_page_profiles
     where org_id = 'a1000000-0000-0000-0000-00000000000a' and scope = 'organization'),
    2,
    'published_version incremented to 2'
);

-- =================== 21. Draft never leaks to public resolver ==============

-- The public resolver should return the published config, not the draft.
-- Change the draft after publishing.
select tests.set_actor('aa100000-0000-0000-0000-000000000001');
select * from public.rpc_customer_page_patch_draft(
    p_org_id => 'a1000000-0000-0000-0000-00000000000a',
    p_location_id => null,
    p_draft => '{"templateId":"editorial"}'::jsonb
);

select tests.set_service();

-- The public resolver should still return 'signature', not 'editorial'
select is(
    (select (published ->> 'templateId') from
        public.rpc_customer_page_resolve_public(
            'a1000000-0000-0000-0000-00000000000a',
            'c1000000-0000-0000-0000-00000000000a'
        )
    ),
    'signature',
    'public resolver returns published templateId, not draft'
);

-- =================== 22-23. Location override in public resolver ==========

-- Publish the location override
select tests.set_actor('aa100000-0000-0000-0000-000000000001');
select * from public.rpc_customer_page_patch_draft(
    p_org_id => 'a1000000-0000-0000-0000-00000000000a',
    p_location_id => 'c1000000-0000-0000-0000-00000000000a',
    p_draft => '{"templateId":"classic"}'::jsonb
);
select * from public.rpc_customer_page_publish(
    p_org_id => 'a1000000-0000-0000-0000-00000000000a',
    p_location_id => 'c1000000-0000-0000-0000-00000000000a'
);

select tests.set_service();

-- Location A should resolve to 'classic' (location override)
select is(
    (select (published ->> 'templateId') from
        public.rpc_customer_page_resolve_public(
            'a1000000-0000-0000-0000-00000000000a',
            'c1000000-0000-0000-0000-00000000000a'
        )
    ),
    'classic',
    'public resolver returns location override when published'
);

-- Location B should fall back to org-level 'signature'
select is(
    (select (published ->> 'templateId') from
        public.rpc_customer_page_resolve_public(
            'a1000000-0000-0000-0000-00000000000a',
            'c1000000-0000-0000-0000-00000000000b'
        )
    ),
    'signature',
    'public resolver falls back to org-level when no location override'
);

-- =================== 24. No profile returns empty ========================

select tests.set_service();

select is(
    (select count(*) from
        public.rpc_customer_page_resolve_public(
            'a2000000-0000-0000-0000-00000000000a',
            'c2000000-0000-0000-0000-00000000000a'
        )
    ),
    0::bigint,
    'public resolver returns no rows for unpublished org'
);

-- =================== 25-26. Asset table RLS ==============================

-- anon cannot see assets
select tests.set_anon();
select throws_ok(
    $$ select 1 from public.customer_page_assets $$,
    '42501', null,
    'anon cannot read customer_page_assets'
);

-- org2 cannot see org1 assets
select tests.set_service();
insert into public.customer_page_assets
    (id, org_id, kind, state)
values
    ('e1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-00000000000a', 'hero', 'pending');

select tests.set_actor('aa100000-0000-0000-0000-000000000003');
select is(
    (select count(*) from public.customer_page_assets where org_id = 'a1000000-0000-0000-0000-00000000000a'),
    0::bigint,
    'org2 owner cannot see org1 assets'
);

-- =================== 27-28. Asset create RPC ==============================

select tests.set_actor('aa100000-0000-0000-0000-000000000001');

select isnt(
    (select public.rpc_customer_page_create_asset_upload(
        p_org_id => 'a1000000-0000-0000-0000-00000000000a',
        p_location_id => null,
        p_kind => 'hero',
        p_source_object_path => 'customer-page/source/ab/test.jpg',
        p_source_content_type => 'image/jpeg'
    )),
    null,
    'owner can create asset upload reservation'
);

-- Wrong content type rejected
select throws_ok(
    $$select public.rpc_customer_page_create_asset_upload(
        p_org_id => 'a1000000-0000-0000-0000-00000000000a',
        p_location_id => null,
        p_kind => 'hero',
        p_source_object_path => 'test.svg',
        p_source_content_type => 'image/svg+xml'
    )$$,
    '22023', null,
    'SVG content type rejected'
);

-- =================== 29. Viewer cannot create asset upload =================

select tests.set_actor('aa100000-0000-0000-0000-000000000004');

select throws_ok(
    $$select public.rpc_customer_page_create_asset_upload(
        p_org_id => 'a1000000-0000-0000-0000-00000000000a',
        p_location_id => null,
        p_kind => 'logo',
        p_source_object_path => 'test.png',
        p_source_content_type => 'image/png'
    )$$,
    '42501', null,
    'viewer cannot create asset upload'
);

-- =================== 30-31. Publish with non-ready hero rejected =========

select tests.set_service();

-- Create a pending asset and reference it in the draft
insert into public.customer_page_assets
    (id, org_id, kind, state)
values
    ('e1000000-0000-0000-0000-00000000000b', 'a1000000-0000-0000-0000-00000000000a', 'hero', 'pending');

select tests.set_actor('aa100000-0000-0000-0000-000000000001');
select * from public.rpc_customer_page_patch_draft(
    p_org_id => 'a1000000-0000-0000-0000-00000000000a',
    p_location_id => null,
    p_draft => ('{"templateId":"modern","hero":{"assetId":"e1000000-0000-0000-0000-00000000000b"}}')::jsonb
);

select throws_ok(
    $$select * from public.rpc_customer_page_publish(
        p_org_id => 'a1000000-0000-0000-0000-00000000000a'
    )$$,
    '22023', null,
    'publish rejects non-ready hero asset'
);

-- Fix: finalize the asset and try again
select tests.set_service();
update public.customer_page_assets
   set state = 'ready', width = 1200, height = 800,
       variants = '[{"width":1200,"height":800,"path":"public/a.webp","contentType":"image/webp","bytes":50000}]'::jsonb
 where id = 'e1000000-0000-0000-0000-00000000000b';

select tests.set_actor('aa100000-0000-0000-0000-000000000001');
select is(
    (select count(*) from public.rpc_customer_page_publish(
        p_org_id => 'a1000000-0000-0000-0000-00000000000a'
    )),
    1::bigint,
    'publish succeeds with ready hero asset'
);

-- =================== 32. Publish with foreign-org asset rejected ==========

select tests.set_service();
insert into public.customer_page_assets
    (id, org_id, kind, state, width, height,
     variants)
values
    ('e2000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-00000000000a', 'hero', 'ready',
     1000, 600,
     '[{"width":1000,"height":600,"path":"public/b.webp","contentType":"image/webp","bytes":40000}]'::jsonb);

select tests.set_actor('aa100000-0000-0000-0000-000000000001');
select * from public.rpc_customer_page_patch_draft(
    p_org_id => 'a1000000-0000-0000-0000-00000000000a',
    p_location_id => null,
    p_draft => ('{"templateId":"modern","hero":{"assetId":"e2000000-0000-0000-0000-00000000000a"}}')::jsonb
);

select throws_ok(
    $$select * from public.rpc_customer_page_publish(
        p_org_id => 'a1000000-0000-0000-0000-00000000000a'
    )$$,
    '22023', null,
    'publish rejects asset from another org'
);

-- =================== 33-34. Unique constraint enforcement =================

select tests.set_service();

-- One org default only
select throws_ok(
    $$insert into public.customer_page_profiles (org_id, scope, draft) values ('a1000000-0000-0000-0000-00000000000a', 'organization', '{}')$$,
    '23505', null,
    'cannot insert second org-level profile'
);

-- One per location only
select throws_ok(
    $$insert into public.customer_page_profiles (org_id, scope, location_id, draft) values ('a1000000-0000-0000-0000-00000000000a', 'location', 'c1000000-0000-0000-0000-00000000000a', '{}')$$,
    '23505', null,
    'cannot insert second location-level profile'
);

-- =================== 35. scope_shape constraint ===========================

select throws_ok(
    $$insert into public.customer_page_profiles (org_id, scope, location_id, draft) values ('a1000000-0000-0000-0000-00000000000a', 'organization', 'c1000000-0000-0000-0000-00000000000b', '{}')$$,
    '23514', null,
    'organization scope cannot have location_id'
);

-- =================== 36. publish_shape constraint =========================

select throws_ok(
    $$insert into public.customer_page_profiles
        (id, org_id, scope, draft, published_version, published, published_at)
      values
        ('d3000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-00000000000a', 'organization',
         '{}', 1, null, now())$$,
    '23514', null,
    'published_version > 0 without published snapshot violates constraint'
);

-- =================== 37. Audit events recorded ===========================

select is(
    (select count(*) from public.audit_events
     where org_id = 'a1000000-0000-0000-0000-00000000000a'
       and action like 'customer_page.%') > 0,
    true,
    'customer page audit events recorded'
);

-- =================== 38-42. All six templates pass publish =================

-- Clean slate for template test
select tests.set_service();
delete from public.customer_page_profiles
 where org_id = 'a2000000-0000-0000-0000-00000000000a';

-- For each template, draft and publish
select tests.set_actor('aa100000-0000-0000-0000-000000000003');

-- signature
select * from public.rpc_customer_page_patch_draft('a2000000-0000-0000-0000-00000000000a', null, '{"templateId":"signature"}'::jsonb);
select is(
    (select count(*) from public.rpc_customer_page_publish('a2000000-0000-0000-0000-00000000000a')),
    1::bigint, 'template signature publishes'
);

-- modern
select * from public.rpc_customer_page_patch_draft('a2000000-0000-0000-0000-00000000000a', null, '{"templateId":"modern"}'::jsonb);
select is(
    (select count(*) from public.rpc_customer_page_publish('a2000000-0000-0000-0000-00000000000a')),
    1::bigint, 'template modern publishes'
);

-- bold
select * from public.rpc_customer_page_patch_draft('a2000000-0000-0000-0000-00000000000a', null, '{"templateId":"bold"}'::jsonb);
select is(
    (select count(*) from public.rpc_customer_page_publish('a2000000-0000-0000-0000-00000000000a')),
    1::bigint, 'template bold publishes'
);

-- editorial
select * from public.rpc_customer_page_patch_draft('a2000000-0000-0000-0000-00000000000a', null, '{"templateId":"editorial"}'::jsonb);
select is(
    (select count(*) from public.rpc_customer_page_publish('a2000000-0000-0000-0000-00000000000a')),
    1::bigint, 'template editorial publishes'
);

-- classic handled above already; minimal here
select * from public.rpc_customer_page_patch_draft('a2000000-0000-0000-0000-00000000000a', null, '{"templateId":"minimal"}'::jsonb);
select is(
    (select count(*) from public.rpc_customer_page_publish('a2000000-0000-0000-0000-00000000000a')),
    1::bigint, 'template minimal publishes'
);


select * from finish();

rollback;
