# ReviewBoost Backend

Multi-tenant SaaS backend for SMS review campaigns and QR/NFC review gating.

---

## Layers

Dependencies point one way. A layer may import from those below it, never above.

```
http/          Express: routing, validation, auth middleware, error shaping
   ↓
services/      Business rules and orchestration. No SQL, no req/res.
   ↓
repositories/  All SQL. One function per query. Tenant-scoped.
   ↓
db/            Pool, transactions, RLS context, migrations
   ↓
domain/        Pure functions. No I/O. Depends on nothing.
```

`domain/` holds the rules that must never be wrong — SMS segmentation, money,
phone normalisation, TCPA compliance, crypto. It has zero dependencies, which is
why it is fully unit-tested without any infrastructure.

```
src/
├── config/index.js          Boot-time env validation. The only process.env reader.
├── logger.js                JSON logs, request ids, recursive PII redaction
├── domain/                  Pure logic
│   ├── sms.js                 GSM-7 160/153 · UCS-2 70/67
│   ├── pricing.js             Integer cents only
│   ├── phone.js               E.164 or rejection
│   ├── templates.js           Variable substitution
│   ├── compliance.js          STOP, consent, quiet hours
│   ├── crypto.js              AES-256-GCM + keyed HMAC
│   ├── passwordSafety.js      HIBP k-anonymity
│   └── deviceFingerprint.js   Coarse device recognition
├── db/{pool,migrate}.js
├── repositories/            All SQL (7 files)
├── services/                Auth, MFA, billing, campaign, QR, SMS, email (10 files)
├── queue/                   BullMQ + 2 workers
├── http/                    app, errors, schemas, 5 middleware, 7 route files
├── server.js                API entrypoint
├── worker.js                Worker entrypoint — scale by running more
└── maintenance.js           Scheduled job entrypoint
```

---

## Decisions that carry weight

### Tenant isolation

Every tenant table has an RLS policy on `account_id`, bound per transaction:

```js
await client.query('SELECT set_config($1, $2, true)', ['app.current_account_id', accountId]);
```

Three details are load-bearing:

1. **Bound parameter, never interpolation.** This is the one value that decides
   data isolation; interpolating it would be an injection vector on exactly the
   wrong thing.
2. **`true` makes it transaction-local.** A session-level setting would survive
   the connection returning to the pool and leak tenant context into whichever
   request checked it out next.
3. **`FORCE ROW LEVEL SECURITY`.** PostgreSQL exempts the table *owner* from row
   security by default, and managed Postgres hands you an owner role. Without
   `FORCE`, every policy is silently inert — the schema looks correct and
   isolates nothing. A test asserts `relforcerowsecurity` on all nine tables.

Auth and billing tables are deliberately **outside** RLS: they must be readable
before a tenant context exists (login) or entirely outside one (Stripe
webhooks). A policy of `id = current_account_id()` on `accounts` makes login
impossible. Those are scoped explicitly in the repository layer instead.

Provider callbacks arrive with no tenant context at all. Rather than loosening
the policies, they go through `SECURITY DEFINER` functions that derive the
tenant from the row they touch and can affect exactly one.

### Authentication

- **Access token** — JWT, 15 minutes, carries `sub`, `act`, `role`, `tv`.
- **Refresh token** — 48 random bytes, stored only as an HMAC, rotates on use.

Presenting an already-revoked refresh token proves a leak: the legitimate client
would hold its replacement. The whole family is revoked and the user emailed.

`token_version` is compared on every request, so a password change or
"sign out everywhere" retires outstanding access tokens immediately rather than
waiting up to 15 minutes.

Membership is re-read per request. A removed member loses access on their next
call, not at token expiry.

**Lockout counts against the target email**, not the caller's address —
IP-keyed limiting is defeated by a botnet. Failed MFA attempts count toward the
same lockout: holding a stolen password must not buy unlimited attempts at the
second factor.

The MFA challenge token uses a **distinct JWT audience**, so it cannot be
presented as an access token and vice versa. A test asserts this.

### The subscription kill switch

Three independent enforcement points, because one check is a single point of
failure for revenue:

1. `requireActiveSubscription` on every route that costs money — re-reads
   billing state rather than trusting the token
2. the campaign worker before dispatch, and the SMS worker before *each* send —
   a subscription can lapse mid-campaign
3. `expireLapsedTrials` in the maintenance job, for trials Stripe never sends an
   event about because no card was attached

Read paths stay open when a subscription lapses. A locked-out customer who
cannot see their data or reach the billing portal does not convert back.

**Stripe webhook correctness.** For `invoice.*` events, `event.data.object` is
an *Invoice*, so its `.id` is `in_…`. Using it to look up a subscription matches
zero rows — payment failures never lock the account, nothing errors, and revenue
enforcement just quietly stops. `resolveAccount()` handles this explicitly:
subscription id → `invoice.subscription` (which moved location in 2025 API
versions) → customer id → metadata.

Handling is exactly-once via a claim table, and a processing failure returns
**500 so Stripe retries** — returning 200 on failure strands the account
permanently while Stripe believes delivery succeeded.

### Campaign sending

Creating a campaign costs a **fixed** number of round trips regardless of
recipient count: two bulk lookups, one atomic quota reservation, one bulk
insert, one enqueue. The request returns `202` in milliseconds.

The previous design did several reads and writes *per recipient* inside the HTTP
request. That is quadratic — 500 recipients took eleven seconds with no network
I/O at all, and a real send would have exceeded a proxy timeout mid-campaign
with no way to know who had already been texted.

**Duplicate sends are blocked three ways**, because texting someone twice costs
money and is a compliance problem:

- BullMQ `jobId: message:<uuid>` collapses duplicate enqueues
- the worker refuses any message not still `queued`
- Twilio receives an idempotency key

### Money

Every monetary value is an integer count of cents. `domain/pricing.js` throws on
a non-integer rather than rounding, and `parseAmountToCents` is exact where
`Number('0.29') * 100` is not.

Segment counting follows the carrier rules exactly — GSM-7 160/153, UCS-2 70/67
— because a naive `length / 160` under-bills every Unicode message. One emoji
forces the whole message to UCS-2 and less than half the capacity.

### PII

Phone numbers, names, and feedback are AES-256-GCM encrypted at rest with a
fresh IV per value. Equality lookups use a **keyed HMAC**: there are only ~10¹⁰
NANP numbers and 2³² IPv4 addresses, so an unsalted digest of either is
reversible by exhaustive search in seconds.

Logs redact a fixed key list recursively — the realistic leak is a nested
provider error echoing a recipient back, not someone logging a password.

### Rate limiting

Two Redis connections with **opposite** settings, which matters:

- **Queue** — `maxRetriesPerRequest: null`. A job must never be lost.
- **Rate limit** — fails fast, `enableOfflineQueue: false`. The queue's settings
  here would hang every HTTP request whenever Redis was down.

`ResilientRateLimitStore` degrades to per-process memory with a circuit breaker,
**except on authentication**, which fails closed: a memory fallback hands an
attacker `instances ×` the brute-force budget, and a briefly unavailable sign-in
page is the smaller problem.

The scan limiter is keyed **per stand**, not per IP — every customer in a
restaurant shares one NAT address, and an IP-keyed limit would block real
customers at exactly the busiest moment.

### QR / NFC gate

`GET /q/:publicId` → record scan → rating gate → high ratings redirect to
Google, low ratings captured privately.

The tenant is **always derived server-side from the stand**. The public
endpoints never accept an account id and never return one — otherwise anyone
could scan a code, harvest the account id, and write unlimited fabricated
feedback into that tenant. A test asserts the id never appears in the response.

`public_id` is 16 bytes of entropy, separate from the primary key, so internal
ids are never exposed and stands cannot be enumerated.

Scan dedupe is a single `INSERT ... WHERE NOT EXISTS` inside a `SECURITY
DEFINER` function — a read-then-write check would let concurrent scans both pass.

---

## Running it

```bash
docker compose up          # postgres + redis + migrations + api + worker
```

Locally:

```bash
cd backend
cp .env.example .env       # fill JWT_SECRET and PII_ENCRYPTION_KEY
npm ci
npm run migrate
npm start                  # API
npm run worker             # separate terminal
npm run maintenance        # on a schedule
```

Generate the two required secrets:

```bash
openssl rand -base64 48    # JWT_SECRET
openssl rand -base64 32    # PII_ENCRYPTION_KEY
```

`PII_ENCRYPTION_KEY` is **not rotatable** without re-encrypting existing rows.
Store it in a managed secret store and include it in backup procedures — losing
it makes every encrypted column permanently unreadable.

## Testing

```bash
npm test              # 209 tests, no infrastructure required
npm run test:unit
TEST_DATABASE_URL=postgres://... npm run test:integration
```

The HTTP suite runs with **no Postgres and no Redis on purpose**: the security
contract must hold regardless of backing services, and proving that cheaply on
every push is the point.

The database suite skips itself unless `TEST_DATABASE_URL` is set. CI provides
one, so RLS isolation, atomic quota reservation, scan dedupe, and account
lockout are proven against real Postgres on every push.

## Scaling notes

At 5,000 businesses the constraints in order:

1. **SMS throughput** — carrier and Twilio per-number limits, not this code.
   Add sender numbers, raise `SMS_PER_SECOND_LIMIT`, add worker replicas.
2. **Database connections** — `DATABASE_POOL_MAX` × instances must stay under
   the server limit. Add PgBouncer before adding instances.
3. **`messages` table growth** — partition by month past a few hundred million
   rows.

The API is stateless. Sessions live in Postgres, rate limits and queues in
Redis, so instances can be added and removed freely.
