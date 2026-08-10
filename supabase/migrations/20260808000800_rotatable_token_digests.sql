-- Make stand token rotation survivable.
--
-- THE PROBLEM THIS FIXES
-- ----------------------
-- A stand token is stored only as a keyed digest, which is right: a database
-- disclosure must not yield working tokens. But the key doing that digesting
-- was the same key encrypting customer notes, and the two have completely
-- different rotation properties.
--
-- Encrypted content is re-encryptable: the ciphertext carries a key version, so
-- old and new coexist during a migration.
--
-- A digest is not. There is no way to recompute a digest under a new key
-- without the original token — and the whole point is that we do not keep it.
-- Rotating that key would therefore invalidate every `public_token_hash` at
-- once, which means **every printed QR code and every NFC tag in the field
-- stops resolving**. Those are physical objects on customers' tables. They
-- cannot be recalled, and a business would have to reprint and physically
-- replace all of them.
--
-- That turns a routine security action — rotating a key after a suspected
-- exposure — into an event that costs the customer money and downtime. Which
-- means in practice it would not be done, and a leaked key would stay live.
--
-- THE FIX
-- -------
-- Two changes:
--
--   1. Token digests use their own key, separate from the content encryption
--      key, so each can rotate on its own schedule.
--
--   2. A version column, plus lazy re-digesting. The one moment the raw token
--      *does* exist is when a customer scans the code — so resolution accepts
--      the previous key as a fallback, and when it matches, it rewrites the row
--      under the current key. Stands migrate themselves as they are used, with
--      no reprinting and no downtime.
--
-- A stand nobody scans stays on the old key until someone does, which is
-- correct: an unused stand is not a live exposure, and it will migrate the
-- moment it becomes one.

alter table public.review_stands
    add column public_token_key_version smallint not null default 1;

comment on column public.review_stands.public_token_key_version is
    'Which token digest key produced public_token_hash. Lazily upgraded on scan '
    'during a rotation, so printed stands never need reissuing.';

-- Resolution during a rotation checks two digests, so the index has to serve
-- lookups by either.
create index review_stands_token_version_idx
    on public.review_stands (public_token_key_version);

/**
 * Resolve a stand, accepting the previous key's digest during a rotation.
 *
 * `p_previous_token_hash` is null outside a rotation, in which case this
 * behaves exactly as before. Returns the matched version so the caller knows
 * whether an upgrade is owed.
 *
 * Still returns no row for an unknown, paused, or retired stand, so those
 * remain indistinguishable.
 */
create or replace function app.resolve_public_stand(
    p_token_hash          text,
    p_previous_token_hash text default null
)
returns table (
    org_id             uuid,
    location_id        uuid,
    stand_id           uuid,
    business_name      text,
    location_name      text,
    google_review_url  text,
    default_locale     text,
    matched_key_version smallint
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

/**
 * Re-digest one stand under the current key.
 *
 * Called only after a resolution matched the previous key, which is the only
 * moment the raw token is in hand. Guarded on the old digest so a concurrent
 * upgrade cannot write twice, and on the version so a stand already migrated is
 * left alone.
 */
create or replace function app.upgrade_stand_token_digest(
    p_old_token_hash text,
    p_new_token_hash text,
    p_new_version    smallint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    updated integer;
begin
    update public.review_stands s
       set public_token_hash = p_new_token_hash,
           public_token_key_version = p_new_version,
           updated_at = now()
     where s.public_token_hash = p_old_token_hash
       and s.public_token_key_version < p_new_version;

    get diagnostics updated = row_count;
    return updated > 0;
end;
$$;

-- ------------------------------------------------------- rpc surface ------

create or replace function public.rpc_public_resolve_stand(
    p_token_hash          text,
    p_previous_token_hash text default null
)
returns table (
    org_id             uuid,
    location_id        uuid,
    stand_id           uuid,
    business_name      text,
    location_name      text,
    google_review_url  text,
    default_locale     text,
    matched_key_version smallint
)
language sql
stable
security invoker
set search_path = ''
as $$
    select * from app.resolve_public_stand(p_token_hash, p_previous_token_hash);
$$;

create or replace function public.rpc_upgrade_stand_token_digest(
    p_old_token_hash text,
    p_new_token_hash text,
    p_new_version    smallint
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
    select app.upgrade_stand_token_digest(p_old_token_hash, p_new_token_hash, p_new_version);
$$;

-- The single-argument form is replaced by the two-argument one above. Dropping
-- it keeps the callable surface to exactly what the flow uses.
drop function if exists public.rpc_public_resolve_stand(text);

revoke all on function app.resolve_public_stand(text, text) from public, anon, authenticated;
revoke all on function app.upgrade_stand_token_digest(text, text, smallint) from public, anon, authenticated;
revoke all on function public.rpc_public_resolve_stand(text, text) from public, anon, authenticated;
revoke all on function public.rpc_upgrade_stand_token_digest(text, text, smallint) from public, anon, authenticated;

grant execute on function public.rpc_public_resolve_stand(text, text) to service_role;
grant execute on function public.rpc_upgrade_stand_token_digest(text, text, smallint) to service_role;
