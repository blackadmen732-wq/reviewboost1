# 3. End-to-end user journeys

**Status: PROPOSED.** Customer journeys J-C1 and J-C2 are the existing V1
flows and do not change. Everything an owner sees below is proposed unless
marked.

## 3.1 Customer journeys

### J-C1 Counter tap (IMPLEMENTED, unchanged)

```
Customer finishes visit → taps or scans Tag → page opens (no app)
→ session recorded (a Tag open)
→ "How was your visit?" ★★★★★ → taps a star → rating recorded
→ public review destination opens, identical for every star (a handoff)
```

Nothing is added between the star and the destination. A 1-star customer is
handed to Google exactly like a 5-star customer.

### J-C2 Text Request (IMPLEMENTED, with PR #76 Phase 0 and decision 2)

```
Customer agreed to texts (owner attested how, PR #76 doc 7 §7.4)
→ owner sends one Text Request
→ eligibility gate (consent, opt-out, suppression, frequency, credits)
→ message, in local daytime:
   "The Corner Cafe: How was your visit? Tap to rate: <link> Reply STOP to opt out."
→ customer taps → same page as J-C1
   (a per-request link; the page is identical to the Tag page)
→ star → same destination for every star
→ request marked "rated"; no further review request to this number for 30 days
```

Replies: STOP opts out at phone level everywhere; START restores; HELP returns
business and support identification. Any other reply is not read by a person
in V1, and the HELP text says so (doc 5 §5.7).

### J-C3 Automated post-visit follow-up (later, R5)

Same as J-C2 except the trigger is a completed visit from Connections, the
owner approved the workflow once, and the message carries the automation
version. At most one request per visit; no reminder text in the first release
of automation (doc 5 §5.4).

## 3.2 Owner journeys

### J-O1 First week: activation

1. Owner signs up, sets up before paying (`20260915001400_setup_before_checkout.sql`),
   creates a Tag, sets the Google destination.
2. Starter trial: 1 Tag, 0 SMS credits. Home status: "Put your code where
   customers pay" until the first open.
3. **First open** (any session on any Tag): Home shows "Your Tag works. 1
   customer opened it." No email.
4. **First rating**: Home's number becomes "1 rating this week".
5. Day 3 with zero opens: one email, "Your Tag hasn't been opened yet", with
   the three most common causes (not placed, wrong QR printed, destination
   missing) and the Tag page link (doc 10 rule A-1).
6. Trial converts on first paid invoice; Starter monthly credits are granted
   only then.

### J-O2 A normal week

1. Monday 08:00 local: weekly digest email (if enabled): ratings this week vs
   last, items needing you, Text Requests sent and delivered, credits left. One
   button: "Open Feedback" or "Open ReviewBoost" when nothing needs action.
2. Owner opens Home: one number with an arrow, one warning at most, one action.
3. Needs you shows two 2-star ratings from Friday 19:00–21:00 at the
   "Takeaway" Tag. Owner opens one, adds a note "spoke to Friday shift about
   wait times", marks done, picks category "Wait time".
4. Owner sends three Text Requests to clients seen today; two deliver, one is
   blocked "They asked not to get texts." No credit used for the blocked one.

### J-O3 A bad experience, followed through

1. A 1-star arrives. Within the next dispatch run, the owner (and the assignee
   if the org has auto-assign by location) gets a push-free, email-only alert
   only if they enabled "Tell me about 1–2 star ratings right away"
   (default on for owner, off for others; at most 3 such emails a day, then a
   single roll-up).
2. Owner flags it "Follow up" and assigns it to the location manager.
3. Manager adds a note and marks done. Resolution time is recorded.
4. If still open after 3 days, one reminder to the assignee; after 7 days, one
   to the owner. Never more.
5. The rating stays a rating. Nothing says "negative review". Whether the
   customer also posted on Google is unknown and never implied.

Contacting the customer: for a counter tap the customer is anonymous; the
follow-up is internal (fix the cause). For a texted customer, V1 does not
reveal which recipient rated (decision 2); the owner may contact customers they
know personally, outside ReviewBoost. ReviewBoost does not send service
follow-up texts in V1 (doc 5 §5.1, class D).

### J-O4 The monthly report

1. On the first local morning of the month, the report snapshot is built for
   the previous calendar month and emailed to members who opted in (owner
   default on).
2. Email: headline numbers, comparison when the sample allows, open items,
   Text Request outcomes, credits used and left, three observations, one next
   step. Link opens Feedback → Insights → Monthly with the same snapshot.
3. Owner forwards it to a partner; the email contains no customer identifiers
   (doc 12).

### J-O5 Texting stops working

1. Delivery failures exceed threshold (doc 10 rule S-2) or the provider is
   unavailable.
2. Text Requests shows a banner: "3 texts didn't go through this week. Credits
   were returned." with the reasons grouped.
3. Owner email only if the problem persists 24 hours and the owner sent in
   that period.

### J-O6 Low activity

1. Opens on all Tags fall more than 60% below the business's own 4-week median
   for two consecutive weeks (doc 10 rule A-3).
2. Home warning (one): "Fewer customers opened your Tags lately." Action:
   "Check your Tags", which lists each Tag's last open.
3. Owner can dismiss: "We're closed for the season" sets a quiet period that
   suppresses activity prompts until a date they choose.

### J-O7 Thinking of cancelling

1. Owner opens Settings → Billing → Manage plan.
2. Our page shows, before the Stripe portal: what they used this period, the
   plan that fits their usage if smaller, and that purchased credits stay
   (they survive cancellation). One optional question: "What's the main
   reason?" with a Skip link of equal weight.
3. "Continue to cancel" opens the Stripe portal. No second confirmation, no
   discount wall, no delay.
4. After cancellation: plan works until period end; Tags then stop serving
   (existing `billing-panel.tsx` copy). Nothing is deleted.

### J-O8 Multi-location owner

1. Home number is org-wide; a location chip filters it.
2. Needs you is filterable by location; admins scoped to a location see only
   theirs (future role scoping, doc 12 §12.2).
3. Monthly report has one section per location when each has ≥ 10 ratings;
   smaller locations are listed with counts only.

### J-O9 Automation (later, R5)

1. Text Requests → Follow-ups → "Ask after each visit" (visible only when the
   org has a working connection and the feature flag).
2. Owner picks template and delay, sees a dry run of last week ("would have
   sent 23; skipped 41: 31 no consent, 6 texted recently, 4 no phone"), sends
   a test to their own verified number, turns it on.
3. Daily: workflow card shows sent, delivered, failed, uncertain, skipped by
   reason, credits used. Pause takes effect for already-scheduled messages.
