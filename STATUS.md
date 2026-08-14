# ReviewBoost Foundation Status

Last updated: 2026-08-14

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

### Frontend/API

- [x] Team praise route uses RPCs for all operations (no direct UPDATE)
- [x] Praise-to-rating correlation removed (rpc_response_has_praise dropped, praisedSomeone removed)
- [x] Error handling on all database queries (503 on failure, never silent empty)
- [x] Cursor validation (UUID + timestamp checked before interpolation)
- [x] TypeScript strict, ESLint clean

### Tests (pgTAP)

- [x] column_security_test.sql (33 tests)
- [x] customer_flow_test.sql (88 tests)
- [x] security_hardening_test.sql (24 tests)
- [x] praise_isolation_test.sql (26 tests)

## What is not done

### Not built (and not in scope for this foundation)

- Frontend UI (pages exist but are not verified against real infrastructure)
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

- Vercel deployment configured with wrong root directory (`backend/` instead of `frontend/`)
- SYSTEM_CONTEXT.md references `review_threshold` field that still needs removal
- No production environment has been provisioned
