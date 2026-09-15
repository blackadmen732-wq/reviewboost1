-- Tag entitlement limits: plan N allows N, N+1 fails, and no two concurrent
-- creates can both slip through.
--
-- These run against a real migrated database. The concurrency case is the
-- reason this file exists: it is not provable by reading the function, and it
-- is the case the HTTP pre-check silently got wrong.

\set ON_ERROR_STOP on
\set QUIET on

-- ------------------------------------------------------------- fixtures ----

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner-a@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'owner-b@example.test');

insert into public.organizations (id, name, slug) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'Org A', 'org-a'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'Org B', 'org-b');

insert into public.organization_members (org_id, user_id, role, status, joined_at) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'owner', 'active', now()),
  ('bbbbbbbb-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'owner', 'active', now());

insert into public.locations (id, org_id, name) values
  ('a10c0000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Main'),
  ('b10c0000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-00000000000b', 'Main');

create or replace function pg_temp.act_as(p_user uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p_user::text, false)::void $$;

create or replace function pg_temp.make_tag(p_org uuid, p_loc uuid, p_label text)
returns uuid language sql as $$
  select public.rpc_create_stand(
      p_org, p_loc, p_label,
      'hash-' || p_label || '-' || p_org::text, substr(md5(p_label), 1, 6),
      1::smallint, null, 'ciphertext-' || p_label, 1::smallint);
$$;

-- ------------------------------------------------ 1. trial allows exactly 1 --

do $$
declare v_msg text;
begin
    perform pg_temp.act_as('11111111-1111-1111-1111-111111111111');

    -- No snapshot exists yet: the first create must start a trial, not assume
    -- a paid plan.
    perform pg_temp.make_tag('aaaaaaaa-0000-0000-0000-00000000000a',
                             'a10c0000-0000-0000-0000-00000000000a', 'first');

    if (select status from public.entitlement_snapshots
         where org_id = 'aaaaaaaa-0000-0000-0000-00000000000a') <> 'trialing' then
        raise exception 'missing snapshot did not resolve to a trial';
    end if;
    if (select plan_id from public.entitlement_snapshots
         where org_id = 'aaaaaaaa-0000-0000-0000-00000000000a') is not null then
        raise exception 'missing snapshot invented a paid plan';
    end if;

    begin
        perform pg_temp.make_tag('aaaaaaaa-0000-0000-0000-00000000000a',
                                 'a10c0000-0000-0000-0000-00000000000a', 'second');
        raise exception 'trial allowed a second Tag';
    exception when sqlstate 'P0001' then
        get stacked diagnostics v_msg = message_text;
        if v_msg <> 'tag_limit_reached' then raise; end if;
    end;

    raise notice 'PASS trial: 1 allowed, 2 refused, no paid plan invented';
end
$$;

-- --------------------------------------------- 2. upgrade raises the cap ----

do $$
declare v_msg text; v_n integer;
begin
    perform public.rpc_set_entitlement(
        'aaaaaaaa-0000-0000-0000-00000000000a', 'starter', 'active', 'manual', null, null);
    perform pg_temp.act_as('11111111-1111-1111-1111-111111111111');

    -- Starter is 3. One already exists, so exactly two more, then no more.
    perform pg_temp.make_tag('aaaaaaaa-0000-0000-0000-00000000000a',
                             'a10c0000-0000-0000-0000-00000000000a', 'starter2');
    perform pg_temp.make_tag('aaaaaaaa-0000-0000-0000-00000000000a',
                             'a10c0000-0000-0000-0000-00000000000a', 'starter3');

    select count(*) into v_n from public.review_stands
     where org_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and status <> 'retired';
    if v_n <> 3 then raise exception 'starter should hold 3 Tags, holds %', v_n; end if;

    begin
        perform pg_temp.make_tag('aaaaaaaa-0000-0000-0000-00000000000a',
                                 'a10c0000-0000-0000-0000-00000000000a', 'starter4');
        raise exception 'starter allowed a 4th Tag';
    exception when sqlstate 'P0001' then
        get stacked diagnostics v_msg = message_text;
        if v_msg <> 'tag_limit_reached' then raise; end if;
    end;

    raise notice 'PASS upgrade: plan N allows exactly N, N+1 refused';
end
$$;

-- ------------------------------ 3. retired Tags do not consume the plan ----

do $$
declare v_n integer;
begin
    update public.review_stands set status = 'retired'
     where org_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and label = 'starter3';

    perform pg_temp.act_as('11111111-1111-1111-1111-111111111111');
    perform pg_temp.make_tag('aaaaaaaa-0000-0000-0000-00000000000a',
                             'a10c0000-0000-0000-0000-00000000000a', 'replacement');

    select count(*) into v_n from public.review_stands
     where org_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and status <> 'retired';
    if v_n <> 3 then raise exception 'live Tag count wrong after retire/replace: %', v_n; end if;
    raise notice 'PASS retired Tags free their slot';
end
$$;

-- ------------------- 4. downgrade and failed payment stop new Tags only ----

do $$
declare v_msg text; v_live integer;
begin
    perform public.rpc_set_entitlement(
        'aaaaaaaa-0000-0000-0000-00000000000a', 'starter', 'past_due', 'manual', null, null);
    perform pg_temp.act_as('11111111-1111-1111-1111-111111111111');

    begin
        perform pg_temp.make_tag('aaaaaaaa-0000-0000-0000-00000000000a',
                                 'a10c0000-0000-0000-0000-00000000000a', 'while-past-due');
        raise exception 'past_due allowed a new Tag';
    exception when sqlstate 'P0001' then
        get stacked diagnostics v_msg = message_text;
        if v_msg <> 'tag_limit_reached' then raise; end if;
    end;

    -- The Tags already printed are physical objects in a shop. Suspending the
    -- account must not retire them.
    select count(*) into v_live from public.review_stands
     where org_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and status = 'active';
    if v_live <> 3 then
        raise exception 'past_due disturbed existing Tags: % active', v_live;
    end if;

    -- And it is never silently converted to a free plan.
    if (select plan_id from public.entitlement_snapshots
         where org_id = 'aaaaaaaa-0000-0000-0000-00000000000a') is null then
        raise exception 'past_due erased the plan instead of suspending it';
    end if;

    raise notice 'PASS past_due: no new Tags, existing Tags untouched, plan retained';
end
$$;

-- --------------------------------------------- 5. cross-org isolation -------

do $$
declare v_msg text;
begin
    -- Owner A, naming Org B.
    perform pg_temp.act_as('11111111-1111-1111-1111-111111111111');
    begin
        perform pg_temp.make_tag('bbbbbbbb-0000-0000-0000-00000000000b',
                                 'b10c0000-0000-0000-0000-00000000000b', 'stolen');
        raise exception 'owner A created a Tag in org B';
    exception when sqlstate 'P0001' then
        get stacked diagnostics v_msg = message_text;
        if v_msg <> 'not_found_or_forbidden' then raise; end if;
    end;

    -- Owner A, own org, but B's location.
    begin
        perform pg_temp.make_tag('aaaaaaaa-0000-0000-0000-00000000000a',
                                 'b10c0000-0000-0000-0000-00000000000b', 'crossed');
        raise exception 'a Tag was created against another org''s location';
    exception when sqlstate 'P0001' then
        get stacked diagnostics v_msg = message_text;
        if v_msg not in ('not_found_or_forbidden', 'tag_limit_reached') then raise; end if;
    end;

    -- A's spending never touched B's allowance.
    perform public.rpc_set_entitlement(
        'bbbbbbbb-0000-0000-0000-00000000000b', null, 'trialing', 'manual', null, null);
    perform pg_temp.act_as('22222222-2222-2222-2222-222222222222');
    perform pg_temp.make_tag('bbbbbbbb-0000-0000-0000-00000000000b',
                             'b10c0000-0000-0000-0000-00000000000b', 'b-first');

    raise notice 'PASS cross-org: A cannot create in B, and A''s usage is not B''s';
end
$$;

-- ------------------------------------ 6. two simultaneous creates ----------

-- Lives in scripts/db/test-tag-race.sh, not here.
--
-- This file ran the race through dblink, which opens its connections from
-- inside the server. That cannot work on Supabase: `postgres` is not a
-- superuser there, dblink refuses a non-superuser connection unless a password
-- was actually exchanged, and every route into that server from within it --
-- unix socket and in-container TCP alike -- is trust. A non-superuser cannot
-- even read `unix_socket_directories` to build the conninfo.
--
-- Two concurrent sessions are a client-side thing. The harness already holds
-- credentials that work, so the race is driven by two real psql processes
-- instead, which removes the whole class of problem rather than routing around
-- one instance of it.

-- --------------------------------- 7. every Tag is reprintable ------------

do $$
declare v_missing integer;
begin
    -- A Tag without its reprint ciphertext is a Tag the owner can never
    -- replace: they saw the token once, at creation, and it is gone. The
    -- ciphertext is written in the same transaction as the Tag, so there is no
    -- window where one exists without the other.
    select count(*) into v_missing
      from public.review_stands
     where public_token_encrypted is null
       and label in ('first', 'starter2', 'replacement', 'b-first', 'racer one');

    if v_missing > 0 then
        raise exception '% Tag(s) created through rpc_create_stand cannot be reprinted', v_missing;
    end if;
    raise notice 'PASS every Tag created through the RPC stored its reprint ciphertext';
end
$$;

do $$
declare v_msg text; v_before integer; v_after integer;
begin
    perform pg_temp.act_as('22222222-2222-2222-2222-222222222222');
    perform public.rpc_set_entitlement(
        'bbbbbbbb-0000-0000-0000-00000000000b', 'pro', 'active', 'manual', null, null);

    select count(*) into v_before from public.review_stands
     where org_id = 'bbbbbbbb-0000-0000-0000-00000000000b';

    -- A direct RPC call that omits the ciphertext must not produce a Tag.
    begin
        perform public.rpc_create_stand(
            'bbbbbbbb-0000-0000-0000-00000000000b', 'b10c0000-0000-0000-0000-00000000000b',
            'no cipher', 'hash-no-cipher', 'nociph', 1::smallint, null, null, null);
        raise exception 'a Tag was created with no reprint ciphertext';
    exception when sqlstate 'P0001' then
        get stacked diagnostics v_msg = message_text;
        if v_msg <> 'reprint_ciphertext_required' then raise; end if;
    end;

    select count(*) into v_after from public.review_stands
     where org_id = 'bbbbbbbb-0000-0000-0000-00000000000b';
    if v_after <> v_before then
        raise exception 'the refused create still left a Tag behind';
    end if;

    raise notice 'PASS a create with no reprint ciphertext fails closed, leaving nothing';
end
$$;

-- ------------------------------------ 8. onboarding writes the snapshot ----

do $$
declare v_status text;
begin
    if exists (
        select 1 from public.organizations o
        left join public.entitlement_snapshots e on e.org_id = o.id
        where e.org_id is null
    ) then
        raise exception 'an organization exists with no entitlement row';
    end if;

    select status into v_status from public.entitlement_snapshots
     where org_id = 'bbbbbbbb-0000-0000-0000-00000000000b';
    if v_status is null then raise exception 'org B has no entitlement row'; end if;

    raise notice 'PASS every organization has an explicit entitlement row';
end
$$;

select 'ALL TAG LIMIT TESTS PASSED' as result;
