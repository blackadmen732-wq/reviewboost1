# 8. One-to-one messaging flow

**Status: PROPOSED.** Extends the existing Text Requests screen and backend.
No second sending path.

## 8.1 Scope

One owner, one recipient, one message, one confirmation. No lists, no
"select all", no scheduling beyond the automatic quiet-hours deferral, no
campaign builder. Roles: `owner` and `admin`, as today.

## 8.2 Flow

1. **Open Text Requests.**
2. **Choose a recipient.** The recipient field accepts either:
   - a search over **recent visitors from connected sources** (last 30 days,
     newest first; name and last four digits; source badge), or
   - a typed phone number (the current behaviour).
3. **Review the recipient.** A card shows: name as each source knows it,
   •••• last four, source ("From Square · paid at High Street, Tue 2:14 pm"),
   consent status with its evidence ("Agreed in person · recorded by Sam on
   3 Oct"), and any eligibility notes. Nothing more.
4. **Choose the message.** One of the approved templates (§8.5). Tokens:
   `{first_name}` (only if the source gave one; otherwise the template's
   no-name variant is used), `{business}`, `{link}`.
5. **Preview.** The exact final text, including the business prefix and opt-out
   footer, with segment count and encoding computed server-side by
   `computeSegments` on that final body. If one character pushes the message
   from GSM-7 to UCS-2, the preview says which character and how many extra
   credits it costs.
6. **Cost.** "This uses 1 credit. You have 148 (120 included this month, 28
   purchased)." Monthly-first is already how the ledger spends.
7. **Eligibility.** `POST /text-requests/eligibility` runs every check (doc 7)
   and lists all blocking reasons and warnings. If consent is missing, the
   attestation dialog (doc 7 §7.4) is offered here, never silently.
8. **Confirm and send.** A single "Send to Ana" button. It is disabled while any
   blocking reason stands. The request carries an idempotency key generated
   when the confirmation step opened, so double taps and retries are one
   request.
9. **Status and history.** The new request appears at the top of the list with
   its live status; tapping it shows the status timeline.

## 8.3 What the server does on send

Unchanged pipeline, with three additions marked **new**:

1. Authenticate, resolve org, check role (existing).
2. **New:** run `app.messaging_eligibility` with stage `schedule`; refuse with
   all reason codes if blocked.
3. Render the final body (**new**: business prefix and footer appended
   server-side), compute segments on it.
4. `rpc_schedule_text_request`: row, credit reservation (monthly first), outbox
   job, one transaction (existing). **New:** the row records `visit_id` and
   `customer_id` when the recipient came from a connection, and the dedupe key
   is derived from the visit when there is one.
5. Dispatch re-checks opt-out, consent, suppression, quiet hours (existing),
   plus messaging pause and provider readiness (**new**).

## 8.4 Status vocabulary

The owner sees exactly what the system knows:

| `text_requests.status` | Owner label | Meaning |
|---|---|---|
| `scheduled` | Scheduled for {time} | Waiting for the send window |
| `queued` | Queued | Waiting for the next send cycle |
| `sending` | Sending | Being handed to the carrier |
| `submitted` | Sent | The carrier accepted it. **Not** "Delivered" |
| `delivered` | Delivered | A delivery receipt confirmed it |
| `failed` | Didn't go through | The carrier refused or reported failure; credit returned per ledger rules |
| `provider_unknown` | Delivery unknown | We couldn't confirm it was sent. We won't resend automatically |
| `cancelled` | Cancelled | Cancelled before sending |
| `suppressed` | Not sent | Blocked at send time, with the reason (for example, they replied STOP after you queued it) |

"Delivered" requires a provider delivery callback. Twilio's `sent` status maps
to `submitted`. Many carriers never return a final receipt; such messages stay
"Sent", which is honest.

The screen never says the customer read the message, rated, or left a Google
review. It can say "They rated" only from ReviewBoost's own response record,
and never claims a Google review happened (`README.md` binding rules).

## 8.5 Message content

Final body structure, assembled by the server:

```
{business}: {template body with {first_name} and {link}}
Reply STOP to opt out.
```

V1 approved templates (D-8.1, owner to approve the wording):

1. "Hi {first_name}, thanks for visiting today. How did we do? {link}"
2. "Thanks for coming in. Would you tell us how it went? {link}"

Example final text (GSM-7, 2 segments with a 24-character link):

```
The Corner Cafe: Hi Ana, thanks for visiting today. How did we do? https://rvb.st/q/AbC123xyz
Reply STOP to opt out.
```

**Recommendation:** V1 offers approved templates only, and removes today's
free-text template field. Free text lets a review request become a promotion
("20% off if you leave 5 stars"), which is both review gating and marketing.
If the owner wants free text, the alternative is free text that must still
contain `{link}`, is screened for incentive and rating-conditional language,
and keeps the server-added prefix and footer. That is a product decision
(D-8.1), not a default.

The opt-out footer and business prefix are counted in segments and credits.
The business name is the org's display name, trimmed to 30 characters for the
prefix.

## 8.6 Ambiguous outcomes

Existing behaviour is kept and explained:

- A provider timeout after submit leaves the request `provider_unknown`. It is
  **never retried automatically**, because the customer may already have it.
- After 15 minutes the reservation is settled as spent
  (`app.sms_reconcile_aged_unknowns`), because refunding a message that was
  probably delivered would let anyone who can cause a timeout send for free.
- A later delivery callback for that message moves it to `delivered` or
  `failed`; if `failed`, the credit is refunded through the ledger's existing
  idempotent refund path.
- The owner may send again manually after seeing "Delivery unknown". The
  confirmation warns: "We couldn't confirm your last text to Ana on Tuesday.
  Sending again might mean she gets it twice." The frequency cap does not
  count `provider_unknown` sends, so the owner is not locked out, but the
  warning is mandatory.

## 8.7 Insufficient credits

Shown at the cost step, before confirmation: "You need 1 credit and have 0.
Included credits renew on {date}." A **Buy credits** button opens the pack
picker (doc 10 §10.4), which goes to Stripe Checkout and returns to the same
composer state. ReviewBoost never buys a pack automatically and never sends on
credit.
