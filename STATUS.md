# ReviewBoost Foundation Status

Last updated: 2026-08-22

## What is done

### Database security (Supabase migrations)

- [x] Core tenancy: organizations, members, locations, stands
- [x] Customer flow: responses, praise, sessions, clicks
- [x] RLS policies on all tenant tables
- [x] Column-level security: UPDATE revoked on all tables, writes through RPCs only
- [x] Organization member RPCs: change_role, suspend, remove (SECURITY DEFINER, last-owner protection, self-promotion prevention)
- [x] Response RPCs: mark_read, resolve, reopen, add_note (SECURITY DEFINER, FOR UPDATE, idempotent, audited)
- [x] Stand token rotation: atomic hash+ciphertext update, audit event, admin-only
- [x] Praise view: security_invoker=true + security_barrier=true, no response_id
- [x] Praise state machine RPCs: match, unmatch, mark_shared, unmark_shared, archive, restore (FOR UPDATE, idempotent, audited)
- [x] Staff creation via RPC only (direct INSERT blocked)
- [x] Audit events: append-only, no authenticated INSERT/UPDATE/DELETE
- [x] Hard delete prevention on locations, stands, members
- [x] Stand token column protection (no direct UPDATE on hash/prefix)
- [x] Obsolete function overloads dropped (set_stand_token_ciphertext, old create_organization)
- [x] All security-critical params required (no unsafe defaults)

### Next.js web application and API

- [x] Public customer rating flow and equal Google review opportunity
- [x] Owner sign-in, onboarding, organization selection, dashboard, feedback, praise, stands, and settings pages
- [x] Next.js route handlers for the public flow and owner operations
- [x] Team praise route uses RPCs for all operations (no direct UPDATE)
- [x] Praise-to-rating correlation removed (rpc_response_has_praise dropped, praisedSomeone removed)
- [x] Error handling on all database queries (503 on failure, never silent empty)
- [x] Cursor validation (UUID + timestamp checked before interpolation)
- [x] TypeScript strict, ESLint clean

### Expo mobile foundation

- [x] Expo Router application under `apps/mobile/`
- [x] Supabase authentication and organization selection
- [x] Protected routes for the Feed and Feedback foundations
- [x] Feed and Feedback mock data filtered by the selected organization

### Tests (pgTAP)

- [x] column_security_test.sql (36 tests)
- [x] customer_flow_test.sql (88 tests)
- [x] security_hardening_test.sql (85 tests)
- [x] praise_isolation_test.sql (26 tests)
- [x] token_rotation_test.sql (18 tests)

The migrations, including a second clean reset and schema-drift check, and all
253 planned pgTAP assertions have run successfully in CI. This verifies the
database build and tested authorization behavior in CI; it does not verify a
production Supabase project.

## Built but not live-tested

- The Next.js web application and its route handlers exist and have automated
  type, lint, unit/component, contract, build, accessibility, end-to-end, and
  visual-test coverage in the repository. They have not been exercised against
  real production infrastructure as part of this status review.
- The Expo mobile foundation uses Supabase for authentication and organization
  selection. Its Feed and Feedback screens use organization-filtered mock data,
  not live backend data, and it is not a completed mobile release.
- Database migrations and pgTAP tests are CI-verified, but production deployment,
  operations, backup, and recovery readiness are not established here.

## What is not built

### Not built (and not in scope for this foundation)

- SMS/Twilio integration
- Stripe billing integration
- Google Business Profile integration
- POS integrations (Square, Toast, Clover)
- AI reply drafting
- Campaign scheduling
- NFC tag encoding
- Hardware ordering/fulfilment
- Admin portal
- Monitoring and alerting
- Backups and restore drill
- Load testing

### Known issues

- Vercel is configured externally and deployment checks have succeeded, but the
  full live flow has not been verified.
- Production infrastructure and provider integrations have not been live-tested
  by the evidence recorded here.
