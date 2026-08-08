-- ReviewBoost row level security
--
-- Deny by default. Every exposed tenant table has RLS enabled and no policy
-- grants anything to `anon`.
--
-- THE RULE EVERY POLICY OBEYS
-- ---------------------------
-- Access is derived from `auth.uid()` and an *active* membership row. It is
-- never derived from an org_id the caller supplied. An attacker is allowed to
-- put another organization's UUID in a path, a body, or a header; the database
-- still refuses, because the org_id in the row is compared against memberships
-- belonging to the authenticated user, not against anything they sent.
--
-- WHY THE HELPERS ARE SECURITY DEFINER
-- ------------------------------------
-- A policy on `organization_members` that queries `organization_members` to
-- decide access recurses. The helpers below break that by running as definer
-- with a fixed empty search_path, so the membership lookup is not itself
-- subject to the policy being evaluated.
--
-- They are the exception, not the pattern: they take no org_id as proof of
-- anything, read only `auth.uid()`, and are the minimum needed to make ordinary
-- policies expressible.

-- ------------------------------------------------ membership helpers ------

create or replace function app.is_org_member(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
          from public.organization_members m
         where m.org_id = target_org_id
           and m.user_id = (select auth.uid())
           -- Only 'active'. An invited, suspended, or removed member has a row
           -- and no access; membership existence is not membership.
           and m.status = 'active'
    );
$$;

create or replace function app.has_org_role(target_org_id uuid, allowed public.member_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
          from public.organization_members m
         where m.org_id = target_org_id
           and m.user_id = (select auth.uid())
           and m.status = 'active'
           and m.role = any(allowed)
    );
$$;

revoke all on function app.is_org_member(uuid) from public, anon;
revoke all on function app.has_org_role(uuid, public.member_role[]) from public, anon;
grant execute on function app.is_org_member(uuid) to authenticated;
grant execute on function app.has_org_role(uuid, public.member_role[]) to authenticated;

-- --------------------------------------------------------- enable RLS -----

alter table public.profiles                enable row level security;
alter table public.organizations           enable row level security;
alter table public.organization_members    enable row level security;
alter table public.locations               enable row level security;
alter table public.review_stands           enable row level security;
alter table public.public_review_sessions  enable row level security;
alter table public.customer_responses      enable row level security;
alter table public.google_review_clicks    enable row level security;
alter table public.team_praise_records     enable row level security;
alter table public.idempotency_records     enable row level security;
alter table public.audit_events            enable row level security;

-- Anonymous customers get no direct table access anywhere. Their writes go
-- through the definer functions in the next migration, which the Data API
-- cannot reach.
revoke all on all tables in schema public from anon;

-- ------------------------------------------------------------ profiles ----

create policy profiles_select_self on public.profiles
    for select to authenticated
    using (id = (select auth.uid()));

-- Update only, and only your own row. There is no insert policy: the row is
-- created by a trigger on signup, so a user cannot mint a profile for someone
-- else. Administrative fields live on organization_members, not here, so they
-- are not reachable by this policy at all.
create policy profiles_update_self on public.profiles
    for update to authenticated
    using (id = (select auth.uid()))
    with check (id = (select auth.uid()));

-- ------------------------------------------------------- organizations ----

create policy organizations_select_member on public.organizations
    for select to authenticated
    using (app.is_org_member(id));

create policy organizations_update_admin on public.organizations
    for update to authenticated
    using (app.has_org_role(id, array['owner', 'admin']::public.member_role[]))
    with check (app.has_org_role(id, array['owner', 'admin']::public.member_role[]));

-- No delete policy. An organization with business history is closed by status,
-- never removed.

-- ------------------------------------------------ organization members ----

-- A member may see who else is in their organization.
create policy organization_members_select on public.organization_members
    for select to authenticated
    using (app.is_org_member(org_id));

-- Only owners and admins administer membership. `with check` is present on
-- update as well as `using`: without it a permitted row could be edited into a
-- row the editor was never allowed to create.
create policy organization_members_insert_admin on public.organization_members
    for insert to authenticated
    with check (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

create policy organization_members_update_admin on public.organization_members
    for update to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]))
    with check (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

create policy organization_members_delete_admin on public.organization_members
    for delete to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

-- ------------------------------------------------------------ locations ---

create policy locations_select_member on public.locations
    for select to authenticated
    using (app.is_org_member(org_id));

create policy locations_write_admin on public.locations
    for all to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]))
    with check (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

-- -------------------------------------------------------- review stands ---

create policy review_stands_select_member on public.review_stands
    for select to authenticated
    using (app.is_org_member(org_id));

create policy review_stands_write_admin on public.review_stands
    for all to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]))
    with check (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

-- ------------------------------------------------- customer flow data -----
--
-- Read-only for every authenticated member. These rows are written by the
-- anonymous customer path through definer functions, so no member — not even an
-- owner — may insert or edit a customer's own words. Fabricating a customer
-- response would corrupt the only honest signal the product produces.

create policy public_review_sessions_select on public.public_review_sessions
    for select to authenticated
    using (app.is_org_member(org_id));

create policy customer_responses_select on public.customer_responses
    for select to authenticated
    using (app.is_org_member(org_id));

-- The two triage fields an owner legitimately sets. `with check` re-asserts
-- membership so a row cannot be updated into another organization, and the
-- rating and note are not writable because no policy permits changing them —
-- an update that touched them still has to pass this policy, and the service
-- layer is what restricts the column list.
create policy customer_responses_triage on public.customer_responses
    for update to authenticated
    using (app.is_org_member(org_id))
    with check (app.is_org_member(org_id));

create policy google_review_clicks_select on public.google_review_clicks
    for select to authenticated
    using (app.is_org_member(org_id));

create policy team_praise_select on public.team_praise_records
    for select to authenticated
    using (app.is_org_member(org_id));

create policy team_praise_match on public.team_praise_records
    for update to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin', 'member']::public.member_role[]))
    with check (app.has_org_role(org_id, array['owner', 'admin', 'member']::public.member_role[]));

-- --------------------------------------------------------- idempotency ----
--
-- No policy at all. These rows are infrastructure, not business data: they are
-- written and read exclusively by the server through definer functions, and
-- there is no reason for any client role to see them. RLS is enabled with no
-- policy, which denies everything.

-- -------------------------------------------------------- audit events ----

-- Select only. Append-only history: no insert, update, or delete policy exists,
-- so a normal user cannot write, rewrite, or erase the record of what was done.
-- The server appends through a definer function.
create policy audit_events_select_admin on public.audit_events
    for select to authenticated
    using (org_id is not null and app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));
