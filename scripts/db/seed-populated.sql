-- Production-shaped rows for the populated-upgrade test.
--
-- Two organizations, because the single-tenant seed is the one that never
-- catches a cross-tenant bug. Deterministic ids so assertions can name rows.
-- Ratings and read/unread state are spread on purpose: the Home unread
-- definition and the rating breakdown are both asserted against these counts.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'owner-a@example.test', '{"full_name":"Owner A"}'),
  ('22222222-2222-2222-2222-222222222222', 'owner-b@example.test', '{"full_name":"Owner B"}'),
  ('33333333-3333-3333-3333-333333333333', 'viewer-a@example.test', '{"full_name":"Viewer A"}');

insert into public.organizations (id, name, slug, timezone) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Mario''s Pizza',  'marios-pizza',  'America/New_York'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Rival Coffee',    'rival-coffee',  'Europe/Berlin');

insert into public.organization_members (org_id, user_id, role, status, joined_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner',  'active', now()),
  ('aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'viewer', 'active', now()),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'owner',  'active', now());

insert into public.locations (id, org_id, name, timezone, google_review_url) values
  ('a10c0000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Main Street', 'America/New_York', 'https://search.google.com/local/writereview?placeid=AAA'),
  ('a10c0000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Airport',     'America/New_York', 'https://search.google.com/local/writereview?placeid=BBB'),
  ('b10c0000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'Hauptstrasse','Europe/Berlin',    'https://search.google.com/local/writereview?placeid=CCC');

insert into public.review_stands
  (id, org_id, location_id, public_token_hash, public_token_prefix, label, stand_type, status, activated_at) values
  ('a57a0000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'a10c0000-0000-0000-0000-000000000001', 'hash-a-front-desk', 'aaaa1', 'Front Desk', 'physical_nfc',  'active',  now()),
  ('a57a0000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'a10c0000-0000-0000-0000-000000000001', 'hash-a-table-two',  'aaaa2', 'Table Two',  'printable_qr',  'active',  now()),
  ('a57a0000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'a10c0000-0000-0000-0000-000000000002', 'hash-a-retired',    'aaaa3', 'Old Sign',   'printable_qr',  'retired', now()),
  ('b57a0000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'b10c0000-0000-0000-0000-000000000001', 'hash-b-counter',    'bbbb1', 'Counter',    'physical_nfc',  'active',  now());

-- Sessions and responses. Org A: ratings 5,5,4,2,1 with a mix of read state and
-- note presence. Org B: one 5, to prove counts never bleed across tenants.
insert into public.public_review_sessions
  (id, org_id, location_id, stand_id, session_token_hash, locale, expires_at, created_at) values
  ('a5e50000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'a10c0000-0000-0000-0000-000000000001', 'a57a0000-0000-0000-0000-000000000001', 'sess-a-1', 'en', now() + interval '1 hour', now() - interval '3 hours'),
  ('a5e50000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'a10c0000-0000-0000-0000-000000000001', 'a57a0000-0000-0000-0000-000000000001', 'sess-a-2', 'en', now() + interval '1 hour', now() - interval '2 hours'),
  ('a5e50000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'a10c0000-0000-0000-0000-000000000001', 'a57a0000-0000-0000-0000-000000000002', 'sess-a-3', 'en', now() + interval '1 hour', now() - interval '90 minutes'),
  ('a5e50000-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'a10c0000-0000-0000-0000-000000000002', 'a57a0000-0000-0000-0000-000000000003', 'sess-a-4', 'en', now() + interval '1 hour', now() - interval '60 minutes'),
  ('a5e50000-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000001', 'a10c0000-0000-0000-0000-000000000001', 'a57a0000-0000-0000-0000-000000000002', 'sess-a-5', 'en', now() + interval '1 hour', now() - interval '30 minutes'),
  ('b5e50000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'b10c0000-0000-0000-0000-000000000001', 'b57a0000-0000-0000-0000-000000000001', 'sess-b-1', 'de', now() + interval '1 hour', now() - interval '45 minutes');

insert into public.customer_responses
  (id, org_id, location_id, stand_id, session_id, response_token_hash, rating, note_encrypted, submitted_at, read_at) values
  -- unread, no note  -> the row that makes "unread count" and "unread list" disagree today
  ('a4e50000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'a10c0000-0000-0000-0000-000000000001', 'a57a0000-0000-0000-0000-000000000001', 'a5e50000-0000-0000-0000-000000000001', 'resp-a-1', 5, null,          now() - interval '3 hours',   null),
  -- unread, with note
  ('a4e50000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'a10c0000-0000-0000-0000-000000000001', 'a57a0000-0000-0000-0000-000000000001', 'a5e50000-0000-0000-0000-000000000002', 'resp-a-2', 2, 'ciphertext2', now() - interval '2 hours',   null),
  -- read, with note
  ('a4e50000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'a10c0000-0000-0000-0000-000000000001', 'a57a0000-0000-0000-0000-000000000002', 'a5e50000-0000-0000-0000-000000000003', 'resp-a-3', 4, 'ciphertext3', now() - interval '90 minutes', now() - interval '80 minutes'),
  -- unread, no note, on the retired stand
  ('a4e50000-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'a10c0000-0000-0000-0000-000000000002', 'a57a0000-0000-0000-0000-000000000003', 'a5e50000-0000-0000-0000-000000000004', 'resp-a-4', 1, null,          now() - interval '60 minutes', null),
  -- read, no note
  ('a4e50000-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000001', 'a10c0000-0000-0000-0000-000000000001', 'a57a0000-0000-0000-0000-000000000002', 'a5e50000-0000-0000-0000-000000000005', 'resp-a-5', 5, null,          now() - interval '30 minutes', now() - interval '20 minutes'),
  ('b4e50000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'b10c0000-0000-0000-0000-000000000001', 'b57a0000-0000-0000-0000-000000000001', 'b5e50000-0000-0000-0000-000000000001', 'resp-b-1', 5, 'ciphertextB', now() - interval '45 minutes', null);

insert into public.google_review_clicks (org_id, location_id, response_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a10c0000-0000-0000-0000-000000000001', 'a4e50000-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a10c0000-0000-0000-0000-000000000001', 'a4e50000-0000-0000-0000-000000000005');

-- Historical praise rows. V1 stops accepting these from the public contract;
-- the rows and the owner read paths stay, and this seed proves the upgrade
-- does not touch them.
insert into public.team_praise_records
  (org_id, location_id, response_id, first_name_encrypted, praise_note_encrypted) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a10c0000-0000-0000-0000-000000000001', 'a4e50000-0000-0000-0000-000000000003', 'enc-first-name', 'enc-praise'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b10c0000-0000-0000-0000-000000000001', 'b4e50000-0000-0000-0000-000000000001', 'enc-first-name-b', null);

insert into public.audit_events (org_id, actor_user_id, action, target_type, target_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'stand.created', 'review_stand', 'a57a0000-0000-0000-0000-000000000001');

commit;
