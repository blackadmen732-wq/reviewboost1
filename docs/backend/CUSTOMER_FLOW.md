# Customer flow — backend contract and handoff

The five anonymous endpoints the `/q/{token}` page calls. This document is the
backend's side of `frontend/contracts/customer-flow.openapi.yaml`; where the two
disagree, the OpenAPI file is the contract and this is the explanation.

Owner: backend. The frontend is owned by Codex; nothing under `frontend/` was
touched by the work this describes.

---

## Review integrity

**Every rating from 1 to 5 receives the same neutral Google-review
opportunity.** This is a release blocker, not a preference.

The structural reason it holds: `googleReviewUrl` is returned by `GET
/api/v1/public/q/{token}`, which runs *before any rating exists* and is never
re-fetched with one. There is no code path where the rating is an input to
deciding what the customer is offered. Ratings 1 through 5 are stored, take the
identical service path, and produce identical response shapes.

The private note and Team Praise are **additive**: extra things a customer may
choose to do. Neither hides, delays, replaces, or de-emphasises the public
review.

Removed by this work and not to be reintroduced:

- `qr_stands.review_threshold` is no longer read or written by any code. The
  column still exists and is scheduled for a separate `DROP COLUMN` migration
  once nothing depends on it.
- `POST /q/:publicId/rating` — the rating gate — returns **410 Gone**.
- `feedbackIntercepted` and `interceptRatePercent` are gone from the dashboard.
  The surviving metric is `privateFeedbackReceived`: recovery, not prevention.

---

## Endpoints

Base: `/api/v1/public`. All responses carry `Cache-Control: no-store`.

Success bodies are the **raw DTO** — no `{ success, data }` envelope. Failures
are always:

```json
{ "error": { "code": "stable_code", "message": "Safe text", "details": [] }, "requestId": "..." }
```

`details` is present only for field-level validation failures. No stack trace,
SQL text, provider payload, tenant id, or internal stand id ever appears.

**No endpoint returns 202.** The client rejects it, and there is no status
contract behind it.

### `GET /q/{token}`

Read-only. **Records no scan** — a link preview or a crawler must not inflate a
business's numbers.

```json
{
  "business": { "name": "…", "logoUrl": null },
  "location": { "name": null },
  "googleReviewUrl": "https://g.page/r/…/review",
  "supportedLocales": ["en", "es", "ht"],
  "defaultLocale": "en"
}
```

`logoUrl` and `location.name` are **always null today**: the legacy schema has
no logo column and no locations table. They are in the contract because both
arrive in a later phase. The stand label is deliberately *not* substituted for a
location name — a placement is not a place.

### `POST /q/{token}/sessions`

`Idempotency-Key` required. Body `{ "locale": "en" | "es" | "ht" }`.
→ **201** `{ "sessionId": "…" }`, or **200** with the same body on replay.

Records one logical scan. Bots are given a working session but are not counted.

### `POST /q/{token}/responses`

`Idempotency-Key` required. Body `{ "sessionId", "rating": 1–5, "note"? }`.
→ **201** `{ "responseId": "…" }`, or **200** on replay.

The note is optional for **every** rating and is encrypted at rest with
AES-256-GCM. One response per session.

### `POST /q/{token}/google-click`

`Idempotency-Key` required. Body `{ "sessionId", "responseId" }`. → **204**.

Records that the Google action was **selected**. It does not mean a review was
written, submitted, or published — ReviewBoost cannot observe any of that, and
no feature built on this table may imply otherwise. Deduplicated per response,
so a customer who taps twice produces one record. The API never redirects: the
client owns the navigation, so a tracking failure can never stand between a
customer and the public review page.

### `POST /q/{token}/team-praise`

`Idempotency-Key` required. Body `{ "sessionId", "responseId", "firstName",
"note"? }`. → **201** `{ "teamPraiseId": "…" }`, or **200** on replay.

Stored `unmatched` with both fields encrypted. **No employee is ever matched
automatically.** Returns nothing about the rating, the note, the Google state, or
any contact detail — `team_praise_records` has no rating column at all, so the
barrier starts in the schema rather than in a DTO someone must remember to trim.

Unicode is stored as written: no transliteration, no accent stripping. Limits are
80 characters / 320 bytes for the name and 2,000 characters / 8,000 bytes for the
note — both, because `maxLength` counts UTF-16 units and storage counts bytes.

---

## Error codes

| Code | Status | Meaning |
|---|---|---|
| `review_link_inactive` | 404 | Unknown, inactive, or not-yet-serviceable stand |
| `validation_failed` | 400 | Body or params rejected; `details` names the fields |
| `idempotency_key_required` | 400 | Header absent or malformed |
| `idempotency_conflict` | 409 | Same key, different request body |
| `idempotency_in_progress` | 409 | An identical request is still running |
| `session_not_found` | 404 | Unknown session, or one issued at another stand |
| `session_expired` | 404 | Session past its 24-hour life |
| `response_already_submitted` | 409 | That session already has a response |
| `response_not_found` | 404 | Response, session, and stand do not all agree |
| `team_praise_already_submitted` | 409 | That response already has praise |
| `rate_limited` | 429 | Per-stand or per-device budget exhausted |
| `endpoint_removed` | 410 | The legacy rating gate |

**Unknown, inactive, and unconfigured stands are indistinguishable.** Same
status, same code, same message. Distinguishing them would confirm to anyone
holding a guessed token that it was once real, and would leak whether a specific
business is a customer.

A stand counts as unconfigured if its destination is not a validated Google
review URL. The contract makes `googleReviewUrl` required and non-nullable and
the client re-validates it, so such a stand cannot produce a usable page —
failing identically to an unknown token beats serving a context the client will
reject with no explanation. A business that adds a valid URL later becomes
serviceable immediately.

---

## Idempotency

Durable and database-backed. `idempotency_records` binds scope (the stand
token), operation, method, route, a keyed hash of the client key, a keyed hash
of the canonical request body, state, status, and an encrypted response body.

- Same key, same request → the original result. A replayed create is **200**,
  not 201: nothing was created this time.
- Same key, different request → **409 `idempotency_conflict`**. Never the stored
  result — that would silently discard what the customer actually submitted.
- Concurrent identical requests → **one** domain row. `INSERT … ON CONFLICT DO
  NOTHING` waits on the uncommitted duplicate rather than racing it, so the
  loser observes the winner's committed result and replays it.
- The claim, the domain write, and the stored result **commit together**. A
  network timeout therefore either replays or performs — never both, and never
  leaves a record with no result to replay.
- Keys are scoped per stand, so two businesses cannot collide.
- A claim left behind by a killed process is taken over after 60 seconds.
- Records expire after 24 hours and are purged by `npm run maintenance`.
- Key order in the body does not matter; a reordered retry is the same request.
- The stored replay body is **encrypted**, because it carries the session and
  response tokens that are keyed-hashed everywhere else.

No external provider is called inside the transaction, so nothing holds it open
waiting on a third party.

---

## Security

**Tenant derivation.** The customer is anonymous. One transaction binds
`app.public_stand_token` — a narrow SELECT policy then exposes exactly the one
stand whose token the caller already holds — reads `account_id` from that row,
and binds `app.current_account_id`. Everything after runs under ordinary tenant
RLS. An `account_id` in the request body is ignored: the token is the only
tenant input, and it is resolved server-side.

`SECURITY DEFINER` was **not** used, and could not have been: every tenant table
is `FORCE ROW LEVEL SECURITY`, so a definer function owned by the table owner is
subject to the same policy it is trying to satisfy and would silently write
nothing.

**Capability tokens.** `sessionId` and `responseId` are 32 bytes of entropy
stored only as keyed HMACs. Stand, session, and response must all agree before a
follow-up action is accepted, so a leaked response token cannot be replayed
against another session or another business.

**No contact data.** Every request schema is `.strict()`, so `phone`, `email`,
`consent`, `marketingConsent`, `accountId`, `standId`, and `reviewThreshold` are
**rejected**, not ignored.

**No raw addresses stored.** Abuse prevention uses a keyed fingerprint of
address and user agent, salted with the UTC date so it rotates daily. It is not
customer identity and must never be used as such — every customer in one
restaurant shares an address.

**Rate limiting** is layered: per stand (240/min read, 60/min write) and per
client fingerprint (30 per 5 min write). Per-stand alone would punish a busy
restaurant sharing one NAT address; per-device alone would leave a single
printed code unbounded.

**CSRF is exempted** for `/api/v1/public/*`. The path carries no ambient
authority, and without the exemption an owner who scans their own QR code while
signed in to the dashboard sends their session cookies, hits the check, and is
rejected 403 — the flow breaking for exactly the person most likely to test it.

---

## Handoff to the frontend

**One change is required in a frontend-owned file, which I did not make.**

`frontend/lib/api/production-customer-flow-api.ts` currently sets
`credentials: "include"`. The public endpoints are anonymous and use no cookies,
so it should be `credentials: "omit"`. Sending credentials needlessly widens
what a cross-origin response can carry and couples the customer flow to CORS
credential rules it does not need.

The backend does **not** depend on this change: CSRF is exempted for the public
path and the CORS configuration already allows credentials for the dashboard, so
the flow works either way. It is hygiene, not a blocker.

No other frontend change is needed. `Idempotency-Key` is now in the CORS
allowlist, so preflight succeeds.

---

## Configuration

`PUBLIC_FRONTEND_URL` — the origin printed into every QR code and written to
every NFC tag, as `{origin}/q/{token}`. Falls back to `PUBLIC_APP_URL`.
Production **refuses to start** without one of them: a stand printed against the
wrong origin is already sitting on a customer's table and cannot be recalled. In
development it defaults to `http://localhost:3000`, stated rather than assumed.

Existing codes printed against the API origin keep working — `GET /q/:publicId`
redirects to the frontend flow.

---

## What is verified, and what is not

**Executed and observed:** 260 backend tests pass. That covers routing,
validation, the strict-schema rejections, the error envelope, CORS preflight,
the CSRF exemption, the legacy routes being unreachable, stand URL generation,
and the pure domain logic — Google URL validation, request canonicalisation,
Unicode normalisation, byte limits.

**Written but never executed:** every SQL statement in
`migrations/003_customer_flow.sql`, and the whole of
`test/integration/customerFlow.db.test.js` — 10 suites covering idempotent
replay, concurrent collapse, cross-tenant isolation, encryption at rest, capability
scoping, Google-click dedupe, the Team Praise barrier, and retention. They are
**skipped**, visibly, because this environment has no Docker, no PostgreSQL, and
no Supabase CLI.

`TEST_DATABASE_URL=postgres://… npm run test:integration` runs them. CI provides
one, so the first push exercises them.

Until that run is green, nothing in this document about database behaviour
should be treated as proven.
