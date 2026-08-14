-- Corrective migration — Phase 2 & 3 of the foundation hardening pass.
--
-- Forward-only. Does not edit any prior migration file.
--
-- PROBLEM 1 — praise_safe_view is SECURITY DEFINER
-- =================================================
-- 20260813210557_foundation_hardening.sql revoked base-table SELECT on
-- team_praise_records from `authenticated` (to stop a Data API caller reading
-- response_id and correlating praise with a rating) and, because that left the
-- view with nothing to run as, recreated praise_safe_view as
-- `security_invoker = false`. That trade produced exactly the failure mode
-- Supabase's own linter flags as an ERROR: a public view that runs as its
-- owner (`postgres`) rather than as the querying role, bypassing RLS on the
-- underlying table for anyone who can select from the view.
--
-- The correct fix does not require SECURITY DEFINER at all: grant
-- `authenticated` SELECT on the exact safe columns of team_praise_records
-- (every column except response_id), and let the view run as
-- `security_invoker = true`. The existing RLS policy `team_praise_select`
-- (`app.is_org_member(org_id)`) already does the tenant-isolation work once
-- the column grant makes it reachable — no inline WHERE clause is needed in
-- the view, and no elevated privilege is needed either.
--
-- response_id stays ungranted at the column level. A Data API caller cannot
-- select it directly from the base table, and it is not in the view's column
-- list, so there is no route from praise back to a specific rated response.
--
-- PROBLEM 2 — a per-response praise flag re-links praise to a rating
-- ====================================================================
-- rpc_response_has_praise exists purely to answer "did this specific rated
-- response also produce praise?" and returns response_id, which is exactly
-- the correlation the rating-blind boundary exists to prevent: a rating and a
-- named colleague, joined by request. An aggregate count (rpc_praise_count)
-- is fine — it says how much praise a business received, not which rating it
-- was attached to. This migration drops the RPC entirely. The corresponding
-- backend logic in frontend/lib/server/owner-data.ts (the `praisedSomeone`
-- per-visit flag) is removed in the same commit; see that file's diff for
-- the documented frontend contract change.

set local check_function_bodies = off;

-- ============================================================
-- 1. Column-level SELECT so the view can run as SECURITY INVOKER
-- ============================================================

revoke select on public.team_praise_records from public, anon, authenticated;

grant select (
    id,
    org_id,
    location_id,
    first_name_encrypted,
    praise_note_encrypted,
    encryption_key_version,
    status,
    matched_staff_id,
    matched_by_user_id,
    matched_at,
    shared_at,
    shared_by,
    created_at,
    updated_at
) on public.team_praise_records to authenticated;

-- response_id is deliberately never granted at the column level. It is the
-- only column that could re-link a praise row to a specific customer_responses
-- row, and therefore to that row's rating.

-- ============================================================
-- 2. Recreate praise_safe_view as SECURITY INVOKER + SECURITY BARRIER
-- ============================================================

drop view if exists public.praise_safe_view;

create view public.praise_safe_view
with (security_invoker = true, security_barrier = true) as
select
    tpr.id,
    tpr.org_id,
    tpr.location_id,
    tpr.first_name_encrypted,
    tpr.praise_note_encrypted,
    tpr.encryption_key_version,
    tpr.status,
    tpr.matched_staff_id,
    tpr.matched_by_user_id,
    tpr.matched_at,
    tpr.shared_at,
    tpr.shared_by,
    tpr.created_at,
    tpr.updated_at
from public.team_praise_records tpr;

comment on view public.praise_safe_view is
    'Rating-blind praise surface. security_invoker=true: runs as the querying '
    'role, so the existing team_praise_select RLS policy (app.is_org_member) '
    'does the tenant-isolation work, not this view. security_barrier=true '
    'stops a caller-supplied qualifier from being pushed down past the '
    'column restriction. response_id, rating, and any customer-response '
    'linkage are intentionally absent from both this view and the column '
    'grant backing it.';

grant select on public.praise_safe_view to authenticated;
revoke all on public.praise_safe_view from public, anon;

-- ============================================================
-- 3. Remove the praise-to-rating correlation RPC
-- ============================================================

drop function if exists public.rpc_response_has_praise(uuid, uuid[]);
