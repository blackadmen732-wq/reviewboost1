# 6. Reporting specification

**Status: PROPOSED.** Part A defines what owners see. Part B defines how
ReviewBoost measures its own retention. Every metric names its source table,
formula, denominator, and what must never be inferred from it.

All periods are whole local days in the organization's primary location
timezone (per-location sections use that location's zone), computed with
`lib/utils/local-day.ts` from PR #67 (DST-tested). "Last week" is the last 7
completed local days; "last month" is the previous calendar month. The day in
progress is never part of a comparison.

## Part A — Owner-facing metrics

### 6.1 Metric catalogue

| ID | Name shown | Formula | Source | Never infer |
|---|---|---|---|---|
| M-1 | Tag opens | count of `public_review_sessions` created in period | sessions | People, visitors, or customers (R-9) |
| M-2 | Ratings | count of `customer_responses` with `submitted_at` in period | responses | Reviews; satisfaction of non-raters |
| M-3 | Rating spread | M-2 grouped by `rating` 1–5 | responses | — |
| M-4 | Average rating | mean of `rating`, only when M-2 ≥ 10 | responses | Google rating; it is not the public average |
| M-5 | Rated after opening | M-2 ÷ M-1 (same Tags, same period), shown as "x of y who opened rated" when M-1 ≥ 20 | sessions, responses | A conversion or review rate |
| M-6 | Sent to Google | count of `destination_selections` in period | selections | That a review was written, posted, or published |
| M-7 | Share sent to Google | M-6 ÷ M-2 | selections, responses | Same; must be equal-opportunity, so a big gap by star is a bug signal, not an insight (§6.9) |
| M-8 | Needs you now | count of ratings ≤ 3 not done + flagged not done, at report time | responses | — |
| M-9 | Low ratings | count of ratings 1–3 in period | responses | Negative public reviews |
| M-10 | Decided within 7 days | low ratings in period with `resolved_at` or first note within 7 days ÷ M-9 | responses, notes | That the customer was satisfied |
| M-11 | Median time to done | median(`resolved_at − submitted_at`) for low ratings done in period | responses | — |
| M-12 | Still open from earlier | low ratings submitted before period start, not done at period end | responses | — |
| M-13 | What you marked | count by `resolution_category` for items done in period | responses | Customer's own words; it is the owner's label |
| M-14 | Follow-through | M-10 restated for the month view | — | — |
| M-15 | Texts sent | `text_requests` with `sent_at` in period, by `origin` | text_requests | — |
| M-16 | Delivered / Didn't go through / Not sure yet / Blocked | counts by terminal status for requests created in period; `provider_unknown` shown as "Not sure yet" until reconciled | text_requests | That "sent" means received |
| M-17 | Rated from a text | requests created in period with `response_id` not null | text_requests (R-2) | Who rated what; review completion |
| M-18 | Credits used | sum of consumption entries in period, by source (monthly, purchased) | `sms_quota_ledger`, slices | — |
| M-19 | Credits returned | sum of refund + release entries in period | ledger | — |
| M-20 | Credits left | spendable balance now, monthly expiry date | grants | — |
| M-21 | Per Tag / per location | M-1, M-2, M-6, M-9 grouped | as above | That a Tag's staff caused ratings |
| M-22 | When low ratings happen | M-9 by weekday and hour band; shown only when M-2 ≥ 20 | responses | Causes |

### 6.2 Level A: daily or weekly operational view

Where: Home (number, status), Feedback · Needs you, Text Requests strip,
weekly email.

Contents: M-2 this week vs last; M-8; M-16 failures this week; M-1 per Tag
when a Tag had 0 opens; credits left (M-20); important change lines from the
observation catalogue (§6.7) limited to one.

### 6.3 Level B: monthly report

Built as an immutable snapshot (doc 7 §7.3) on the first local morning of the
month. Sections, each omitted when it has no data (never shown as zero-filled
decoration):

1. **Headline:** M-2 with comparison to previous month; M-1; M-6 (labelled
   "people we sent to your Google page").
2. **Rating spread** (M-3) and M-4 when allowed.
3. **Needs you:** M-9, M-10, M-11, M-12, M-13.
4. **Texts:** M-15 by origin, M-16, M-17.
5. **Credits:** M-18, M-19, M-20, monthly credits that expired unused.
6. **By Tag / by location** (M-21) when > 1 Tag or location.
7. **Three observations** (§6.7), each with its numbers.
8. **One next step**: the highest-priority applicable next step (§6.7.3).
9. **How to read this:** one line per caveat triggered (small sample,
   new Tag, partial month because of signup date, quiet period).

Facts and interpretation are visually separate: numbers in tables; the
observations block is headed "What we noticed" and each line says what it is
based on.

### 6.4 Level C: 3, 6 and 12 months

Shown in Insights once the org has the history (first rating older than the
window). Monthly points of M-2, M-9 share, M-10, M-15, M-1. Rules:

- A month with < 10 ratings is drawn as a count only (no average point).
- Year-over-year comparison only with ≥ 13 months of data; otherwise the
  12-month view carries the line "Seasons affect these numbers. A year of
  history lets us compare like with like."
- Partial months (signup month, cancellation month) are marked and excluded
  from comparisons.
- Locations are compared only when each has ≥ 30 ratings in the window, and
  the comparison is of shares, not counts (a bigger location is not "better").

### 6.5 Calculation rules

- Counts are exact SQL aggregates under the caller's RLS (like
  `rpc_feedback_insights`, SECURITY INVOKER) for live views; snapshots are
  computed by a service function and stored.
- Late events: a rating submitted on the last day but processed after the
  snapshot is not added to a sent report; the next report's "Still open from
  earlier" covers it. Snapshots are never edited; a corrected snapshot is a
  new version with `supersedes_id` and is only produced by an operator.
- Deleted data (account deletion, retention purge) is not resurrected in old
  snapshots: snapshots hold aggregates only, no identifiers (doc 12).
- Text request outcomes are counted by request creation date; a request
  created on the 31st and delivered on the 1st belongs to the earlier month.

### 6.6 Sample-size rules

| Rule | Threshold | Behaviour below it |
|---|---|---|
| Average shown | ≥ 10 ratings in period (PR #67 `MIN_SAMPLE`) | Show count and spread only |
| "Up / down" words for averages | both periods ≥ 10 and difference ≥ 0.2 (PR #67 `MEANINGFUL_CHANGE`) | "About the same" or no comparison |
| Count comparison arrow | both periods ≥ 1 | Count only |
| Percent change on counts | both periods ≥ 20 | Absolute difference only ("up 3") |
| Weekday/hour pattern | ≥ 20 ratings and ≥ 5 low ratings | "Not enough ratings yet to see a pattern" |
| Rated after opening (M-5) | ≥ 20 opens | Hidden |
| Per-location comparison | each ≥ 30 ratings | Counts only |

No statistical-significance language anywhere. These are display rules.

### 6.7 Observation catalogue

Fixed rules, evaluated in priority order; the first three that apply are
shown. Each produces a sentence from a template with its numbers filled in, and
the evidence query is stored with the snapshot.

| ID | Applies when | Sentence |
|---|---|---|
| O-1 | M-12 > 0 | "{n} low ratings from earlier are still open." |
| O-2 | M-9 ≥ 3 and ≥ 60% of them in one weekday/hour band, M-2 ≥ 20 | "{k} of your {n} low ratings came on {band}." |
| O-3 | A category marked ≥ 3 times and ≥ 40% of categorised items | "You marked {k} low ratings as {category}." |
| O-4 | M-2 up or down ≥ 30% vs previous month, both ≥ 20 | "Ratings were {up/down} {pct}% from {month}." |
| O-5 | A Tag with ≥ 20 opens last month and 0 this month | "{Tag} had no opens this month." |
| O-6 | M-16 didn't-go-through ≥ 3 and ≥ 10% | "{n} texts didn't go through. Credits were returned." |
| O-7 | M-10 = 100% and M-9 ≥ 3 | "Every low rating got a response within a week." |
| O-8 | M-15 = 0 for an org that sent ≥ 5 in each of the prior 2 months | "You didn't send Text Requests this month." |
| O-9 | Monthly credits expired unused ≥ 50% for 2 months | "You used {u} of {a} included credits." |
| O-10 | M-4 changed ≥ 0.2 with both months ≥ 10 | "Your average rating went from {a} to {b}." |

Forbidden: causal claims ("because"), benchmarks, other businesses, predicted
outcomes, Google review counts.

#### 6.7.3 Next step (one)

Priority: open low ratings → "Look at {n} open ratings"; texts failing → "Check
why texts didn't go through"; unused Tag → "Move or reprint {Tag}"; texting
habit lapsed with consented customers → "Send Text Requests after visits this
week"; otherwise "Keep your Tags where customers pay. Nothing needs you."

### 6.8 What the system must never infer or claim

- That a Google (or any) review was written, posted, removed, or changed.
- That a low rating became, or prevented, a public review.
- That a rise in ratings was caused by ReviewBoost, a Tag, or a text.
- Anything about individual customers in reports (no names, numbers, notes).
- Industry benchmarks, competitor comparisons, review completion rates.

### 6.9 Integrity monitor (internal)

Because every star gets the same destination, M-7 by star should be similar.
An internal job compares M-7 for 1–3 vs 4–5 stars per org monthly; a gap > 25
points with ≥ 30 ratings in each group raises an internal alert to check for a
handoff bug or a customer flow regression. Never shown to owners.

## Part B — ReviewBoost retention metrics

### 6.10 Definitions

A **paying business** is an org with a `billing_subscriptions` row in
`active` or `past_due` on the measurement date (trialing excluded).

| Metric | Numerator | Denominator |
|---|---|---|
| Activation rate | orgs reaching **activated** (first Tag open AND first rating AND destination set) within 14 days of signup | orgs that signed up in cohort |
| Time to first value | median hours from signup to first rating | activated orgs in cohort |
| Weekly active business (WAB) | orgs with ≥ 1 rating OR ≥ 1 Text Request sent OR ≥ 1 owner action (note/done/assign) in the week | paying businesses that week |
| Monthly active business | same over the calendar month | paying businesses at month end |
| Repeat Tag usage | orgs with ratings in ≥ 3 of the last 4 weeks | paying businesses with ≥ 1 Tag |
| Feedback follow-through | low ratings decided within 7 days | low ratings (all orgs) in period |
| SMS consent coverage | distinct phones with `opted_in` consent and evidence | distinct phones the org attempted to text in last 90 days |
| Delivery rate | delivered | sent (excluding `provider_unknown` still pending) |
| Opt-out rate | STOP received within 7 days of a send | delivered |
| Report engagement | monthly-report emails clicked, or report viewed in app within 14 days | reports sent |
| Month-N retention | cohort orgs still paying N months after first paid invoice | cohort orgs with a first paid invoice |
| Logo churn (monthly) | paying businesses at month start that are not paying at month end | paying businesses at month start |
| Revenue churn (gross MRR) | MRR lost from cancellations + downgrades | MRR at month start |
| Cancellation reasons | count by reason (Stripe `cancellation_details` + our survey) | cancellations with a reason |

Segmented by plan, signup cohort (month), business type (owner-selected at
onboarding, optional; "not given" is a segment) and location count, but only
reported where the segment has ≥ 30 orgs; otherwise rolled into "other".

Report engagement depends on email click tracking being acceptable (doc 12
D-12.3); if click tracking is off, only in-app views count and the metric is
labelled so.

### 6.11 Optimise for

Month-6 retention of paying businesses and follow-through, subject to
guardrails: opt-out rate, complaint rate, email unsubscribe rate, and no
increase in support contacts about unexpected messages or charges. Never
optimise for messages sent, dashboard visits, or handoffs alone.

### 6.12 Experiments

| Experiment | Unit | Design | Primary metric | Guardrails |
|---|---|---|---|---|
| E-1 Monthly report email | org | 10% holdout gets the in-app report but no email, for 6 months; assignment by hash of org id | Month-3 and month-6 retention | Unsubscribe, support contacts |
| E-2 Needs you redefinition | — | Not randomised (an integrity-neutral UX fix shipped to all); pre/post on follow-through with the prior 8 weeks as baseline | Follow-through | Missed-item reports |
| E-3 Weekly summary default on vs off | org | Randomised default for new signups | WAB at weeks 4–12 | Unsubscribe |
| E-4 Help prompts for at-risk orgs | org | 20% of flagged orgs get no prompt (rules still logged) | Next-60-day retention among flagged | Prompt dismiss rate |

Rules: pre-register metric and duration in the experiment doc before start;
minimum 100 orgs per arm or the experiment is reported as directional only;
no peeking-based stopping; correlation between feature use and retention is
reported as correlation and never as effect. Holdouts never withhold anything
safety-, billing-, or integrity-related. At pilot scale most of these will be
underpowered; doc 15 §15.6 says what is measured before then.
