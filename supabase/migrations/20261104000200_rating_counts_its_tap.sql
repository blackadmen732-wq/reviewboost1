-- A rating counts its own tap.
--
-- 20261103000300_tag_opens records a session as a tap (`counts_as_scan`) only
-- when the opening request did not look like a crawler or link preview, judged
-- by its user agent. A person whose browser sends an unusual user agent can
-- still open the page and pick a star, and Home then read "0 taps · 1 rated":
-- a number that cannot be true, on the screen the owner checks first.
--
-- A rating is proof a person was there: link previews and crawlers do not tap
-- a star. So when a rating is saved, its session counts as a tap, and its Tag
-- counts as used, exactly as public_create_session does for a recognised
-- person.
--
-- SECURITY INVOKER on purpose. customer_responses accepts inserts only from
-- the definer functions of the public flow (direct inserts are revoked), which
-- run as the table owner, so the trigger already has the rights it needs and
-- adds nothing to the privileged surface (privilege_surface_test).

create or replace function app.rating_counts_its_tap()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_flipped boolean;
begin
    update public.public_review_sessions s
       set counts_as_scan = true
     where s.id = new.session_id
       and not s.counts_as_scan
    returning true into v_flipped;

    if coalesce(v_flipped, false) then
        update public.review_stands st
           set last_opened_at = greatest(coalesce(st.last_opened_at, '-infinity'::timestamptz), now())
         where st.id = new.stand_id;
    end if;

    return new;
end;
$$;

revoke all on function app.rating_counts_its_tap() from public, anon, authenticated;

drop trigger if exists customer_responses_count_tap on public.customer_responses;
create trigger customer_responses_count_tap
    after insert on public.customer_responses
    for each row
    execute function app.rating_counts_its_tap();
