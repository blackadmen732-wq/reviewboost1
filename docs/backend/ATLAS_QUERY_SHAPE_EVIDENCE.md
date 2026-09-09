# ATLAS — owner-inbox query shape (research #40)

Measured on this Cloud Agent host after the critical migration path passed.
Not a 20,000-org load. One hot org, two locations, **12,000** responses plus a
quiet org with 40 rows. Same SQL as `listReviews` / `getOwnerCounts` in
`frontend/lib/server/owner-data.ts`.

Host: PostgreSQL in `supabase_db_reviewboost`, `jit = off`. 2026-09-09.

## Reproduced (before any new index)

| Query | Role | p50-class time | Plan |
|---|---|---|---|
| Inbox `ORDER BY submitted_at DESC, id DESC LIMIT 26` | table owner (RLS off) | **2.60 ms** | Seq Scan 12,040 rows + top-N sort |
| same | `authenticated` hot owner | **64.6 ms** | Seq Scan + `Filter: app.is_org_member(org_id)`, 12,670 buffers |
| Exact `COUNT(*)` for the org | `authenticated` | **63.0 ms** | same per-row RLS |
| Quiet owner `COUNT(*)` of the hot org | `authenticated` | **61.0 ms**, count **0** | still visited 12,040 rows |

Ratio authenticated / owner on the inbox list: **~25×**. That matches the
direction of PR #40 / report 03 (24× on 28,800 rows at 180 ms vs 7.4 ms). This
host is smaller and colder; the **shape** is the finding, not the absolute ms.

Existing index `customer_responses_org_location_time_idx (org_id, location_id,
submitted_at DESC)` cannot walk `WHERE org_id = $1 ORDER BY submitted_at DESC`
in time order (no skip-scan). The planner seq-scans once the hot org is a large
fraction of the table.

## After `(org_id, submitted_at DESC, id DESC)` — isolation unchanged

| Query | Role | Time | Plan |
|---|---|---|---|
| Inbox LIMIT 26 | table owner | **0.039 ms** | Index Scan, stop after 26 |
| Inbox LIMIT 26 | `authenticated` | **0.78 ms** | same index + RLS filter on 26 rows only |
| Exact `COUNT(*)` | `authenticated` | **61.6 ms** | still Seq Scan + per-row RLS |
| Quiet owner count of hot org | `authenticated` | count **0** | no leak |

Inbox improved **64.6 ms → 0.78 ms** under RLS. The index does not remove
`app.is_org_member`. Cross-tenant remains zero rows.

Exact-count tiles are a different problem. The index does not fix them. Do
**not** drop the org predicate. Do **not** bypass RLS. Proposed follow-up
(not in this commit): replace dashboard exact `COUNT(*)` with estimates or
cached counters; optionally rewrite large-table RLS to
`org_id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid()
AND status = 'active')` so the planner can hash-join membership once. That
rewrite is isolation-equivalent only if the subquery is the same membership
rule. It is **not** shipped here.

## What this branch ships

`20260909000400_owner_dashboard_org_time_indexes.sql` adds the measured inbox
index and the matching live-feed index on `public_review_sessions
(org_id, created_at DESC, id DESC)`. Tenant isolation policies are untouched.
