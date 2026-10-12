# 4. Screen-by-screen UX specification

**Status: PROPOSED.** No new navigation destination. Everything below lives in
Home, Feedback, Text Requests, Tags, or Settings, reuses `AppShell`,
`components/ui/*`, `StatusBanner`, `StatTile`, `EmptyState`, and the existing
design tokens (`--rb-*`). The locked Customer Page is not touched.

Binding constraints carried from PR #67's Owner Systems spec v1.6–v1.7: Home
shows one number with one arrow, one action, at most one warning, no chart,
no settings; simple daily words; big tap targets; no paragraphs.

## 4.1 Where things go

| Question the owner asks | Answered in |
|---|---|
| Is ReviewBoost working? | Home number and status |
| Is there anything I need to act on? | Home warning → Feedback · Needs you |
| What value did it deliver this week or month? | Home number; weekly email; Feedback · Insights · Monthly |
| Are my customer follow-ups working? | Text Requests · Sent (and Follow-ups later) |
| Am I spending SMS credits appropriately? | Text Requests header balance; Settings · Billing · Credits |
| Which Tag is working? | Tags list and Tag detail |
| What should I do next? | Home's one action; report's one next step |
| How do I control emails? | Settings · Notifications |

## 4.2 Home

**Layout (phone, top to bottom; desktop is the same column, max 720px):**

1. Greeting and business name (exists).
2. **The number.** "14 ratings this week" with an arrow and "up 3 from last
   week". When a location is selected, scoped to it. Tapping opens Insights.
3. **One status line** (`StatusBanner`), highest priority first:
   1. Setup incomplete (no Tag, no destination) → "Finish setting up".
   2. Billing problem (`past_due`) → "Your payment didn't go through".
   3. Needs you > 0 → "2 ratings need you" → Feedback.
   4. Texting problem (doc 10 S-2) → "Some texts didn't go through" → Text Requests.
   5. Activity drop (doc 10 A-3) → "Fewer customers opened your Tags lately" → Tags.
   6. Monthly report ready, unopened, first 7 days of month → "Your September report is ready".
   7. Otherwise "All caught up" (no action required).
4. **One primary button**, driven by the status above, or "Send a Text
   Request" for orgs that have sent one in the last 30 days, else "Print your code".
5. Secondary tiles (exist): "To read" becomes **"Needs you"** with the new
   definition (R-3). The Feedback nav badge counts the same thing, so the
   badge, the tile and the tab never disagree.

**The number's rules.** Week = last 7 completed local days vs the 7 before.
Arrow and "up/down n" only when both weeks have ≥ 1 rating; if last week had 0,
show "14 ratings this week" with no arrow. Never an average on Home unless the
week has ≥ 10 ratings (doc 6 §6.6). Quiet weeks: "No ratings this week" plus,
if Text Requests were sent, "You asked 4 customers" as the subline, so a quiet
week still shows effort.

**States.** Loading: skeleton of number and banner (existing loading pattern).
Error: existing 503 error boundary, "We couldn't load your numbers. Try again."
Empty (no Tag): setup status, button "Finish setting up".

**Permissions.** All roles see Home. Billing status line only for owner/admin.

## 4.3 Feedback

Tabs stay: **Needs you · Everything · Insights** (Insights from PR #67).

### Needs you

- **Contents:** ratings 1–3 not done, plus any rating flagged "Follow up",
  newest first. Location filter chip when the org has > 1 location.
- **Row:** stars, relative time, Tag label, location (multi-location only),
  badges: "Follow up", assignee initials, note count.
- **Row actions (swipe on phone, buttons on desktop):** Done, Follow up.
- **Empty:** "All caught up. Nothing is waiting on you." (exists, kept).
- **Banner when many are old:** "5 have been waiting more than a week." Tap
  sorts oldest first. No red counts beyond the nav badge.

### Everything

- All ratings, newest first; filters: stars, location, Tag, done/not done.
- 4–5 star rows are marked seen when they render in this list (not on the
  server's guess); they never enter Needs you unless flagged.

### Rating detail (`/feedback/[responseId]`)

```
★★☆☆☆   Fri 7:42 pm · Takeaway Tag · Main St
[Came from a Text Request]            ← only an aggregate-safe badge, no number
──────────────────────────────
What happened next
  • Flagged for follow-up by Sam · Fri 8:10 pm
  • Note by Sam: "Order was 25 min late…"   (encrypted, existing)
  • Done by Ana · Sat 10:02 am · Wait time
──────────────────────────────
[ Add a note ]  [ Assign ▾ ]  [ Follow up ]  [ Mark done ]
```

- **Mark done** opens an optional one-tap category sheet: Wait time, Staff,
  Quality, Cleanliness, Price, Order accuracy, Other, Skip. Skip is equally
  prominent. The category is the owner's judgement and is labelled as such in
  reports ("you marked 4 as Wait time").
- **Assign** lists active members with role ≥ member. Not staff roster names
  (they cannot sign in).
- **Reopen** for done items (exists).
- No "reply to customer" button: there is no channel to an anonymous customer.

### Insights

PR #67's view (7/30/90 days, star distribution, trend, `MIN_SAMPLE = 10`),
plus:

- **When it happens:** low ratings by day of week and by hour band
  (morning/midday/afternoon/evening), shown only when the period has ≥ 20
  ratings; otherwise "Not enough ratings yet to see a pattern."
- **What you marked:** categories chosen when marking done, as counts.
- **Follow-through:** low ratings decided within 7 days, as "9 of 11".
- **By Tag** and **by location** tables: opens, stars, handoffs.
- **Monthly** sub-view: list of report snapshots by month; each opens the same
  content as the email.
- **Longer view:** 3/6/12 months appear once the org has that much history
  (doc 6 §6.8).

**Permissions.** Owner, admin, member read; viewer reads; only owner/admin
assign; any member can note and mark done on items assigned to them or
unassigned.

## 4.4 Text Requests

Today: composer, recent list, balance (exists). With PR #76 Phase 0: consent
attestation, approved templates, sender prefix and STOP footer.

Additions:

- **Header:** "112 credits left · 38 used this month · monthly credits reset
  Nov 1" (from the ledger; purchased credits shown separately when present).
- **Sent list** with status chips mapped from `text_requests.status`:
  Scheduled, Sending, Sent, Delivered, Didn't go through (credit returned),
  Not sure yet (provider_unknown; "We're checking with the carrier"), Blocked
  (reason from eligibility), Cancelled, and **Rated** (from R-2 linkage).
- **This month strip:** "Sent 24 · Delivered 22 · Rated 9 · Didn't go through 1".
  "Rated" counts requests whose link produced a rating; it is never presented
  as a Google review.
- **Problem banner** (doc 10 S-2) with grouped reasons and fixes.
- **Follow-ups section (later, R5):** absent entirely until the org has a
  working connection and the flag. No disabled toggles, no "coming soon".

Composer failure states: blocked reasons use PR #76 doc 7 §7.7 copy verbatim.

## 4.5 Tags

- **List row adds:** opens this week, stars this week, last opened
  ("2 days ago" / "Never").
- **Unused Tag hint:** a Tag with 0 opens in 14 days after its first open, or
  0 opens 7 days after creation: "No one has opened this Tag lately. Is it
  somewhere customers can see it?" Dismissable per Tag.
- **Tag detail:** 30-day opens, stars, handoffs, star distribution when ≥ 10.
- Ratings are not attributed to staff; Tags are places, not people.

## 4.6 Settings

- **Notifications** (new section): per member, per category toggle:
  Weekly summary (default on owner, off others), Monthly report (on owner/admin),
  Low ratings right away (on owner), Reminders about open items (on assignee),
  Account and billing (always on, cannot disable), Tips to get more from
  ReviewBoost (default on, the only lifecycle category). Each email footer
  links here and has a one-click unsubscribe for its category.
- **Quiet period:** "We're closed until …" suppresses activity prompts and
  churn rules (doc 10 §10.7).
- **Billing** (exists): adds credits used and remaining by source, expiring
  monthly credits date, purchased credits note, pack purchase (after F-4), the
  "plan that fits your usage" line and cancellation flow (J-O7).

## 4.7 Responsive behaviour

- Phone first; every action reachable with a thumb; bottom nav unchanged (four).
- Desktop: same content in the existing sidebar layout; Feedback detail opens
  in place on wide screens (existing pattern).
- Mobile app (Expo): Feedback list and detail already call the APIs; adding
  Done / Follow up / Assign to the app is near-term, Insights stays web-only
  until the web view settles.
- Accessibility: Axe in Playwright (existing CI) on every new screen; colour is
  never the only signal (arrows carry "up/down" text).

## 4.8 Copy rules

Use "ratings", "opens", "handoffs to Google" (or "people we sent to Google"),
"texts", "credits". Never "reviews generated", "conversion", "prevented",
"risk score". Numbers before words. Explain small samples in one short line.
