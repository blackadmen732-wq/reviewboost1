# 13. API and webhook contracts

**Status: PROPOSED.** Conventions follow the existing API (`lib/server/http.ts`,
`lib/server/errors.ts`):

- Auth: `Authorization: Bearer <Supabase access token>`; organization resolved
  server-side (selected org cookie / `requireOwner`). **No endpoint accepts an
  `org_id`.**
- Success: `{ "data": … }`. Error: `{ "error": { "code", "message",
  "details"? }, "requestId" }`.
- Bodies validated with Zod `strictObject` (unknown keys rejected).
- Another org's id and a missing id both return `404 not_found`; a real role
  boundary returns `403 forbidden`.
- Mutating endpoints accept `Idempotency-Key` (8–200 chars); a replay returns
  the original result.
- Contracts are added to `openapi/` as `reviewboost-owner-connections-v1.yaml`
  in Phase 1 so contract tests can run.

> **Stage 1 as built (2026-10-12).** The routes below exist with the test
> provider; differences from this proposal:
>
> - Provider-scoped routes are `/api/v1/connections/providers/{provider}/…`
>   (Next.js cannot have `{provider}` and `{connectionId}` as sibling segments).
> - Configuration is `GET` (the app's places, read live) and `POST`
>   `{ "mappings": [ { "externalLocationId", "locationId" } ] }`. Place names
>   and time zones are taken from the provider, not the request; time zone
>   confirmation is deferred.
> - The callback returns `{ connectionId, state }`; the setup screen reads
>   places through `GET …/configuration`. Missing permissions return `200`
>   with `state: "authorization_required"` rather than `409`.
> - `account_mismatch` (409) and `test_required` (409) were added.
> - Not built yet: `Idempotency-Key` on these routes (repeat taps are
>   harmless: activation and "Update now" are idempotent in the database),
>   cursor paging on runs and issues (latest 10 runs, 50 open issues),
>   `mfa_required`, the OpenAPI file, and the Text Requests additions in 13.2.

New error codes: `connection_state_invalid` (409), `provider_unavailable`
(503 with `Retry-After`), `oauth_state_invalid` (400), `oauth_denied` (400),
`permissions_insufficient` (409), `account_already_connected` (409),
`mfa_required` (403), `not_eligible` (409, with `details.reasons`).

## 13.1 Providers and connections

### `GET /api/v1/connections/providers`

Roles: owner, admin.

```json
{ "data": [ {
  "id": "square",
  "displayName": "Square",
  "categories": ["pos", "appointments"],
  "summary": "Find customers from your Square sales or appointments.",
  "dataRead": ["Your locations", "Names and phone numbers of customers who visited", "When they paid or had an appointment"],
  "cannotDo": ["Change anything in Square", "See card numbers or what people bought"],
  "direction": "import_and_events",
  "availability": "available",
  "workflows": [
    { "id": "payments", "label": "Sales", "permissions": [ { "label": "Your locations", "reason": "To match Square places to yours" } ] },
    { "id": "appointments", "label": "Appointments", "permissions": [ … ] }
  ],
  "connection": { "id": "3f1c…", "state": "active", "health": "healthy", "syncing": false } | null
} ] }
```

Provider scope strings are not returned; owners see permission labels.

### `GET /api/v1/connections` · `GET /api/v1/connections/{connectionId}`

```json
{ "data": {
  "id": "3f1c…",
  "providerId": "square",
  "workflowId": "payments",
  "accountLabel": "Corner Cafe LLC",
  "state": "active",
  "health": "warning",
  "warnings": [ { "code": "records_skipped", "count": 2 } ],
  "syncing": false,
  "permissions": ["Your locations", "Customers who visited", "When they paid"],
  "locations": [ { "locationId": "…", "locationName": "High Street", "externalLocationName": "Corner Cafe - High St", "timezoneMismatch": false } ],
  "lastSuccessAt": "2026-10-12T14:10:03Z",
  "lastAttemptAt": "2026-10-12T14:10:03Z",
  "nextSyncAt": "2026-10-12T20:10:00Z",
  "lastError": null,
  "createdAt": "…"
} }
```

No token, cursor, external account id, or scope string appears.

### `POST /api/v1/connections/providers/{provider}/authorize`

Roles: owner (admin if D-2.1). Requires MFA when built. Rate limit: 10 per org
per hour.

Request: `{ "workflowId": "payments", "reconnectConnectionId"?: "uuid" }`
Response `200`: `{ "data": { "authorizeUrl": "https://connect.squareup.com/oauth2/authorize?…" } }`
Errors: `409 account_already_connected` (an org already has a live Square
connection and this is not a reconnect), `403 mfa_required`, `503
provider_unavailable` (provider not configured in this environment).

### `POST /api/v1/connections/providers/{provider}/callback`

Request: `{ "code"?: string, "state": string, "error"?: string }` (copied
from the provider's redirect query by the callback page; the page never
stores them).
Response `200`: `{ "data": { "connectionId": "…", "state": "connecting" | "authorization_required", "locations": [ { "externalLocationId": "…", "name": "…", "timezone": "America/Chicago" } ] } }`
Errors: `400 oauth_state_invalid`, `400 oauth_denied`, `409
account_already_connected`, `409 permissions_insufficient` (also sets
`authorization_required`), `409` on reconnect with a different account.

### `GET` · `POST /api/v1/connections/{connectionId}/configuration`

Allowed in `connecting`, `active`, `error`. Increments `config_version`.

```json
{ "locationMappings": [ { "externalLocationId": "L8Y…", "locationId": "uuid" } ],
  "confirmTimezones": [ { "locationId": "uuid", "timezone": "America/Chicago" } ] }
```

Validation: each ReviewBoost location at most once and belonging to the org;
each external location from the discovered list; at least one mapping.

### `POST /api/v1/connections/{connectionId}/test`

Allowed in `connecting`, `active`. Writes nothing canonical.
Response: `{ "data": { "account": "Corner Cafe LLC", "windowDays": 7, "usable": 18, "issues": { "no_customer": 4, "no_phone": 2, "invalid_phone": 1, "location_not_mapped": 0 }, "samples": [ { "hint": "Ana R. · •••• 4821", "issue": "invalid_phone" } ] } }`

### `POST /api/v1/connections/{connectionId}/activate`

Requires a passing test for the current `config_version`.
Response: `{ "data": { "state": "active", "backfillRunIds": ["…"] } }`.
`409 connection_state_invalid` otherwise.

### `POST /api/v1/connections/{connectionId}/sync`

Allowed in `active`. One per 5 minutes; a second call returns the existing run
(`200`, same id) rather than an error.

### `POST /api/v1/connections/{connectionId}/disconnect`

Request: `{ "confirm": true }`. Response `202`: `{ "data": { "state": "disconnecting" } }`.
Idempotent: disconnecting a disconnected connection returns `200` with the
current state.

### `GET /api/v1/connections/{connectionId}/runs?cursor=`

Paginated (existing opaque cursor convention). Items: `kind`, `stream`,
`status`, `counts`, `startedAt`, `finishedAt`, `errorCode`.

### `GET /api/v1/connections/{connectionId}/issues?cursor=`

Items: `objectType`, `issueCode`, `hint`, `firstSeenAt`, `lastSeenAt`. Hints
contain at most an initial-shortened name and last four digits.

## 13.2 Text Requests additions

### `GET /api/v1/text-requests/recipients?q=&cursor=`

Roles: owner, admin. Searches contacts with a connected or manual visit in the
last 30 days. `q` matches decrypted names server-side (bounded set) or, if it
looks like a phone number, the keyed hash of its normalized form.

```json
{ "data": { "items": [ {
  "customerId": "…",
  "names": [ { "name": "Ana Ruiz", "source": "Square" } ],
  "phoneLastFour": "4821",
  "latestVisit": { "visitId": "…", "kind": "payment", "occurredAt": "…", "locationName": "High Street" },
  "eligibility": { "status": "eligible" | "needs_consent" | "blocked", "reasons": ["consent_missing"] }
} ], "nextCursor": null } }
```

### `POST /api/v1/text-requests/eligibility`

Request: `{ "customerId"?: "uuid", "phone"?: "string", "visitId"?: "uuid", "standId": "uuid", "templateId": "thanks_v1" }` (exactly one of `customerId` or `phone`).
Response:

```json
{ "data": {
  "allowed": false,
  "blocking": [ { "code": "consent_missing", "message": "They haven't agreed to texts from you yet." } ],
  "warnings": [ { "code": "quiet_hours", "message": "This will go out at 9:00 am." } ],
  "preview": { "body": "The Corner Cafe: Hi Ana, …\nReply STOP to opt out.", "segments": 2, "encoding": "GSM-7", "credits": 2 },
  "balance": { "total": 148, "monthly": 120, "purchased": 28 },
  "consent": { "status": "unknown", "evidence": null },
  "previousUnknownDeliveryAt": null
} }
```

### `POST /api/v1/text-requests/consent-attestations`

Roles: owner, admin. Records an `opted_in` consent event through the service-
role wrapper.

```json
{ "customerId": "uuid", "method": "in_person" | "signup_form" | "at_booking" | "by_text",
  "wordingVersionId": "uuid", "confirmed": true, "reference"?: "string ≤ 120" }
```

`confirmed` must be literally `true`. Response: `{ "data": { "consentEventId": "…" } }`.

### `POST /api/v1/text-requests` (changed)

Adds `customerId`, `visitId`, `templateId`; removes the `consent` field and the
free-text `messageTemplate` (subject to D-8.1). Runs eligibility; on block
returns `409 not_eligible` with `details.reasons`. On success, unchanged
response plus `segments` and `credits`.

## 13.3 Billing additions

`POST /api/v1/billing/credit-packs/{packId}/checkout` → `{ "data": { "checkoutUrl": "…" } }`.
Stripe webhook adds `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `charge.refunded`,
`charge.dispute.created` handling (doc 10 §10.4–10.5).

## 13.4 Square webhook receiver

`POST /api/v1/webhooks/integrations/square`

| Aspect | Contract |
|---|---|
| Auth | `x-square-hmacsha256-signature` verified with `SQUARE_WEBHOOK_SIGNATURE_KEY` (and `_PREVIOUS` during rotation) over the exact configured URL (`SQUARE_WEBHOOK_NOTIFICATION_URL`) and raw body |
| Size | ≤ 256 KB, else `413` |
| Responses | `200` after durable insert (including duplicates and events for unknown or disconnected accounts); `403` bad signature; `503` database unavailable (Square retries) |
| Body handling | Never echoed, never logged; stored encrypted for 7 days |
| Subscribed events | `customer.created`, `customer.updated`, `payment.created`, `payment.updated`, `booking.created`, `booking.updated`, and the app-authorization revocation event (exact name confirmed in the sandbox) |
| Latency | Square expects a response within 10 s; the handler's work before responding is one verified insert |

### Internal envelope (after parsing, stored in `integration_inbox`)

```json
{
  "providerId": "square",
  "providerEventId": "c3b5…",
  "externalAccountId": "ML3…",
  "eventType": "payment.updated",
  "objectType": "payment",
  "objectId": "KkAk…",
  "objectVersion": 4,
  "occurredAt": "2026-10-12T14:09:58Z",
  "receivedAt": "2026-10-12T14:10:00Z",
  "payloadVersion": "square-2026-10-01.v1",
  "connectionId": "3f1c…",
  "orgId": "…"
}
```

`payloadVersion` combines the pinned Square API version with the adapter's
parser version, so a parser change is visible in stored rows.

## 13.5 Worker

`POST /api/v1/internal/integrations/process` — worker secret (`SMS_WORKER_SECRET`
or `CRON_SECRET`, via `workerAuthorized`), unknown callers get `404`. Response:
counts only (`inboxProcessed`, `runsAdvanced`, `tokensRefreshed`,
`deadLettered`, `stalledConnections`). Idempotent and safe to call
concurrently.

## 13.6 Environment variables (new)

| Name | Purpose |
|---|---|
| `SQUARE_ENVIRONMENT` | `sandbox` or `production` |
| `SQUARE_APPLICATION_ID` | OAuth client id |
| `SQUARE_APPLICATION_SECRET` | OAuth client secret (server only) |
| `SQUARE_OAUTH_REDIRECT_URL` | Exact registered redirect |
| `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_WEBHOOK_SIGNATURE_KEY_PREVIOUS` | Webhook verification |
| `SQUARE_WEBHOOK_NOTIFICATION_URL` | Exact URL used in signature computation |
| `SQUARE_API_VERSION` | Pinned `Square-Version` |
| `INTEGRATION_CREDENTIAL_KEY`, `INTEGRATION_CREDENTIAL_KEY_PREVIOUS`, `INTEGRATION_CREDENTIAL_KEY_VERSION` | Token encryption |

None carries a `NEXT_PUBLIC_` prefix; the existing secret-scanning CI job and
`check-no-service-secret` script are extended to these names.
