-- The documented local stack serves Storage over HTTP on loopback. This
-- constraint made a real local upload fail at confirmation, though Storage
-- had received the bytes. Hosted artwork still requires HTTPS; the exception
-- is restricted to loopback origins. Customer presentation also refuses this
-- development exception in a production build.
alter table public.customer_page_assets
    drop constraint customer_page_assets_public_url_check;

alter table public.customer_page_assets
    add constraint customer_page_assets_public_url_check check (
        public_url is null
        or public_url ~ '^https://'
        or public_url ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]+)?/'
    );
