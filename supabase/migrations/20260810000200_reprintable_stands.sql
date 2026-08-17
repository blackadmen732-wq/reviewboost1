-- Make a stand reprintable.
--
-- THE PROBLEM
-- -----------
-- Storing only a keyed digest of the stand token is right for lookups: a
-- database disclosure yields nothing that resolves. But it also means nothing
-- can regenerate the QR code. An owner who loses the printout, or wants a
-- second copy for a second till, would have to rotate the token — which
-- invalidates the copy already on the table.
--
-- "Reprint your stand" is an ordinary Tuesday, not a security event. A design
-- that turns it into one gets worked around, usually by someone writing the
-- token down somewhere far less safe than this database.
--
-- THE TRADE, STATED PLAINLY
-- -------------------------
-- The token is now also stored encrypted with AES-256-GCM under the application
-- key, which lives in a secret store and not in the database. So:
--
--   * A database disclosure alone still yields nothing usable. The ciphertext
--     is inert without the key.
--   * A database disclosure *plus* a key disclosure yields tokens. That is the
--     same exposure customer notes already carry, so it adds no new class of
--     risk — it widens an existing one.
--
-- Lookups continue to use the digest. Decryption happens only when an owner
-- asks to reprint, which keeps resolution an index scan rather than a table
-- walk that decrypts every row.

alter table public.review_stands
    add column public_token_encrypted text,
    add column token_encryption_key_version smallint not null default 1;

comment on column public.review_stands.public_token_encrypted is
    'AES-256-GCM under the application key, so an owner can reprint a stand '
    'without invalidating the copy already in the field. Lookups use '
    'public_token_hash; this is read only when reprinting.';

-- Stands created before this migration have no ciphertext and cannot be
-- reprinted. They keep working — resolution is unaffected — and the owner is
-- told to rotate if they need a new copy.
comment on column public.review_stands.token_encryption_key_version is
    'Key version for public_token_encrypted, so the content key can rotate '
    'independently of the digest key.';

/**
 * Store the reprintable ciphertext alongside the digest.
 *
 * Separate from creation so the older onboarding function keeps working, and so
 * this is the only statement that ever writes the ciphertext.
 */
create or replace function app.set_stand_token_ciphertext(
    p_stand_id     uuid,
    p_ciphertext   text,
    p_key_version  smallint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    actor   uuid := (select auth.uid());
    updated integer;
begin
    if actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    -- Membership is verified rather than trusted: this function writes to a
    -- specific stand, so it must confirm the caller owns the tenant it belongs
    -- to. Definer functions that skip this are how one tenant writes to another.
    update public.review_stands s
       set public_token_encrypted = p_ciphertext,
           token_encryption_key_version = p_key_version
     where s.id = p_stand_id
       and exists (
           select 1 from public.organization_members m
            where m.org_id = s.org_id
              and m.user_id = actor
              and m.status = 'active'
              and m.role in ('owner', 'admin')
       );

    get diagnostics updated = row_count;
    return updated > 0;
end;
$$;

create or replace function public.rpc_set_stand_token_ciphertext(
    p_stand_id    uuid,
    p_ciphertext  text,
    p_key_version smallint
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
    select app.set_stand_token_ciphertext(p_stand_id, p_ciphertext, p_key_version);
$$;

revoke all on function app.set_stand_token_ciphertext(uuid, text, smallint) from public, anon;
revoke all on function public.rpc_set_stand_token_ciphertext(uuid, text, smallint) from public, anon;
grant execute on function app.set_stand_token_ciphertext(uuid, text, smallint) to authenticated;
grant execute on function public.rpc_set_stand_token_ciphertext(uuid, text, smallint) to authenticated;
