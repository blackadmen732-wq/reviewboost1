# Contact-first Connections — implementation boundary

**Product decision (2026-10-18):** ReviewBoost Connections exists to get names
and phone numbers a business already stores elsewhere into Text Requests. It is
**not** a payment reconciliation, appointment analytics or workflow-automation
product. Existing experimental visit and sync code remains in historical
branches until safely replaced; do not deploy an incompatible schema reset.

## One customer workflow

1. Owner/admin opens **Settings → Connections** and chooses a source.
2. Source opens an OAuth consent screen (or a file picker for Google Sheets).
3. Only customer contact read permissions are requested.
4. ReviewBoost imports/syncs names and phones into **one org-isolated contact
   list**, validates phone formats, deduplicates and records the source.
5. Owner selects a contact inside **Text Requests** and sees a plain-language
   eligibility status. Importing **never creates SMS consent**.
6. Owner explicitly previews and submits the approved one-to-one SMS message.
   The existing Twilio consent, opt-out, quiet-hours, quota and sending gates
   are authoritative. No automatic sending upon connection or sync.
7. Owner can re-sync, re-authorize and disconnect. Credentials and data follow
   the approved revocation and retention rules.

## Source status — no simulated production connectors

| Source | Existing code | Next step |
| --- | --- | --- |
| Google Sheets | One-sheet import on draft PR #79 | Google Cloud OAuth client / Picker key, migration, live account tests |
| Square | GET /v2/customers read-only contact client on branch from #79 | Seller OAuth app and scopes (CUSTOMERS_READ only), encrypted token lifecycle, import job, contact sync, pilot and tests |
| Google Contacts | Planned entry only | Google People API auth + restricted contact read, verified consent/publishing |
| Toast | Planned entry only | Verify partner approval and customer-read endpoints |
| Clover | Planned entry only | Verify developer app approval and contact read scopes |
| Vagaro | Planned entry only | Verify provider access/approval and customer read scopes |
| Mindbody | Planned entry only | Verify API credentials, per-business authorization and contacts API |
| CSV | Historical #74 design only | File parser/import with same consent-neutral schema, no SaaS OAuth |

The **Square** client is a low-level building block, not an activated connection:
- `frontend/lib/server/integrations/providers/square/customer-source.ts`
- GET `/v2/customers` with a seller-authorized bearer token, pinned API version,
  page size 1–100 and cursors, Sandbox vs Production endpoints, data schema
  validation and safe, typed provider errors.
- Maps only external id, name, phone and source timestamps/version. Discards
  email, notes, payment or booking data. Does not store or send an SMS.
- This client **does not** obtain the OAuth token, persist imported contacts or
  schedule recurring sync. The Square directory card remains Coming soon.

## Release acceptance for each real provider

- Register the ReviewBoost application with the provider and validate redirect
  URIs. OAuth tokens and client secrets stay server-only, encrypted, rotation
  supported; **no provider user supplies a secret in the ReviewBoost UI**.
- Guard OAuth `state` against CSRF/replay, require current organization owner or
  admin and the appropriate step-up authentication policy.
- Ask for the **minimum contact-read scope**. Do not request payment, booking,
  inventory, write or messaging access.
- Fetch contacts using bounded pages, respect 429 and retries, avoid duplicate
  imports, and detect expired/revoked credentials. Do not print PII or tokens in
  logs. Enforce org isolation and RLS even when a provider id collides.
- Provide explicit Preview/import count/last sync/error states, disconnect and
  data retention. No "Connected" badge until real provider authentication succeeds.
- Verify each provider's sandbox with tests for expired token, duplicate events,
  pagination, malformed numbers, and cross-tenant access.
- **No messaging without independently recorded valid consent**; obey STOP
  opt-outs. SMS imports are not permitted proof of opt-in.
- Merge only through PR checks; reconcile Supabase migration drift and fix
  reviewboost.fit DNS before deploying to paying users. No live charging or
  outbound SMS during this work without explicit approval.

This doc replaces the *product goal* stated in earlier Square payment/
appointment-oriented designs. It is not a claim that those legacy workflows
have already been removed from deployed code.
