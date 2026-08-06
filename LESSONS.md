# ReviewBoost — Engineering Lessons

Durable lessons from the legacy Node/Express build and its rebuild attempts.

**This document contains lessons, not status.** Anything volatile — branch names,
commit counts, test counts, what has or has not run — lives in
[`STATUS.md`](./STATUS.md) and is dated there.

---

## How to read the evidence labels

Every technical finding below carries one of these. A finding without a label is
a defect in this document.

| Label | Means |
|---|---|
| **REPRODUCED** | Executed against the relevant environment and the result observed |
| **INSPECTION-CONFIRMED** | Confirmed by reading code, schema, or configuration — not executed |
| **MOCKED** | Exercised only against fakes, stubs, or simulated dependencies |
| **UNVERIFIED** | Designed or claimed, never proven |

An earlier revision of this document said every bug was "verified by running it."
That was false. A substantial portion were read, not run, and the review of a
third-party implementation was performed entirely on pasted source that was never
executed. The labels below correct that.

---

## Part 0 — The most serious correction: review gating

### What the legacy system did

The legacy implementation routed customers by the rating they selected:

- 4–5 stars → redirected to the public Google review page
- 1–3 stars → diverted into a private feedback form, no public review offered
- Low ratings were reported to the business as reviews "prevented" or "intercepted"

**This is review gating, and it is prohibited.** Google's user-contributed
content policy forbids discouraging or prohibiting negative reviews and forbids
selectively soliciting positive reviews. Beyond policy, gating exposes the
business to platform enforcement and to consumer-protection risk.

An earlier revision of this document called that mechanism "genuinely good" and
said it "doesn't need fixing." **That endorsement was wrong and is withdrawn.**

### The rule that replaces it

> **Every customer receives the same neutral opportunity to leave a public
> Google review, regardless of the rating they selected inside ReviewBoost.**

The rating a customer gives may *additionally* trigger:

- Private feedback capture
- A service-recovery task for the business
- An owner alert
- Internal sentiment classification
- A follow-up workflow

The private recovery path must never **hide, suppress, delay, deprioritise, or
replace** the public review opportunity. No threshold. No conditional redirect.
No differential prominence.

### Amplifier and Shield, redefined

The names are kept. The meanings are corrected.

| Term | Compliant meaning | What it must never mean |
|---|---|---|
| **Amplifier** | Helping a business consistently ask for honest feedback, and learn from positive experiences | Routing only satisfied customers to Google |
| **Shield** | Detecting an unhappy experience early so the business can recover the relationship privately | Preventing, intercepting, or filtering negative public reviews |

### Language banned from all ReviewBoost surfaces

Product copy, dashboards, marketing, and internal documents must not contain:

- "Reviews prevented" / "reviews intercepted" / "negative reviews stopped"
- "Only 4- and 5-star customers reach Google"
- "Intercept rate" as a headline metric
- Any threshold-based routing of the public review opportunity

Where this document names those phrases, it names them **as rejected behaviour**.

### The code still implements gating — INSPECTION-CONFIRMED

`qr_stands.review_threshold` exists in the legacy schema and the public route
redirects only at or above it. **The prohibited behaviour is present in the
repository today.** Removing it is required work, not a documentation change.

---

## Part 1 — Process failures that cost real damage

### 1. Work held in unpushed commits was lost

An entire working tree and its git object store were lost with nothing on the
remote. No reflog, no dangling objects, no snapshot.

> **RULE — Push before you build, not after.** Create the repository, push, then
> write code. An unpushed commit does not exist.

### 2. Live secrets were exposed three times

Twilio API key and secret in chat; a Resend key in chat; live `JWT_SECRET` and
`PII_ENCRYPTION_KEY` pasted into `.env.example`, which is a committed file.

The `.env` / `.env.example` filenames differ by eight characters. That is the
whole trap.

> **RULE — Secrets live in `.env` and nowhere else.** Not chat, not
> `.env.example`, not a comment, not a commit message. Anything seen outside
> `.env` is burned; rotate it.

### 3. Two AI agents wrote to the same repository simultaneously

Roughly a thousand lines changed in fifteen minutes while a review was in
progress. Files grew under the reader. Every edit matched a version that no
longer existed.

> **RULE — One writer at a time.** Separate branches or separate directories, or
> stop one.

---

## Part 2 — Legacy backend defects

### REPRODUCED — executed and observed

| Defect | Observation |
|---|---|
| A malformed payload (`{"customers":"x"}`) terminated the process | `curl` returned `000`; the server was gone |
| A corrupt data file terminated the process and crash-looped | Same |
| Authentication had no throttle | 40 wrong keys in ~1s, all `401`, no delay, no lockout |
| Campaign sending was quadratic | 100 → 0.45s, 300 → 2.98s, 500 → **11.2s**, with no network I/O |
| Missing `trust proxy` broke webhook signature verification | A correctly signed request behind `X-Forwarded-Proto: https` returned `403` |
| Dependency vulnerabilities | `npm audit` reported 4; `npm audit fix` cleared them |

**Root cause of the first two:** async route handlers without `try/catch` and no
global error handler. Express 4 does not catch a rejected promise from an async
handler; Node then terminates the process.

> **RULE — Wrap every async handler and always install a terminal error
> handler.**

> **RULE — Rate limit authentication itself, not only expensive endpoints.**

> **RULE — Never perform per-item database or file I/O inside a request loop.**
> If cost grows faster than input, it is broken regardless of how it feels at
> ten items.

### INSPECTION-CONFIRMED — read, not executed

| Defect |
|---|
| No STOP handling, consent record, suppression list, or quiet hours |
| Admin key left as a placeholder value |
| Timing-unsafe credential comparison |
| `localhost` origins present in the production CORS allowlist |
| Session credential stored in `localStorage` |
| Customer phone numbers stored in plaintext on disk |
| Security documentation described encryption the default path did not perform |
| Documentation contained `curl` examples that would return `401` as written |
| A provider webhook was mounted behind admin-key middleware the provider cannot satisfy |
| Registration throttle keyed on IP+email, so varying the email defeated it |
| Email verification implemented but never enforced |
| No CSRF protection |
| No account lockout |
| Missing UUID validation on a delete route |
| Query parameters coerced with bare `Number()`, admitting `NaN` |
| A member-invite endpoint returned distinguishable responses for known and unknown emails |
| Read endpoints performed writes and outbound provider calls |
| Duplicate endpoints and three different error envelope shapes |
| A headline metric was hardcoded to zero |
| A single tenant identifier was hardcoded |
| No billing implementation of any kind |

> **RULE — Never document a security control you have not implemented.**
> Someone will answer a compliance questionnaire from it.

> **RULE — If a document contains a command, run it.**

---

## Part 3 — Defects in a third-party implementation

**All INSPECTION-CONFIRMED.** This code was reviewed as pasted source and was
never executed. Treat the findings as high-confidence reading, not as
reproduction.

### The billing kill switch could not fire

For `invoice.*` events, `event.data.object` is an **Invoice**. Its identifier is
`in_…`, not `sub_…`. Matching it against a subscription column returns no rows.
A reactivation branch additionally tested an Invoice for `status === 'active'`,
which an Invoice never has.

Net effect: payment failure never restricted the account and payment success
never restored it — with no error and no log.

> **RULE — With Stripe, confirm which object type each event actually carries.**

### Tenant isolation that isolated nothing

Two independent reasons: the application connected as the table owner, which
PostgreSQL exempts from row security unless it is forced; and one table had no
policy at all while a dashboard query counted it and claimed isolation.

There was also a latent contradiction — enforcing the policies as written would
have broken login, because the login query runs before any tenant context exists.

### Tenant identity taken from client input

An account identifier was accepted from the request body and used to set the
database tenant context, and a public endpoint returned that identifier. Anyone
who could reach the public endpoint could then write into that tenant.

> **RULE — Derive the tenant from authenticated server-side context. Never from
> a request body, query string, header, or path.**

### String interpolation into the isolation primitive

The tenant identifier was interpolated into SQL rather than bound.

> **RULE — Bound parameters, always — most of all for the value that decides
> data isolation.**

### Other findings

Provider call ordered before the durable write, so a failed write retried the
job and re-sent; naive `length / 160` segment maths; no subscription or
suppression re-check in the worker; HTML-escaping applied at storage rather than
render, corrupting stored text; email canonicalisation that merged distinct
addresses; cookie clearing without matching attributes; unbounded recipient
arrays; registration granting an active subscription with no payment record;
webhook handler returning `200` on internal failure, so the provider never
retried; no pool error listener; and an authentication path whose response time
revealed whether an account existed.

**And it silently removed the entire compliance layer** — consent, suppression,
encryption, and signature verification.

> **RULE — When evaluating a rewrite, diff what it *removes*, not only what it
> adds.**

---

## Part 4 — Defects introduced during the rebuild, and caught

Included because the reviewing process matters more than the reviewer.

| Defect | How it surfaced |
|---|---|
| A predicate named for quiet hours returned true for the *permitted* window | Writing a test |
| Campaign dispatch paged at 500 while campaigns permitted 5,000 | Re-reading the code |
| A helper called without being imported | Module-graph load check |
| An authorisation middleware mounted before the middleware that populates its input — a silent no-op | Route-order review |
| A router mounted after a broader router that shadowed it | Same |
| `\bstop\b` matched "one-stop shop", so those messages shipped with no opt-out instruction | A test written specifically to break the function |
| Network connections opened at module import, making the HTTP layer untestable | Tests hanging |
| A third-party store that issues a command from its constructor | Tests failing at module load |

The opt-out regex is the one worth internalising: **a hyphen is a word boundary**.
It was present in the legacy code as well, and surfaced only because a test tried
to prove the function wrong rather than confirm it.

### Three times the test was wrong, not the code

A segment-count assertion off by one; an ASCII quote used in a test asserting
non-ASCII encoding; and a password fixture that was rejected by a local check
before reaching the code path under test.

> **RULE — When a test fails, first ask whether the test is wrong.** Changing
> code to satisfy a mistaken assertion introduces real defects.

---

## Part 5 — Corrected architectural lessons

These replace earlier guidance in this document that was wrong or too narrow.

### 5.1 Provider send semantics — correcting the idempotency claim

An earlier revision claimed that passing an idempotency key to Twilio's Messages
API prevents duplicate sends. **That claim was wrong and is withdrawn.** The
standard Message creation path does not offer that guarantee, and Twilio's own
guidance attributes duplicate messages primarily to applications issuing
multiple requests.

**Do not promise exactly-once delivery.** It is not achievable across an
application database, a network, a provider, carriers, and a handset.

The achievable design:

- One permanent internal `message_id`
- A database uniqueness constraint expressing the logical send
- An atomic claim of the message before any provider contact
- A separate `message_attempts` row for **every** provider attempt
- The provider SID stored the moment it is returned
- A distinct `provider_unknown` state when the outcome cannot be determined
- **No blind retry after a timeout or broken connection**
- Reconciliation via provider lookup, status callbacks, and operator review
- Webhook events deduplicated independently of send attempts

**The honest promise:** no deliberate duplicate sends; no blind retry after an
ambiguous result; every attempt traceable; uncertain outcomes reconciled before
anything else is sent. At-least-once job delivery, effectively-once business
behaviour.

### 5.2 Row Level Security — rewritten for Supabase

Earlier guidance said "FORCE row level security, always." That came from a direct
-PostgreSQL deployment where the application connected as the table owner. It
does not transfer unexamined to Supabase.

Corrected guidance:

- Supabase Auth remains in its managed schema; do not reimplement it
- **Every tenant-owned table exposed through Supabase APIs has RLS enabled**
- Policies derive membership from `auth.uid()` and trusted membership tables
- Tenant identity is never trusted because it appears in a body, query string, header, or path
- **The service-role key bypasses RLS.** It must never reach a browser, a mobile client, a log, or a public build
- Service-role use is confined to narrow server-only workers, verified webhook processing, migrations, and administrative operations — and even there every query names the organisation explicitly
- Ordinary dashboard requests run as the authenticated user
- Security-definer functions get a fixed safe `search_path`, explicit grants, and `EXECUTE` revoked from `PUBLIC` unless deliberately required
- Exposed views use `security_invoker = true`

Cross-tenant tests must cover select, insert, update, delete, RPC, storage, and
background-worker paths — plus users with no membership, removed members,
location-only access, and anonymous access.

> **RLS is one layer of authorisation, not the whole of it.**

**Status: UNVERIFIED.** No Supabase policy has been written or exercised. Do not
describe tenant isolation as proven until adversarial integration tests have run
against real policies.

### 5.3 Authentication throttling — layered, not either/or

Earlier guidance said "lock the account, not the IP." That is half right and
dangerous alone: account-only locking lets an attacker deliberately lock a victim
out.

Required layers:

- Per-account limits
- Per-IP limits
- Per-device and session-risk limits where available
- Global and per-endpoint limits
- Separate MFA attempt limits
- Credential-stuffing detection
- Progressive delay rather than a hard cliff
- Alerting on suspicious patterns
- **Recovery paths that an attacker cannot use to permanently lock a victim out**

Account-only and IP-only protection are each incomplete.

### 5.4 Messaging compliance — corrected language

An earlier revision asserted a specific per-message dollar liability. **That was
inappropriate and is withdrawn.**

> SMS mistakes can create serious carrier, regulatory, contractual, reputational,
> and financial exposure. Exact liability depends on jurisdiction, facts, consent
> evidence, message type, and applicable law. ReviewBoost requires qualified
> legal and compliance review before production messaging.

The engineering obligations are unchanged and non-negotiable:

- Consent evidence, with purpose and scope recorded
- Opt-in source and timestamp
- STOP, START, HELP and equivalent keyword handling
- Suppression enforced immediately before every send
- Quiet hours evaluated in the recipient's applicable time zone
- Sender-aware and tenant-aware consent semantics
- A2P 10DLC registration where applicable
- Immutable consent history
- Retention and deletion rules
- Provider status reconciliation
- Ongoing compliance monitoring

Never describe the system as "bulletproof", "fully compliant", or legally
approved.

### 5.5 Secret management — beyond a pre-commit hook

A pre-commit hook is useful and insufficient: it protects one machine and is
bypassable with a flag.

Add:

- GitHub secret scanning **with push protection**
- Secret scanning in CI
- Least-privilege provider credentials
- Separate development, preview, and production credentials
- Credential expiry and scheduled rotation
- Spend alerts on Twilio and Stripe
- Restricted production access
- Audit logging of secret access
- A written incident-response procedure
- Immediate rotation on suspected exposure
- Never printing full secret values during diagnostics

---

## Part 6 — Lessons that stand

Accurate, and retained. **None of these are claims that the protection currently
works** — see `STATUS.md` for what has actually been exercised.

| Lesson |
|---|
| One writer at a time |
| Commit small, push immediately |
| Async error boundaries on every handler |
| Queue-based processing for anything that contacts a provider |
| Transactional outbox: state change and event emission in one transaction |
| Durable webhook inbox: verify, deduplicate, store, then process asynchronously |
| Quota as an append-only ledger; mutable counters are projections, not truth |
| Suppression checked immediately before send, not only at campaign build |
| Provider reconciliation for every ambiguous outcome |
| No per-item I/O inside request loops |
| Tenant derived from authenticated server context |
| Parameterised SQL everywhere |
| Test the tests — a failing test may itself be wrong |
| Documentation that overstates security is worse than none |
| Diff what a rewrite removes |
| Distinguish "not done yet" from "I cannot do this" |
| Money in integer minor units; provider cost in micro-units |
| Unrun code is a guess with syntax highlighting |

---

## Part 7 — Process observations worth keeping

**Parallel agent fan-out failed on budget exhaustion** and returned nothing,
costing a full session. Check capacity before fanning out.

**An AI assistant does not work between messages.** Nothing progresses while you
are away. Work framed as "continuing in the background" is not happening.

**Blocked is not the same as unfinished.** Tasks requiring credentials or
infrastructure the assistant cannot reach should be labelled blocked immediately,
not carried on a list as pending.

---

## Part 8 — What was done well

- Repeated requests for adversarial review, without pushback when the answers were unflattering
- A secret pasted into the wrong file was noticed before it was committed
- Credential rotation performed immediately when advised
- A concurrent writer was stopped once the conflict was explained
- Requests to explain the system in non-specialist terms, rather than accumulating unevaluable code
- Requesting this retrospective rather than rebuilding and repeating

The failures above are process and craft. Both are learnable.

---

## Appendix — Primary sources

Consult these directly rather than relying on summaries in this document.

- Google — user-contributed content policy (prohibited and restricted content), including rules on discouraging or selectively soliciting reviews
- Supabase — Row Level Security documentation, and API-key / service-role security guidance
- Twilio — messaging compliance, Advanced Opt-Out, A2P 10DLC registration, and duplicate-message guidance
- Stripe — webhook delivery semantics, including duplicate and out-of-order delivery, and idempotency
- NIST — Secure Software Development Framework (SP 800-218)
