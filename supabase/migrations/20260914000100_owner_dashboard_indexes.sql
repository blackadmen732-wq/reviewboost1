-- Indexes for the owner dashboard access patterns.
--
-- Every index here names the query it serves, and every one of those queries
-- exists in frontend/lib/server/owner-data.ts today. An index added for a query
-- nobody runs is not free: it is write amplification on the customer submit
-- path, which is the one path that must stay fast.
--
-- Deliberately NOT added, having been checked against the live schema:
--
--   public_review_sessions (org_id, started_at desc)
--       There is no `started_at` column on this table -- it records
--       `created_at` -- and no owner query orders sessions org-wide at all.
--       An earlier draft of this file carried that index; it cannot be
--       "repointed" at created_at, because the query it claimed to serve does
--       not exist. `(org_id, location_id, created_at desc)` and
--       `(stand_id, created_at desc)` already cover the reads that do.
--
--   audit_events (org_id, created_at desc)
--       Already created by 20260808000100_core_tenancy.sql.
--
--   google_review_clicks (org_id, clicked_at desc)
--       No query orders clicks by time. The owner paths look clicks up by
--       `response_id` (served by the unique index) and count them per org
--       (served by the leading column of the existing location index).

-- listReviews / listVisits: .eq("org_id").order("submitted_at" desc).order("id" desc)
-- The existing indexes lead with (org_id, location_id) or carry a read_at /
-- resolved_at predicate, so neither can order an unfiltered org-wide page.
create index if not exists customer_responses_org_submitted_idx
    on public.customer_responses (org_id, submitted_at desc, id desc);

-- getRatingBreakdown: five head-count queries, .eq("org_id").eq("rating", n)
create index if not exists customer_responses_org_rating_idx
    on public.customer_responses (org_id, rating);

-- The Feedback inbox, and the badge that counts it. Both sides of
-- app.owner_inbox_predicate() read through this one index, which is the point
-- of having a single definition: one predicate, one index, no disagreement.
create index if not exists customer_responses_inbox_idx
    on public.customer_responses (org_id, submitted_at desc, id desc)
    where note_encrypted is not null and resolved_at is null;

-- listPraise without unmatchedOnly: .eq("org_id").order("created_at" desc)
-- The existing praise indexes are either location-leading or partial on
-- status = 'unmatched', so the "all praise" page falls back to a sort.
create index if not exists team_praise_org_created_idx
    on public.team_praise_records (org_id, created_at desc, id desc);

-- listStands: .eq("org_id").order("created_at" asc). A descending index serves
-- an ascending scan by reading backwards, so one index covers both directions.
create index if not exists review_stands_org_created_idx
    on public.review_stands (org_id, created_at desc);
