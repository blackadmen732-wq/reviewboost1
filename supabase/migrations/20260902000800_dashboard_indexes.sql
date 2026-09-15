-- Dashboard query indexes.
--
-- The existing indexes on customer_responses and public_review_sessions all
-- include location_id, which means they cannot serve the org-wide queries the
-- owner dashboard issues (counts, listings, live feed). Without these, every
-- org-wide query does a sequential scan once a busy location passes a few
-- thousand rows.

-- Org-wide listing/counting on customer_responses, ordered by submitted_at.
-- Covers: getOwnerCounts (today count, unread count, recent ratings),
--         listReviews (cursor pagination), getVisitSummary (total count),
--         getRatingBreakdown.
create index if not exists customer_responses_org_submitted_idx
    on public.customer_responses (org_id, submitted_at desc);

-- Org-wide listing on public_review_sessions, ordered by created_at.
-- Covers: listLiveFeed tap query (merge-sorted with feedback).
create index if not exists public_review_sessions_org_created_idx
    on public.public_review_sessions (org_id, created_at desc);
