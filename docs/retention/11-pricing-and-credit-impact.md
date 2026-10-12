# 11. Pricing and SMS-credit impact assessment

**Status: PROPOSED.** The pricing and credit rules are constraints, audited
against the code, not redesigned. Discrepancies are reported, not fixed here.
Provider costs below are labelled as assumptions where they are not in the
repository.

## 11.1 Intended rules vs code

From PR #76 doc 10 §10.2, re-checked on `main` `0155948`:

| Rule | Code | Match |
|---|---|---|
| Starter $49, 1 location, 3 Tags, 150 segments | `20260915000400_entitlements.sql` starter 1/3/150; price via Stripe price id | Yes |
| Starter trial 7 days, card required, 1 location, 1 Tag, 0 SMS | trial 1/1/0; `TRIAL_DAYS = 7`; card collection always | Yes |
| Growth $79, 2/8/500, no trial | limits match; `billing-service.ts:165` sets `trial_period_days: TRIAL_DAYS` for every plan | **No (F-8)** |
| Pro $129, 5/25/1,500, no trial | limits match; same trial line | **No (F-8)** |
| Packs 50/$4, 200/$16, 500/$40 | grant RPC only, no catalogue or checkout | **No (F-4)** |
| 1 segment = 1 credit | reservation uses computed segments | Yes |
| Monthly expires at period end, no rollover | grant `expires_at = period_end`, expiry sweep | Yes (`20260915001300_sms_ledger_carry_over.sql` is a storage migration that carries unexpired balances into grants with their own expiry; it is not a rollover) |
| Purchased never expires, survives cancellation | check constraint `expires_at is null` | Yes |
| Monthly first, then purchased | slice order, race-tested | Yes |
| First paid Starter invoice grants allowance; failed first payment grants 0 | mint only on `invoice.paid`, amount > 0 | Yes |
| Owner UI shows real allowance | `main` reads ledger; PR #67 hard-codes 0 | **Conflict on #67 (F-3)** |

This design adds **no** new price, plan, credit source, or billing behaviour.

## 11.2 Cost to the business, in credits

All customer texts (classes A and B) cost credits. Owner emails, reminders,
reports, and in-app features cost nothing extra and are included in every plan
(D-11.1 confirms: retention features are not a paid add-on).

| Plan | Credits/month | Texts/month at 1 segment | Per working day (22) |
|---|---|---|---|
| Starter | 150 | 150 | ~6.8 |
| Growth | 500 | 500 | ~22.7 |
| Pro | 1,500 | 1,500 | ~68 |

Packs: $0.08 per credit at every size (50/$4, 200/$16, 500/$40).

## 11.3 Message length and segments

With PR #76 Phase 0 framing (`{Business}: {template}\nReply STOP to opt out.`),
the default template `thanks_v1`, and `PUBLIC_FRONTEND_URL =
https://reviewboost.fit` (`docs/backend/ENVIRONMENT.md`):

| Link form | Link length | Body length (15-char name) | Body length (30-char name, the max) | Segments (GSM-7) |
|---|---|---|---|---|
| Today: `/q/{43-char Tag token}` | 69 | 151 | 166 | 1 / **2** |
| `/q/{token}?r={22-char ref}` (rejected) | 94 | 176 | 191 | **2 / 2** |
| Proposed: `/r/{22-char ref}` | 48 | 130 | 145 | 1 / 1 |

So the proposed request link (doc 5 §5.2) both enables attribution and keeps
every GSM-7 message at one segment, where today a long business name already
costs two.

**Encoding.** One non-GSM character switches the whole message to UCS-2
(70/67 characters per segment), making a 130-character message 2 segments.
The commonest cause will be the business name (curly apostrophe in "Mario’s",
accented letters outside GSM-7, emoji). Proposal D-11.2: normalise typographic
quotes and dashes in the sender name to their GSM-7 equivalents (visually the
same), and show the owner in Settings when their name forces UCS-2: "Your
business name has a character that doubles the cost of each text: ’. Use ' instead?"

## 11.4 Safeguards

| Hazard | Safeguard (existing unless marked) |
|---|---|
| Preview disagrees with charge | Same `computeSegments` on the final body at preview and reservation |
| Failed send charged | Refund to the same grants on definitive failure |
| Duplicate send charged twice | `dedupe_key` unique; one in-flight attempt |
| Provider uncertainty | `provider_unknown` settled as spent after 15 min; refunded if a later callback says failed; shown as "Not sure yet" |
| Blocked send charged | Eligibility runs before reservation; a block never reserves (PR #76 Phase 0) |
| Automation overspend (later) | Daily cap; pause on credit exhaustion; never borrows ahead (doc 5 §5.3.11) |
| Surprise purchases | No auto-reload; packs only by explicit checkout (F-4 fix) |
| Refunded pack | Remove unspent remainder only (PR #76 doc 10 §10.5) |
| Credits expiring unused | Visible expiry date; C-7 note; plan-fit line (doc 10 §10.6) |
| Provider bills more than ledger | Monthly provider-vs-ledger reconciliation (PR #76 doc 10 §10.5; PR #73 candidate) |

## 11.5 Owner-facing cost visibility

- Text Requests header: credits left, used this month, reset date (doc 4 §4.4).
- Composer: "This text uses 1 credit" computed on the final body.
- Monthly report: used by source, returned, expired unused.
- Billing: purchased credits and their survival on cancellation stated plainly.
- No cost shown as money per text to owners (they bought credits, not cents),
  except the pack price on purchase.

## 11.6 ReviewBoost's own cost (assumptions to verify)

Not in the repository; to be confirmed against the live provider contract
before launch, ideally through PR #73's rate tables once rebased.

| Item | Assumption | Effect |
|---|---|---|
| US A2P SMS outbound per segment, all-in (provider + carrier fees) | roughly $0.01–$0.015 | Starter's 150 included segments cost ReviewBoost roughly $1.50–$2.25 at full use; packs at $0.08/credit carry margin |
| 10DLC brand + campaign registration | one-time and monthly fees per brand/campaign | Operations cost; decide whether ReviewBoost registers per business or as a platform (doc 12 D-12.1) |
| Transactional email | low or free tier at pilot volume (verify Resend pricing) | Negligible per org |
| Compute for reports and evaluators | a few aggregate queries per org per day | Negligible at current scale; indexes in doc 7 |

**Sustainability rule:** the monthly reconciliation compares provider-billed
segments and cost with ledger consumption; a gap > 2% for a month is an
operational alert, not an owner-visible event.

## 11.7 Phased commercial items (not V1)

| Item | Dependency | Why later |
|---|---|---|
| Credit packs purchasable (F-4) | Stripe pack prices (operator), checkout, webhook handler | Needed before automation, near-term |
| Fix trial-on-every-plan (F-8) | Owner confirmation that the brief is the rule | One-line change with a test; billing behaviour change needs explicit approval |
| Automation (class B) | Connections, consent coverage, pilot | Spends credits without a click; highest cost risk |
| Automatic reload | Not planned | Excluded by the brief |
| Bulk sends, MMS, AI messages, imports | Not planned | Excluded by the brief |
