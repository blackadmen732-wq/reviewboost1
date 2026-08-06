# ReviewBoost — Every Mistake, and the Rule That Prevents It

A complete retrospective. Nothing softened, including my own errors.

Ordered by what it actually cost, not by how technical it sounds.

---

## Part 1 — The three that cost real damage

### 1. Two days of work sat in one unpushed commit, then vanished

**What happened.** The entire project was deleted — working tree *and* the git
object store. `.git/objects` was empty, no reflog, no dangling commits. My own
`/tmp` snapshots were gone too. Nothing had ever reached GitHub.

**Cost:** roughly two days of work, unrecoverable.

**Why it happened.** Everything was committed locally in one batch at the end,
and pushing was treated as the last step rather than the first.

> **RULE 1 — Push before you build, not after.**
> Create the repo, push an empty commit, *then* write code. Push after every
> batch. An unpushed commit does not exist.

**Now enforced by:** commits after every batch in the rebuild — 5 commits instead
of 1. Still your job to actually run `git push`.

---

### 2. Live secrets pasted into chat — three times

**What happened.** Across the conversation:

- Twilio API Key SID + Secret pasted into chat
- Resend API key pasted into chat
- A live `JWT_SECRET` and `PII_ENCRYPTION_KEY` pasted into `.env.example` — a file that **is committed to git**

**Cost:** two credential rotations, and it was pure luck the `.env.example` edit
was caught before being committed.

**Why leaked Twilio keys matter specifically.** Attackers scrape them and run
international premium-rate traffic. The bill is yours and can reach thousands
overnight.

**The `.env` vs `.env.example` trap.** The names differ by eight characters. One
is gitignored, one is committed. You edited the wrong one, and the secrets in it
were your *live* values.

> **RULE 2 — Secrets go in `.env` and nowhere else. Ever.**
> Not chat. Not `.env.example`. Not a comment. Not a commit message.
> If a secret is ever visible outside `.env`, treat it as burned and rotate it.

**Now enforced by:** a pre-commit hook that blocks any commit containing a
populated secret assignment or a live-key pattern (`re_…`, `sk_live_…`, `SK…`,
`AC…`), plus a CI job that fails the build on the same patterns. The hook has
already blocked one real commit.

---

### 3. Two AI agents edited the same repo at the same time

**What happened.** Mid-audit, files started changing under me — ~1,000 lines in
15 minutes. `index.js` grew 538 → 645 → 833 lines while I was reading it. New
files appeared. Then the frontend started being restructured too.

**Cost:** an entire session of my work was unusable, and it is genuinely possible
this contributed to the loss in Part 1.

**Why it is worse than it sounds.** Two agents both running "refactor the whole
repo" produce half-merged code that is harder to untangle than starting over.
Every `Edit` matches against a version that no longer exists.

> **RULE 3 — One writer at a time.**
> If two tools have write access, stop one. If you want parallel work, give them
> separate branches or separate directories.

---

## Part 2 — Security bugs in the original code

Every one of these I **verified by running it**, not by reading.

### Critical — the app could be killed by anyone with a valid key

| # | Bug | Proof |
|---|---|---|
| 1 | `POST {"customers":"x"}` crashed the entire process | `curl` → `status=000`, server gone |
| 2 | A corrupt data file crashed it and crash-looped forever | same |

**Root cause of both:** nine `async` route handlers with no `try/catch`, and no
global error handler. Express 4 does **not** catch a rejected promise in an async
handler; Node 22 then kills the process by default.

> **RULE 4 — Every async handler is wrapped, and there is always a global error
> handler.** One `asyncRoute` helper. No exceptions.

### Critical — unlimited password guessing

40 wrong keys in ~1 second, all `401`, no throttle, no lockout, no alert:

```
401 401 401 401 401 ... (40×, no delay)
```

One static shared key protected all customer PII and all Twilio spend.

> **RULE 5 — Rate limit *authentication*, not just expensive endpoints.**
> And lock the *account*, not the IP — a botnet defeats IP limiting.

### Critical — sending was quadratic

Measured, dry-run, zero network I/O:

| Recipients | Time |
|---|---|
| 100 | 0.45s |
| 300 | 2.98s |
| 500 | **11.2s** |

5× the load cost 25× the time. Per recipient it did 3 file reads + 2 full-file
writes against a file that grew as it went. With real Twilio, a 500-person
campaign would have blown any proxy timeout mid-send, with **no record of who
had already been texted**.

> **RULE 6 — Never do per-item I/O in a request loop.**
> Bulk query, bulk insert, then queue. If cost grows faster than input, it is
> broken regardless of how fast it feels at 10 items.

### Critical — no TCPA compliance at all

No STOP handling. No consent tracking. No quiet hours. No suppression list.

A recipient **literally could not opt out**. In the US that is $500–$1,500 per
message, statutory. One 500-person campaign done wrong is a potential
$750,000 problem.

> **RULE 7 — For SMS, compliance is not a feature. Build STOP, consent, and
> quiet hours before the first real send.**

### High

| # | Bug | Why it matters |
|---|---|---|
| 8 | No `app.set('trust proxy')` | Twilio signs `https://`, Express saw `http://` → **every delivery receipt silently 403'd**. Verified. |
| 9 | Admin key was the literal placeholder `change_me_demo_key` | |
| 10 | Twilio webhook sat *behind* the admin-key middleware | Twilio cannot send that header. The webhook was dead by design. |
| 11 | Timing-unsafe key comparison (`!==`) | |
| 12 | `localhost` origins in the production CORS allowlist | Any page reaching localhost gained a browser-trusted path to prod |
| 13 | Access key in `localStorage` | XSS-exfiltratable, no expiry, unrevocable without a restart |
| 14 | Real phone numbers in plaintext JSON on disk | No encryption, no retention policy |
| 15 | Real Twilio creds had been used with `dryRun: false` | Real SMS had gone to a real number |
| 16 | 4 npm vulnerabilities (axios prototype pollution, body-parser DoS, postcss) | |

### The documentation lied about security

`SECURITY.md` stated PII was AES-256-GCM encrypted and consent was required.
Both were true **only** on the Supabase path. The *default* configuration wrote
plaintext JSON with no consent checks.

> **RULE 8 — Docs that overstate security are worse than no docs.**
> Someone answers a compliance questionnaire from them.

Also: `TESTING.md`'s own `curl` examples omitted the auth header. Every one would
have returned `401`.

> **RULE 9 — If a doc contains a command, run it.**

### Medium

| # | Bug |
|---|---|
| 17 | Registration limiter keyed on `IP + email` → vary the email, get unlimited signups |
| 18 | Email verification fully built, never enforced anywhere |
| 19 | No CSRF protection |
| 20 | No account lockout |
| 21 | Missing UUID validation on `DELETE /members/:userId` |
| 22 | `?size=` and `?days=` bypassed validation → `NaN` into a renderer |
| 23 | Member invite returned `404` vs `201` → email enumeration oracle |
| 24 | Frontend threw away `error.status`, so it could not tell 401 from 500 |
| 25 | `GET` endpoints triggered writes *and* Twilio calls — one took **9.0s**, and the UI polled it every 5s |
| 26 | Duplicate endpoints (`/send` and `/send-sms` identical) |
| 27 | Three different JSON error shapes |
| 28 | `reviewsReceived` hardcoded to `0` and shown as a headline metric |
| 29 | Single hardcoded tenant: `const ACTIVE_ACCOUNT_ID = 'local-demo-account'` |
| 30 | No billing code whatsoever — grepped for `cents|stripe|price|cost`: zero hits |

---

## Part 3 — Bugs in the version another AI produced

You brought me a "final backend." It had good architectural instincts and would
have lost you money in specific, quiet ways.

### The kill switch could never fire

```js
const subscription = event.data.object;
UPDATE accounts SET status='past_due' WHERE stripe_subscription_id = subscription.id;
```

For `invoice.*` events, `event.data.object` is an **Invoice**. Its `.id` is
`in_1ABC…`, not `sub_1ABC…`. **That WHERE matched zero rows, every time.**

And the reactivation branch checked `subscription.status === 'active'` — an
Invoice's status is `paid`/`open`/`void`, never `active`. So that never fired
either.

Net effect: payment failure never locked anyone out, payment success never
unlocked anyone. **No error. No log.** You would find out from a revenue chart
months later.

> **RULE 10 — With Stripe, always check what object type an event actually
> carries.** Invoice ≠ Subscription.

### RLS that isolated nothing

Two independent reasons it did not work:

1. **The table owner bypasses RLS.** You run the schema as the same user in
   `DATABASE_URL`, so every policy was inert. `FORCE ROW LEVEL SECURITY` is
   required.
2. **`qr_scans` had no RLS at all** — yet the dashboard counted it inside
   `runWithRLS()` and claimed isolation. Every tenant would have seen the
   **global** scan count.

And the trap: *fixing* RLS would have broken login, because `SELECT … FROM
accounts WHERE email = $1` runs with no tenant context.

> **RULE 11 — `FORCE ROW LEVEL SECURITY`, always. And keep auth tables outside
> RLS deliberately, scoped in code instead.**

### Anyone could write to any tenant

```js
body('accountId').isUUID()      // ← from the request body
await runWithRLS(accountId, …)  // ← attacker-supplied
```

And `/q/:stand_id` **returned the account id publicly**. So: scan any QR →
harvest the tenant id → inject unlimited fake 1-star feedback.

> **RULE 12 — Never take the tenant from client input. Derive it server-side.**

### SQL injection in the isolation primitive

```js
await client.query(`SET LOCAL app.current_account_id = '${accountId}'`);
```

String interpolation into the one value that decides data isolation.

> **RULE 13 — Bound parameters, always.** `set_config($1, $2, true)`.

### Other real bugs in that version

| # | Bug | Consequence |
|---|---|---|
| 14 | Twilio send happened *before* the DB write; a failed insert retried the job | Customer texted up to **3 times** |
| 15 | `Math.ceil(len/160)` for segments | Undercharged every Unicode message |
| 16 | Worker never checked subscription or suppression | Cancelled accounts kept spending your money; STOP ignored |
| 17 | `.escape()` on stored feedback | `it's` permanently became `it&#x27;s` in the database |
| 18 | `normalizeEmail()` default | `a.b@gmail.com` and `ab@gmail.com` collapsed into one account |
| 19 | `clearCookie('token')` with no options | Logout did not reliably log out |
| 20 | No CORS at all + `SameSite=Lax` | Cookie auth would simply not work with a separate frontend |
| 21 | `recipients` array with no `max` | One request could queue 1,000,000 texts |
| 22 | Registration set `subscription_status='active'` with no Stripe customer | Everyone got a free account forever |
| 23 | Webhook swallowed DB errors and returned `200` | Stripe never retries; account stuck permanently |
| 24 | No `pool.on('error')` | An idle client error kills the process |
| 25 | Login skipped bcrypt when the email did not exist | Timing oracle for enumerating accounts |
| 26 | CommonJS, port 3000, raw `pg` | Structurally incompatible with your ESM/Supabase/4000 codebase |

**And it silently deleted your compliance layer** — consent, suppression, PII
encryption, webhook signature verification, all gone.

> **RULE 14 — "Newer" is not "better." Diff what a rewrite *removes*, not just
> what it adds.**

---

## Part 4 — Bugs I introduced during the rebuild, and caught

I am including these because you should know your AI makes mistakes too, and
that catching them is a *process*, not luck.

| # | My bug | How it surfaced |
|---|---|---|
| 1 | `isWithinQuietHours()` returned `true` for the *allowed* window — name backwards from behaviour | Writing a test |
| 2 | Campaign dispatch capped at 500 while campaigns allow 5,000 — would silently drop 90% | Re-reading my own code |
| 3 | Used `rawQuery()` without importing it — would have thrown on first login | Module-graph load check |
| 4 | `enforceIpAllowlist` mounted *before* `requireAuth`, so `req.auth` was undefined and it did **nothing** | Route-order review |
| 5 | MFA router mounted *after* `/api/auth`, which shadowed it | Same |
| 6 | **`\bstop\b` matched "one-stop shop"** — a hyphen is a word boundary, so those messages shipped with **no opt-out instruction** | A test I wrote specifically to try to break it |
| 7 | Redis connections opened at module import, making the HTTP layer untestable | Tests hanging |
| 8 | `rate-limit-redis` throws from its *constructor* when Redis is down | 7 tests failing at module load |

Number 6 is the one I want you to notice: **it was a per-message statutory
violation, it existed in the previous version too, and it only surfaced because
I wrote a test trying to prove my own code wrong.**

### And three times my *test* was wrong, not the code

- Asserted 201 UTF-16 units = 4 segments. It is 3. (`201 ÷ 67 = 3.0` exactly.)
- Used `"` (plain ASCII) in a test asserting UCS-2. It is GSM-7; I meant `"`.
- Asserted `password123` returns a breach count. It is caught by the local
  obvious-password list first, before any network call.

> **RULE 15 — When a test fails, first ask whether the *test* is wrong.**
> Three of my failures were bad fixtures. Changing the code would have introduced
> real bugs to satisfy a wrong assertion.

---

## Part 5 — What was simply never built

Not bugs. Gaps nobody noticed until the audit.

| Missing | Consequence |
|---|---|
| **Any billing at all** | The product could not take money |
| **Any signup** | Customers could not onboard themselves |
| **Multi-tenancy in the default path** | One hardcoded account |
| **Contacts as entities** | "Customer management" was impossible — customers existed only as fields on messages |
| Password reset, email verification | Could not support real users |
| Any test at all (originally) | Two crash bugs shipped |
| Docker, CI | "Works on my machine" |
| Monitoring, alerting | Nothing notices 10,000 failed logins |
| Backups, restore drill | |
| Graceful shutdown | Every deploy abandoned in-flight sends |
| `/health`, `/ready` | Cannot run behind a load balancer |
| Structured logging, request IDs | "It broke at 2pm" was uninvestigable |
| **`segment_count` persisted** | Segments were calculated, then thrown away — no cost reconciliation possible |
| NFC, hardware ordering, print templates | The physical product |
| Google Business Profile | `reviewsReceived` was hardcoded `0` |

---

## Part 6 — My own process mistakes

### I launched 8 parallel agents and they all failed

Credit balance exhausted. Returned nothing. Wasted a session and I had to
re-derive everything serially.

> **RULE 16 — Check the budget before fanning out.**

### I said "I'll do X" and then couldn't

I said I would work while you were away. **I cannot.** I only run when you send a
message. I said this once and then still framed work as if it were continuing in
the background.

> **RULE 17 — Your AI does not work while you sleep.** Nothing happens between
> your messages.

### I twice offered to fix things I could not reach

`docker compose up` — no Docker in my environment. `git push` — no credentials.
Both were on my task list for hours before I said clearly that they were
permanently blocked on you.

> **RULE 18 — Separate "not done yet" from "I cannot do this."**

---

## Part 7 — The single biggest one, still open

**None of the SQL has ever run.**

Across both the original and the rebuild, the database schema has never executed.
22 tables, 10 SQL functions, 4 migrations — written carefully, tested nowhere.

The tests that prove tenant isolation exist and **have never executed once**.

> **RULE 19 — Unrun code is not code. It is a guess with syntax highlighting.**
>
> ```bash
> docker compose up
> curl http://localhost:4000/api/ready
> ```

---

## The rules, in one place

Pin this above your desk.

| # | Rule |
|---|---|
| 1 | Push before you build. An unpushed commit does not exist. |
| 2 | Secrets live in `.env` and nowhere else. Ever. |
| 3 | One writer at a time. |
| 4 | Wrap every async handler. Always have a global error handler. |
| 5 | Rate limit authentication. Lock the account, not the IP. |
| 6 | Never do per-item I/O in a request loop. |
| 7 | For SMS, build STOP + consent + quiet hours before the first real send. |
| 8 | Never document security you have not implemented. |
| 9 | If a doc contains a command, run it. |
| 10 | With Stripe, check what object type each event carries. |
| 11 | `FORCE ROW LEVEL SECURITY`, always. Keep auth tables outside it deliberately. |
| 12 | Never take the tenant from client input. |
| 13 | Bound parameters, always. |
| 14 | Diff what a rewrite *removes*, not just what it adds. |
| 15 | When a test fails, first ask whether the test is wrong. |
| 16 | Check the budget before fanning out. |
| 17 | Your AI does not work while you sleep. |
| 18 | Separate "not done yet" from "I cannot do this." |
| 19 | Unrun code is a guess with syntax highlighting. |

---

## What you actually did well

Worth saying, because the list above is long and it is not the whole picture.

- **You asked for brutal audits repeatedly**, and did not argue when the answers
  were unflattering. That is the rarest and most valuable habit here — most
  people ask for reassurance.
- **You caught the `.env.example` mistake yourself** by noticing something looked
  wrong, before it was committed.
- **You rotated the Twilio key immediately** when told, without debating it.
- **You stopped the second agent** when the conflict was explained.
- **You asked "explain it like I'm not a developer"** — understanding your own
  system beats accumulating code you cannot evaluate.
- **You asked for this document.** Most people rebuild and repeat.

The product thinking was never the problem. The Amplifier/Shield mechanism is
genuinely good — it was already the best part of the original code, before it had
a name. Every failure above is process and craft, and both are learnable. The
idea was never in question.
