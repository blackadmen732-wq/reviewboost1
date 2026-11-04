-- Count Tag opens: how many people tapped or scanned a Tag.
--
-- WHY
-- ---
-- Home exists to answer two questions for an owner: how many people tapped
-- the Tag, and how many stars they gave. Ratings were counted; taps were not.
-- The customer page now starts its session the moment it opens (it used to
-- wait for the star), so a session is an open. That also takes one round trip
-- off the tap itself: the star only has to save the rating.
--
-- A session was already "one logical scan" (`p_record_scan`, which keeps link
-- previews and crawlers out of `last_opened_at`). That decision was used once
-- and then thrown away, so the row could not say whether a person opened it.
-- It is now kept on the row, and an owner's count reads only those.
--
-- WHAT IS NOT COUNTED
-- -------------------
-- Opens by anything that looks like a bot. A customer whose browser never
-- runs the page's script still rates through /q/{token}/rate, which makes its
-- session at the tap: counted, just later.
--
-- Rows from before this migration were all made at a star tap, by a person
-- or a form post, so they default to counted.

alter table public.public_review_sessions
    add column if not exists counts_as_scan boolean not null default true;

comment on column public.public_review_sessions.counts_as_scan is
    'True when a person (not a link preview or crawler) opened the Tag. Home counts these as taps.';

-- No new index: owners count "this business, since a date", which
-- public_review_sessions_org_created_idx (org_id, created_at desc, from
-- 20260902000800_dashboard_indexes) already answers. Nearly every row counts,
-- so a partial copy would only add a write to every page open.

-- ---------------------------------------------------- create session ------
-- Identical to 20260817005852_token_rotation_write_continuity.sql except that
-- the insert keeps p_record_scan on the row.

create or replace function app.public_create_session(
    p_token_hash              text,
    p_idempotency_key         text,
    p_request_hash            text,
    p_session_token_hash      text,
    p_locale                  text,
    p_client_hash             text,
    p_session_ttl_seconds     integer,
    p_idempotency_ttl_seconds integer,
    p_record_scan             boolean,
    p_response_body_encrypted text,
    p_previous_token_hash     text default null
)
returns table (outcome text, response_status smallint, response_body_encrypted text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    stand      record;
    claim      record;
    scope_key    text;
    v_operation  text := 'session';
    old_replay   record;
begin
    select * into stand
      from app.resolve_public_stand(p_token_hash, p_previous_token_hash);
    if stand.stand_id is null then
        return query select 'unknown_stand'::text, null::smallint, null::text;
        return;
    end if;

    scope_key := stand.stand_id::text;

    select * into claim
      from app.claim_idempotency(stand.org_id, v_operation, scope_key, p_idempotency_key,
                                 p_request_hash, p_idempotency_ttl_seconds);

    -- Backward compatibility: check for completed records under the old scope
    -- key (p_token_hash was used before this migration). Prevents double writes
    -- for requests that started under the old scope scheme.
    if claim.outcome = 'claimed' then
        select ir.state, ir.request_hash, ir.response_status, ir.response_body_encrypted
          into old_replay
          from public.idempotency_records ir
         where ir.org_id = stand.org_id
           and ir.operation = v_operation
           and ir.idempotency_key = p_idempotency_key
           and ir.expires_at > now()
           and (ir.scope_key = p_token_hash
                or (p_previous_token_hash is not null and ir.scope_key = p_previous_token_hash))
         limit 1;

        if found then
            perform app.release_idempotency(v_operation, scope_key, p_idempotency_key);

            if old_replay.request_hash <> p_request_hash then
                return query select 'conflict'::text, null::smallint, null::text;
                return;
            end if;

            if old_replay.state = 'completed' then
                return query select 'replay'::text, old_replay.response_status, old_replay.response_body_encrypted;
                return;
            end if;

            return query select 'in_progress'::text, null::smallint, null::text;
            return;
        end if;
    end if;

    if claim.outcome <> 'claimed' then
        return query select claim.outcome, claim.response_status, claim.response_body_encrypted;
        return;
    end if;

    insert into public.public_review_sessions
        (org_id, location_id, stand_id, session_token_hash, locale, client_hash, expires_at,
         counts_as_scan)
    values
        (stand.org_id, stand.location_id, stand.stand_id, p_session_token_hash,
         p_locale, p_client_hash, now() + make_interval(secs => p_session_ttl_seconds),
         p_record_scan);

    if p_record_scan then
        update public.review_stands s
           set last_opened_at = now()
         where s.id = stand.stand_id;
    end if;

    perform app.complete_idempotency(v_operation, scope_key, p_idempotency_key,
                                     201::smallint, p_response_body_encrypted);

    return query select 'created'::text, 201::smallint, p_response_body_encrypted;
end;
$$;


-- Same signature, so existing grants carry over; restated so this file alone
-- says who may call it.
revoke all on function app.public_create_session(text, text, text, text, text, text, integer, integer, boolean, text, text) from public, anon, authenticated;
grant execute on function app.public_create_session(text, text, text, text, text, text, integer, integer, boolean, text, text) to service_role;
