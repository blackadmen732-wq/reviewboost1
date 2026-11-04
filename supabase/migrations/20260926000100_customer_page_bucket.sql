-- The Customer Page image bucket, for every environment.
--
-- Until now the bucket existed only in supabase/config.toml, which configures
-- the local stack and nothing else: a hosted project that ran every migration
-- still had no bucket, and every owner upload failed at the signed-URL step.
--
-- Public read: a published page stamps the image's public URL into what a
-- customer's browser loads directly, and the bucket holds only what an owner
-- deliberately uploaded as their page's photo.
--
-- Writes are never public. No storage.objects policy grants anon or
-- authenticated an insert, update or delete here, so the only way in is the
-- signed upload URL the server mints (service role) for one path under the
-- caller's own organization — see lib/server/customer-page-service.ts.
--
-- The limits match the upload pipeline: the owner's browser normalises every
-- photo to JPEG or WebP under 5 MiB before asking for a ticket, and the API
-- still accepts PNG. Anything else is refused by storage itself.
--
-- Idempotent: re-running converges the bucket to these settings, whether it
-- was absent, created by hand in the dashboard, or seeded from config.toml.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'customer-page',
    'customer-page',
    true,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
    set name               = excluded.name,
        public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
