# 10. Churn-risk detection and intervention rules

**Status: PROPOSED.** Interpretable rules only. No single signal is treated as
intent to cancel. Owners never see a "risk" label or score; they see a
specific, fixable observation, or nothing.

## 10.1 Inputs

All from existing tables plus `owner_activity_days`; no customer identifiers
are read.

| Input | Source |
|---|---|
| Tags, creation dates | `review_stands` |
| Opens, ratings, handoffs per day | sessions, responses, selections |
| Low ratings open, age | `customer_responses.needs_attention` |
| Text Requests by status, eligibility block reasons | `text_requests`, `messaging_eligibility_checks` (PR #76) |
| Credits granted, used, expired | ledger, grants |
| Plan, status, `cancel_at_period_end`, payment failures | `billing_subscriptions`, Stripe inbox |
| Owner activity by surface | `owner_activity_days` |
| Report sent / viewed / clicked | `owner_notifications`, `owner_activity_days` (`report_view`, `email_click`) |
| Quiet periods | `org_quiet_periods` |

## 10.2 Baseline and minimum data

- **Own baseline:** the org's median weekly opens (and ratings) over the
  previous 4 complete weeks, excluding weeks in a quiet period. A rule that
  compares to baseline needs ≥ 4 baseline weeks and a baseline median ≥ 10
  opens/week; below that, decline rules do not run (a business with 3 opens a
  week cannot meaningfully "drop 60%").
- **Tenure:** decline and engagement rules start after 6 weeks of paid
  tenure; setup rules run from signup.
- **Quiet period:** suppresses A-*, N-1, E-*; never suppresses B-* or S-2.

## 10.3 Rules (version 1)

| ID | Rule | Minimum data | Level | Explanation stored and shown |
|---|---|---|---|---|
| A-1 | No Tag open 3 days after the first Tag was created | — | watch | "Your Tag hasn't been opened since you set it up on {date}." |
| A-2 | A Tag with ≥ 20 opens in its first 30 days has 0 opens for 14 days | per Tag | watch | "{Tag} had {n} opens, then none since {date}." |
| A-3 | Weekly opens < 40% of own baseline for 2 consecutive weeks | §10.2 | watch; at_risk if also E-1 | "Opens were {a} and {b} the last two weeks; usually about {m}." |
| A-4 | Paid ≥ 21 days, 0 ratings ever | — | at_risk | "No ratings yet since your plan started on {date}." |
| N-1 | ≥ 5 low ratings open > 7 days, or oldest open > 21 days | ≥ 5 low ratings in 60 days | watch | "{n} low ratings have been open more than a week." |
| S-1 | Sent ≥ 5 Text Requests in prior 30 days, 0 in last 30, and has consented recipients | — | watch | "You haven't sent Text Requests since {date}." |
| S-2 | Last 7 days: ≥ 3 sends and ≥ 30% failed or blocked for a fixable reason (consent missing, timezone unconfirmed, provider_not_ready) | ≥ 3 attempts | watch (owner-visible), internal page if `provider_not_ready` | "{k} of {n} texts didn't go out. Most common reason: {reason}." |
| S-3 | ≥ 50% of monthly credits expired unused 2 periods in a row and sends > 0 ever | 2 periods | watch | Plan-fit line in billing only; never a nag |
| E-1 | No owner/admin activity for 21 days (excluding email clicks) | paid ≥ 6 weeks | watch | Internal only |
| E-2 | Last 3 monthly reports neither viewed nor clicked | 3 reports | watch | Internal only |
| B-1 | Subscription `past_due` | — | at_risk | Billing banner (existing Stripe dunning drives emails) |
| X-1 | `cancel_at_period_end = true` | — | at_risk | Internal only; no owner prompt beyond the existing billing banner |

**Levels.** `watch` = one rule firing. `at_risk` = any rule marked at_risk, or
two or more watch rules from different families (A, N, S, E) open at once.
Levels exist for internal triage and measurement, not for owner copy.

## 10.4 Confidence and explanation

Each signal stores its evidence (the numbers in the explanation) and the
rules version. Internal views show: rule, plain explanation, evidence, how long
it has been open, prompts shown, and the false-positive history of that rule
(§10.8) as "this rule is right about X% of the time" once measured. No
probability is invented before data exists; until §10.8 has data the internal
view says "not yet measured".

## 10.5 Interventions by level

| Level | Owner sees | Internal team | Never |
|---|---|---|---|
| watch (owner-visible rules A-1, A-2, A-3, N-1, S-1, S-2) | One Home status line (priority order in doc 4 §4.2) and at most one email via the matching C-rule; each with the specific fix | Listed in the internal retention view; no action required | Discounts, urgency, "we miss you" copy |
| watch (internal-only rules E-1, E-2, S-3) | Nothing (S-3 only as a plan-fit line in billing) | Visible for pattern analysis | Emails about inactivity |
| at_risk | Same owner prompts as their rules; plus, if paid ≥ 60 days, one personal email from a named person offering a 15-minute setup check, plainly optional | One human review per org per 60 days at most | Calls, repeated emails, blocking cancellation |
| B-1 | Billing banner, Stripe dunning | Watch for failed recovery | Suspending data |
| X-1 | Nothing extra | Read the reason when given | Retention offers after they chose to cancel |

Specific fixes by rule: A-1/A-2 → Tag list with last open, reprint link,
placement tips; A-3 → same plus "closed for the season?" quiet-period option;
N-1 → Needs you sorted oldest first, assign; S-1 → Text Requests composer;
S-2 → grouped reasons with the fix for each (record consent, confirm time
zone, wait for us on provider readiness); S-3 → plan fit.

## 10.6 Plan adjustment

When S-3 holds, or a Growth/Pro org uses ≤ the Starter limits (1 location,
≤ 3 Tags, ≤ 150 credits used) for 2 periods, Settings → Billing shows: "Your
use fits Starter ($49/month). You'd keep your Tags (up to 3) and 150 credits a
month." Shown in billing only, never pushed by email, never shown during the
first 60 days. Downgrade goes through the Stripe portal; purchased credits are
kept.

## 10.7 Frequency limits and dismissal

- One owner-visible retention prompt at a time on Home; one retention email
  per org per 7 days; max 3 per 30 days, across all rules.
- Each prompt has Dismiss with reasons: "Not relevant", "We're closed for the
  season" (opens quiet period setup), "Already handled". Dismissing suppresses
  that rule for that org for 30 days (90 for "not relevant" twice).
- A signal clears automatically when its condition no longer holds; the
  prompt disappears without comment.

## 10.8 Measuring false positives

- A signal is a **true positive** if the org cancels or becomes inactive
  (no activity and no ratings for 30 days) within 90 days of the signal, with
  no recovery in between; **false positive** otherwise. Recovery = the rule's
  condition cleared and activity returned to ≥ 70% of baseline.
- Per rule, monthly: precision (true / fired), recall (churned orgs that had
  any signal in the prior 90 days / all churned orgs), and median lead time.
- E-4 holdout (doc 6 §6.12) separates "prompt helped" from "would have
  recovered anyway".
- Rules with precision < 20% after 50 firings are revised or retired; changes
  bump `rules_version`.

## 10.9 Privacy

- Rules read aggregates; internal views show counts and dates, never customer
  phone numbers, notes, or individual ratings beyond counts.
- Owner activity stores a surface bitmask per day, not page views, URLs, or
  devices.
- Internal access to retention views is limited to staff with a support role
  and is audited.

## 10.10 When to consider a model

Only when all hold: ≥ 500 paying businesses with ≥ 12 months of history,
≥ 100 cancellations with reasons, rule precision measured and plateaued, and
a specific decision a model would improve (for example, who gets the
personal check-in). Even then, the model ranks orgs for internal attention;
owner-visible prompts remain rule-based and explainable.
