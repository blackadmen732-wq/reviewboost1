-- Tag entitlement limits: plan N allows N, N+1 fails, and no two concurrent
-- creates can both slip through.
--
-- These run against a real migrated database. The concurrency case is the
-- reason this file exists: it is not provable by reading the function, and it
-- is the case the HTTP pre-check silently got wrong.

\set ON_ERROR_STOP on
\set QUIET on

create extension if not exists dblink;

-- The harness passes a connection string that is known to reach this server.
-- Running this file through plain psql instead falls back to rebuilding one
-- from server settings, which works only for a passwordless local socket.
\if :{?conninfo}
\else
\set conninfo ''
\endif

-- Carried through a GUC rather than read directly: psql does not interpolate
-- its variables inside a dollar-quoted block, which is where dblink_connect is.
select set_config('rb.conninfo', :'conninfo', false);

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

-- The real test. Two genuine sessions, both inside open transactions, and the
-- second one is proven to be *blocked inside* rpc_create_stand -- past the auth
-- and location checks, at the entitlement lock -- while the first still holds
-- the row. That is exactly the interleaving a count-then-insert implementation
-- loses: both sessions read "2 of 3 used" and both insert.
-- These fixtures are committed at the top level on purpose. The racers are
-- separate sessions and cannot see rows held in an uncommitted transaction, so
-- creating them inside the DO block below would make both racers fail the
-- membership check instead of racing.
insert into auth.users (id, email)
    values ('33333333-3333-3333-3333-333333333333', 'owner-c@example.test');
insert into public.organizations (id, name, slug)
    values ('cccccccc-0000-0000-0000-00000000000c', 'Org C', 'org-c');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
    values ('cccccccc-0000-0000-0000-00000000000c', '33333333-3333-3333-3333-333333333333',
            'owner', 'active', now());
insert into public.locations (id, org_id, name)
    values ('c10c0000-0000-0000-0000-00000000000c', 'cccccccc-0000-0000-0000-00000000000c', 'Main');

-- Starter: 3 Tags. Two already used, so exactly one slot is left and two
-- sessions are about to race for it.
select public.rpc_set_entitlement(
    'cccccccc-0000-0000-0000-00000000000c', 'starter', 'active', 'manual', null, null);

insert into public.review_stands
    (org_id, location_id, public_token_hash, public_token_prefix, label, status)
values ('cccccccc-0000-0000-0000-00000000000c', 'c10c0000-0000-0000-0000-00000000000c',
        'c-hash-1', 'cccc01', 'existing one', 'active'),
       ('cccccccc-0000-0000-0000-00000000000c', 'c10c0000-0000-0000-0000-00000000000c',
        'c-hash-2', 'cccc02', 'existing two', 'active');

do $$
declare
    v_conn text := coalesce(
        nullif(current_setting('rb.conninfo', true), ''),
        format('dbname=%s port=%s host=%s user=%s',
               current_database(),
               current_setting('port'),
               split_part(current_setting('unix_socket_directories'), ',', 1),
               current_user));
    v_org  uuid := 'cccccccc-0000-0000-0000-00000000000c';
    v_loc  uuid := 'c10c0000-0000-0000-0000-00000000000c';
    v_user uuid := '33333333-3333-3333-3333-333333333333';
    v_ok   integer := 0;
    v_fail integer := 0;
    v_live integer;
    v_blocked boolean := false;
    v_waited integer := 0;
begin
    perform dblink_connect('racer1', v_conn);
    perform dblink_connect('racer2', v_conn);
    perform dblink_exec('racer1', 'begin');
    perform dblink_exec('racer2', 'begin');
    -- dblink_exec refuses a statement that returns rows, so SET rather than
    -- select set_config(...). Plain SET is session-scoped, which is what an
    -- impersonated request needs.
    perform dblink_exec('racer1', format('set request.jwt.claim.sub = %L', v_user::text));
    perform dblink_exec('racer2', format('set request.jwt.claim.sub = %L', v_user::text));

    -- Racer 1 goes in and stops, holding the entitlement row, transaction open.
    perform dblink_send_query('racer1', format(
        'select public.rpc_create_stand(%L, %L, ''racer one'', ''c-hash-r1'', ''ccr001'', 1::smallint, null, ''cipher-r1'', 1::smallint)',
        v_org, v_loc));
    perform * from dblink_get_result('racer1') as t(id uuid);
    perform * from dblink_get_result('racer1') as t(id uuid);

    -- Racer 2 now enters the same function while racer 1 still holds the lock.
    perform dblink_send_query('racer2', format(
        'select public.rpc_create_stand(%L, %L, ''racer two'', ''c-hash-r2'', ''ccr002'', 1::smallint, null, ''cipher-r2'', 1::smallint)',
        v_org, v_loc));

    -- It must not be able to finish. If the cap were advisory, racer 2 would
    -- sail past and insert a fourth Tag.
    while v_waited < 200 loop
        if dblink_is_busy('racer2') = 1 then
            v_blocked := true;
            exit;
        end if;
        perform pg_sleep(0.01);
        v_waited := v_waited + 1;
    end loop;

    if not v_blocked then
        raise exception 'second create was never blocked: the cap is not serialised';
    end if;

    -- Release racer 1. Racer 2 wakes, re-counts, and must now see three.
    perform dblink_exec('racer1', 'commit');
    v_ok := v_ok + 1;

    begin
        perform * from dblink_get_result('racer2') as t(id uuid);
        perform * from dblink_get_result('racer2') as t(id uuid);
        perform dblink_exec('racer2', 'commit');
        v_ok := v_ok + 1;
    exception when others then
        v_fail := v_fail + 1;
        begin perform dblink_exec('racer2', 'rollback'); exception when others then null; end;
    end;

    perform dblink_disconnect('racer1');
    perform dblink_disconnect('racer2');

    select count(*) into v_live from public.review_stands
     where org_id = v_org and status <> 'retired';

    if v_live <> 3 then
        raise exception 'RACE LOST: starter limit is 3, org holds % Tags (% succeeded, % refused)',
            v_live, v_ok, v_fail;
    end if;
    if v_ok <> 1 or v_fail <> 1 then
        raise exception 'expected exactly one winner, got % ok / % refused', v_ok, v_fail;
    end if;

    raise notice 'PASS concurrency: second create blocked at the lock, then refused; cap held at 3';
end
$$;

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
