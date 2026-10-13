# 9. Future event-triggered messaging, and explicit V1 exclusions

**Status: PROPOSED for a later phase. NOT BUILT, and not exposed in V1.**

## 9.1 V1 exclusions

Not in V1, and not represented by any visible control, disabled toggle, or
"coming soon" switch in the owner UI:

| Excluded | Why |
|---|---|
| Automatic sends triggered by connected events | Needs every prerequisite in §9.3, and a pilot proving the manual path first |
| Bulk sends, lists, "select all", campaigns | V1 is one-to-one Text Requests; `SYSTEM_CONTEXT.md` forbids a marketing path |
| Automatic credit reload | Never buy on the owner's behalf |
| AI-generated customer messages | Content must be approved templates |
| MMS | Different cost, content, and carrier rules |
| Customer imports (CSV, bulk) as a V1 owner feature | Brief excludes it; PR #74's CSV importer stays unexposed |
| Customer-facing opt-in capture on the Tag page | Changes the public flow; separate decision with its own review-integrity check |
| Two-way sync or writing anything back to Square | Read-only by design |
| Additional providers beyond Square | One working provider first |

## 9.2 Keeping V1 compatible

V1 already lays down what automation will need, so nothing is rebuilt later:

- Visits are canonical, attributed, versioned, and location-scoped (doc 5).
- The eligibility service has a `workflow_disabled` check and a `stage`
  parameter, and is the only gate (doc 7).
- Text Requests can carry `visit_id`, and the dedupe key derives from it, so
  "one request per visit" already holds for manual sends.
- The eligibility log records `actor_user_id`; automation will record a
  workflow version instead.

None of this shows in the UI.

## 9.3 Prerequisites for the first automation ("ask after a visit")

| Requirement | Definition |
|---|---|
| Business trigger | A visit reaches `completed` (payment) or `appointment_time_passed` (booking) at a mapped location |
| Event contract | `visit.became_eligible` emitted from the canonical visit table, never from raw provider events, with `visit_id`, `customer_id`, `location_id`, `occurred_at`, `source_version` |
| Owner configuration | An `automations` row per org and location: template id, delay, enabled, created by, approved at. Off by default |
| Template | One of the approved templates; versioned |
| Timing rule | Send `delay` after `occurred_at` (default 2 hours), then the quiet-hours deferral; never more than 48 hours after the visit (stale requests are dropped, not sent late) |
| Consent and eligibility | The same `app.messaging_eligibility` with stage `schedule` and again at dispatch. A contact with `unknown` consent is skipped and counted, never prompted |
| Quiet hours and frequency | As doc 7; plus a per-org daily cap the owner sets |
| Dedupe and idempotency | `dedupe_key = 'auto:' || visit_id`. A visit can trigger at most one request, ever, across manual and automatic paths |
| Credit accounting | The same reservation path; an automation that hits zero credits pauses itself and tells the owner, it does not queue sends on credit |
| Pause / disable | One switch per automation, effective for already-scheduled messages at dispatch |
| Preview / test mode | "Send me a test" to the owner's own verified number, and a dry-run report: "Last week this would have sent 23 requests; 41 visits were skipped (31 no consent, 6 texted recently, 4 no phone)" |
| Reporting | Daily summary: sent, delivered, failed, unknown, skipped by reason |
| Audit | `automation_versions` (immutable), each Text Request records the version that produced it |
| Review integrity | Trigger never filters on anything correlated with satisfaction (doc 7 §7.6) |
| Legal sign-off | Counsel confirms the consent basis for automated sends before the feature flag can be enabled in production |

## 9.4 Decision gate

Automation is proposed only after the V1 pilot shows: connected visits arrive
reliably (doc 15 acceptance criteria), the manual flow's eligibility reasons
are understood by owners, and the consent path produces real `opted_in`
records. Without the last one, an automation would skip almost everyone.
