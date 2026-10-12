# ReviewBoost Retention — design set

**Status of this whole folder: PROPOSED.** Nothing here is built and nothing
here is approved until the owner signs off on the decisions below. State labels
are the ones `SYSTEM_CONTEXT.md` defines (APPROVED, PROPOSED, IMPLEMENTED,
CI-TESTED, LIVE-VERIFIED, NOT BUILT, REJECTED).

This set designs the system that gives a local business a measurable reason to
keep paying for ReviewBoost in month 6 and beyond. It is a companion to the
Connections design in `docs/connections/` (draft PR #76), not a competitor to
it: Connections brings customers and visits *in*; this set designs what the
business does with feedback, follow-up, and reporting *every month*. Where the
two overlap (consent, eligibility, post-visit automation, the credit ledger,
Text Requests) this set reuses PR #76 and says so by section number.

## The idea in one paragraph

A business does not stay because it got a burst of reviews. It stays because
ReviewBoost becomes the place it learns how last week went: how many customers
it asked, what they said, which bad experience needs a follow-up, whether that
follow-up happened, and whether things are getting better. That loop runs in
quiet weeks as well as busy ones, because it is about the business's own
service, not about review volume. Every number is something ReviewBoost actually
observed; nothing claims a Google review was written.

## The documents

| # | Document | What it answers |
|---|---|---|
| 1 | [Current-state audit](01-current-state-audit.md) | What exists, evidence, gaps, reuse, open PRs, findings R-1…R-12 |
| 2 | [Product requirements](02-product-requirements.md) | Users, problems, goals, non-goals, requirements, feature cards |
| 3 | [User journeys](03-user-journeys.md) | Owner and customer flows, per business type |
| 4 | [UX specification](04-ux-specification.md) | Screen by screen inside Home, Feedback, Text Requests, Tags, Settings |
| 5 | [Automation specification](05-automation-specification.md) | Message classes, post-visit follow-up, timing, caps, failure behaviour |
| 6 | [Reporting specification](06-reporting-specification.md) | Metric definitions, formulas, sources, sample-size rules |
| 7 | [Data and event model](07-data-and-event-model.md) | Entities, event taxonomy, idempotency |
| 8 | [System architecture](08-system-architecture.md) | What is reused, what is new and why |
| 9 | [Retention lifecycle](09-retention-lifecycle.md) | Signup through month 12, month-six value |
| 10 | [Churn risk and interventions](10-churn-risk-and-interventions.md) | Transparent rules, thresholds, guardrails |
| 11 | [Pricing and SMS-credit impact](11-pricing-and-credit-impact.md) | Costs, limits, discrepancies, safeguards |
| 12 | [Privacy, security, compliance](12-privacy-security-compliance.md) | Checklist and abuse prevention |
| 13 | [Roadmap](13-roadmap.md) | Phases, dependencies, risks, acceptance criteria |
| 14 | [Testing strategy](14-testing-strategy.md) | Unit, integration, e2e, billing, consent, messaging, reporting, recovery |
| 15 | [Launch and operations](15-launch-and-operations.md) | Monitoring, support, reconciliation, rollback, measurement |

## Decisions that need the owner before implementation

Each document lists its own smaller D-items. These are the ones that block the
first phase or change what the product is.

1. **Which messages exist.** Five classes, never mixed (doc 5 §5.1): manual
   Text Request, automated post-visit follow-up, owner reminder, customer
   service follow-up, owner report. Recommended for the first release: manual
   Text Requests (already built), owner reminders and the weekly/monthly owner
   email. Automated customer texting waits for Connections and a pilot
   (doc 13, Phase R5). Customer service follow-up by SMS is not offered by
   ReviewBoost in V1; the owner contacts the customer directly.
2. **Link a rating to the Text Request that produced it** (finding R-2). Today
   the text links to the plain Tag URL, so ReviewBoost cannot tell a texted
   customer's rating from a counter tap, and the "already rated" suppression
   never fires. Recommended: send a short per-request link (`/r/{ref}`) that
   serves the identical customer page, used only for suppression and
   aggregate reporting. It is shorter than today's Tag link, so it also keeps
   every standard message at one credit (doc 11 §11.3). The owner is **not**
   shown which recipient gave which rating, which keeps the customer page's
   anonymity intact and changes nothing a customer sees. This touches the
   public flow contract, so it needs an explicit yes.
3. **What "Needs you" means** (finding R-3). Today every unresolved rating,
   including every 5-star, sits in Needs you. Recommended: Needs you holds 1–3
   star ratings that are not done, plus anything flagged for follow-up; 4–5
   star ratings are counted and visible under Everything but do not demand
   action. The public review opportunity is unaffected; this is the owner's
   private inbox (allowed by `SYSTEM_CONTEXT.md` §2).
4. **An owner email channel.** No email, push, or digest exists (R-5). Reports
   and reminders need one. Recommended: Resend (already named as PROPOSED in
   `SYSTEM_CONTEXT.md` §8), transactional only, with an ADR.
5. **Insights depends on PR #67.** Feedback → Insights exists only on the
   unmerged PR #67 branch (R-4). Recommended: port its `rpc_feedback_insights`
   and `lib/owner/insights.ts` rules as the base of the reporting work rather
   than building a second aggregation.
6. **Billing discrepancies are reported, not fixed here**: Growth and Pro
   checkouts start a trial (F-8 in PR #76), credit packs cannot be bought
   (F-4), and the composer mints consent (F-1). Recommended order in doc 13.
7. **Scheduler cadence.** Dispatch runs once a day at 19:00 UTC on the deployed
   plan (R-7). A Text Request scheduled at 10:00 local waits for that run.
   Nothing time-sensitive in this design is launched until the cadence is fixed
   (Vercel Pro or the PR #67 scheduler).

## Validation performed (Phase C)

Checked each document against `SYSTEM_CONTEXT.md` (review integrity,
prohibited language, Text Requests naming), the V1 customer contract in
`customer-flow.tsx`, PR #67's Owner Systems spec (Home brief rules, locked
Customer Page), and PR #76. What the check changed:

| Found | Resolution |
|---|---|
| Appending `?r=` to the Tag link pushes a typical text from 1 to 2 credits | Replaced with a shorter `/r/{ref}` request link (doc 5 §5.2, doc 11 §11.3) |
| PR #76 doc 9 used an `auto:` dedupe prefix, which would let a manual and an automatic request for one visit both send | Amended to one `visit:` key for both (doc 5 §5.3.6) |
| `SYSTEM_CONTEXT.md` promises "private feedback" for low ratings, but the V1 flow has no note | Design does not reintroduce a note; service recovery is internal (R-1). Doc drift fixed in R0 |
| `already_rated` (PR #76) depends on a completion call nothing makes | Wired in R4 (R-2) |
| Home badge, tile and tab could count different things after the Needs you change | One definition for all three (doc 4 §4.2) |
| Report "credits included" could read a hard-coded constant (#67) | Reports read the ledger only; test in doc 14 §14.5 |
| Owner-facing "risk" language | Removed; owners see a specific fix or nothing (doc 10) |
| Metrics that could imply reviews | Only "ratings", "opens", "sent to Google"; banned-copy lint (doc 12 §12.1) |

Assumptions that change outcomes if wrong: provider SMS cost (doc 11 §11.6);
that owner attestation is an acceptable consent basis (Counsel, PR #76); that
email is acceptable to owners as the out-of-app channel; that the production
domain is `reviewboost.fit` (segment math).

## What this design will not do

No new top-level navigation item. No second customer model, SMS engine, credit
ledger, queue, or automation engine. No campaigns, bulk sends, automatic credit
reload, AI-written customer messages, MMS, or customer imports in V1. No
automation shown as available before it can safely run. No health score shown
to owners. No claim that a Google review was written. No review gating, ever.
