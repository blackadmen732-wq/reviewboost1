# 15. Phased roadmap

**Status: PROPOSED.** Each phase is one reviewable PR (or a short stack), ends
CI-green on a branch, and does not merge, deploy, migrate production, change
live billing, or enable live messaging without the owner's explicit
authorization.

The thin vertical slice is Phases 0–3: one real connection (Square), one safe
data flow (visits → contacts), visible sync status, and a verified path into
one-to-one Text Requests with honest consent.

## Phase 0 — Decisions and safety fixes

**Depends on:** approval of this design.

| Work | Acceptance |
|---|---|
| Owner decisions in README (provider, consent path, MFA, #74, disconnect policy) and the D-items | Recorded in this folder |
| Fix F-1: composer stops minting consent; attestation endpoint and dialog; reset migration for empty-evidence opt-ins | A typed number with no consent is blocked with `consent_missing`; attestation records method, wording version, actor; pgTAP + Vitest regression tests |
| Fix F-2: server-side business prefix and opt-out footer; segments on final body | Preview and send show the footer; segment tests updated |
| Approved templates (per D-8.1) | Free text removed or screened as decided |

These ship value without any integration: they make today's Text Requests
honest. They are small and independent, so they go first.

**Phase 0 code status (on this branch, not merged):** F-1, F-2 and approved
templates are implemented. Differences from the target contracts above, all
because no connected contacts exist yet:

- Consent is recorded at `POST /api/v1/text-requests/consent`, keyed by phone
  and Tag rather than `customerId`; the wording version is the string
  `owner-attestation-v1` in `frontend/lib/sms/text-request-templates.ts`
  rather than a row id. Doc 13's `/consent-attestations` replaces it in Phase 3.
- The two approved messages are "Thanks for visiting today. How did we do?
  {link}" and "How was your visit? Tell us here: {link}". No `{first_name}`
  yet, because a typed number has no name.
- A blocked send returns `409 not_eligible` with the owner-facing reason;
  the full multi-reason list (doc 7) arrives with the eligibility function in
  Phase 1.
- Migration `20261012000100_consent_requires_evidence.sql` resets earlier
  evidence-free owner opt-ins to `unknown` and adds a `NOT VALID` check that
  new ones carry `method`, `attested_by` and `wording_version`.

## Phase 1 — Foundation (no provider)

**Depends on:** Phase 0 decisions; #74 disposition.

| Work | Acceptance |
|---|---|
| Migration: `integration_*` tables, revised customer model (doc 5 §5.9), eligibility function and log | Applies from empty and on the populated baseline; RLS on every table; pgTAP isolation attacks pass |
| `lib/server/integrations/` registry, adapter contract, credentials module, lifecycle service, fake adapter | Full lifecycle runs end to end with the fake adapter in Vitest |
| Inbox, sync runner, worker endpoint, health metrics | Duplicate, out-of-order, crash-resume and dead-letter tests pass; concurrency proof for leases and token refresh |
| Directory and connected-detail UI rendering registry state; no `available` provider yet | Directory shows nothing connectable in production config; Playwright states and Axe pass |
| OpenAPI contract file | Contract tests pass |

### Status: stage 1 built (draft PR #76), not merged

Built and tested against the test provider only:

- Migration `20261012000200_integrations_foundation.sql`: connections,
  place mappings, lifecycle events, sealed credentials, OAuth states, webhook
  inbox, sync runs and checkpoints, record issues, and the customer model
  (`customers`, `customer_source_profiles`, `customer_visits`). RLS on every
  table; all writes through `app.integration_*` definer functions reachable
  only by `service_role`. pgTAP: `supabase/tests/integrations_test.sql` (99).
- `lib/server/integrations/`: registry, adapter contract, credentials
  (AES-256-GCM, own key), the test provider, pipeline, sync runner,
  connection service. Routes under `/api/v1/connections`, the webhook
  receiver, the worker endpoint, and Connections metrics in
  `/api/v1/internal/health`.
- Screens: Settings → Connections (directory), one page per app (connect,
  match places, run the check, turn on, status, issues, recent updates,
  disconnect), the callback page, and the test provider's consent page.
- Tests: `tests/unit/integrations.test.ts`, and an opt-in end-to-end run of
  the whole lifecycle against the local cluster,
  `tests/integration/connections-e2e.test.ts` (`RB_LOCAL_PG=1`).

Deviations from the design, on purpose:

- Credentials are bound (GCM additional data) to organization, provider and
  provider account rather than the connection id, which does not exist yet
  when tokens are first sealed. One live connection per account keeps the
  binding as tight.
- A customer with no usable phone is not a contact. It is an issue the owner
  can see (`no_phone`, `invalid_phone`); there is no `phone_status` column.
- A connection reads only its workflow's stream (`payments` or `bookings`).
- Visits at places the owner left out are counted, not listed as issues, and
  the customers on them are not brought in.
- The worker endpoint is not scheduled: Vercel Hobby crons run once a day.
  Owner actions and webhooks run the worker right after they respond
  (`after()`); a scheduler can call `/api/v1/internal/integrations/process`
  once one is chosen.

Not done in stage 1: the eligibility function and log (Phase 3), Playwright
and Axe runs of the new screens, the OpenAPI file, MFA for connecting, and
`Idempotency-Key` on these routes. The customer model here overlaps open PR
#74, which needs revising onto it before either merges.

## Phase 2 — Square, read-only

**Depends on:** Phase 1; a Square developer account and sandbox credentials
(owner provides); MFA built or waived.

| Work | Acceptance |
|---|---|
| Square adapter: OAuth code flow, refresh, revoke, `ListLocations`, payments and bookings mapping, webhook verification | Unit tests with documented vectors; recorded sandbox fixtures |
| Setup wizard with location mapping and test sync | Owner can connect a sandbox seller on a preview deployment and see test results |
| Backfill and incremental sync, issue list, connected detail | Sandbox payments and bookings become visits; duplicates and replays produce none; `SANDBOX_VERIFICATION.md` written with evidence |
| Square marked `available` only behind a pilot feature flag | Directory shows Square as Coming soon for everyone else |

**Exit criteria:** every *verify in sandbox* item in Appendix A answered.

## Phase 3 — Into Text Requests

**Depends on:** Phase 2; Phase 0 fixes.

| Work | Acceptance |
|---|---|
| Recipient search, recipient card, eligibility endpoint and explanations | A connected contact shows source, visit, consent state; every blocking reason is shown |
| Send from a connected visit: `visit_id` dedupe, final-body cost confirmation | One request per visit under double taps and retries |
| Credit pack checkout and grant (F-4); refund and dispute handling; F-8 fix if confirmed | Signed Stripe fixtures: duplicate events grant once; refund removes unspent only |
| Contextual links from Text Requests to Connections | Links appear only for owners/admins and only when relevant |

**Exit criteria (the slice is done):** on a preview deployment with the Square
sandbox and `SMS_PROVIDER=fake`, an owner connects Square, sees visits arrive
with their source, attests consent for one contact, sees the exact message and
cost, sends, and sees an honest status, with no duplicate visit, message, or
charge under replayed webhooks and double taps.

## Phase 4 — Operations and pilot readiness

**Depends on:** Phase 3; scheduler at production cadence (Vercel Pro or PR #67
scheduler); an alerting tool chosen.

| Work | Acceptance |
|---|---|
| Alerts and runbooks (doc 14) | Each alert fired in a drill |
| Privacy policy Connections section; account deletion covers integration data | Reviewed by owner |
| Legal review of consent basis, templates, and disclosures | Written sign-off |
| A2P 10DLC registration and a live SMS number | Operations, outside code |
| Production Square app review against Square's terms | Operations |

**Pilot (requires explicit authorization):** 3–5 businesses (mixed
restaurant and salon) on production Square, with live messaging only after the
legal sign-off. Measure: share of visits with a usable phone, share of
contacts reaching `opted_in`, sync latency, owner comprehension of block
reasons.

## Phase 5 — Later, each a separate decision

- Event-triggered automation (doc 9), gated on pilot results.
- Customer-facing opt-in capture.
- A second provider (Vagaro or Toast/Clover per demand), using the same
  adapter contract with no change to the canonical model.

## Dependency summary

```
Decisions ─► Phase 0 (honest Text Requests)
         └─► Phase 1 (foundation, #74 revised) ─► Phase 2 (Square sandbox) ─► Phase 3 (slice) ─► Phase 4 (ops) ─► pilot
External: Square dev account (P2) · MFA or waiver (P2) · Stripe pack prices (P3) · scheduler cadence + alerting (P4) · counsel, 10DLC (P4)
```

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Few connected contacts ever become `opted_in`, so the feature finds people it can't text | High | High | Measure in pilot; attestation flow; future opt-in capture; set expectations in UI copy |
| Many Square payments carry no `customer_id` (restaurants) | High | Medium | Report it honestly in setup; Appointments workflow is stronger for salons |
| Owner attestation not legally sufficient | Medium | High | Counsel before live messaging |
| Square plan gating for booking reads | Medium | Medium | Verify in sandbox before building the appointments workflow |
| Scheduler cadence (once daily) | Certain until fixed | Medium | Inline webhook processing; fix cadence before pilot |
| #74 lands unrevised first | Medium | Medium | Coordinate: revise #74 rather than land it as is |
| MFA rule blocks launch | Certain until built or waived | High | Decide in Phase 0 |
