-- Tighten RLS policies that were broader than necessary.
--
-- The column-level security migration already revoked DELETE privileges, but
-- these policies still said "FOR ALL" which includes DELETE. Belt and
-- suspenders: replace them with explicit INSERT + UPDATE policies.
--
-- Also tightens staff_members write policies from any-member to admin+.

-- ============================================================
-- A. LOCATIONS — replace FOR ALL with INSERT + UPDATE
-- ============================================================

drop policy if exists locations_write_admin on public.locations;

create policy locations_insert_admin on public.locations
    for insert to authenticated
    with check (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

create policy locations_update_admin on public.locations
    for update to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]))
    with check (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

-- ============================================================
-- B. REVIEW STANDS — replace FOR ALL with INSERT + UPDATE
-- ============================================================

drop policy if exists review_stands_write_admin on public.review_stands;

create policy review_stands_insert_admin on public.review_stands
    for insert to authenticated
    with check (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

create policy review_stands_update_admin on public.review_stands
    for update to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]))
    with check (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

-- ============================================================
-- C. CUSTOMER RESPONSES — tighten triage to exclude viewer
-- ============================================================

drop policy if exists customer_responses_triage on public.customer_responses;

create policy customer_responses_triage on public.customer_responses
    for update to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin', 'member']::public.member_role[]))
    with check (app.has_org_role(org_id, array['owner', 'admin', 'member']::public.member_role[]));

-- ============================================================
-- D. STAFF MEMBERS — tighten from any-member to admin+
-- ============================================================
-- The original policies let any member (including viewer) insert and update
-- staff records. Tighten to owner/admin only; select stays open to all members.

drop policy if exists staff_members_write_member on public.staff_members;
drop policy if exists staff_members_update_member on public.staff_members;

create policy staff_members_insert_admin on public.staff_members
    for insert to authenticated
    with check (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

create policy staff_members_update_admin on public.staff_members
    for update to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]))
    with check (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

-- ============================================================
-- E. RESPONSE NOTES — tighten insert to exclude viewer
-- ============================================================
-- Keep the existing author_id = auth.uid() check from the original policy.

drop policy if exists response_notes_insert_member on public.response_notes;

create policy response_notes_insert_member on public.response_notes
    for insert to authenticated
    with check (
        app.has_org_role(org_id, array['owner', 'admin', 'member']::public.member_role[])
        and author_id = (select auth.uid())
    );

-- ============================================================
-- F. ORGANIZATION MEMBERS — restrict UPDATE columns
-- ============================================================
-- The table-wide UPDATE grant lets any admin change org_id or user_id on
-- membership rows. Restrict to role and status only.

revoke update on public.organization_members from authenticated;
grant update (role, status) on public.organization_members to authenticated;
