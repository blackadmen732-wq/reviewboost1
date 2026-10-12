# 2. Product requirements

**Status: PROPOSED.**

## 2.1 The problem

Some owners get a burst of ratings and Google handoffs after setup, decide they
have "got enough reviews", and cancel. The product as built answers one
question well (did a customer tap a star?) and has nothing to say in a quiet
week. Its only recurring surface, Feedback, fills with 5-star items that
demand clearing (R-3), and no message reaches an owner who stops opening the
app (R-5).

## 2.2 Who it is for

| User | What they need from ReviewBoost each month |
|---|---|
| **Owner** (role `owner`) | To know in one glance whether anything needs them, whether customer experience is holding up, and whether the money is well spent |
| **Manager** (role `admin`) | To act on bad experiences at their location and show they did |
| **Staff with access** (role `member`) | To see and close items assigned to them; nothing about billing |
| **Viewer** (role `viewer`) | To read, not act |
| **Customer** (no account) | One honest, easy chance to rate a visit, and to never be pestered |

## 2.3 The recurring value cycle

```
serve a customer ─► invite feedback (Tag, or one Text Request)
      ▲                         │
      │                         ▼
 next period shows       ReviewBoost records open, star, handoff
 what changed                   │
      ▲                         ▼
 owner acts  ◄── summary ◄── issues surface in Needs you
 (follow-up,     of patterns     (1–3 stars, flagged items)
  fix, praise)   and changes
```

The cycle is about the business's own service. It produces something useful
when volume is low ("3 ratings this week, all 5s, nothing to do" is a real
answer) and when volume is high.

## 2.4 Recurring value by business type

One core system; configuration only where it changes behaviour.

| Type | What they get every month | Configuration that matters |
|---|---|---|
| **Solo service professional** (cleaner, plumber, tutor) | Few ratings, each meaningful. Value is the Text Request after each job and a monthly note confirming every customer was asked and nothing went unanswered. Quiet months still report "you asked 9 customers; 6 rated; no problems" | One location, one or two Tags. Text Requests is the main tool. Reports suppress averages under 10 ratings |
| **Restaurant or café** | Volume from the counter Tag. Value is spotting a bad shift: low ratings clustered on Friday evenings, or at one Tag. Weekly email is the habit | Tags per area (counter, tables, takeaway). Day-of-week and hour breakdowns in Insights. Text Requests rare |
| **Salon or appointment business** | Every customer is known by appointment. Value is consistent asking after each appointment and follow-up of the occasional unhappy client by the owner personally | Text Requests after appointments now; automated post-appointment follow-up later (doc 5) once Connections supplies appointments |
| **Multiple employees** | Value is accountability: who handled which low rating, and that nothing sat open for a week | Assignment to a member, resolution time, "done by" names. Ratings are never attributed to an employee by ReviewBoost (no staff field on the customer flow) |
| **Multiple locations** | Value is comparison: which location's ratings moved, which has open items | Location filter on Feedback and Insights, per-location section of the monthly report, location-scoped admins |

## 2.5 Goals

1. An owner can answer, in under ten seconds on Home: is it working, is there
   anything to do, what changed since last week.
2. Every 1–3 star rating gets an owner decision (done, follow-up, or note)
   within a week, and the owner can show it.
3. A monthly report arrives by email whether or not the owner opened the app,
   built only from observed events, with one next step.
4. Text Requests become a habit for businesses that know their customers, with
   honest consent and visible delivery outcomes.
5. Owners who are not getting value are noticed by rules a person can read, and
   helped or allowed to leave cleanly.
6. Retention is measured against a baseline, with control groups where
   practical.

## 2.6 Non-goals

- Generating more reviews than a business's real customer flow produces.
- A CRM, a ticketing system, a marketing tool, or a campaign manager.
- A health score, benchmark, or competitor comparison shown to owners.
- Any customer-facing change to the locked Customer Page in this program.
- Bulk campaigns, automatic credit reload, AI-written customer messages, MMS,
  customer imports in V1.
- Machine-learning churn prediction (doc 10 §10.9 says when to revisit).
- Detecting whether a Google review was written. ReviewBoost cannot observe it.

## 2.7 Requirements

`MUST` blocks release; `SHOULD` is expected unless a reason is recorded.

### Integrity

- R-INT-1 MUST: no feature, metric, filter, or automation reads the rating to
  decide whether a customer gets the public review opportunity or a request.
- R-INT-2 MUST: "handoff" is the only word for `destination_selections`; the
  strings "reviews generated", "reviews received", "reviews prevented", "review
  rate" are banned in product copy and email (lint test, doc 14).
- R-INT-3 MUST: a low rating is never described as a negative public review.

### Feedback and recovery

- R-FB-1 MUST: Needs you holds unresolved 1–3 star ratings and flagged items
  only (decision 3).
- R-FB-2 MUST: an owner can mark done, flag for follow-up, add a note, and
  (multi-member orgs) assign to a member; each records who and when.
- R-FB-3 SHOULD: on done, an optional one-tap "what was it about" category.
- R-FB-4 MUST: unresolved items older than the reminder threshold produce at
  most one reminder per item per week, and never more than one reminder email
  per org per day.

### Reporting

- R-REP-1 MUST: every metric has a definition in doc 6 and a test.
- R-REP-2 MUST: averages and comparisons follow the sample rules (doc 6 §6.6).
- R-REP-3 MUST: monthly report is a stored, immutable snapshot.
- R-REP-4 MUST: observations come from a fixed rule catalogue, each citing its
  numbers; no generated prose.

### Messaging

- R-MSG-1 MUST: the five message classes are separate in data and UI (doc 5).
- R-MSG-2 MUST: no customer message without passing the one eligibility
  service (PR #76 doc 7).
- R-MSG-3 MUST: owner emails carry an unsubscribe per category; billing and
  security emails are the only non-optional ones.

### Retention

- R-RET-1 MUST: churn rules are documented, versioned, and every flag stores
  the evidence that triggered it.
- R-RET-2 MUST: cancellation stays self-service, one path, no retention trap.

## 2.8 Feature cards

Each card states problem, who, how, why it recurs, data, cost or risk,
success measure, and phase.

### F1 Needs you, redefined
- **Problem:** inbox clogged with 5-stars (R-3). **Who:** owner, admin.
- **How:** Needs you = rating ≤ 3 and not done, or flagged follow-up. 4–5 stars
  are marked seen when listed under Everything.
- **Recurs because:** the list is short and true, so it is worth opening.
- **Data:** `customer_responses`, two new columns (doc 7 §7.2).
- **Cost/risk:** low. Risk an owner misses a 4-star with a problem; mitigated
  by the flag action on any item.
- **Success:** median time from 1–3 star to decision; share decided within 7
  days. **Phase:** V1.

### F2 Follow-up, assignment, category
- **Problem:** "did we act?" is unanswerable. **Who:** multi-employee and
  multi-location businesses.
- **How:** flag, assign to member, mark done with optional category; history
  from `response_notes` and `audit_events`.
- **Recurs because:** accountability becomes a weekly routine.
- **Data:** new columns on `customer_responses`; `response_categories` fixed list.
- **Cost/risk:** low; must not grow into ticketing (no SLA, no priorities).
- **Success:** follow-through rate (doc 6 M-14). **Phase:** V1.

### F3 Weekly brief on Home
- **Problem:** Home has no comparison. **Who:** every owner.
- **How:** one number with an arrow ("14 ratings this week, up 3"), one
  warning max, one action (#67 v1.6 rules).
- **Recurs because:** it changes every week, including quiet ones.
- **Data:** responses, Text Requests, notifications. **Cost:** low.
- **Success:** weekly active owners. **Phase:** V1.

### F4 Owner email (weekly digest, reminders, monthly report)
- **Problem:** at-risk owners stop opening the app (R-5).
- **How:** Resend, one `owner_notifications` outbox, per-category preferences.
- **Recurs because:** value arrives without a login.
- **Data:** member emails, preferences. **Cost:** an email provider (≈$0 at
  pilot volume; verify Resend pricing before launch); deliverability work.
- **Success:** report open rate (where measurable), click-through to app,
  unsubscribe rate. **Phase:** V1.

### F5 Monthly report
- **Problem:** no "what did I get this month". **How:** snapshot on the 1st
  local day, emailed and viewable at Feedback → Insights → Monthly.
- **Recurs because:** a dated record that compounds into 3/6/12-month trends.
- **Data:** doc 6. **Cost:** compute per org per month, trivial.
- **Success:** retention difference in the holdout experiment (doc 6 §6.10).
- **Phase:** V1.

### F6 Tag activity
- **Problem:** owners cannot see which Tag is working. **How:** per-Tag opens,
  stars, handoffs, last activity on Tags; "unused Tag" hint.
- **Recurs because:** placement becomes learnable (`SYSTEM_CONTEXT.md` §7).
- **Data:** sessions, responses, selections by `stand_id`. **Phase:** V1.

### F7 Text Request outcomes and attribution
- **Problem:** owners can't see whether texting works (R-2).
- **How:** per-request reference in the link (decision 2); Text Requests shows
  sent, delivered, failed, uncertain, rated.
- **Recurs because:** it shows the return on credits.
- **Data:** `text_requests.response_id`. **Risk:** de-anonymisation; mitigated
  by aggregate-only display. **Phase:** V1 (after decision 2).

### F8 Credit visibility
- **Problem:** owners can't tell if they are spending well. **How:** monthly
  used/remaining, expiring-soon note, per-request cost, failed refunds shown.
- **Data:** ledger. **Success:** fewer pack purchases followed by expiry of
  monthly credits; support tickets about charges. **Phase:** V1 (packs near).

### F9 Churn-risk rules and help prompts
- **Problem:** at-risk owners are invisible. **How:** rules in doc 10; owner
  sees a helpful prompt, internal team sees the evidence.
- **Success:** false-positive rate, save rate vs holdout. **Phase:** near.

### F10 Automated post-visit follow-up
- **Problem:** owners forget to ask. **How:** doc 5 §5.3, on Connections visits.
- **Risk:** consent, spam, cost; highest risk feature. **Phase:** later (R5),
  after Connections Phase 3, legal sign-off, and pilot.

### F11 Cancellation reason and plan adjustment
- **Problem:** no learning from churn (R-10), and an owner whose needs shrank
  has no visible alternative to cancelling. **How:** read Stripe's
  `cancellation_details`; optional one-question survey on our own billing page
  before the portal opens, skippable in one tap; where usage fits a smaller
  plan, the billing page shows it plainly next to Cancel (doc 10 §10.6).
- **Phase:** near.
