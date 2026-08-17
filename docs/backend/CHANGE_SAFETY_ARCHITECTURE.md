# Change-Safety Architecture

Rules for adding features to ReviewBoost without breaking existing behavior.

## Module boundaries

The backend is a modular monolith. Each module owns its tables, RPCs, and API
routes. Modules communicate through well-defined interfaces, never by reaching
into each other's tables directly.

| Module | Owns | May depend on |
|---|---|---|
| **organizations** | `organizations`, `organization_members`, membership RPCs | (none — root module) |
| **feedback** | `customer_responses`, `response_notes`, resolve/reopen/read RPCs | organizations, stands |
| **stands** | `review_stands`, `public_review_sessions`, `google_review_clicks`, stand RPCs | organizations |
| **praise** | `team_praise_records`, `staff_members`, praise RPCs | organizations, stands |
| **messaging** | (future) SMS/email delivery, templates | organizations |
| **billing** | (future) subscriptions, usage, invoices | organizations |
| **google** | (future) Google Business Profile integration | organizations, stands |
| **pos** | (future) POS system integrations | organizations, stands |
| **notifications** | (future) push, email, in-app notifications | organizations, messaging |
| **intelligence** | (future) analytics, insights, suggestions | organizations, feedback, praise |

### Dependency rules

- Every module may depend on **organizations** (for tenant context and auth).
- No module may depend on a *future* module — only modules that exist today.
- Cross-module reads use views or RPCs, never direct table queries.
- Cross-module writes use RPCs, never direct INSERT/UPDATE.
- Circular dependencies are forbidden.

## API contract

### Single source of truth

`openapi/reviewboost-public-v1.yaml` is the authoritative contract for the
public customer-flow API. All other documentation describes; this file defines.

### Versioning

- The public API is versioned in the URL path (`/api/v1/...`).
- Breaking changes require a new version (`/api/v2/...`).
- Non-breaking additions (new optional fields, new endpoints) are allowed within
  a version.

### Generated clients

- `frontend/lib/api/generated/customer-flow.ts` is generated from the OpenAPI
  spec using `npm run api:generate` in `frontend/`.
- Never hand-edit generated files. Regenerate after every spec change.
- CI validates that generated clients are in sync with the spec.

## Database migrations

### Forward-only

- Never edit a committed migration. Create a new corrective migration instead.
- Name migrations with the timestamp prefix Supabase generates:
  `supabase migration new <description>`.
- Each migration must be idempotent where possible (`CREATE OR REPLACE`,
  `DROP ... IF EXISTS` before `CREATE`).

### Expand–migrate–contract

For breaking schema or API changes, follow three phases:

1. **Expand**: Add the new column/table/RPC alongside the old one. Both work.
   Deploy this migration. The application reads from old, writes to both.
2. **Migrate**: Backfill data from old to new. Verify correctness. Update the
   application to read from new.
3. **Contract**: Drop the old column/table/RPC once all reads and writes use the
   new structure. This is a separate migration deployed after verification.

Never combine expand and contract in a single migration or deployment.

### Migration testing

- Every migration must pass `supabase db reset` from an empty database.
- Every migration must pass with existing test data (seed.sql).
- pgTAP tests validate post-migration state, not just "did it run."

## Data integrity requirements

### Idempotency

Every state-transition RPC must check current state before mutating. If the row
is already in the target state, the RPC returns successfully without side
effects. This makes retries safe and prevents duplicate audit events.

### Unique constraints

Use database-level unique constraints (not application-level checks) for
business uniqueness rules. Examples: one active stand per token hash, one
membership per user-org pair, one response per session.

### Row locking

State-transition RPCs use `SELECT ... FOR UPDATE` on the target row before
reading its current state. This prevents race conditions where concurrent
requests both read the old state and both write, producing duplicates or
inconsistencies.

### Transactional writes

Audit events are written inside the same transaction as the state change.
If the state change fails, the audit event is rolled back. If the audit write
fails, the state change is rolled back. Use SECURITY DEFINER RPCs for this —
they run as the function owner and can write to tables the caller cannot.

### Transactional outbox (future)

When the messaging module is added, side effects that leave the database
(emails, SMS, webhooks) must use a transactional outbox pattern:

1. Write the outbox row in the same transaction as the state change.
2. A separate worker polls the outbox and delivers messages.
3. The worker marks rows as delivered and retries failures.

This prevents "state changed but notification lost" and "notification sent
but state change rolled back."

### Audit trail

`audit_events` is append-only. No role has direct INSERT, UPDATE, or DELETE.
Only SECURITY DEFINER RPCs write audit events, inside the same transaction as
the business state change. Every auditable state transition (resolve, reopen,
match, share, archive, membership changes) must produce exactly one audit event.

## Feature flags and rollback

### Feature flags

New features that change user-visible behavior should be gated behind feature
flags (environment variables or a feature-flag table) so they can be disabled
without a deployment.

### Rollback procedure

- Application rollback: revert to the previous Vercel deployment.
- Database rollback: if a migration is destructive and cannot be reverted with a
  corrective migration, restore from a Supabase point-in-time backup. This is
  why expand–migrate–contract exists — to avoid this scenario.
- Never rely on `DROP` or `ALTER ... DROP COLUMN` for rollback. Use corrective
  migrations that add back what was removed.

## Testing requirements

Every change must include appropriate tests from the following categories:

| Category | Tool | What it proves |
|---|---|---|
| **Unit tests** | Vitest | Route handlers return correct status codes and bodies for valid/invalid/unauthorized inputs |
| **Contract tests** | Vitest + OpenAPI | API responses match the OpenAPI spec |
| **RLS tests** | pgTAP | Row-level security policies allow and deny the correct operations for each role |
| **Migration tests** | pgTAP | Post-migration state is correct (rows exist, constraints hold, privileges are set) |
| **Integration tests** | pgTAP | RPCs enforce authorization, idempotency, audit writes, and state transitions |
| **End-to-end tests** | Playwright | Customer flow works from landing page through completion |
| **Privilege tests** | pgTAP | `has_schema_privilege`, `has_function_privilege` prove roles cannot access what they should not |

### Minimum coverage for a new feature

- At least one unit test per route handler (success + auth failure + validation failure).
- At least one pgTAP test per new RPC (authorization + state transition + idempotency).
- At least one RLS test per new table (owner can read own rows, cannot read other org's rows).
- Contract tests if the OpenAPI spec changes.
- E2E tests if the customer-facing flow changes.

## Production readiness gates

### Observability

- Structured JSON logging with `requestId` correlation on every API route.
- Error responses include `requestId` for support debugging.
- Database query performance monitored through Supabase dashboard.

### Alerting

- Vercel deployment failure alerts.
- Supabase database health alerts.
- Error rate monitoring on API routes (set up when traffic warrants it).

### Backup and recovery

- Supabase point-in-time recovery is enabled for production.
- Backup verification: restore to a staging project quarterly.
- `CUSTOMER_NOTE_ENCRYPTION_KEY` is stored outside the database and backed up
  separately. Losing this key means losing access to encrypted customer notes
  and praise text.

### Load testing

Before launching features that change query patterns or add new tables:

- Run pgBench or k6 against a staging Supabase instance.
- Verify that RLS policies do not degrade query performance with realistic
  row counts (10k+ responses per org).
- Verify that `FOR UPDATE` locking does not cause deadlocks under concurrent
  load.

### Pre-merge checklist

Before merging any PR:

1. All CI checks pass (lint, typecheck, build, unit tests, contract tests,
   migration tests, pgTAP tests, secret scanning, review-gating check).
2. Migrations apply cleanly from empty (`supabase db reset`).
3. No secrets in committed files.
4. OpenAPI spec and generated clients are in sync.
5. PR description accurately describes what changed and why.
6. At least one human review approval.
