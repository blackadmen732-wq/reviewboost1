# What is missing

An honest inventory of what ReviewBoost does not have. Written to be read by
someone deciding what to build next, not to make the project look finished.

Ordered by what would hurt most if it stayed missing.

---

## 1. There is no owner. Anywhere.

**This is the biggest hole and it is easy to miss**, because the customer flow
works end to end and feels like progress.

A customer can scan, rate, leave a note, and praise a colleague. **No human
being can read any of it.** There is no sign-up, no login, no dashboard, no way
to create an organization, no way to create a location, and no way to make a
stand. Every row the customer flow writes goes into a database nobody can open
except through Studio.

The migrations define `organizations`, `organization_members`, and `locations`
with correct policies, and no code path creates a row in any of them. The seed
script exists precisely because there is no other way to get a stand.

**What to build:** Supabase Auth sign-up, an onboarding route that creates the
organization, owner membership, first location, and first stand in one
transaction, and a dashboard that lists responses and praise. Until that exists,
ReviewBoost has no users — only customers of users who do not exist yet.

---

## 2. Nothing is deployed, and nothing is pushed

Two branches of backend work live on one machine with no push credentials. This
project has already lost almost all of its code once.

Beyond pushing: there is no Vercel project, no production Supabase project, no
environment separation between development, preview, and production, no domain,
and no deploy pipeline. "It builds locally" and "a customer can scan a code" are
separated by all of that.

---

## 3. Stands cannot be created, printed, or rotated

The `review_stands` table is correct. Nothing writes to it except a development
script.

Missing: stand creation, activation, pause, retire, token rotation, QR image
rendering (SVG and PNG), and a printable PDF. The legacy backend had QR
rendering; that code did not carry over and needs re-deriving on this stack.

A stand also has no lifecycle safeguard: **rotating a token invalidates a
physical object already sitting on a customer's table.** There is no reprint
workflow and no warning that rotation means replacement.

---

## 4. Team Praise has no second half

Praise is captured, encrypted, and stored `unmatched`. That is where it stops.

Missing: a staff roster, the matching screen, the deliberate rating-blind view,
optimistic concurrency on the match, the recognition lifecycle and its
append-only event log, bonus decisions in integer minor units, payroll export
with RFC 4180 escaping and spreadsheet-formula neutralisation, and manual
payment confirmation.

The schema anticipates this (`matched_staff_id`, `status`, `matched_by_user_id`
exist), so it is additive rather than a rewrite. But today the feature captures
data nobody can act on.

---

## 5. Key rotation would brick every printed stand

`CUSTOMER_NOTE_ENCRYPTION_KEY` does two jobs. Encryption is reversible: the key
version travels with the ciphertext, so old and new can coexist.

The lookup digests are not. Stand, session, and response tokens are stored only
as keyed HMACs of that key, so rotating it **invalidates every QR code and NFC
tag in the field**. They would have to be reprinted and physically replaced.

**Fix before the first paying customer prints anything:** derive token digests
from a separate, rotatable key with its own version column, so content rotation
and token rotation are independent. This is cheap now and expensive later.

---

## 6. No observability beyond log lines

There are structured JSON logs with request ids and recursive redaction, which
is a real start. Missing: anywhere to send them, error tracking, alerting, a
health or readiness endpoint, uptime monitoring, and any metric at all.

Nobody would know the customer flow was down until a business complained.

---

## 7. No backups, and no restore drill

Supabase takes backups on paid plans. Nobody has confirmed the plan, the
retention, or — the part that actually matters — that a restore has ever been
performed. An untested backup is a belief, not a control.

`CUSTOMER_NOTE_ENCRYPTION_KEY` must be in the backup procedure. A database
restored without it contains unreadable notes and unresolvable stands.

---

## 8. No load testing, and one specific unknown

The claim "this scales" is unverified. One number in particular is worth
measuring before it matters: **the rate limiter writes to the database on every
public request.** That is deliberate — serverless instances share no memory, so
an in-process counter is defeated by however many instances are warm — but it
means the busiest path in the system does an upsert before it does anything
useful.

Measure p50/p95/p99 for context resolution and response submission, connection
usage under concurrency, and behaviour when the database throttles. If the
limiter dominates, the fix is a durable shared counter, not a return to
per-instance memory.

---

## 9. The legacy backend still serves review gating

`backend/` contains a live Express app whose `POST /q/:publicId/rating` routes
4–5★ to Google and diverts everything below a threshold into a private form that
demands an explanation and offers to collect a phone number and email address.

It is not deployed anywhere, so it harms nobody today. It should be removed once
the Supabase flow is live — after pushing, because the only executed
implementation of these endpoints lives on an unpushed branch, and after
harvesting requirements: SMS segment counting, integer-cent money, consent
capture, suppression, quiet hours, outbox and inbox designs, reconciliation.

---

## 10. Smaller things that will bite

- **No `OPTIONS`-only CORS test against a real browser.** Same-origin means no
  preflight today, which also means the CORS path is untested in practice.
- **No pagination anywhere.** The dashboard does not exist yet, but
  `customer_responses` grows without bound and the first listing endpoint must
  be cursor-paginated from day one, not retrofitted.
- **`idempotency_records` and `rate_limit_buckets` grow forever** unless the
  purge functions are scheduled. They exist; nothing calls them. Supabase Cron
  is the intended home and is not configured.
- **No `robots.txt` or `noindex` on `/q/*`.** Review pages should not be
  indexed; a crawler in the index is also a crawler generating scans.
- **The `location.name` and `business.logoUrl` fields are permanently null**
  until the dashboard can set them, and the contract says they are populated.
- **No accessibility or localisation review of the Haitian Creole strings.** The
  locale is offered by the API; nobody has confirmed the translations are real.

---

## What is genuinely solid

Worth stating, because the list above is long and the foundation is not weak.

- Tenant isolation is enforced by composite foreign keys, so a cross-organization
  link is refused by the database rather than by a code review.
- Idempotency is durable and transactional: claim, write, and stored result
  commit together, so a timeout on a phone cannot double-write.
- Review integrity is structural, not procedural. The Google URL is delivered
  before any rating exists, `review_stands` has no threshold column, and
  `team_praise_records` has no rating column — the barrier is the absence of the
  field, not a query someone must remember to trim.
- Customer notes and names are encrypted at rest with a fresh IV per value.
- Tokens are 256 bits and stored only as keyed digests.
- The service role never touches a table; it calls six narrow functions that each
  derive the tenant from the stand token.
