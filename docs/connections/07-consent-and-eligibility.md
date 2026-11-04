# 7. Consent and messaging eligibility

**Status: PROPOSED.** This document describes technical controls. It is not
legal advice and not a compliance certification. Before any workflow is
enabled in production, counsel must confirm the consent basis, the message
content rules, and the jurisdictions served.

## 7.1 The rule

> A connection is not consent. An imported phone number is not consent. A
> booking, payment, purchase or appointment is not consent.

Square's customer object has no SMS consent field (Appendix A §A.2). So every
contact that arrives through a connection starts with consent `unknown`, which
the existing gate already treats as "do not send". The connection makes a
person *findable* in Text Requests. Something else must make them *eligible*.

## 7.2 One eligibility service

Today the gate is `app.sms_can_send(org, phone_hash, purpose)`, called at
schedule time and again at dispatch. It checks phone-level opt-out, consent,
and suppressions. It does not check credits (the reservation does that),
messaging readiness, location validity, or frequency beyond the dedupe
windows, and it returns one reason, not all of them.

Proposal: extend, not duplicate. A new
`app.messaging_eligibility(p_org_id, p_location_id, p_phone_hash, p_purpose,
p_context jsonb)` returns **every** failing check in a fixed order, and
`app.sms_can_send` becomes a thin wrapper over it so that the schedule RPC,
dispatch, the composer preview, and any future automation all ask the same
function. A TypeScript wrapper `lib/server/messaging/eligibility.ts` adds the
checks that live outside the database (provider configuration) and maps codes
to owner copy.

### Checks, in order

| # | Check | Code if it fails | Blocks or warns | Where |
|---|---|---|---|---|
| 1 | Org exists, subscription allows software use (`app.entitlement_allows_use`) | `org_inactive` | Block | DB |
| 2 | Location belongs to org, is `active`, has a valid IANA timezone (not the `UTC` default unless confirmed) | `location_invalid` / `location_timezone_unconfirmed` | Block / Warn | DB |
| 3 | Phone present, parses to E.164, country allowed (US only in V1, D-7.1) | `phone_missing` / `phone_invalid` / `phone_country_unsupported` | Block | TS before hashing; DB trusts the hash |
| 4 | Not opted out at phone level (`sms_phone_optout`) | `opted_out` | Block | DB (existing) |
| 5 | Consent `opted_in` for this org and purpose, with a recorded source, time, and wording version | `consent_missing` / `consent_evidence_incomplete` | Block | DB |
| 6 | No active suppression (`compliance`, `hard_bounce`, `manual`, `stop_keyword`, `opt_out`) | `suppressed_<reason>` | Block | DB (existing) |
| 7 | Purpose permitted: `review_request` is the only V1 purpose; template approved (doc 8 §8.5) | `purpose_not_permitted` / `template_not_approved` | Block | DB + TS |
| 8 | Frequency: no review request to this contact from this org in the last 30 days (D-7.2), plus the existing `recent_send` and `completed_flow` windows | `frequency_cap` / `recently_sent` / `already_rated` | Block | DB |
| 9 | Not a duplicate of an equivalent request (same visit, or the existing `dedupe_key`) | `duplicate_event` | Block | DB (existing unique key) |
| 10 | Quiet hours | `quiet_hours` | **Warn and schedule**, not block: the existing behaviour schedules for the next allowed time | TS + DB (existing) |
| 11 | Workflow enabled: for V1 manual sends, the owner has accepted the Text Requests terms (D-7.3); for automations (future), the automation is enabled and approved | `workflow_disabled` | Block | DB |
| 12 | Messaging status: the org is not under a compliance hold (abuse review, carrier complaint) | `messaging_paused` | Block | DB (new `org_messaging_status`) |
| 13 | SMS provider configured and ready (`getSmsProvider` does not throw, sending number present) | `provider_not_ready` | Block | TS |
| 14 | Credits: `app.sms_quota_available(org) ≥ segments(final body)` | `insufficient_credits` | Block | DB (existing) |
| 15 | Source connection health, if the recipient came from a connection | `source_needs_attention` | Warn only | DB |

Check 14 is advisory at preview time; the authoritative check is the
reservation inside `rpc_schedule_text_request`, which locks the balance. A
preview that said "you have enough" followed by a refusal at send is possible
and is shown honestly.

Checks 4–6 run again at dispatch (they already do). Check 12 and 13 are added
to the dispatch-time gate too, so a pause takes effect for already-scheduled
messages.

## 7.3 Recording the decision

```sql
create table public.messaging_eligibility_checks (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  location_id    uuid,
  phone_hash     text not null,            -- never the number
  purpose        public.sms_consent_purpose not null,
  stage          text not null check (stage in ('preview','schedule','dispatch')),
  allowed        boolean not null,
  reasons        text[] not null,          -- fixed codes only
  consent_event_id uuid,                   -- which consent event satisfied check 5
  text_request_id  uuid,
  visit_id         uuid,
  actor_user_id    uuid,
  checked_at     timestamptz not null default now()
);
```

Written for `schedule` and `dispatch` always, and for `preview` only when it
blocks (to avoid a row per keystroke). No name, number, or message body.
Retained with the Text Request it belongs to. Owners and admins can read their
own org's rows; the composer uses them to explain "why didn't this send?".

**Never silent.** A block always produces a reason code, the owner always sees
it, and a blocked send never consumes credit. There is no override parameter
anywhere in the API; the only way past a block is to fix its cause.

## 7.4 How a contact becomes eligible (fixing audit F-1)

The composer currently records `opted_in` on every send with
`source: "owner_import"` and empty evidence. That is removed. Consent is
recorded only by these paths:

| Path | Source code | Evidence recorded | V1? |
|---|---|---|---|
| **Owner attestation, per recipient** | `owner_import` | `method` (one of: "agreed in person", "agreed on a sign-up form", "agreed when booking", "agreed by text"), the exact attestation wording and its version id, attesting user id, time, location, and optionally a reference the owner gives (form name, date). Shown once per contact; not repeated on later sends | Yes, subject to counsel (README decision 2) |
| **Customer texts START** | `reply_start` | Inbound message id, time | Yes (exists) |
| **Customer opts in on a ReviewBoost page** | `customer_flow` | Page version, disclosure text version, timestamp, the stand | No. A new customer-facing capture point is a separate product decision (doc 9) |
| **Bulk import with attestation** | `owner_import` | Same as above, per file | No. Customer imports are excluded from V1 by the brief |

The attestation is an explicit dialog, not a checkbox buried in the form:

> **Has Ana agreed to get texts from The Corner Cafe?**
> ReviewBoost can only text people who agreed to hear from you. Having their
> number in Square doesn't count.
> ○ They agreed in person  ○ On a sign-up form  ○ When they booked  ○ By text
> [ ] I confirm Ana agreed to receive a text from The Corner Cafe asking about
> their visit.
> [Record and continue]   [Cancel]

The wording is versioned (`consent_wording_versions` table, immutable rows).
Changing it creates a new version; existing consents keep the version they
were given under.

**Migration for existing data.** Consent events already written with
`source = owner_import` and an empty evidence object are not edited (the ledger
is append-only). A migration appends an `unknown` event for each affected
`(org, phone, purpose)` whose latest event is such an empty-evidence opt-in,
with `source = admin` and evidence `{reason: "consent_without_evidence_reset"}`.
Production has not sent live messages, so this is expected to affect only test
data; the migration reports its count.

## 7.5 Opt-out, identification, disclosures

- **STOP / START / HELP**: unchanged, already phone-level and pre-consent.
- **Every outbound message** includes the business name at the start and an
  opt-out line at the end (doc 8 §8.5). The footer is added server-side and
  cannot be removed by a template.
- **HELP reply** text names ReviewBoost and the business and gives the support
  address. (The inbound path exists; the reply content is a Phase 3 task.)
- **Quiet hours** stay 09:00–20:00 in the location's timezone, which is inside
  the 08:00–20:00 window several US state laws use. D-7.4 confirms whether to
  use the recipient's area code timezone in addition; the current design uses
  the business location, which is a reasonable proxy for a customer who just
  visited it.
- **Jurisdiction**: US numbers only in V1 (check 3). Other countries are a
  separate legal review.
- **Carrier registration** (A2P 10DLC) for the sending number is a launch
  prerequisite owned by operations, not something code can satisfy.

## 7.6 Review integrity

Eligibility never depends on a rating, a predicted rating, a visit's value, or
any connected-data signal about how satisfied a customer was. Specifically:

- The connected data cannot be used to decide *who* gets asked based on
  anything correlated with sentiment (no "only text customers who tipped", no
  "skip customers who complained").
- Every request lands on the same `/q/{token}` flow, where every rating gets
  the same Google opportunity (`SYSTEM_CONTEXT.md` §2).
- The `already_rated` check (existing `completed_flow` suppression) stops a
  second request after *any* rating, regardless of the stars.

A pgTAP test asserts `app.messaging_eligibility` has no parameter or join that
reads `customer_responses.rating`.

## 7.7 Owner-facing reasons

| Code | Owner copy |
|---|---|
| `consent_missing` | They haven't agreed to texts from you yet. |
| `opted_out` | They asked not to get texts. |
| `phone_invalid` / `phone_missing` | That phone number won't work for texts. |
| `duplicate_event` | You already sent a request for this visit. |
| `recently_sent` / `frequency_cap` | You texted them recently. You can ask again after {date}. |
| `already_rated` | They already left a rating. |
| `quiet_hours` | It's late where you are. This will go out at {time}. |
| `insufficient_credits` | You need {n} credits and have {m}. |
| `source_needs_attention` | Square needs attention. Their details may be out of date. |
| `provider_not_ready` | Texting isn't set up yet. We're on it. |
| `messaging_paused` | Texting is paused on your account. Contact us. |
| `location_timezone_unconfirmed` | Check your time zone so texts go out at the right hour. |
| `org_inactive` | Your plan doesn't include texting right now. |
