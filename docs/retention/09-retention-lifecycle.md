# 9. Retention lifecycle plan

**Status: PROPOSED.** Signup through month 12. Interventions reference the
reminder rules (doc 5 §5.5) and churn rules (doc 10). Every intervention is
capped, dismissable, and suppressed during a quiet period.

## 9.1 Why a business still pays in month 6

Not because of a review count. By month 6 a business that uses ReviewBoost as
designed has:

1. **A record it cannot get elsewhere:** six monthly reports showing how many
   customers it asked, how they rated, which bad experiences it dealt with, and
   how fast. That record is the business's own, it compounds, and it starts
   answering seasonal questions.
2. **A routine:** Monday summary, a short Needs you list, Text Requests after
   jobs. Removing ReviewBoost removes the routine, not just a widget.
3. **Accountability across staff and locations:** who handled what, and that
   nothing sat open.
4. **Honest proof of effort:** "You asked 140 customers this quarter; 38% of
   those who opened rated." It never pretends to be review counts.
5. **Physical presence:** Tags on the counter keep collecting with no work.

If an owner reaches month 6 without these, the product failed them earlier, and
the lifecycle below is designed to catch that early, not at cancellation.

## 9.2 The lifecycle

| Period | Value the owner should have experienced | Habit being built | New information visible | Prompt | Signals of no value | Intervention |
|---|---|---|---|---|---|---|
| **Day 0–7 (trial: 1 Tag, 0 credits)** | Tag set up, first open, first rating seen on Home | Look at Home once a day | First open, first rating, "sent to Google" count | "Put your Tag where customers pay" until first open | No Tag created; Tag created, 0 opens by day 3; destination missing | A-1 email day 3 with the three common causes; setup status on Home; no discount, no urgency |
| **Week 2–4 (first paid month)** | Several ratings; first low rating handled through Needs you; first Text Request (Starter has 150 credits from first paid invoice) | Check Needs you; send Text Requests after jobs | Weekly summary #1–#3; per-Tag opens; credits used | Weekly summary; "Send a Text Request" on Home if the org has phone-based customers (asked at onboarding, optional) | 0 ratings in week 2; consent never recorded for any recipient; Text Request attempts all blocked | A-2 "Your Tag has gone quiet" (if it had opens); a Text Requests empty state explaining consent in one line; owner can say "We don't text customers", which hides texting prompts |
| **Month 2** | First monthly report with a real comparison | Read the monthly report | Month-over-month, open items, credits used, three observations | Report email; Home "Your report is ready" for 7 days | Report not opened; no owner activity 14 days | None beyond the report. Absence of activity is noted (rule E-1) but not chased yet |
| **Month 3** | A pattern ("low ratings cluster Friday evening") or proof of follow-through | Act on a pattern; mark categories | Weekday/hour pattern once ≥ 20 ratings; "What you marked" | Observation in report; one next step | Needs you items accumulating > 7 days; monthly credits mostly expiring unused | C-2 weekly reminder (one); C-7 credit note suggesting texting consented customers or a smaller plan |
| **Months 4–5** | Stable routine; quiet weeks still produce a useful summary | Weekly glance, monthly read | 3-month trend line | Only the routine | Activity drop vs own baseline (A-3); texts failing (S-2); reports ignored 3 months (E-2) | A-3 Home banner + one email with Tag list; S-2 Text Requests banner with fixes; E-2 internal only (no owner nag): a person may check in once |
| **Month 6** | 6-month view; half-year summary in the month-6 report | Use the record (share with partner/staff) | 6-month trend, follow-through over time, Tag that performs best (by opens) | Month-6 report includes a "Your first six months" section | Combination rules (doc 10 level `at_risk`) | At-risk handling (doc 10 §10.5): help prompt with the specific fix; plan-fit line if usage is below plan |
| **Months 7–11** | Seasonal awareness; staff accountability | Same, plus quiet-period use for seasonal businesses | Same-month comparisons need 13 months; until then "seasons affect these numbers" | Report only | Sudden decline; billing failure | B-1 billing (Stripe dunning + our banner); A-3 as before |
| **Month 12** | Annual summary; first year-over-year next month | Annual review | 12-month view; "This year" section in month-12 report | Report only | Cancellation intent | J-O7 cancellation flow: plan fit, credits survive, one optional reason, no friction |

## 9.3 Explicit cancellation intent

Opening Settings → Billing → Manage plan with intent to cancel:

1. Show facts, not pressure: this period's usage, purchased credits that
   remain and survive cancellation, the plan that fits their usage if smaller.
2. One optional reason (equal-weight Skip).
3. Continue to the Stripe portal. One click. No discount wall, countdown,
   "are you sure" chain, or call requirement.
4. After cancellation, no win-back emails beyond one at period end stating
   what happens to their Tags and data, and how to resubscribe. Unsubscribable.

## 9.4 What is deliberately absent

No streaks, badges, or gamified "scores". No artificial urgency ("only 2 days
left to…"), no fake savings, no shame copy ("Your competitors are ahead"), no
notifications designed to pull the owner in without something to do. A quiet
week with nothing to act on says exactly that.

## 9.5 Business-type adjustments

- **Solo:** reports suppress averages and patterns more often (sample rules);
  the value line is "you asked N customers" and "every low rating answered".
- **Restaurant:** weekday/hour pattern is the main month-3 insight; Text
  Requests prompts are off unless the owner says they text customers.
- **Salon:** Text Requests habit carries weeks 2–5; automation (R5) is the
  month-4+ upgrade once Connections exists.
- **Multi-employee:** assignment and "done by" in the report from month 1.
- **Multi-location:** per-location sections once each has ≥ 10 ratings a month.
