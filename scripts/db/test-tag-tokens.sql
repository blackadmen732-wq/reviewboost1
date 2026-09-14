-- Tag / NFC / QR / token behaviour, verified against a real database.
--
-- These routes already exist. This is verification and hardening, not a
-- rebuild: each block states the property and then attempts the thing that
-- would violate it.

\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner-a@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'owner-b@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'viewer-a@example.test');

insert into public.organizations (id, name, slug) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'Org A', 'org-a'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'Org B', 'org-b');

insert into public.organization_members (org_id, user_id, role, status, joined_at) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'owner', 'active', now()),
  ('aaaaaaaa-0000-0000-0000-00000000000a', '44444444-4444-4444-4444-444444444444', 'viewer', 'active', now()),
  ('bbbbbbbb-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'owner', 'active', now());

insert into public.locations (id, org_id, name, google_review_url) values
  ('a10c0000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Main', 'https://search.google.com/local/writereview?placeid=A'),
  ('b10c0000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-00000000000b', 'Main', 'https://search.google.com/local/writereview?placeid=B');

insert into public.review_stands
  (id, org_id, location_id, public_token_hash, public_token_prefix, label, status,
   public_token_encrypted, token_encryption_key_version)
values
  ('a57a0000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a', 'a10c0000-0000-0000-0000-00000000000a', 'hash-a-active',  'aaaa01', 'Front Desk', 'active',  'cipher-a', 1),
  ('a57a0000-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-00000000000a', 'a10c0000-0000-0000-0000-00000000000a', 'hash-a-retired', 'aaaa02', 'Old Sign',   'retired', 'cipher-r', 1),
  ('a57a0000-0000-0000-0000-0000000000e2', 'aaaaaaaa-0000-0000-0000-00000000000a', 'a10c0000-0000-0000-0000-00000000000a', 'hash-a-paused',  'aaaa03', 'Patio',      'paused',  'cipher-p', 1),
  ('b57a0000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-00000000000b', 'b10c0000-0000-0000-0000-00000000000b', 'hash-b-active',  'bbbb01', 'Counter',    'active',  'cipher-b', 1);

create or replace function pg_temp.act_as(p_user uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p_user::text, false)::void $$;

-- ------------------------------------------------- 1. token uniqueness ------

do $$
begin
    begin
        insert into public.review_stands
          (org_id, location_id, public_token_hash, public_token_prefix, label, status,
           public_token_encrypted, token_encryption_key_version)
        values
          ('bbbbbbbb-0000-0000-0000-00000000000b', 'b10c0000-0000-0000-0000-00000000000b',
           'hash-a-active', 'dupe01', 'Collision', 'active', 'cipher-x', 1);
        raise exception 'two stands were allowed to share a token digest';
    exception when unique_violation then
        null;
    end;

    -- Across organizations too: the digest is the only thing authorising a
    -- write into a business, so a collision is a cross-tenant write.
    raise notice 'PASS a token digest is unique across every organization';
end
$$;

-- ------------------------- 2. rotation invalidates NFC readiness ------------

do $$
declare v_provisioned timestamptz; v_invalidated timestamptz; v_rotated timestamptz;
begin
    perform pg_temp.act_as('11111111-1111-1111-1111-111111111111');

    perform public.rpc_record_nfc_provision(
        'a57a0000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a', 'req-1');

    select nfc_provisioned_at into v_provisioned from public.review_stands
     where id = 'a57a0000-0000-0000-0000-00000000000a';
    if v_provisioned is null then raise exception 'provisioning was not recorded'; end if;

    -- Rotating changes the URL. Every tag written before this moment is dead.
    perform public.rpc_rotate_stand_token(
        'a57a0000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a',
        'hash-a-rotated', 'aaaa9z', 1::smallint, 'req-2', 'cipher-a2', 1::smallint);

    select nfc_provisioned_at, nfc_provision_invalidated_at, token_rotated_at
      into v_provisioned, v_invalidated, v_rotated
      from public.review_stands where id = 'a57a0000-0000-0000-0000-00000000000a';

    if v_provisioned is not null then
        raise exception 'rotation left the stand reading as provisioned: the tag in the shop is dead';
    end if;
    if v_invalidated is null then
        raise exception 'rotation did not record that a written tag was invalidated';
    end if;
    if v_rotated is null then
        raise exception 'rotation did not stamp token_rotated_at';
    end if;

    raise notice 'PASS rotation clears NFC readiness and records why';
end
$$;

-- ------------------------------ 3. re-provisioning after a rotation ---------

do $$
declare v_provisioned timestamptz; v_invalidated timestamptz;
begin
    perform pg_temp.act_as('11111111-1111-1111-1111-111111111111');
    perform public.rpc_record_nfc_provision(
        'a57a0000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a', 'req-3');

    select nfc_provisioned_at, nfc_provision_invalidated_at
      into v_provisioned, v_invalidated
      from public.review_stands where id = 'a57a0000-0000-0000-0000-00000000000a';

    if v_provisioned is null then raise exception 'rewrite was not recorded'; end if;
    if v_invalidated is not null then
        raise exception 'the stale marker survived a fresh write';
    end if;

    raise notice 'PASS rewriting after a rotation clears the stale marker';
end
$$;

-- --------------------- 4. a partial success is safe to retry ----------------

do $$
declare v_first timestamptz; v_second timestamptz; v_count integer;
begin
    -- The physical write landed; the server call did not. The client retries
    -- the same request. It must not require rewriting the tag, and it must not
    -- produce a second stand or a conflict.
    perform pg_temp.act_as('11111111-1111-1111-1111-111111111111');

    select recorded_at into v_first from public.rpc_record_nfc_provision(
        'a57a0000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a', 'req-4');
    select recorded_at into v_second from public.rpc_record_nfc_provision(
        'a57a0000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a', 'req-4');

    if v_first is null or v_second is null then
        raise exception 'a retry of a recorded provision did not succeed';
    end if;

    select count(*) into v_count from public.review_stands
     where org_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
    if v_count <> 3 then raise exception 'a retry changed the stand count: %', v_count; end if;

    raise notice 'PASS provisioning is idempotent, so a partial success is retryable';
end
$$;

-- ------------------------------- 5. inactive stands refuse provisioning -----

do $$
declare v_msg text; v_stand uuid;
begin
    perform pg_temp.act_as('11111111-1111-1111-1111-111111111111');

    -- Writing a retired or paused stand's URL to a tag produces a tag that
    -- fails the moment a customer taps it.
    foreach v_stand in array array['a57a0000-0000-0000-0000-0000000000e1'::uuid,
                                   'a57a0000-0000-0000-0000-0000000000e2'::uuid] loop
        begin
            perform public.rpc_record_nfc_provision(
                v_stand, 'aaaaaaaa-0000-0000-0000-00000000000a', 'req-5');
            raise exception 'an inactive stand accepted provisioning: %', v_stand;
        exception when sqlstate 'P0001' then
            get stacked diagnostics v_msg = message_text;
            if v_msg <> 'not_found_or_forbidden' then raise; end if;
        end;
    end loop;

    raise notice 'PASS retired and paused stands refuse provisioning, identically';
end
$$;

-- ------------------------------------------- 6. cross-org isolation ---------

do $$
declare v_msg text; v_hash text;
begin
    perform pg_temp.act_as('11111111-1111-1111-1111-111111111111');

    -- Owner A provisioning Org B's stand.
    begin
        perform public.rpc_record_nfc_provision(
            'b57a0000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-00000000000b', 'req-6');
        raise exception 'owner A provisioned org B''s stand';
    exception when sqlstate 'P0001' then
        get stacked diagnostics v_msg = message_text;
        if v_msg <> 'not_found_or_forbidden' then raise; end if;
    end;

    -- Owner A naming their own org but B's stand id: the RPC filters on both.
    begin
        perform public.rpc_record_nfc_provision(
            'b57a0000-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-00000000000a', 'req-6');
        raise exception 'a stand was provisioned through another org''s id';
    exception when sqlstate 'P0001' then
        get stacked diagnostics v_msg = message_text;
        if v_msg <> 'not_found_or_forbidden' then raise; end if;
    end;

    -- Owner A rotating Org B's token.
    begin
        perform public.rpc_rotate_stand_token(
            'b57a0000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-00000000000b',
            'hash-stolen', 'xxxx01', 1::smallint, 'req-6', null, null);
        raise exception 'owner A rotated org B''s token';
    exception when sqlstate 'P0001' then
        get stacked diagnostics v_msg = message_text;
        if v_msg <> 'not_found_or_forbidden' then raise; end if;
    end;

    select public_token_hash into v_hash from public.review_stands
     where id = 'b57a0000-0000-0000-0000-00000000000b';
    if v_hash <> 'hash-b-active' then
        raise exception 'org B''s token changed: %', v_hash;
    end if;

    raise notice 'PASS org A cannot provision or rotate anything belonging to org B';
end
$$;

-- --------------------------------- 7. lower roles cannot provision ----------

do $$
declare v_msg text;
begin
    perform pg_temp.act_as('44444444-4444-4444-4444-444444444444');
    begin
        perform public.rpc_record_nfc_provision(
            'a57a0000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a', 'req-7');
        raise exception 'a viewer provisioned a stand';
    exception when sqlstate 'P0001' then
        get stacked diagnostics v_msg = message_text;
        if v_msg <> 'not_found_or_forbidden' then raise; end if;
    end;

    begin
        perform public.rpc_rotate_stand_token(
            'a57a0000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a',
            'hash-viewer', 'vvvv01', 1::smallint, 'req-7', null, null);
        raise exception 'a viewer rotated a token';
    exception when sqlstate 'P0001' then
        get stacked diagnostics v_msg = message_text;
        if v_msg <> 'not_found_or_forbidden' then raise; end if;
    end;

    raise notice 'PASS a viewer can neither provision nor rotate';
end
$$;

-- ------------------------------------ 8. anonymous callers get nothing ------

do $$
declare v_msg text;
begin
    perform set_config('request.jwt.claim.sub', '', false);
    begin
        perform public.rpc_record_nfc_provision(
            'a57a0000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a', 'req-8');
        raise exception 'an unauthenticated caller provisioned a stand';
    exception when sqlstate 'P0001' then
        get stacked diagnostics v_msg = message_text;
        if v_msg <> 'not_authenticated' then raise; end if;
    end;
    raise notice 'PASS provisioning requires authentication';
end
$$;

-- --------------------------- 9. no NFC hardware identifier in V1 ------------

do $$
declare v_cols text;
begin
    select string_agg(column_name, ', ') into v_cols
      from information_schema.columns
     where table_schema = 'public' and table_name = 'review_stands'
       and (column_name ~ 'uid' or column_name ~ 'hardware_uid' or column_name ~ 'tag_uid');
    if v_cols is not null then
        raise exception 'V1 stores an NFC hardware identifier: %', v_cols;
    end if;
    raise notice 'PASS no NFC UID is stored';
end
$$;

-- ------- 10. QR and NFC share one URL, and inactive Tags are indistinguishable --

do $$
declare
    v_active   integer;
    v_retired  integer;
    v_paused   integer;
    v_unknown  integer;
begin
    -- There is one token per stand and therefore one URL. QR and NFC are two
    -- ways of handing a customer the same /q/{token}; nothing here is
    -- per-channel, which is why a rotation invalidates both at once.
    if exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'review_stands'
           and column_name ~ '(qr|nfc)_token'
    ) then
        raise exception 'a per-channel token column exists: QR and NFC must share one URL';
    end if;

    select count(*) into v_active  from public.rpc_public_resolve_stand('hash-b-active', null);
    select count(*) into v_retired from public.rpc_public_resolve_stand('hash-a-retired', null);
    select count(*) into v_paused  from public.rpc_public_resolve_stand('hash-a-paused', null);
    select count(*) into v_unknown from public.rpc_public_resolve_stand('hash-does-not-exist', null);

    if v_active < 1 then
        raise exception 'an active stand did not resolve';
    end if;

    -- A customer holding a retired Tag, a paused Tag, or a made-up token must
    -- get the same answer. Distinguishing them tells an attacker which tokens
    -- are real.
    if v_retired <> 0 or v_paused <> 0 or v_unknown <> 0 then
        raise exception 'inactive stands are distinguishable: retired=% paused=% unknown=%',
            v_retired, v_paused, v_unknown;
    end if;

    raise notice 'PASS one URL for QR and NFC; retired, paused, and unknown resolve identically';
end
$$;

select 'ALL TAG/TOKEN TESTS PASSED' as result;
