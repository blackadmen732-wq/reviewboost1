# What is missing

An honest inventory of what ReviewBoost does not have. Written to be read by
someone deciding what to build next, not to make the project look finished.

Ordered by what would hurt most if it stayed missing.

---

## 1. The owner API exists; the owner *interface* does not

**Backend: done.** `POST /api/v1/onboarding` creates the organization, owner
membership, first location, and first stand in one transaction.
`GET /api/v1/customer-responses` and `GET /api/v1/team-praise` read them back,
cursor-paginated. `GET /api/v1/review-stands/{id}/qr` renders a printable code.

Owner routes run under the **caller's own** Supabase client, so RLS enforces
isolation on every statement rather than each handler remembering a `where
org_id`. The service role stays confined to the anonymous customer flow, where
there is no user for RLS to key on.

**Frontend: missing, and it is Codex's to build.** There is still no sign-up
screen, no onboarding wizard, and no dashboard. A business owner cannot yet do
any of the above without an HTTP client.

Also missing on the backend side: member invitations, role changes, location
editing, marking feedback read or resolved, and stand pause/retire. The schema
and policies support all of it; the routes are not written.

---

## 2. Nothing is deployed, and nothing is pushed

Two branches of backend work live on one machine with no push credentials. This
project has already lost almost all of its code once.

Beyond pushing: there is no Vercel project, no production Supabase project, no
environment separation between development, preview, and production, no domain,
and no deploy pipeline. "It builds locally" and "a customer can scan a code" are
separated by all of that.

---

## 3. Stand lifecycle is half-built

**Done:** the first stand is created during onboarding, listed, token-rotated,
and rendered as printable SVG at high error correction.

**Missing:** creating *additional* stands, pause and retire, PNG, and a
print-ready PDF with the business name and instructions. Physical NFC encoding
and a hardware catalogue do not exist at all.

Token rotation is deliberately destructive — it invalidates a code already on a
table — and is therefore a separate explicit action, not a side effect of
editing a stand. The route says so. **The UI that calls it must say so too**, or
an owner will click it to "refresh" a stand and silently kill their signage.

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

## 5. Key rotation — fixed

Token digests now use `TOKEN_DIGEST_KEY`, separate from the content encryption
key. During a rotation, resolution accepts the previous key and rewrites the row
under the new one the first time the stand is scanned — so stands migrate
themselves with nothing reprinted. Runbook in `ENVIRONMENT.md`.

Stands are also reprintable now: the token is stored encrypted alongside its
digest, so an owner who loses the printout gets a new copy instead of having to
rotate and replace a code already on a table. The trade is stated in migration
`20260810000200` — a database disclosure alone still yields nothing, because the
key is not in the database.

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

## 9. ~~The legacy backend still serves review gating~~ (RESOLVED)

The legacy `backend/` directory containing the Express app with review gating
has been removed. Requirements were harvested to `docs/backend/LEGACY_REQUIREMENTS.md`
before deletion. The legacy code is preserved on branch `archive/legacy-express-backend`.

---

## 10. Smaller things that will bite

- **No `OPTIONS`-only CORS test against a real browser.** Same-origin means no
  preflight today, which also means the CORS path is untested in practice.
- **Pagination is cursor-based and bounded** on both listing endpoints, capped
  at 100 rows. Done, not a gap — noted so nobody re-adds an offset.
- **`idempotency_records` and `rate_limit_buckets` grow forever** unless the
  purge functions are scheduled. They exist; nothing calls them. Supabase Cron
  is the intended home and is not configured.
- **No `robots.txt` or `noindex` on `/q/*`.** Review pages should not be
  indexed; a crawler in the index is also a crawler generating scans.
- **`business.logoUrl` is permanently null** — there is no logo column and no
  upload path. `location.name` is now populated from the real location record.
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
