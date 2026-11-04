-- Tag key check: prove the keys a deployment holds still open the Tags in the
-- field, before it serves a single customer.
--
-- WHY
-- ---
-- Every printed QR code and every programmed NFC chip carries one ReviewBoost
-- link, and resolving it depends on two application keys:
--
-- * TOKEN_DIGEST_KEY (with TOKEN_DIGEST_KEY_PREVIOUS during a rotation)
--   matches the link to its row in review_stands;
-- * CUSTOMER_NOTE_ENCRYPTION_KEY reads the saved copy of the link that owners
--   reprint from.
--
-- A key pasted wrong, rotated without its predecessor, or replaced makes every
-- Tag stop opening at once, while the build, the home page and every check
-- that does not open a Tag still look fine. Readiness checked that the keys
-- were present and well formed; nothing checked that they were the right ones.
--
-- WHAT
-- ----
-- For each digest key version that live Tags use, how many Tags are on it,
-- and the saved copies of a few of them: the ciphertext and the stored digest.
-- The application decrypts each copy, recomputes its digest with the key it
-- holds for that version, and refuses readiness (and turns health red) when
-- they differ (frontend/lib/server/tag-keys.ts). Nothing leaves the server:
-- the routes answer with counts, versions and variable names, never a token.
--
-- Retired Tags are left out: they no longer open by design. Paused Tags are
-- in, because they open again the moment they are resumed. A Tag made before
-- reprintable stands (20260810000200) has no saved copy; it is counted and
-- never sampled.
--
-- Service role only.

create or replace function public.rpc_tag_key_sample(p_per_version integer default 3)
returns table (
    key_version     smallint,
    tags            bigint,
    token_encrypted text,
    token_hash      text
)
language sql
stable
security definer
set search_path = ''
as $$
    with per_version as (
        select s.public_token_key_version as version, count(*) as tags
          from public.review_stands s
         where s.status <> 'retired'
         group by s.public_token_key_version
    ),
    samples as (
        select s.public_token_key_version as version,
               s.public_token_encrypted,
               s.public_token_hash,
               row_number() over (
                   partition by s.public_token_key_version
                   order by s.created_at desc, s.id
               ) as position
          from public.review_stands s
         where s.status <> 'retired'
           and s.public_token_encrypted is not null
    )
    select pv.version, pv.tags, sm.public_token_encrypted, sm.public_token_hash
      from per_version pv
      left join samples sm
        on sm.version = pv.version
       and sm.position <= greatest(1, least(coalesce(p_per_version, 3), 10))
     order by pv.version, sm.position;
$$;

comment on function public.rpc_tag_key_sample(integer) is
    'Per digest key version of live Tags: the count, and up to p_per_version '
    '(1-10) saved copies with their stored digests, so readiness and health can '
    'prove the configured keys still open them. Service role only.';

revoke all on function public.rpc_tag_key_sample(integer) from public, anon, authenticated;
grant execute on function public.rpc_tag_key_sample(integer) to service_role;
