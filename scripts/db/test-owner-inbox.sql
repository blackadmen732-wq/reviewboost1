-- The Feedback badge and the Feedback list are the same set.
--
-- The seed in seed-populated.sql is built so the old and new definitions
-- disagree: org A has three responses with `read_at is null`, but only two of
-- them have a note. Under the old rule the badge said 3 over a list of 2, and
-- the missing one was a silent five-star rating that can never appear on that
-- screen.

\set ON_ERROR_STOP on
\set QUIET on

\i :seed

-- The single definition, mirrored from INBOX_PREDICATE in owner-data.ts and
-- from the partial index customer_responses_inbox_idx.
create or replace function pg_temp.inbox(p_org uuid)
returns setof public.customer_responses
language sql stable as $$
    select * from public.customer_responses
     where org_id = p_org
       and note_encrypted is not null
       and resolved_at is null
     order by submitted_at desc, id desc
$$;

do $$
declare
    v_org      uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
    v_badge    integer;
    v_listed   integer;
    v_old_rule integer;
begin
    -- The badge: a count.
    select count(*) into v_badge from pg_temp.inbox(v_org);
    -- The list: rows, as the screen fetches them.
    select count(*) into v_listed from (select * from pg_temp.inbox(v_org) limit 50) page;

    if v_badge <> v_listed then
        raise exception 'badge says %, list shows %', v_badge, v_listed;
    end if;
    if v_badge = 0 then
        raise exception 'the fixture proves nothing: the inbox is empty';
    end if;

    -- And the definition really is the one that used to disagree.
    select count(*) into v_old_rule from public.customer_responses
     where org_id = v_org and read_at is null;

    if v_old_rule = v_badge then
        raise exception
            'the fixture no longer exercises the bug: old rule and new rule both say %', v_badge;
    end if;

    raise notice
        'PASS badge = list = % (the old read_at rule would have said %)', v_badge, v_old_rule;
end
$$;

-- Reading a message is not handling it.
do $$
declare v_org uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; v_before integer; v_after integer;
begin
    select count(*) into v_before from pg_temp.inbox(v_org);

    update public.customer_responses set read_at = now()
     where org_id = v_org and note_encrypted is not null and read_at is null;

    select count(*) into v_after from pg_temp.inbox(v_org);
    if v_after <> v_before then
        raise exception 'opening a message removed it from the inbox: % -> %', v_before, v_after;
    end if;
    raise notice 'PASS opening a message does not clear it; only resolving does';
end
$$;

-- Resolving is what clears it, and it clears it from both sides at once.
do $$
declare v_org uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; v_before integer; v_after integer;
begin
    select count(*) into v_before from pg_temp.inbox(v_org);

    -- resolved_at and resolved_by move together: a check constraint says a
    -- resolution must name who did it.
    update public.customer_responses
       set resolved_at = now(),
           resolved_by = '11111111-1111-1111-1111-111111111111'
     where id = 'a4e50000-0000-0000-0000-000000000002';

    select count(*) into v_after from pg_temp.inbox(v_org);
    if v_after <> v_before - 1 then
        raise exception 'resolving did not clear exactly one item: % -> %', v_before, v_after;
    end if;
    raise notice 'PASS resolving clears one item from the count and the list together';
end
$$;

-- One business's inbox is never another's.
do $$
declare v_a integer; v_b integer;
begin
    select count(*) into v_a from pg_temp.inbox('aaaaaaaa-0000-0000-0000-000000000001');
    select count(*) into v_b from pg_temp.inbox('bbbbbbbb-0000-0000-0000-000000000002');
    if v_b <> 1 then
        raise exception 'org B inbox should hold its single noted response, holds %', v_b;
    end if;
    if v_a = 0 then raise exception 'org A inbox emptied unexpectedly'; end if;
    raise notice 'PASS inbox counts do not cross tenants (A=%, B=%)', v_a, v_b;
end
$$;

-- The index the predicate reads through actually exists and matches it.
do $$
declare v_def text;
begin
    select indexdef into v_def from pg_indexes
     where schemaname = 'public' and indexname = 'customer_responses_inbox_idx';
    if v_def is null then
        raise exception 'the inbox has no index: every badge render is a scan';
    end if;
    if v_def !~ 'note_encrypted IS NOT NULL' or v_def !~ 'resolved_at IS NULL' then
        raise exception 'the inbox index no longer matches the predicate: %', v_def;
    end if;
    raise notice 'PASS the inbox predicate and its partial index agree';
end
$$;

select 'ALL OWNER INBOX TESTS PASSED' as result;
