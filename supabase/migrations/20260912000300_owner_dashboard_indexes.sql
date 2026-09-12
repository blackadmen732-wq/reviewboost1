-- Indexes for the owner dashboard access patterns.
--
-- Every query in owner-data.ts filters by org_id and sorts by a timestamp.
-- Without these, every page load is a sequential scan once data grows.

-- Feedback list: .eq("org_id", orgId).order("submitted_at", desc)
create index if not exists customer_responses_org_submitted
    on public.customer_responses (org_id, submitted_at desc);

-- Rating breakdown RPC: GROUP BY rating WHERE org_id = ...
create index if not exists customer_responses_org_rating
    on public.customer_responses (org_id, rating);

-- Praise list: .eq("org_id", orgId).order("created_at", desc)
create index if not exists team_praise_records_org_created
    on public.team_praise_records (org_id, created_at desc);

-- Google clicks: .eq("org_id", orgId).order("clicked_at", desc)
create index if not exists google_review_clicks_org_clicked
    on public.google_review_clicks (org_id, clicked_at desc);

-- Review sessions: .eq("org_id", orgId).order("started_at", desc)
create index if not exists public_review_sessions_org_started
    on public.public_review_sessions (org_id, started_at desc);

-- Audit events: .eq("org_id", orgId).order("created_at", desc)
create index if not exists audit_events_org_created
    on public.audit_events (org_id, created_at desc)
    where org_id is not null;

-- Stands by org for the Tags page.
create index if not exists review_stands_org_created
    on public.review_stands (org_id, created_at desc);
