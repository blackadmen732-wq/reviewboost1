-- Feedback → Insights: one read-only aggregation over the ratings a business
-- has received.
--
-- WHAT IT ANSWERS
-- ---------------
-- How many ratings of each star value arrived between consecutive boundaries.
-- The caller passes the boundaries — local midnights computed from the
-- business's own time zone by lib/utils/local-day.ts, where daylight-saving
-- days are 23 or 25 hours long and are tested as such — and gets back one row
-- per (bucket, star value) that has any ratings in it:
--
--     bucket n  =  p_bounds[n] <= submitted_at < p_bounds[n + 1]
--
-- Every boundary is explicit. The first is inclusive, the last is exclusive,
-- and nothing outside them is read. So the current period, the previous period
-- it is compared with, and the day in progress are each a bucket the server
-- chose on purpose, never an interval the database guessed — which is what
-- lets the screen keep a half-finished today out of any comparison.
--
-- Doing the counting here replaces the other two ways of getting the same
-- numbers: about twenty separate count queries per screen, or shipping every
-- rating row to the server process to add up there.
--
-- ISOLATION
-- ---------
-- SECURITY INVOKER, deliberately. The function runs as the signed-in caller, so
-- the customer_responses row level security policy (active members of the
-- organization only) applies to every row it counts. It cannot return anything
-- a direct select by the same person could not; asking about another business
-- returns nothing, which is the same answer as a business with no ratings, so
-- nothing is confirmed either way. The explicit org_id filter on top is not the
-- security boundary — RLS is — it is what keeps someone who belongs to two
-- businesses from seeing them added together, and it is what the index needs.
--
-- The location filter narrows within the organization; it can never widen it.
-- A location id belonging to another business simply matches no rows.
--
-- It reads and never writes (STABLE), and only `authenticated` may call it:
-- not anon, and not the service role, which bypasses row level security and
-- has no reason to ask this question.
--
-- WHAT IT DOES NOT DO
-- -------------------
-- It counts ratings only. It does not touch destination selections, so it can
-- never be read as "reviews received" on any other site. Every star value is
-- counted the same way, and nothing here depends on which value was chosen.

create or replace function public.rpc_feedback_insights(
    p_org_id      uuid,
    p_bounds      timestamptz[],
    p_location_id uuid default null
)
returns table (bucket integer, rating smallint, responses bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
    v_count integer := coalesce(array_length(p_bounds, 1), 0);
begin
    if p_org_id is null then
        raise exception 'p_org_id is required' using errcode = '22023';
    end if;

    -- Two boundaries make one bucket. Sixty-four is far past anything the
    -- screen asks for (a 90-day view needs twelve), and keeps the call cheap.
    if v_count < 2 or v_count > 64 then
        raise exception 'p_bounds must hold between 2 and 64 boundaries'
            using errcode = '22023';
    end if;

    for i in 1 .. v_count loop
        if p_bounds[i] is null then
            raise exception 'p_bounds must not contain nulls' using errcode = '22023';
        end if;
        -- width_bucket assumes sorted thresholds and gives quietly wrong
        -- answers otherwise, so unsorted input is refused rather than counted.
        if i > 1 and p_bounds[i] <= p_bounds[i - 1] then
            raise exception 'p_bounds must be strictly ascending' using errcode = '22023';
        end if;
    end loop;

    -- The longest view is 90 days compared with the 90 before it. A span
    -- beyond 400 days is not a question the product asks.
    if p_bounds[v_count] - p_bounds[1] > interval '400 days' then
        raise exception 'p_bounds may span at most 400 days' using errcode = '22023';
    end if;

    return query
        select width_bucket(r.submitted_at, p_bounds)::integer as bucket,
               r.rating,
               count(*)                                        as responses
          from public.customer_responses r
         where r.org_id = p_org_id
           and (p_location_id is null or r.location_id = p_location_id)
           and r.submitted_at >= p_bounds[1]
           and r.submitted_at <  p_bounds[v_count]
         group by 1, 2
         order by 1, 2;
end;
$$;

comment on function public.rpc_feedback_insights(uuid, timestamptz[], uuid) is
    'Ratings per star value between explicit boundaries, for Feedback → Insights. '
    'Read-only; runs as the caller under row level security.';

revoke all on function public.rpc_feedback_insights(uuid, timestamptz[], uuid)
    from public, anon, service_role;
grant execute on function public.rpc_feedback_insights(uuid, timestamptz[], uuid)
    to authenticated;
