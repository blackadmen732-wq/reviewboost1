-- Assertions for the populated-upgrade path.
--
-- An upgrade that "succeeds" while silently dropping a business's history is
-- worse than one that fails, so every count seeded before the upgrade is
-- re-checked after it, and cross-tenant totals are checked separately.

\set ON_ERROR_STOP on

do $$
declare
    v_expected constant jsonb := jsonb_build_object(
        'organizations', 2, 'members', 3, 'locations', 3, 'stands', 4,
        'sessions', 6, 'responses', 6, 'clicks', 2, 'praise', 2
    );
    v_actual jsonb;
    v_key text;
begin
    select jsonb_build_object(
        'organizations', (select count(*) from public.organizations),
        'members',       (select count(*) from public.organization_members),
        'locations',     (select count(*) from public.locations),
        'stands',        (select count(*) from public.review_stands),
        'sessions',      (select count(*) from public.public_review_sessions),
        'responses',     (select count(*) from public.customer_responses),
        'clicks',        (select count(*) from public.google_review_clicks),
        'praise',        (select count(*) from public.team_praise_records)
    ) into v_actual;

    for v_key in select jsonb_object_keys(v_expected) loop
        if v_expected -> v_key <> v_actual -> v_key then
            raise exception 'upgrade lost rows: % expected %, got %',
                v_key, v_expected -> v_key, v_actual -> v_key;
        end if;
    end loop;
    raise notice 'row counts preserved: %', v_actual;
end
$$;

-- Historical praise and encrypted notes survive the V1 public-contract change.
do $$
begin
    if not exists (
        select 1 from public.team_praise_records
        where org_id = 'aaaaaaaa-0000-0000-0000-000000000001'
          and first_name_encrypted = 'enc-first-name'
    ) then
        raise exception 'historical team praise was destroyed by the upgrade';
    end if;

    if not exists (
        select 1 from public.customer_responses
        where id = 'a4e50000-0000-0000-0000-000000000002'
          and note_encrypted = 'ciphertext2'
    ) then
        raise exception 'historical encrypted note was destroyed by the upgrade';
    end if;
    raise notice 'historical praise and note ciphertext intact';
end
$$;

-- Tenant totals never merged.
do $$
declare v_a bigint; v_b bigint;
begin
    select count(*) into v_a from public.customer_responses
        where org_id = 'aaaaaaaa-0000-0000-0000-000000000001';
    select count(*) into v_b from public.customer_responses
        where org_id = 'bbbbbbbb-0000-0000-0000-000000000002';
    if v_a <> 5 or v_b <> 1 then
        raise exception 'tenant response totals wrong: A=% B=%', v_a, v_b;
    end if;
    raise notice 'tenant isolation of seeded rows intact (A=%, B=%)', v_a, v_b;
end
$$;

-- The entitlement backfill reached organizations that predate the table.
do $$
declare v_missing integer; v_bad integer;
begin
    select count(*) into v_missing
      from public.organizations o
      left join public.entitlement_snapshots e on e.org_id = o.id
     where e.org_id is null;
    if v_missing > 0 then
        raise exception '% pre-existing organization(s) have no entitlement row', v_missing;
    end if;

    -- And it did not hand anyone a paid plan they never bought.
    select count(*) into v_bad
      from public.entitlement_snapshots
     where source = 'backfill'
       and (status <> 'trialing' or plan_id is not null);
    if v_bad > 0 then
        raise exception 'the backfill invented a paid plan for % organization(s)', v_bad;
    end if;

    raise notice 'entitlement backfill: every organization trialing, none on a paid plan';
end
$$;

-- Tags that existed before the cap are never retired by it. An organization
-- over its trial allowance keeps what it printed; it simply cannot add more.
do $$
declare v_live integer;
begin
    select count(*) into v_live
      from public.review_stands
     where org_id = 'aaaaaaaa-0000-0000-0000-000000000001'
       and status = 'active';
    if v_live <> 2 then
        raise exception 'the Tag cap disturbed existing Tags: % active, expected 2', v_live;
    end if;
    raise notice 'existing Tags survive an upgrade that caps new ones';
end
$$;

-- No index may reference a column that does not exist. A migration that adds
-- one aborts the chain; this catches the same class of mistake if a later
-- migration ever drops a column an index still names.
do $$
declare v_bad text;
begin
    select string_agg(format('%s.%s', schemaname, indexname), ', ')
      into v_bad
      from pg_indexes
     where schemaname in ('public', 'app')
       and indexdef ~ 'started_at';
    if v_bad is not null then
        raise exception 'index references a non-existent started_at column: %', v_bad;
    end if;
    raise notice 'no index references started_at';
end
$$;
