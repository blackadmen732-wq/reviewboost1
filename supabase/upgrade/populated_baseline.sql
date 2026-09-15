-- A realistic pre-destination database.
--
-- The populated-upgrade proof starts here: migrations applied only up to
-- 20260902000800, then this data, then the rest of the migrations. Anything
-- this file writes must survive that, unchanged, or the upgrade loses a
-- customer's rating, a business's history, or a tenant boundary.
--
-- The rows are deliberately awkward. One location has a Google URL that still
-- validates, one has a URL that never did, one has none at all, and one
-- belongs to a different tenant — because a backfill that only handles the
-- tidy row is a backfill that has not been tested.

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
    ('00000000-0e10-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'owner@legacy.test', 'x', now(), now()),
    ('00000000-0e10-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'rival@legacy.test', 'x', now(), now());

insert into public.organizations (id, name, slug, timezone, default_locale, status)
values
    ('00000000-0e10-0000-0000-000000000001', 'Legacy Diner', 'legacy-diner', 'America/New_York', 'en', 'active'),
    ('00000000-0e10-0000-0000-000000000002', 'Legacy Rival', 'legacy-rival', 'Europe/London', 'en', 'active');

insert into public.organization_members (org_id, user_id, role, status)
values
    ('00000000-0e10-0000-0000-000000000001', '00000000-0e10-0000-0000-0000000000a1', 'owner', 'active'),
    ('00000000-0e10-0000-0000-000000000002', '00000000-0e10-0000-0000-0000000000a2', 'owner', 'active');

insert into public.locations (id, org_id, name, google_review_url, default_locale, status)
values
    -- Valid legacy URL: must become the canonical destination.
    ('00000000-0e10-0000-0000-000000000011', '00000000-0e10-0000-0000-000000000001',
     'Legacy Main', 'https://g.page/r/legacy-main/review', 'en', 'active'),
    -- Passes the old https-only column check but not the Google host allowlist:
    -- must be left with no destination rather than smuggled through.
    ('00000000-0e10-0000-0000-000000000012', '00000000-0e10-0000-0000-000000000001',
     'Legacy Broken', 'https://not-google.example.com/review', 'en', 'active'),
    -- Never configured.
    ('00000000-0e10-0000-0000-000000000013', '00000000-0e10-0000-0000-000000000001',
     'Legacy Unset', null, 'en', 'active'),
    -- Another tenant entirely.
    ('00000000-0e10-0000-0000-000000000014', '00000000-0e10-0000-0000-000000000002',
     'Rival Main', 'https://search.google.com/local/writereview?placeid=RIVAL', 'en', 'active');

insert into public.review_stands (id, org_id, location_id, public_token_hash, public_token_prefix, status, public_token_key_version)
values
    ('00000000-0e10-0000-0000-000000000021', '00000000-0e10-0000-0000-000000000001',
     '00000000-0e10-0000-0000-000000000011', 'legacy-token-hash-1', 'lgcy0001', 'active', 1),
    ('00000000-0e10-0000-0000-000000000022', '00000000-0e10-0000-0000-000000000001',
     '00000000-0e10-0000-0000-000000000012', 'legacy-token-hash-2', 'lgcy0002', 'active', 1),
    ('00000000-0e10-0000-0000-000000000023', '00000000-0e10-0000-0000-000000000002',
     '00000000-0e10-0000-0000-000000000014', 'legacy-token-hash-3', 'lgcy0003', 'active', 1);

insert into public.public_review_sessions (id, org_id, location_id, stand_id, session_token_hash, locale, expires_at)
values
    ('00000000-0e10-0000-0000-000000000031', '00000000-0e10-0000-0000-000000000001',
     '00000000-0e10-0000-0000-000000000011', '00000000-0e10-0000-0000-000000000021',
     'legacy-session-hash-1', 'en', now() + interval '1 day'),
    ('00000000-0e10-0000-0000-000000000032', '00000000-0e10-0000-0000-000000000001',
     '00000000-0e10-0000-0000-000000000011', '00000000-0e10-0000-0000-000000000021',
     'legacy-session-hash-2', 'en', now() + interval '1 day'),
    ('00000000-0e10-0000-0000-000000000033', '00000000-0e10-0000-0000-000000000002',
     '00000000-0e10-0000-0000-000000000014', '00000000-0e10-0000-0000-000000000023',
     'legacy-session-hash-3', 'en', now() + interval '1 day');

-- Historical ratings, including the encrypted customer notes the V1 public
-- contract no longer accepts. The contract changed; the history did not.
insert into public.customer_responses
    (id, org_id, location_id, stand_id, session_id, response_token_hash, rating,
     note_encrypted, note_key_version, submitted_at)
values
    ('00000000-0e10-0000-0000-000000000041', '00000000-0e10-0000-0000-000000000001',
     '00000000-0e10-0000-0000-000000000011', '00000000-0e10-0000-0000-000000000021',
     '00000000-0e10-0000-0000-000000000031', 'legacy-response-hash-1', 5,
     'v1:legacy-ciphertext-one', 1, now() - interval '30 days'),
    ('00000000-0e10-0000-0000-000000000042', '00000000-0e10-0000-0000-000000000001',
     '00000000-0e10-0000-0000-000000000011', '00000000-0e10-0000-0000-000000000021',
     '00000000-0e10-0000-0000-000000000032', 'legacy-response-hash-2', 1,
     null, 1, now() - interval '10 days'),
    ('00000000-0e10-0000-0000-000000000043', '00000000-0e10-0000-0000-000000000002',
     '00000000-0e10-0000-0000-000000000014', '00000000-0e10-0000-0000-000000000023',
     '00000000-0e10-0000-0000-000000000033', 'legacy-response-hash-3', 4,
     null, 1, now() - interval '5 days');

-- The historical Google click rows the rename has to carry across intact.
insert into public.google_review_clicks (id, org_id, location_id, response_id, clicked_at)
values
    ('00000000-0e10-0000-0000-000000000051', '00000000-0e10-0000-0000-000000000001',
     '00000000-0e10-0000-0000-000000000011', '00000000-0e10-0000-0000-000000000041',
     now() - interval '30 days'),
    ('00000000-0e10-0000-0000-000000000052', '00000000-0e10-0000-0000-000000000002',
     '00000000-0e10-0000-0000-000000000014', '00000000-0e10-0000-0000-000000000043',
     now() - interval '5 days');

-- Historical Team Praise: removed from the public contract, kept as data.
insert into public.team_praise_records
    (id, org_id, location_id, response_id, first_name_encrypted, praise_note_encrypted, encryption_key_version)
values
    ('00000000-0e10-0000-0000-000000000061', '00000000-0e10-0000-0000-000000000001',
     '00000000-0e10-0000-0000-000000000011', '00000000-0e10-0000-0000-000000000041',
     'v1:legacy-first-name', 'v1:legacy-praise-ciphertext', 1);

insert into public.audit_events (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
values
    ('00000000-0e10-0000-0000-000000000001', '00000000-0e10-0000-0000-0000000000a1', 'user',
     'location.updated', 'location', '00000000-0e10-0000-0000-000000000011', '{}'::jsonb);
