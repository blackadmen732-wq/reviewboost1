# 11. Security and privacy threat model

**Status: PROPOSED.** Builds on the controls already in the repository
(`README.md` security model, `docs/backend/ARCHITECTURE.md`,
`TEXT_REQUESTS.md` §17) and the APPROVED non-negotiables in
`SYSTEM_CONTEXT.md` §9.

## 11.1 Assets

| Asset | Why it matters |
|---|---|
| Provider access and refresh tokens | Read access to a business's customer and payment history at Square |
| ReviewBoost's Square client secret and webhook signature key | Impersonate the app; forge events for every connected business |
| Customer names and phone numbers | Personal data of people who never signed up for ReviewBoost |
| Consent and opt-out records | Legal record; tampering enables unlawful sends |
| Credits | Money |
| The ability to send SMS | Abuse channel (spam, harassment), carrier penalties for every ReviewBoost customer |

## 11.2 Trust boundaries

Browser ↔ Next.js route handlers ↔ Postgres (RLS + definer functions);
Next.js ↔ Square API; Square ↔ webhook endpoint; Next.js ↔ Twilio; Stripe ↔
webhook endpoint; scheduler ↔ `/internal/*`.

## 11.3 Threats and controls

| # | Threat (STRIDE) | Control | Verified by |
|---|---|---|---|
| T1 | A user reads or acts on another org's connection (I, E) | Org from session only; RLS on all integration tables; definer functions re-check org; composite FKs; 404 for foreign ids | pgTAP attacks as `authenticated` with a foreign JWT; route tests |
| T2 | Client supplies an `org_id` or `location_id` it doesn't own (E) | No route accepts `org_id`; `location_id` validated against the org inside the definer function | pgTAP + route tests |
| T3 | `member`/`viewer` connects or disconnects a provider (E) | Role check in route and definer (`owner`, plus `admin` if D-2.1) | pgTAP |
| T4 | OAuth CSRF / login-swap: attacker gets a victim's browser to complete the attacker's authorization, connecting the attacker's Square to the victim's org (S, T) | 256-bit single-use `state`, bound to user and org, 10-minute expiry, stored as keyed digest | Unit + integration tests: wrong user, reused, expired, missing |
| T5 | Authorization code interception or redirect manipulation (S) | Redirect URI is fixed in Square's app config and sent identically on exchange; no user-supplied redirect; exchange server-side with the client secret | Test that a modified redirect is refused |
| T6 | Same Square account attached to two orgs, leaking one business's customers to another (I) | Partial unique index on `(provider_id, external_account_id)` for live rows; reconnect must return the same `merchant_id` | pgTAP |
| T7 | Token theft from the database (I) | AES-256-GCM with a dedicated key held outside the DB; AAD binds ciphertext to the row; table has no client grants and no policies | pgTAP grant tests; unit test that a moved ciphertext fails |
| T8 | Token leakage through logs, errors, analytics, URLs, browser (I) | Tokens never leave `credentials.ts`; logger redaction keys; API DTOs exclude credential fields by construction; CSP and no third-party analytics on Settings pages | Unit test over every API response schema; log-redaction tests |
| T9 | Forged webhook creating fake visits or revoking a connection (S, T) | HMAC verification with the exact URL and raw body, constant-time compare, before any durable write under the event id; events only *trigger* a re-fetch with the connection's own token, so a forged body cannot inject data | Tests with bad signature, modified URL, re-serialized JSON |
| T10 | Webhook replay (T) | Dedupe on provider event id; re-fetch makes replays harmless | Duplicate-delivery tests |
| T11 | Webhook flood / large body (D) | 256 KB cap, signature check before parsing JSON, per-IP and global rate limit (existing `app.consume_rate_limit`, fails closed) | Load test in Phase 2 |
| T12 | Abuse of Sync now / test endpoints to hammer Square with a victim's token (D) | Per-connection limit (once per 5 min), per-org limit on authorize attempts | Route tests |
| T13 | Connected data used to text people who never agreed (repudiation, legal) | Consent never inferred from a connection (doc 7); attestation records who, when, wording version; eligibility log | pgTAP: a synced contact is `unknown`; F-1 fix test |
| T14 | Owner tampers with consent via the API (T) | Consent writable only through service-role wrappers with the attestation schema; append-only | Existing pgTAP + new |
| T15 | Review gating via connected data (policy) | Eligibility has no input correlated with satisfaction; test asserts the function never reads ratings | pgTAP static check |
| T16 | Insider/operator over-reach (I) | Service-role key server-only (existing); operator RPCs return counts and redacted hints only | Review of `/internal/*` outputs |
| T17 | Stale credentials after disconnect (E) | Credentials hard-deleted in the disconnect transaction; provider revoke attempted; webhooks for disconnected accounts dropped | Integration test |
| T18 | Square revokes or rotates our app's webhook key (D) | Key in env with a `_PREVIOUS` value accepted during rotation | Unit test with two keys |
| T19 | Personal data kept longer than needed (privacy) | Minimal-data import (only customers who visited), retention purges, deletion on disconnect, account deletion extended | Worker tests |
| T20 | Credentials connected by a hijacked owner session (S) | MFA step-up before authorize (APPROVED rule; NOT BUILT, README decision 3); session freshness check | Blocked until MFA exists or waived |

## 11.4 Credential lifecycle

Obtain (server-side exchange) → encrypt with key version N → refresh every
≤ 7 days under a single-flight lock → re-encrypt on key rotation → revoke at
Square and hard-delete at disconnect, org deletion, or provider revocation.
Client secret, webhook signature key and encryption keys live in the hosting
platform's encrypted environment variables, separate for development, preview
and production (APPROVED rule), rotated on staff change or suspected exposure.

## 11.5 Safe logging

Allowed in logs: request id, connection id, provider id, event type, outcome
code, counts, durations, hashed phone (keyed digest), Square object ids.
Never: tokens, codes, secrets, raw webhook bodies, names, phone numbers,
message bodies, signature headers. The existing recursive redaction in
`logger.ts` gains the token and code keys, and a unit test feeds it a Square
token response and a webhook body.

## 11.6 Privacy

- **Data minimization**: §6.1 and §5.1. Only customers referenced by visits;
  no amounts or items.
- **Purpose limitation**: connected data is used for review requests only.
  Not for analytics resale, not for marketing, not shared across orgs.
- **Transparency**: the provider detail page and the privacy policy
  (`app/privacy/page.tsx`) describe what is read and why. The privacy page needs
  a Connections section before launch.
- **Data subject requests**: §5.8.
- **Square's terms**: the Square developer terms and data-use rules must be
  reviewed before production launch (operations task).

## 11.7 Residual risks

| Risk | Status |
|---|---|
| MFA absent | Open; blocks production connect unless waived |
| Owner attestation may not satisfy the law for this message type | Open; counsel |
| Scheduler cadence once daily | Open; Vercel Pro or the PR #67 pg_cron scheduler |
| No external alerting | Open; Phase 4 dependency |
| Square plan requirements for booking reads | Verify in sandbox |
