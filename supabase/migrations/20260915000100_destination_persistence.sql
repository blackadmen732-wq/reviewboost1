-- ReviewBoost owns the door.
--
-- WHAT THIS CHANGES
-- -----------------
-- A Tag's QR and NFC carry one ReviewBoost URL, `/q/{token}`, and nothing
-- else. Where that door leads is server state — so it can be changed without
-- reprinting a single sticker or reprogramming a single chip.
--
-- Until now the only thing behind the door was `locations.google_review_url`,
-- a single text column. That made Google the architecture rather than the
-- first provider in it. This adds `destination_provider` and
-- `destination_url`, which together are the canonical destination, and
-- backfills them from every `google_review_url` that passes validation.
--
-- `google_review_url` IS DELIBERATELY NOT DROPPED. It stays as a
-- compatibility column, kept in step by the owner write path, for as long as
-- any reader still expects it. The canonical truth is the destination pair.
--
-- FAIL CLOSED
-- -----------
-- An unknown provider is rejected, not stored and ignored. A URL that is not
-- on that provider's host allowlist is rejected. HTTPS only, no credentials in
-- the authority, no ports. A location with no valid destination resolves to a
-- closed door, which the public API renders as the same dead link as an
-- unknown token.

-- ============================================================ validator =====

-- The provider-aware gate. Delegates to the existing Google validator for the
-- one provider V1 enables, and refuses everything else — so adding a provider
-- is a deliberate act here, never an accident at a call site.
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
    if p_provider is null or p_url is null then
        return false;
    end if;

    if p_provider = 'google' then
        return public._validate_google_review_url(p_url);
    end if;

    -- Unknown provider. There is no general "any HTTPS URL" branch and there
    -- must never be one: this function is the only thing standing between a
    -- compromised owner account and an open redirect on every Tag.
    return false;
end;
$$;

revoke all on function public._validate_destination_url(text, text)
    from public, anon;
grant execute on function public._validate_destination_url(text, text)
    to authenticated, service_role;

-- ================================================== destination columns =====

alter table public.locations
    add column if not exists destination_provider text,
    add column if not exists destination_url text;

comment on column public.locations.destination_provider is
    'Review destination provider. V1 enables ''google'' only. Null means no destination is configured and the door stays closed.';
comment on column public.locations.destination_url is
    'The validated destination URL for the configured provider. Canonical: google_review_url is compatibility storage only.';

-- Both set or both null. A provider with no URL and a URL with no provider are
-- each a half-configured door, and a half-configured door is the state where
-- someone reads one column and ignores the other.
alter table public.locations
    drop constraint if exists locations_destination_pair_check;
alter table public.locations
    add constraint locations_destination_pair_check
        check (
            (destination_provider is null and destination_url is null)
            or (destination_provider is not null and destination_url is not null)
        );

-- The allowlist, enforced by the database rather than trusted from the caller.
-- A direct UPDATE by a future migration, a console session, or a bug in an RPC
-- cannot store a destination this rejects.
alter table public.locations
    drop constraint if exists locations_destination_valid_check;
alter table public.locations
    add constraint locations_destination_valid_check
        check (
            destination_url is null
            or public._validate_destination_url(destination_provider, destination_url)
        );

-- ======================================================== backfill ==========

-- Every location whose existing Google URL still passes validation keeps
-- working with no owner action. One that does not is left with a null
-- destination: a closed door an owner can see and fix, rather than a URL the
-- resolver would reject on every scan.
update public.locations
   set destination_provider = 'google',
       destination_url      = google_review_url
 where destination_provider is null
   and google_review_url is not null
   and public._validate_google_review_url(google_review_url);

-- ============================================ compatibility window =========

-- For as long as `google_review_url` is still written — by the legacy owner
-- RPC, by a seed file, by a test fixture — the canonical destination has to
-- follow it, or a door configured through the old path would resolve as
-- closed. A trigger makes that true for every writer, including ones nobody
-- remembered to update, which is the whole risk of a compatibility window.
--
-- It only ever fills in a destination the caller did not set explicitly: a
-- write that names destination_provider/destination_url wins, because that is
-- the canonical path. An invalid Google URL leaves the destination null and
-- the door closed, which is the safe direction.
create or replace function app.sync_destination_from_google_url()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.destination_url is distinct from coalesce(old.destination_url, null)
       or new.destination_provider is distinct from coalesce(old.destination_provider, null) then
        -- The caller set the canonical fields. Leave them alone.
        return new;
    end if;

    if new.google_review_url is null or new.google_review_url = '' then
        new.destination_provider := null;
        new.destination_url      := null;
        return new;
    end if;

    if public._validate_google_review_url(new.google_review_url) then
        new.destination_provider := 'google';
        new.destination_url      := new.google_review_url;
    else
        new.destination_provider := null;
        new.destination_url      := null;
    end if;

    return new;
end;
$$;

drop trigger if exists locations_sync_destination on public.locations;
create trigger locations_sync_destination
    before insert or update of google_review_url, destination_provider, destination_url
    on public.locations
    for each row
    execute function app.sync_destination_from_google_url();

-- ================================================ resolver return shape =====

-- `create or replace function` cannot change a function's return type, and
-- `app.resolve_public_stand` is gaining two columns. The wrapper is dropped
-- first because it is the only object that names the old signature; the
-- plpgsql write functions read the result into a `record`, so they take the
-- wider row without change. Grants do not survive a drop and are restored
-- below.
drop function if exists public.rpc_public_resolve_stand(text, text);
drop function if exists app.resolve_public_stand(text, text);

/**
 * Resolve a stand to the business, the location, and the door behind it.
 *
 * Returns no row for an unknown, paused, or retired stand, an inactive
 * location, or a suspended organization — all of which stay indistinguishable
 * from each other and from a token that never existed.
 *
 * `p_previous_token_hash` is null outside a key rotation. The matched version
 * comes back so the caller knows whether a re-digest is owed.
 */
create function app.resolve_public_stand(
    p_token_hash          text,
    p_previous_token_hash text default null
)
returns table (
    org_id               uuid,
    location_id          uuid,
    stand_id             uuid,
    business_name        text,
    location_name        text,
    google_review_url    text,
    destination_provider text,
    destination_url      text,
    default_locale       text,
    matched_key_version  smallint
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

create function public.rpc_public_resolve_stand(
    p_token_hash          text,
    p_previous_token_hash text default null
)
returns table (
    org_id               uuid,
    location_id          uuid,
    stand_id             uuid,
    business_name        text,
    location_name        text,
    google_review_url    text,
    destination_provider text,
    destination_url      text,
    default_locale       text,
    matched_key_version  smallint
)
language sql
stable
security invoker
set search_path = ''
as $$
    select * from app.resolve_public_stand(p_token_hash, p_previous_token_hash);
$$;

revoke all on function app.resolve_public_stand(text, text)
    from public, anon, authenticated;
grant execute on function app.resolve_public_stand(text, text) to service_role;

revoke all on function public.rpc_public_resolve_stand(text, text)
    from public, anon, authenticated;
grant execute on function public.rpc_public_resolve_stand(text, text) to service_role;
