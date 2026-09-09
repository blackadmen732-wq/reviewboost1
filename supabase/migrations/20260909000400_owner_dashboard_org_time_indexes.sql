-- Owner dashboard time-order indexes. Measured on ATLAS integration
-- (docs/backend/ATLAS_QUERY_SHAPE_EVIDENCE.md).
--
-- listReviews / live-feed ORDER BY time, id cannot walk
-- (org_id, location_id, submitted_at). This index lets LIMIT 26 stop after
-- 26 rows. RLS is unchanged: app.is_org_member(org_id) still applies.
-- Exact COUNT(*) tiles are not helped; do not weaken tenant isolation to
-- make them faster.

create index if not exists customer_responses_org_submitted_id_idx
    on public.customer_responses (org_id, submitted_at desc, id desc);

create index if not exists public_review_sessions_org_created_id_idx
    on public.public_review_sessions (org_id, created_at desc, id desc);
