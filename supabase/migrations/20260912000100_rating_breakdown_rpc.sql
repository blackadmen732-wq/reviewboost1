-- Single-pass rating breakdown replacing 5 separate count queries.
--
-- Returns one row per distinct rating value present, with columns
-- (rating, cnt). The caller fills in zeros for any rating not returned.
-- Runs under RLS via the caller's session — no SECURITY DEFINER needed.

create or replace function public.rating_breakdown(target_org_id uuid)
returns table(rating smallint, cnt bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select cr.rating, count(*) as cnt
      from public.customer_responses cr
     where cr.org_id = target_org_id
     group by cr.rating
     order by cr.rating;
$$;

revoke all on function public.rating_breakdown(uuid) from public, anon;
grant execute on function public.rating_breakdown(uuid) to authenticated;
