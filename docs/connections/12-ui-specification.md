# 12. Screen-by-screen UI specification

**Status: PROPOSED.** Uses the existing design system: `AppShell`,
`components/ui/*` (Button, Card, Dialog, EmptyState, InlineNotice, Input,
Skeleton, StatePanel, Toast), tokens such as `bg-surface`, `bg-quiet`,
`text-ink`, `text-muted`, `bg-brand-soft`, `--radius-card`, and the
`EditableRow` pattern from Settings. Copy follows the PR #67 design philosophy:
simple daily words, big taps, no paragraphs, one warning at most.

Every visible control works or is labelled unavailable. No decorative toggles.

## 12.1 Settings entry

A row in Settings, same shape as the existing Help rows:

```
[plug icon]  Connections
             Square · Connected                       >
```

Status text variants: "Not set up", "Square · Connected", "Square · Needs
attention" (warning colour), "Square · Updating…".

## 12.2 Directory — `/settings/connections`

```
← Settings
Connections
Bring in customers from tools you already use.

[ Search                                  ]
( All )( Point of sale )( Appointments )          ← chips; hidden if one category

Connected                                        ← section only if any
┌──────────────────────────────────────────────┐
│ [Square logo] Square                         │
│ High Street · Updated 5 min ago     Manage > │
└──────────────────────────────────────────────┘

Available
┌──────────────────────────────────────────────┐
│ [Square logo] Square                         │
│ Find customers from your Square sales or     │
│ appointments.                                │
│ Reads from Square. Never changes anything.   │
│                                   [Connect]  │
└──────────────────────────────────────────────┘

Planned                                          ← only if D-2.3 approves
  Toast · Clover · Vagaro        Planned (no button)
```

Phone: single column, cards full width, 16 px gutters. Desktop: max width
`Container`, two-column grid for Available.

| State | Treatment |
|---|---|
| Loading | Three `Skeleton` cards |
| Empty search | "Nothing called "xyz". We connect with Square today." |
| Error loading | `StatePanel` "We couldn't load this. Try again" with a retry button |
| Offline | Existing `/offline` handling; the page shows cached content read-only, actions disabled with "You're offline" |
| No permission (member/viewer) | Settings row hidden; direct URL renders the existing owner-only not-found |

## 12.3 Provider detail (not connected) — `/settings/connections/square`

Sections, in order, each short:

1. **Header**: logo, "Square", availability badge.
2. **What it does**: "Find the people who paid or had an appointment, so you
   can text them a review request."
3. **What you'll choose**: radio cards "Sales (Square Point of Sale)" /
   "Appointments (Square Appointments)".
4. **What ReviewBoost reads** (changes with the choice): "Your locations",
   "Names and phone numbers of customers who visited", "When they paid" or
   "When their appointment was". Each with a one-line reason.
5. **What it can't do**: "It can't change anything in Square." "It can't see
   card numbers or what they bought." "Connecting doesn't let you text anyone.
   Customers still need to agree."
6. **You'll need**: "A Square account you can sign in to as the owner."
   (Appointments: "Square Appointments", plus any plan requirement confirmed in
   the sandbox.)
7. **[Connect Square]** primary button. "Help" and "Privacy" links.

If MFA is required and not set up, the button opens the MFA step-up first.

## 12.4 Setup wizard — `/settings/connections/square/setup`

A stepper with four visible steps (the eleven technical steps of doc 3 §3.4
grouped for the owner):

**Step 1 · Sign in to Square.** Button leaves for Square. Returning lands on
"Finishing up…" (spinner, no actions). Failure states:

| Case | Copy | Action |
|---|---|---|
| Owner pressed Deny at Square | "You didn't give permission, so nothing was connected." | Try again |
| State expired or reused | "That took too long. Please start again." | Start again |
| Permissions short | "Square didn't give us everything we need: {missing in plain words}." | Sign in again |
| Account already connected to another business | "This Square account is already connected to another ReviewBoost business." | Contact us |
| Square down | "Square isn't responding. Try again in a few minutes." | Try again |

**Step 2 · Choose your places.** For each Square location, a select of
ReviewBoost locations (or "Don't use"). Time zone shown under each pair;
mismatch shows an `InlineNotice`: "Square says Chicago time, ReviewBoost says
UTC. Use Chicago time?" [Use Chicago] (updates the location after
confirmation).

**Step 3 · Check it works.** Runs the test. Shows:

```
✓ Connected to Square as "Corner Cafe LLC"
✓ 2 places matched
Last 7 days
  18 visits we can use
   4 visits with no customer attached      ⓘ
   2 customers with no phone number        ⓘ
   1 phone number that won't work for texts
[See details]
```

"See details" lists issues as "Ana R. · •••• 4821 · Phone number won't work",
never full numbers. If nothing usable came back, say so plainly and explain the
likely reason ("Most sales in Square didn't have a customer attached. Square
only links a customer when you add one at checkout.") and still allow
activation if the connection itself is valid.

**Step 4 · Turn it on.** Summary and [Turn on]. Lands on the connected detail
page with a "Bringing in your last 30 days…" progress panel.

Leaving mid-wizard keeps the connection in `connecting`; the directory shows
"Finish setting up". Cancel asks "Stop setting up Square?" and disconnects.

## 12.5 Connected detail — `/settings/connections/square` when connected

```
Square                                 Connected ●
Corner Cafe LLC · High Street, Mill Road

Last updated      5 minutes ago
Visits this week  47 from Square            ← only counts we trust
Permissions       Locations, customers who visited, sales times   (View)

[Update now]                                    ← disabled 5 min after use, says why

Needs a look (2)                                ← only if issues
  2 customers with no phone number    See
Recent activity
  Today 2:10 pm   Updated · 3 new visits
  Today 9:00 am   Updated · nothing new
  Yesterday       Couldn't reach Square · fixed itself

Settings
  Places            High Street, Mill Road     Change
  What counts       Sales                      Change (re-authorizes if needed)

[Disconnect Square]                              ← destructive, bottom
```

| Lifecycle / health | Banner | Primary action |
|---|---|---|
| `active` + `healthy` | none | Update now |
| `active` + `warning` | Amber `InlineNotice` with the specific warning | The fix for that warning |
| syncing | "Updating… 1,240 visits so far" progress | none (Update now disabled) |
| `reauth_required` | "Square needs you to sign in again. Until then, new visits won't come in." | Sign in to Square |
| `unavailable` | "Square isn't responding. We'll keep trying. Nothing you need to do." | none |
| `error` | Specific copy per error code | The fix (for example "Choose places again") |
| `authorization_required` | "Square didn't give us everything we need." | Sign in again |
| `disconnecting` | "Disconnecting…" | none |

**Disconnect dialog:**

> **Disconnect Square?**
> New visits will stop coming in. We'll tell Square to remove our access.
> Customers you've brought in stay for 30 days in case you reconnect, then
> we delete them. People who asked not to be texted stay on your do-not-text
> list.
> [Disconnect]  [Cancel]

## 12.6 Text Requests changes

**Recipient field** becomes a combobox:

```
Who should get it?
[ Search name or type a number          ]
  Recent from Square
  Ana Ruiz      •••• 4821   Paid today 2:14 pm · High Street      ✓ Can text
  Ben Okafor    •••• 0932   Appointment yesterday                 Needs OK
  Cleo M.       •••• 7710   Paid Tue                              Asked not to
```

Badges: "Can text" (green), "Needs OK" (consent unknown; selecting opens the
attestation dialog), "Asked not to" (opted out; not selectable), "Texted
recently" (not selectable until date), "Number won't work".

No connection: below the field, a quiet link "Connect Square to find
customers here" (owners/admins only). Connection needs attention: "Square
needs attention, so this list may be out of date. Fix it".

**Recipient card** after selection: name(s) with source, •••• last four, the
visit, consent evidence line, eligibility notes. "Remove" to pick someone
else.

**Message**: template picker (doc 8 §8.5), live preview of the final text in a
phone-bubble, "1 text · 1 credit" with the encoding note when relevant.

**Confirm**: "Send to Ana · 1 credit" primary button; disabled with the reason
underneath when blocked. Insufficient credits shows "Buy credits".

**History list**: status chips using doc 8 §8.4 labels; "Delivery unknown"
uses neutral styling (not error red) with an info tooltip.

## 12.7 Accessibility and responsiveness

- All flows usable at 320 px width, keyboard-only, and with a screen reader;
  status changes announced through `aria-live="polite"`.
- Colour is never the only signal; every badge has text.
- Touch targets at least 44 px (existing bottom-nav rule).
- Axe checks and visual baselines in light and dark mode, phone and desktop,
  added to the existing Playwright suites.
