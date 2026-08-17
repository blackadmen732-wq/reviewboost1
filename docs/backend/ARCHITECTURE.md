# Backend Architecture

## Stack

- **Database**: PostgreSQL 17 via Supabase
- **Auth**: Supabase Auth (GoTrue)
- **Frontend**: Next.js 16 App Router, TypeScript strict
- **Hosting**: Vercel (frontend), Supabase (database + auth)

## Database design

### Tenant isolation

Every tenant table carries `org_id` and Row Level Security policies that filter
by the caller's organization membership. RLS is `ENABLE` (not `FORCE`) because
SECURITY DEFINER functions need to bypass RLS to write audit events and perform
cross-table operations.

### Write path: RPCs only

All state mutations go through SECURITY DEFINER PostgreSQL functions. No
authenticated role has UPDATE or INSERT grants on tenant tables (except where
explicitly needed by RLS policies). This ensures:

- Every write is validated (auth, membership, state)
- Every state change is audited
- No column can be tampered via the Data API

### Concurrency

State-transition RPCs use `SELECT ... FOR UPDATE` to lock the target row before
reading its current state. This prevents race conditions where two concurrent
requests could both read "unresolved" and both write "resolved" with duplicate
audit events.

### Idempotency

Every RPC checks current state before transitioning. If the row is already in
the target state, the RPC returns successfully without writing a duplicate audit
event. This makes retries safe.

### Audit trail

`audit_events` is append-only. No role has INSERT, UPDATE, or DELETE on it. Only
SECURITY DEFINER functions write to it, and only `rpc_record_audit_event` was
ever exposed (now revoked from authenticated). Audit events are written inside
the same transaction as the state change.

## Table overview

| Table | Purpose |
|---|---|
| `organizations` | Tenants |
| `organization_members` | User-to-org membership with role |
| `locations` | Physical locations within an org |
| `review_stands` | QR/NFC stands at locations |
| `public_review_sessions` | Anonymous customer sessions |
| `customer_responses` | Ratings + encrypted notes |
| `google_review_clicks` | Tracks who went to Google |
| `team_praise_records` | Customer praise for staff (encrypted) |
| `staff_members` | Staff roster (encrypted names) |
| `response_notes` | Owner notes on responses (encrypted) |
| `audit_events` | Append-only audit log |

## Security layers

### Column-level grants

Authenticated users have no table-wide SELECT on `team_praise_records`. Instead,
column-level SELECT is granted on safe columns only (excluding `response_id` to
prevent praise-to-rating correlation).

### Views

`praise_safe_view` uses `security_invoker = true` (RLS applies to the querying
user) and `security_barrier = true` (prevents optimizer predicate pushdown that
could leak filtered rows through side channels).

### Encryption

PII fields (`name_encrypted`, `note_encrypted`, `praise_note_encrypted`,
`first_name_encrypted`) are encrypted with AES-256-GCM under a versioned
application key. The key never enters the database. Stand tokens are stored
both as keyed digests (for lookup) and as ciphertext (for reprinting).

### Stand token security

- Lookup uses the digest; the raw token is never stored in plaintext
- Token columns (`public_token_hash`, `public_token_prefix`) cannot be updated directly
- Rotation is atomic: hash, prefix, ciphertext, key version, and audit event in one transaction
- Only owners and admins can rotate

## API conventions

### Error handling

Every database query checks for errors. Failures produce HTTP 503, never
silent empty results or nulls. The `dataFailure` / `databaseFailure` helpers
log context and throw `ApiError`.

### Pagination

Cursor-based pagination using composite opaque cursors (base64url of
`timestamp\0uuid`). Cursors are validated before use: the UUID must match
the UUID regex and the timestamp must parse as a valid date. Invalid cursors
are treated as "no cursor" (return first page).

### Public endpoints

Customer-facing routes (`/api/v1/public/q/[token]/...`) require no
authentication. They use the stand token for authorization. Unknown and
inactive tokens produce indistinguishable 404 responses.
