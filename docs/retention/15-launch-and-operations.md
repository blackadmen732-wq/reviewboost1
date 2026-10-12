# 15. Launch and operations plan

**Status: PROPOSED.** Nothing here is enabled in production without explicit
authorization. Each capability launches behind its flag, first for internal
test orgs, then a pilot, then everyone.

## 15.1 Launch stages per capability

| Stage | Who | Gate to move on |
|---|---|---|
| 0. Preview | Internal test orgs on a preview deployment, `fake` providers | Phase acceptance criteria (doc 13) met; drills (doc 14 §14.7) pass |
| 1. Internal production | ReviewBoost's own test business | Live verification items recorded (doc 14 §14.8) |
| 2. Pilot | 5–15 consenting businesses, mixed types | Two full report cycles read through with owners; no wrong numbers; unsubscribe < 5%; no support complaints about unexpected messages |
| 3. General | All orgs (minus holdouts) | Owner authorization |

Messaging capabilities (R6) have their own stricter gate (doc 5 §5.3.1).

## 15.2 Monitoring

Extend `/api/v1/internal/health` and PR #67 worker heartbeats.

| Signal | Threshold | Action |
|---|---|---|
| Worker heartbeat gap (each job) | > 3× cadence | Page operator |
| `owner_notifications` oldest pending | > 30 min | Alert |
| Dead letters (notifications, SMS outbox) | > 0 new in 24 h | Alert |
| Report job completion | Not done by 12:00 UTC on day 1 (or 12:00 local + 4 h per zone group) | Alert |
| Email bounce rate | > 5% daily | Alert; pause tips category |
| Email complaint rate | > 0.1% | Alert; review |
| SMS delivery rate | < 90% over 24 h with ≥ 50 sends | Alert |
| SMS opt-out rate | > 2% over 7 days | Alert; review templates and offenders |
| `provider_unknown` older than 1 h | > 0 | Alert (reconciliation should have settled) |
| Integrity monitor gap (doc 6 §6.9) | Any org flagged | Investigate customer flow |
| Provider-vs-ledger reconciliation gap | > 2% monthly | Investigate |

Alert delivery requires choosing an alerting tool (not built; PR #76 Phase 4
dependency). Until then, no stage beyond Preview.

## 15.3 Support

- **Runbooks** (in `docs/backend/OPERATIONS.md` once #67 lands, or alongside):
  "Owner says the report number is wrong", "Owner didn't get emails",
  "Owner wants to stop all emails", "Texts aren't going out", "Owner asks why
  a 5-star isn't in Needs you", "Owner asks if a customer posted on Google".
- **Standard answers:** ReviewBoost cannot see Google reviews; ratings are not
  reviews; we never hide or route ratings; how consent works.
- **Tools:** internal read-only view of an org's report snapshot inputs,
  notification log (status and reason only), retention signals; all access
  audited.
- **Owner self-service first:** every email has preferences; every prompt can
  be dismissed; cancellation is self-service.

## 15.4 Reconciliation

| What | Cadence | How |
|---|---|---|
| SMS credits vs provider billing | Monthly | Compare provider segments and cost with ledger consumption; PR #73 code once rebased |
| `provider_unknown` | Every maintenance run (existing) | Settled as spent after 15 min; corrected by late callbacks |
| Report snapshot vs recompute | Daily sample of 1% of last month's snapshots (first 3 months after launch) | Mismatch → alert and investigate; correction is a superseding snapshot |
| Notifications sent vs provider events | Weekly | Delivered/bounced counts agree within 1% |
| Stripe subscription state vs `billing_subscriptions` | Daily (existing inbox retry) | Mismatch alert |

## 15.5 Rollback

| Capability | Rollback |
|---|---|
| Needs you v2 | Flag off → previous `openOnly` behaviour; columns stay (additive migration) |
| Emails | Global flag off per category; pending rows suppressed `flag_off` |
| Reports | Flag off hides Monthly view and stops emails; snapshots kept |
| Request link attribution | Flag off → new requests use `/q` Tag link; existing `/r` links keep resolving until their 30-day window ends |
| Retention prompts | Flag off; signals continue to be computed for measurement |
| Automation | Pause all automations globally (sets `workflow_disabled` at dispatch); scheduled requests cancelled and released |

Migrations are additive and backward compatible within a phase, so code
rollback does not require schema rollback. No production migration is run
without explicit authorization (`docs/backend/CHANGE_SAFETY_ARCHITECTURE.md`).

## 15.6 Measuring success

Before experiments are powered (doc 6 §6.12 needs ≥ 100 orgs per arm):

- **Baseline now:** record monthly logo churn, month-1/3/6 retention by
  cohort, activation, and cancellation reasons for the current customer base
  from Stripe and existing tables, before R1 ships.
- **Pilot qualitative:** with each pilot owner, after report 1 and report 2:
  could they answer the six questions in doc 4 §4.1; was any number wrong or
  confusing; did any email feel unnecessary.
- **Leading indicators (all orgs, from R1):** WAB, follow-through, report
  engagement, unsubscribe rate, Text Requests per active texting org,
  opt-out rate.
- **Lagging (from R3 + 6 months):** month-6 retention vs pre-launch cohorts
  (correlational) and vs E-1 holdout (causal, if powered).
- **Review:** monthly retention review reads doc 6 Part B metrics and doc 10
  §10.8 rule precision; changes to rules or thresholds are versioned and
  recorded in this folder.

## 15.7 Launch checklist (per stage 2 and 3)

- [ ] Phase acceptance criteria met and CI green
- [ ] Populated-upgrade test green for every migration
- [ ] Drills in doc 14 §14.7 passed in preview
- [ ] Alerts wired and fired once in a drill
- [ ] Privacy policy and Terms updated (Counsel)
- [ ] Email domain authenticated (SPF, DKIM, DMARC)
- [ ] Support runbooks written
- [ ] Rollback flag tested
- [ ] Owner authorization recorded for the stage
