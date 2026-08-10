-- Local development seed.
--
-- Applied automatically by `supabase db reset`. Development only — it creates
-- two organizations so cross-tenant behaviour is visible in Studio without
-- having to construct it by hand every time.
--
-- The stand token digests below are computed from CUSTOMER_NOTE_ENCRYPTION_KEY,
-- so they only resolve if your `.env.local` uses the development key printed by
-- `scripts/backend/seed-stand.mjs`. Run that script to mint a real token and
-- print the URL to open.
--
-- Nothing here is a secret: it is fixture data on a throwaway local database.

insert into public.organizations (id, name, slug, timezone, default_locale)
values
    ('11111111-1111-1111-1111-111111111111', 'The Corner Cafe', 'corner-cafe', 'Europe/London', 'en'),
    ('22222222-2222-2222-2222-222222222222', 'Rival Bistro', 'rival-bistro', 'America/New_York', 'en')
on conflict (id) do nothing;

insert into public.locations
    (id, org_id, name, city, country_code, timezone, google_review_url, default_locale)
values
    ('aaaa1111-1111-1111-1111-111111111111',
     '11111111-1111-1111-1111-111111111111',
     'High Street', 'London', 'GB', 'Europe/London',
     'https://g.page/r/CdCornerCafeSample/review', 'en'),
    ('bbbb2222-2222-2222-2222-222222222222',
     '22222222-2222-2222-2222-222222222222',
     'Main Street', 'Boston', 'US', 'America/New_York',
     'https://g.page/r/CdRivalBistroSample/review', 'en')
on conflict (id) do nothing;

-- A location with no Google URL, to exercise the not-yet-serviceable path: it
-- must be indistinguishable from an unknown token.
insert into public.locations (id, org_id, name, timezone, default_locale)
values
    ('cccc3333-3333-3333-3333-333333333333',
     '11111111-1111-1111-1111-111111111111',
     'Unconfigured Kiosk', 'Europe/London', 'en')
on conflict (id) do nothing;
