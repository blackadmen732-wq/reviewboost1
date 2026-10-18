# ReviewBoost Connections — design set

**Updated product scope (2026-10-18):** Connections is now **contact import
for Text Requests only**. See [Contact-first Connections](contacts-only.md).
Historical payment/appointment sync designs below are reference material, not
approval to request those permissions or enable those workflows. Square
remains unavailable until customer-read OAuth and real imports work.

**Status of this whole folder: PROPOSED.** Nothing here is built. Nothing here
is approved until the owner signs off on the decisions listed below. The state
labels are the ones `SYSTEM_CONTEXT.md` defines (APPROVED, PROPOSED,
IMPLEMENTED, CI-TESTED, LIVE-VERIFIED, NOT BUILT, REJECTED).

Connections lets a business owner connect a tool they already use, see exactly
what ReviewBoost may read from it, confirm the connection works, and use the
customer and visit records it supplies inside the existing **Text Requests**
flow, without copying records by hand.

Three separate acts, never collapsed into one:

1. **Connecting** a service grants ReviewBoost read access to some data.
2. **Syncing** brings permitted records in, attributed to their source.
3. **Sending** a text is a separate decision, gated by consent and eligibility.

A connection is not consent. An imported phone number is not consent. A
booking or a payment is not consent.

## The documents

| # | Document | What it answers |
|---|---|---|
| 1 | [Current-state audit](01-current-state-audit.md) | What exists, what is partial, what is missing, what to reuse, open PRs |
| 2 | [Directory and routes](02-directory-and-routes.md) | Which providers appear, how, and where in the app |
| 3 | [Connection lifecycle](03-connection-lifecycle.md) | States, transitions, the setup flow |
| 4 | [Provider adapter interface](04-provider-adapter-interface.md) | Registry, adapter contract, connection record, credentials |
| 5 | [Customer and visit data model](05-customer-and-visit-model.md) | Canonical records, identity matching, retention |
| 6 | [Ingestion and sync](06-ingestion-and-sync.md) | Webhooks, polling, idempotency, checkpoints, dead letters |
| 7 | [Consent and eligibility](07-consent-and-eligibility.md) | The one eligibility service and its reason codes |
| 8 | [One-to-one messaging flow](08-one-to-one-messaging.md) | Text Requests with a connected recipient |
| 9 | [Future automation and V1 exclusions](09-future-automation.md) | What is deliberately not in V1 |
| 10 | [Credits and billing](10-credits-and-billing.md) | Ledger reuse, discrepancies, reconciliation |
| 11 | [Threat model](11-threat-model.md) | Security and privacy |
| 12 | [UI specification](12-ui-specification.md) | Screen by screen, every state |
| 13 | [API and webhook contracts](13-api-and-webhook-contracts.md) | Endpoints, payloads, errors |
| 14 | [Testing and operations](14-testing-and-operations.md) | Test plan, monitoring, alerting, runbooks |
| 15 | [Roadmap](15-roadmap.md) | Phases, dependencies, acceptance criteria |
| A | [Provider evaluation](appendix-a-provider-evaluation.md) | Real APIs, auth, limits, maintenance cost, the first-provider choice |

## Decisions that need the owner before implementation

These are the forks where the answer changes the product. Each document names
its own smaller ones; these are the ones that block Phase 1.

1. **First provider: Square** (POS for restaurants, Square Appointments for
   salons). Recommended in Appendix A. Square supplies **no SMS consent
   field**, so a Square connection makes recipients *findable*, never
   *eligible* by itself.
2. **How consent gets recorded for a connected recipient.** Today the Text
   Requests composer silently records `opted_in` on every send (audit finding
   F-1). The proposal replaces that with an explicit, per-recipient owner
   attestation that records source, wording version, who attested, and when.
   Whether owner attestation is an acceptable legal basis for a review-request
   text is a question for counsel, not for this design.
3. **MFA before connecting.** `SYSTEM_CONTEXT.md` §9 lists "integration
   connection" among actions that require MFA (APPROVED), and MFA is not
   built. Either MFA step-up ships first, or the owner explicitly waives the
   rule for the pilot.
4. **PR #74 (customer model) is adopted with changes, not merged as is.** See
   the audit, §5.
5. **Data on disconnect.** Proposed default: credentials deleted immediately;
   source-only customer and visit data deleted after a 30-day grace period;
   consent and opt-out records kept, because they are the legal record.

## What this design will not do

No new top-level navigation item. No second customer model, SMS engine, credit
ledger or queue. No bulk campaigns, automatic credit reload, AI-written
customer messages, MMS, or automated sends in V1. No provider shown as
connectable before it really works. No review gating, ever.
