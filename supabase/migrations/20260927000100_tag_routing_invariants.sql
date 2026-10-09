-- The Tag is dumb. ReviewBoost is the routing layer.
--
-- A physical Tag — a printed QR code, an NFC chip — carries one thing: the
-- stable ReviewBoost URL `/q/{public token}`. Everything behind it is resolved
-- from server state at the moment a customer opens it:
--
--   public token → review_stands row → organization / location
--                → published Customer Page + current destination
--
-- So a business can change its Google link, its Customer Page, or which
-- location a Tag belongs to, and every Tag already in the field follows on the
-- very next scan. Nothing is reprinted or reprogrammed.
--
-- AUDIT RESULT
-- ------------
-- The architecture already had this shape. `review_stands` *is* the routing
-- record, keyed by the public token's digest; the destination and the page are
-- joined in at resolution time (`app.resolve_public_stand`), never copied onto
-- the Tag. Rotating the *digest key* re-hashes lazily on scan without changing
-- the token (20260808000800). The only thing that changes the printed URL is
-- the explicit owner/admin action "Make a new code" (`rpc_rotate_stand_token`),
-- which exists to revoke a Tag that has leaked or been copied.
--
-- No migration to a separate "public id → routing record" table is needed:
-- that indirection is already here. What was missing was enforcement — nothing
-- stopped a future write path from touching the Tag's identity as a side
-- effect, and nothing required a destination to be a review-writing link. This
-- migration adds both.
--
-- 1. TAG IDENTITY IS IMMUTABLE EXCEPT BY EXPLICIT ROTATION
--    A trigger refuses any change to a Tag's public token digest, prefix or
--    reprint ciphertext unless the same write is either
--      * the explicit rotation (it stamps token_rotated_at), or
--      * a key-version upgrade that re-digests / re-encrypts the SAME token.
--    Editing a label, moving a Tag to another location, changing a
--    destination, publishing a Customer Page, pausing or programming a Tag —
--    none of them can alter what is printed on it.
--
-- 2. NEW DESTINATIONS MUST BE GOOGLE REVIEW-WRITING LINKS
--    The resolvable allowlist (`_validate_google_review_url`) accepts any
--    Google Maps listing or opaque short link. Those open a place page, not the
--    review box, and a short link can be re-pointed by whoever controls it.
--    Any destination that is set or changed from now on must be one of the
--    two forms that open Google's review-writing dialog for a specific place:
--      https://search.google.com/local/writereview?placeid=<place id>
--      https://g.page/r/<profile id>/review
--    Existing rows keep resolving under the old allowlist, so no Tag in the
--    field goes dark; the next time an owner edits the destination it has to
--    be a review link.

-- ======================================================= strict validator ==

create or replace function public._is_google_review_writing_url(p_url text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
    v_rest  text;
    v_slash integer;
    v_auth  text;
    v_path  text;
    v_q     integer;
    v_query text;
begin
    -- The resolvable allowlist first: HTTPS, no credentials, no port, no
    -- oversized input, a Google host. Everything below only narrows it.
    if not public._validate_google_review_url(p_url) then
        return false;
    end if;

    v_rest  := substring(p_url from 9);
    v_slash := position('/' in v_rest);
    if v_slash = 0 then
        return false;
    end if;
    v_auth := rtrim(lower(substring(v_rest from 1 for v_slash - 1)), '.');
    v_path := substring(v_rest from v_slash);
    v_q    := position('?' in v_path);
    v_query := case when v_q > 0 then substring(v_path from v_q + 1) else '' end;
    if v_q > 0 then
        v_path := substring(v_path from 1 for v_q - 1);
    end if;
    -- A fragment never reaches Google's server; it cannot make a listing a
    -- review link.
    v_path := split_part(v_path, '#', 1);

    if v_auth = 'search.google.com' then
        return v_path = '/local/writereview'
           and ('&' || split_part(v_query, '#', 1)) ~ '&placeid=[A-Za-z0-9_-]+(&|$)';
    end if;

    if v_auth = 'g.page' then
        return v_path ~ '^/r/[A-Za-z0-9_-]+/review/?$';
    end if;

    return false;
end;
$$;

comment on function public._is_google_review_writing_url(text) is
    'True only for a Google link that opens the review-writing dialog for one '
    'place. Required for every destination set or changed after 2026-09-27.';

revoke all on function public._is_google_review_writing_url(text) from public, anon;
grant execute on function public._is_google_review_writing_url(text) to authenticated, service_role;

-- The provider-aware form, for write paths.
create or replace function public._validate_destination_write(
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
        return public._is_google_review_writing_url(p_url);
    end if;
    return false;
end;
$$;

revoke all on function public._validate_destination_write(text, text) from public, anon;
grant execute on function public._validate_destination_write(text, text) to authenticated, service_role;

-- ================================= every new destination is a review link ==

-- Runs after `locations_sync_destination` (triggers fire in name order), so a
-- legacy write of google_review_url is checked on the destination it produced.
-- Only a destination that is actually being set or changed is checked: a
-- rename of a location whose older link predates this rule still saves, and
-- its Tags keep working.
create or replace function app.enforce_review_link_destination()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.destination_url is null then
        return new;
    end if;

    if tg_op = 'UPDATE'
       and new.destination_url is not distinct from old.destination_url
       and new.destination_provider is not distinct from old.destination_provider then
        return new;
    end if;

    -- A URL outside the resolvable allowlist is left to the table's CHECK
    -- (locations_destination_valid_check), which refuses it as before. This
    -- trigger narrows only what that allowlist would otherwise let through.
    if not public._validate_destination_url(new.destination_provider, new.destination_url) then
        return new;
    end if;

    if not public._validate_destination_write(new.destination_provider, new.destination_url) then
        -- Same error the owner write path already raises for a bad URL, so
        -- every caller maps it to the same 422.
        raise exception 'invalid_destination_url' using errcode = 'P0001';
    end if;

    return new;
end;
$$;

drop trigger if exists locations_writereview_destination on public.locations;
create trigger locations_writereview_destination
    before insert or update of google_review_url, destination_provider, destination_url
    on public.locations
    for each row
    execute function app.enforce_review_link_destination();

-- ====================================== Tag identity: rotation only ========

create or replace function app.guard_tag_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_rotation boolean := new.token_rotated_at is distinct from old.token_rotated_at;
begin
    if new.public_token_hash is distinct from old.public_token_hash
       and not v_rotation
       and not (new.public_token_key_version > old.public_token_key_version) then
        raise exception 'tag_identity_immutable'
            using errcode = 'P0001',
                  detail = 'A Tag''s public token changes only through rpc_rotate_stand_token.';
    end if;

    if new.public_token_prefix is distinct from old.public_token_prefix and not v_rotation then
        raise exception 'tag_identity_immutable'
            using errcode = 'P0001',
                  detail = 'A Tag''s public token changes only through rpc_rotate_stand_token.';
    end if;

    -- The reprint ciphertext may be written the first time (a Tag created
    -- before reprinting existed), re-encrypted under a newer key, or replaced
    -- by a rotation. Anything else would print a code for a different token.
    if new.public_token_encrypted is distinct from old.public_token_encrypted
       and old.public_token_encrypted is not null
       and not v_rotation
       and not (new.token_encryption_key_version > old.token_encryption_key_version) then
        raise exception 'tag_identity_immutable'
            using errcode = 'P0001',
                  detail = 'A Tag''s public token changes only through rpc_rotate_stand_token.';
    end if;

    return new;
end;
$$;

drop trigger if exists review_stands_guard_identity on public.review_stands;
create trigger review_stands_guard_identity
    before update on public.review_stands
    for each row
    execute function app.guard_tag_identity();

comment on trigger review_stands_guard_identity on public.review_stands is
    'The URL printed on a Tag changes only by explicit rotation. Destination, '
    'Customer Page, location and label changes resolve at scan time instead.';
