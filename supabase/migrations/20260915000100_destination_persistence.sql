-- Destination persistence: authoritative provider-aware destination model.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- ReviewBoost owns the door (/q/{token}). The destination behind the door
-- should be server-controlled and provider-aware. Until now the only column
-- was google_review_url (text), which made Google permanent architecture.
--
-- This migration adds destination_provider and destination_url to locations,
-- backfills from validated google_review_url rows, updates resolve_public_stand
-- to return the canonical destination, and adds a server-side validator
-- for future provider allowlists.
--
-- google_review_url IS NOT DROPPED. It remains as a compatibility column while
-- old code is cut over. New writes should use destination_provider/url.
-- A later migration will tombstone google_review_url as deprecated.

-- ============================================================ validator =====

-- Returns true only for a destination URL that is on the exact server
-- allowlist for the given provider. Unknown provider always returns false.
--
-- This matches the TypeScript isValidDestinationUrl(provider, url) logic.
-- Both layers must agree — a URL that one accepts and the other rejects is
-- a security gap.
create or replace function public._validate_destination_url(
    p_provider text,
    p_url      text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
    if p_provider = 'google' then
        return public._validate_google_review_url(p_url);
    end if;
    -- Unknown provider: fail closed. Arbitrary URLs are never allowed.
    return false;
end;
$$;

revoke all on function public._validate_destination_url(text, text)
    from public, anon, authenticated;
grant execute on function public._validate_destination_url(text, text)
    to service_role;

-- ============================================== destination columns =========

alter table public.locations
    add column if not exists destination_provider text
        check (destination_provider is null or destination_provider in ('google')),
    add column if not exists destination_url text
        check (
            destination_url is null
            or (
                destination_provider is not null
                and public._validate_destination_url(destination_provider, destination_url)
            )
        );

comment on column public.locations.destination_provider is
    'Review destination provider. V1 supports ''google'' only. Null means no destination configured.';
comment on column public.locations.destination_url is
    'Validated review destination URL for the configured provider. Must pass the server allowlist.';

-- Paired constraint: provider and url must both be null or both be set.
alter table public.locations
    add constraint locations_destination_pair_check
        check (
            (destination_provider is null and destination_url is null)
            or (destination_provider is not null and destination_url is not null)
        );

-- ============================================== backfill ====================

-- Migrate any existing valid google_review_url to the new columns.
-- Invalid or null google_review_url rows are left with null destination.
-- This is idempotent: rows already backfilled (from a re-run) are untouched.
update public.locations
   set destination_provider = 'google',
       destination_url       = google_review_url
 where google_review_url is not null
   and google_review_url != ''
   and public._validate_google_review_url(google_review_url)
   and destination_provider is null;

-- ======================================= resolve_public_stand ==============

-- Add destination_provider and destination_url to the resolver return type.
-- Returns null destination columns when no destination is configured (the
-- caller is responsible for treating that as a closed door).
--
-- google_review_url is kept in the return set during the compatibility window
-- so old call sites that read that column continue to work without a
-- coordinated deploy. It will be removed in a later migration.
create or replace function app.resolve_public_stand(
    p_token_hash          text,
    p_previous_token_hash text default null
)
returns table (
    org_id                uuid,
    location_id           uuid,
    stand_id              uuid,
    business_name         text,
    location_name         text,
    google_review_url     text,
    destination_provider  text,
    destination_url       text,
    default_locale        text,
    matched_key_version   smallint
)
language sql
stable
security definer
set search_path = ''
as $$
    select o.id,
           l.id,
           s.id,
           o.name,
           l.name,
           l.google_review_url,
           l.destination_provider,
           l.destination_url,
           coalesce(l.default_locale, o.default_locale),
           s.public_token_key_version
      from public.review_stands s
      join public.locations l on l.id = s.location_id and l.org_id = s.org_id
      join public.organizations o on o.id = s.org_id
     where (s.public_token_hash = p_token_hash
            or (p_previous_token_hash is not null
                and s.public_token_hash = p_previous_token_hash))
       and s.status = 'active'
       and l.status = 'active'
       and o.status = 'active';
$$;

-- Grants remain the same as before.
revoke all on function app.resolve_public_stand(text, text) from public, anon, authenticated;
grant execute on function app.resolve_public_stand(text, text) to service_role;

-- ======================================= rpc_public_resolve_stand ==========

create or replace function public.rpc_public_resolve_stand(p_token_hash text)
returns table (
    org_id               uuid,
    location_id          uuid,
    stand_id             uuid,
    business_name        text,
    location_name        text,
    google_review_url    text,
    destination_provider text,
    destination_url      text,
    default_locale       text
)
language sql
stable
security invoker
set search_path = ''
as $$
    select org_id, location_id, stand_id, business_name, location_name,
           google_review_url, destination_provider, destination_url, default_locale
      from app.resolve_public_stand(p_token_hash);
$$;

revoke all on function public.rpc_public_resolve_stand(text) from public, anon, authenticated;
grant execute on function public.rpc_public_resolve_stand(text) to service_role;

-- ===================================== owner destination write =============

-- Replaces rpc_update_location google-url write path with a destination-aware
-- write. Called by the settings API. Validates provider + URL server-side.
-- An empty url clears the destination (both columns set to null).
create or replace function app.update_location_destination(
    p_location_id      uuid,
    p_org_id           uuid,
    p_provider         text,
    p_url              text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- Fail on unknown provider.
    if p_provider not in ('google') then
        raise exception 'unknown_destination_provider'
            using detail = 'Provider is not in the V1 allowlist.';
    end if;

    -- Empty url means clear the destination.
    if p_url = '' then
        update public.locations
           set destination_provider = null,
               destination_url      = null,
               google_review_url    = null,
               updated_at           = now()
         where id = p_location_id
           and org_id = p_org_id;
        return;
    end if;

    -- Validate URL against the provider's allowlist.
    if not public._validate_destination_url(p_provider, p_url) then
        raise exception 'invalid_destination_url'
            using detail = 'URL does not match the allowed pattern for this provider.';
    end if;

    update public.locations
       set destination_provider = p_provider,
           destination_url      = p_url,
           -- Keep google_review_url in sync during the compatibility window.
           google_review_url    = case when p_provider = 'google' then p_url else google_review_url end,
           updated_at           = now()
     where id = p_location_id
       and org_id = p_org_id;
end;
$$;

revoke all on function app.update_location_destination(uuid, uuid, text, text)
    from public, anon, authenticated;
grant execute on function app.update_location_destination(uuid, uuid, text, text)
    to service_role;
