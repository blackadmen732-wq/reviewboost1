# 5. Automation specification

**Status: PROPOSED.** Customer-facing automation (class B below) is a later
phase and **must not be exposed** until every prerequisite in §5.3.1 holds.
This document extends PR #76 doc 9 (`09-future-automation.md`) and uses its
eligibility service (doc 7) unchanged. Nothing here enables automated
messaging; enabling it in production needs explicit authorization.

## 5.1 Five message classes, never mixed

| Class | Recipient | Channel | Trigger | Consent basis | Credits | Data home | V1? |
|---|---|---|---|---|---|---|---|
| **A. Text Request** | Customer | SMS | Owner presses Send | Customer SMS consent, purpose `review_request` | Yes | `text_requests` (`origin = 'manual'`) | Yes (exists) |
| **B. Automated post-visit follow-up** | Customer | SMS | Eligible business event (visit completed) | Same consent; plus owner approval of the workflow version | Yes | `text_requests` (`origin = 'automation'`, `automation_version_id`) | Later (R5) |
| **C. Owner reminder** | Member | Email, in-app banner | Rule on owner-side state (open item, unused Tag, failures) | Member's notification preference | No | `owner_notifications` | Yes |
| **D. Customer service follow-up** | Customer | Owner's own phone/email, outside ReviewBoost | Owner decision on a rating | Not ReviewBoost's to send | No | `response_notes` records that it happened | Record only |
| **E. Report or summary** | Member | Email + in-app | Calendar (weekly, monthly) | Member's preference | No | `report_snapshots` + `owner_notifications` | Yes |

Rules that keep them apart:

- Classes A and B share one table and one pipeline because they are the same
  message to the same person for the same purpose; `origin` distinguishes them
  in data and UI. There is no second SMS path.
- Class C and E never touch the SMS provider, the consent ledger, or credits.
- Class D is deliberately not a send feature. A service message is a different
  purpose from a review request; ReviewBoost holds consent for
  `review_request` only (`sms_consent_purpose` enum), and the V1 customer is
  anonymous (R-1). A future `service_follow_up` purpose would need its own
  consent wording, its own legal review, and a customer-facing disclosure,
  and is listed in doc 13 as a separate later decision.
- UI: A lives in Text Requests · Sent; B in Text Requests · Follow-ups; C in
  the Home banner and email; D as a note on the rating; E in Insights · Monthly
  and email. They never share a list.

## 5.2 Class A: Text Request (manual), what changes

Exists. Changes proposed here, on top of PR #76 Phase 0:

1. **Attribution reference (decision 2).** At schedule, mint `link_ref`, 16
   random bytes base64url (22 characters), store its keyed digest on the
   request, and send a **request link** `https://reviewboost.fit/r/{link_ref}`
   instead of the Tag link. The `/r/[ref]` route resolves the request on the
   server and serves the identical customer flow for that request's Tag; the
   session create call carries the reference and the session RPC records
   `public_review_sessions.text_request_id`. An unknown, expired or cancelled
   reference falls back to a plain "This link has expired" state with no
   tracking; nothing else on screen differs from `/q`.
   Why not `/q/{tagToken}?r=…`: the Tag token is 43 characters, so appending a
   reference pushes a typical message from 1 to 2 segments (doc 11 §11.3).
   The request link is 21 characters *shorter* than today's Tag link, and the
   Tag's capability token stops travelling in SMS at all.
2. **Completion.** When a response is recorded on a session with a
   `text_request_id`, in the same transaction: set
   `text_requests.response_id`, `completed_at`, and call
   `app.sms_mark_flow_completed` (existing, finally wired). No rating value is
   copied to the request.
3. **Dispatch cadence.** Requires the production scheduler (R-7).

## 5.3 Class B: Automated post-visit follow-up

### 5.3.1 Prerequisites (all required before the flag can be turned on for any org)

PR #76 doc 9 §9.3 table, plus:

- Connections Phase 3 exit criteria met (PR #76 doc 15).
- Class A attribution (§5.2) live, so "rated" and `already_rated` work.
- Scheduler at ≤ 1-minute cadence with heartbeats (PR #67).
- Alerting live (doc 15).
- Counsel's written sign-off on consent basis, wording and jurisdictions.
- A2P 10DLC registration complete for the sending number.
- Pilot authorization from the owner.

### 5.3.2 How the event enters

Only from canonical visits (PR #76 doc 5), never from a raw provider payload:

```
provider webhook/poll → integration inbox → canonical visit upsert
  → visit reaches status 'completed' (payment) or appointment end passed (booking)
  → in the same transaction, insert automation_events
      (event 'visit.became_eligible', idempotency key 'visit:'||visit_id||':v'||visit_version)
```

Late events: a visit whose `occurred_at` is more than 48 hours ago when it
arrives is recorded but produces no message (`stale_event`). Duplicate events
collide on the idempotency key. A visit edited later (refund, cancellation)
before the send cancels the pending request (`visit_cancelled`).

### 5.3.3 Required customer information

A linked customer with a phone (E.164, US in V1) and consent `opted_in` for
`review_request` with evidence (PR #76 doc 7 §7.4). Name is optional and is
never put in the message in V1 (no personalisation beyond business name).

### 5.3.4 Owner configuration

`automations` (one per org × location × kind) with immutable
`automation_versions`: template id (approved list only), delay, daily cap,
enabled, approved_by, approved_at. Defaults: delay 2 hours, daily cap = 20 or
the plan's monthly credits ÷ 20, whichever is lower. Every edit creates a new
version; in-flight requests keep the version they were created with.

### 5.3.5 Eligibility

`app.messaging_eligibility` (PR #76 doc 7) at `schedule` and again at
`dispatch`, with `p_context = {automation_version_id, visit_id}`. Additional
automation-only checks evaluated in the same function:

| Check | Code |
|---|---|
| Automation enabled and this version current | `workflow_disabled` |
| Daily cap for this automation not reached (counted in location local day) | `daily_cap_reached` |
| Visit not cancelled/refunded | `visit_cancelled` |
| Event not older than 48 h at schedule; not older than 72 h at dispatch | `stale_event` |
| Org not in a quiet period | `org_quiet_period` |

Skipped events are counted by reason, never prompted for consent, never queued
"for later".

### 5.3.6 Duplicate prevention

- `dedupe_key = 'visit:' || visit_id` for both manual and automatic sends, so
  one visit yields at most one request ever, whichever path asked first. This
  amends PR #76 doc 9 §9.3, which proposed `'auto:' || visit_id`: a prefix
  that differs by origin would let a manual and an automatic request for the
  same visit both pass.
- `automation_events` unique on idempotency key.
- Contact-level frequency cap: one review request per contact per org per 30
  days (PR #76 D-7.2), across both origins.
- Existing `(org_id, dedupe_key)` unique constraint is the final guard.

### 5.3.7 Timing and quiet hours

`send_at = occurred_at + delay`, then moved forward into 09:00–20:00 in the
location's IANA zone (existing `quiet-hours.ts`, DST-correct, re-checked at
dispatch). If the moved time exceeds `occurred_at + 48h`, the request is
cancelled as `stale_event`. A location still on the `UTC` default fails
eligibility with `location_timezone_unconfirmed` (blocking for automation,
not just a warning). Using the recipient's area-code zone is PR #76 D-7.4.

### 5.3.8 Opt-outs and invalid numbers

STOP at any time suppresses at phone level before dispatch (existing gate).
Carrier "invalid/landline/unreachable" errors add a `hard_bounce` suppression
for that phone; the request settles as failed with credit refunded. HELP
replies get the help text (§5.7).

### 5.3.9 Send outcomes

Unchanged state machine: `scheduled → queued → sending → submitted →
delivered`, `failed`, `provider_unknown` (never auto-retried; settled as spent
after 15 minutes by reconciliation; a later definitive callback corrects it),
`suppressed`, `cancelled`. Each request records `automation_version_id`.

### 5.3.10 Pause, edit, stop

- **Pause:** one switch. Effective immediately for new events and at dispatch
  for scheduled ones (dispatch re-checks `workflow_disabled`). Paused-at-dispatch
  requests are cancelled with reservation released.
- **Edit:** creates a version; pending requests send on their version unless
  the edit was "stop sending old wording", which cancels them.
- **Stop (delete):** disables and archives; history kept.
- **Automatic pause:** credits exhausted (`insufficient_credits` on 3
  consecutive events), failure rate > 20% over the last 20 attempts, a
  compliance hold, or a carrier complaint. Owner told by email and banner, with
  the reason and the fix. Never resumes by itself.

### 5.3.11 Credits

Same reservation at schedule (monthly first, then purchased), same refund on
failure, same release on cancel. An automation never borrows ahead, never
queues sends waiting for credit, never buys credit.

### 5.3.12 Is it working?

Follow-ups card (daily, last 7 and 30 days): eligible visits, sent, delivered,
didn't go through, not sure yet, rated, skipped by reason, credits used.
"Rated" relies on §5.2 attribution. A dry-run report precedes enabling.

## 5.4 Reminder rules for customers

**Default and V1 of automation: no reminder text.** One request per visit.

A single reminder may be proposed only after the pilot shows opt-out rate
< 1% and complaint rate ≈ 0 for first messages, and then only with: one
reminder maximum, ≥ 48 hours after delivery, only if delivered and not rated
(requires §5.2), inside quiet hours, counted against the 30-day frequency cap,
and enabled per automation by the owner with the cost shown. This is decision
D-5.1 and is not part of any planned phase.

## 5.5 Owner reminders (class C)

| Rule | Trigger | Recipient | Cap | Stops when |
|---|---|---|---|---|
| C-1 Open low rating | Needs you item older than 3 days | Assignee, else owner | 1 per item; 1 email/day per member, batched | Item done or unflagged |
| C-2 Old open items | Any Needs you item older than 7 days | Owner | 1/week | None older than 7 days |
| C-3 Low rating now | New 1–2 star (opt-in category) | Members who enabled | 3/day, then one roll-up | — |
| C-4 Tag not opened | doc 10 A-1, A-2 | Owner | 1 per Tag per 30 days | First open |
| C-5 Texts failing | doc 10 S-2 | Owner | 1 per 72 h | Failure rate back under threshold |
| C-6 Credits low | Remaining < 10% of monthly and > 5 sends in last 7 days | Owner | 1 per period | New period or purchase |
| C-7 Monthly credits expiring unused | > 50% unused with 5 days left, and the org sent ≥ 1 Text Request ever | Owner | 1 per period | — |
| C-8 Automation paused itself | §5.3.10 | Owner | 1 per pause | Resumed |

Global cap: at most **one** non-billing, non-security email per member per
day (C-3 excepted when the member opted in), and at most **three** per week.
Excess is folded into the next weekly summary. All suppressed during a quiet
period except billing, security, and C-8.

C-7 never suggests buying credits; it suggests sending Text Requests to
customers who agreed, or moving to a smaller plan if usage is consistently low
(doc 11 §11.5).

## 5.6 Reports and summaries (class E)

- **Weekly summary:** Monday 08:00 local (primary location zone), covering the
  previous Monday–Sunday. Not sent if the week had zero opens, zero ratings,
  zero texts and zero open items **and** the previous week's summary was also
  empty: a single "quiet week" email is useful; a series of them is spam.
- **Monthly report:** first day of month, 08:00 local, previous calendar month.
  Always generated (snapshot) even if not emailed.
- Delivery through `owner_notifications` with `idempotency_key =
  'report:'||org_id||':'||period`.

## 5.7 Compliance behaviour for customer texts

From PR #76 doc 7 §7.5 and Phase 0: business-name prefix, "Reply STOP to opt
out." footer added server-side, US numbers only, quiet hours 09:00–20:00 local.
HELP reply: "{Business} uses ReviewBoost to ask about visits. Reply STOP to
stop texts. Help: {support URL}. Msg&data rates may apply." Legal review of
all wording before launch (doc 12).

## 5.8 Failure behaviour summary

| Failure | Behaviour |
|---|---|
| Worker crash after reserve, before provider call | Lease expires, job retried; attempt row prevents a second provider call if one was recorded |
| Crash after provider accepted, before recording | `provider_unknown` path; reconciliation; never resent |
| Duplicate provider webhook | Inbox dedupe on provider event id |
| Duplicate automation event | Idempotency key unique |
| Email provider down | `owner_notifications` retried with backoff, dead-letter after 24 h, alert |
| Report build fails | Retried hourly for 24 h; Home never shows "report ready" without a snapshot |
| Scheduler stops | Heartbeat alert (PR #67 `worker_heartbeats`) |
