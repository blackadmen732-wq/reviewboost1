# 1. Current-state audit

**Audited:** `main` at `0155948` on 2026-10-12, the open pull requests #67,
#73, #74, #75 and draft #76. Every claim names what it was checked against.
"Working" means the code exists and has CI evidence; **nothing below is
live-verified** (no real Stripe charge, SMS, or hardware tap has been recorded,
`docs/V1_COMPLETION_REPORT.md` final matrix).

This audit does not repeat PR #76's audit (`docs/connections/01-current-state-audit.md`
on branch `claude/connections-design-f5nnm4`). It adopts its findings F-1 to
F-8 and adds findings R-1 to R-12 that matter for retention.

## 1.1 Capability table

Status values: **working** (implemented, CI-tested), **partial**, **planned**
(documents only), **missing**. Phase: **V1** (first retention release),
**near** (next), **later**.

| Capability | Status | Evidence | Reuse | Gaps and risks | Phase |
|---|---|---|---|---|---|
| Owner navigation: Home, Feedback, Text Requests, Tags, Settings | working | `frontend/features/dashboard/nav-items.ts` ("Exactly four, forever" on phone; Settings on desktop and via profile) | All of it | Reviews, Praise, Customers pages still exist as routes but are out of nav | V1 |
| Customer flow: tap → star → same destination | working | `features/customer-flow/customer-flow.tsx` "THE V1 CUSTOMER CONTRACT": no note, no Team Praise, no confirm | Unchanged | Locked; this design changes nothing a customer sees (see R-2 for a link parameter) | V1 |
| Tag opens | working (data) | `public_review_sessions` row per session (`20260808000200_customer_flow.sql`) | Count as "opens" | Per-device dedupe claimed in `SYSTEM_CONTEXT.md` §3 not found in `rpc` session create (R-9) | V1 |
| Star selections | working | `customer_responses.rating` 1–5, one per session | Count | No customer text in V1 (R-1) | V1 |
| Destination handoff | working | `destination_selections` (renamed from `google_review_clicks`), comment: "never … that a review was written" | Count as "handoffs" | Must never be called reviews | V1 |
| Feedback inbox: Needs you / Everything | working | `app/(owner)/feedback/page.tsx`; `listReviews(openOnly)` = `resolved_at is null` | Tabs, list, detail | Needs you includes every unresolved 5-star (R-3) | V1 |
| Feedback → Insights | partial (PR #67 only) | `#67: app/(owner)/feedback/insights`, `rpc_feedback_insights`, `lib/owner/insights.ts` (`MIN_SAMPLE = 10`, `MEANINGFUL_CHANGE = 0.2`) | Port, do not rebuild | Not on `main` (R-4) | V1 |
| Read / resolve / reopen / action notes | working | `20260810000400_feedback_workflow.sql`: `response_notes` (encrypted, author), `resolved_by`, RPCs audited | Is the service-recovery record | No assignee, no category, no follow-up flag, no reminder | V1 |
| Staff roster | working | `staff_members` (encrypted names, not login users) | Optional "about" attribution | Staff cannot sign in; assignment target must be a member | near |
| Members and roles | working | `member_role` owner/admin/member/viewer | Access control for every new surface | — | V1 |
| Locations with timezone | working | `locations.timezone` default `UTC` | Reporting days, quiet hours | UTC default distorts local days (F-7) | V1 |
| Home brief | working (simple) | `app/(owner)/home/page.tsx`: average of last 50, ratings today, unread, one status, one button | Layout, StatusBanner, StatTile | No period comparison; #67 spec v1.6: "one number + one arrow, one action, one warning" | V1 |
| Text Requests (manual, one-to-one) | working in code | `app/(owner)/text-requests`, `text-request-service.ts`, outbox, webhook inbox, 78 Vitest + 59 pgTAP (`STATUS.md`) | The only customer-message path | F-1 consent minting, F-2 no sender/STOP text, R-2 no attribution, R-7 cadence | V1 |
| Consent ledger, opt-out, suppression | working | `sms_consent_events`, `sms_phone_optout`, `app.sms_can_send` | Single gate (PR #76 doc 7) | Consent evidence empty (F-1) | V1 |
| "Already rated" suppression | partial | `app.sms_mark_flow_completed` + `rpc_sms_mark_flow_completed` exist; **no caller** in `frontend/` | Wire it | Never fires today (R-2) | V1 |
| Segment engine and cost | working | `lib/server/sms/segments.ts`, `cost.ts` | Every cost display | — | V1 |
| SMS credit ledger (monthly first, purchased never expires) | working | `20260915000800_sms_two_source_ledger.sql`, 50-assertion suite | All credit movement | — | V1 |
| Credit packs | partial | `rpc_billing_apply_credit_purchase` with no caller | PR #76 doc 10 §10.4 | F-4 | near |
| Billing (Stripe subscriptions) | working in code | `billing-service.ts`, `billing_subscriptions`, signed webhook inbox | Plan state for churn signals | F-8 trial on every plan; no cancellation reason captured in-app (R-10) | V1 |
| Entitlements | working | `20260915000400_entitlements.sql`: trial 1/1/0, Starter 1/3/150, Growth 2/8/500, Pro 5/25/1,500 | Limits | — | V1 |
| Workers / crons | partial | `frontend/vercel.json`: dispatch `0 19 * * *`, maintenance `0 8 * * *` | Endpoint pattern `/api/v1/internal/*` + `workerAuthorized` | Once daily (R-7) | V1 blocker |
| Health endpoint | partial | `app/api/v1/internal/health` (SMS counts) | Extend | No alert delivery | near |
| Owner email / push / digest | missing | No Resend/email code; no `expo-notifications` in `apps/mobile/package.json` | — | R-5 | V1 |
| Product analytics / owner activity | missing | No analytics SDK, no activity table | `audit_events` for state changes | R-6 | V1 |
| Feature flags | missing | No flag module | — | R-11 | V1 |
| Monthly report | missing | — | Insights rules | — | V1 |
| Churn-risk signals | missing | — | Domain tables | — | near |
| Customer model, visits | planned | PR #74 (unmerged), PR #76 doc 5 | Adopt as amended by #76 | Only one model may land | later |
| Connections (Square) | planned | PR #76 | Visit source for automation | Not built | later |
| Automated post-visit follow-up | planned | PR #76 doc 9 | Extended in doc 5 here | Needs visits + consent + pilot | later |
| MFA | missing | PR #76 F-5; #67 commit "stop claiming MFA" | — | APPROVED rule unmet | near |
| Alerting | missing | V1 report "No external alerting is wired" | — | — | near |

## 1.2 Findings added by this audit

**R-1. The V1 customer flow collects no words.** The customer contract has "no
note" (`customer-flow.tsx`). `customer_responses.note_encrypted` still exists
for historical rows. So a 2-star rating today arrives as a star, a time, a Tag
and a location, nothing else, and the customer is anonymous. Consequences:
"themes" cannot be mined from customer text; service recovery for a counter
tap is internal (what went wrong at that time and place), not a conversation
with the customer. `SYSTEM_CONTEXT.md` §3 and §6 still describe "low rating
also opens private feedback", which is stale against the V1 contract. This
design does **not** reintroduce a note; that would change the locked Customer
Page.

**R-2. A rating cannot be tied to the Text Request that produced it.** The
message body carries the Tag's plain `/q/{token}` link
(`text-request-service.ts`, `renderMessage`). `rpc_sms_mark_flow_completed`
has no caller. Consequences: `text_requests.completed_at` is never set, the
`completed_flow` suppression never fires (so PR #76's `already_rated` check
cannot pass or fail on real data), and reports cannot say how many ratings
came from texts. Proposed fix: doc 5 §5.2 and doc 7 §7.2 (README decision 2).

**R-3. Needs you is every unresolved rating.** `listReviews(openOnly)` filters
on `resolved_at is null` with no rating condition, and Home's "To read" counts
every unread rating. A business with 200 happy customers a month gets 200
items to clear. Owners learn to ignore the inbox, which defeats both service
recovery and any "feedback accumulating" churn signal. Proposed fix: doc 4 §4.3
(README decision 3).

**R-4. Insights is not on `main`.** The user-described Feedback tabs (Needs
you, Everything, Insights) match PR #67, not `main`. Reporting here builds on
#67's `rpc_feedback_insights` and its sample rules once ported.

**R-5. There is no channel to reach an owner outside the app.** No email, no
push. A monthly report or a reminder that only appears when the owner opens
the app cannot rescue an owner who has stopped opening it, which is exactly
the owner at risk.

**R-6. Owner activity is not recorded.** Nothing records that an owner opened
Home, read a report, or dismissed a prompt. `audit_events` records state
changes only. Churn rules need a minimal, privacy-preserving activity record
(doc 7 §7.3).

**R-7. Scheduled work runs once a day.** `vercel.json` runs SMS dispatch at
19:00 UTC daily (15:00 Eastern, 12:00 Pacific). Quiet hours and "send 2 hours
after the visit" are meaningless at that cadence. `docs/SCHEDULING.md` and
PR #67's `supabase/ops/production_scheduler.sql` describe the fix.

**R-8. The top-level status documents are stale.** `SYSTEM_CONTEXT.md` §5.1 and
`STATUS.md` say Stripe billing is "NOT BUILT" and cite 326 pgTAP assertions;
`docs/V1_COMPLETION_REPORT.md` and `main` have Stripe in code and 516
assertions. This design trusts the code. Updating those documents is a
separate, small task.

**R-9. "Opens" are sessions, not people.** A page reload or second scan can
create another session. Every report calls them "Tag opens", never visitors or
customers.

**R-10. Cancellation happens in the Stripe portal with no reason captured
in-app.** `billing/route.ts` offers `checkout` and `portal` only. Stripe's
portal can collect a cancellation reason; it is not read back.

**R-11. No feature flags.** Every staged rollout here (and PR #76's Square
pilot flag) needs one. Proposed: a small org-scoped `feature_flags` table read
server-side (doc 8 §8.3), not a vendor SDK.

**R-12. Plan copy may disagree with the ledger.** PR #76 F-3: PR #67 hard-codes
`smsIncluded: 0`. A report that shows "credits included" must read the ledger,
never a constant.

## 1.3 Adopted from PR #76

F-1 consent minted on every send; F-2 no sender name or opt-out line; F-3 SMS
allowance disagreement; F-4 packs cannot be bought; F-5 MFA missing; F-6
scheduler cadence (same as R-7); F-7 UTC timezone default; F-8 trial on every
plan. Fixes are owned by PR #76's Phase 0 and Phase 3; this design depends on
them and does not re-specify them.

**Pending, not merged (PR #76 Phase 0 code, pushed 2026-10-12):** sending no
longer records consent, so a number with no recorded consent is refused before
any credit is reserved; the owner confirms consent with an attestation that
saves the method and who confirmed it; every text is prefixed with the business
name and ends "Reply STOP to opt out."; free text is replaced by two approved
templates; a migration resets earlier evidence-free opt-ins to `unknown`. This
design is written on top of that behaviour. Until #76 lands, `main` still has
F-1 and F-2. PR #67 rewrites the same Text Requests screen and still records
consent on every send, so #67 must take #76's Phase 0 before either lands
(doc 13, dependency D-0).

## 1.4 Open pull requests

| PR | Relevance to retention | Recommendation |
|---|---|---|
| #76 Connections design (draft, docs) | High. Eligibility service, consent attestation, visit model, automation prerequisites, credit packs | Treat as the owner of consent, eligibility, customers, visits, and packs. This set references it and adds nothing parallel |
| #67 V1 Final Integration (384 files) | High. Insights, Home brief rules, worker heartbeats, production scheduler, MFA design | Port Insights and the scheduler; obey the Home brief rules (v1.6) and the locked Customer Page |
| #74 Customer model | Medium. Needed only for automation | Adopt as amended by #76 doc 5 §5.9 |
| #73 SMS pricing engine | Low. Provider rate tables for cost reconciliation | Rebase before use (base predates the ledger) |
| #75 into #67 | Low | — |

## 1.5 What not to build (duplicates this audit rules out)

| Tempting | Already exists or is owned elsewhere |
|---|---|
| A "Reports" or "Insights" nav item | Feedback → Insights (#67) |
| A "Customers" or "Contacts" page | PR #74 / #76 model, surfaced inside Text Requests |
| A "Campaigns" or "Automations" destination | Text Requests, with automation as a section in it later |
| A ticketing system | `response_notes` + resolve, plus two fields (doc 7) |
| A second consent flag or eligibility check | `app.messaging_eligibility` (#76 doc 7 §7.2) |
| A notifications table per feature | One `owner_notifications` outbox (doc 7) |
| A balance column | `sms_credit_grants` + slices |
| A queue service | Postgres outbox + `/internal/*` workers |
