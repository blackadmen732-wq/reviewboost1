# ReviewBoost Text Requests — backend foundation

The production-grade backend for sending a simple review-request SMS
("How was your visit? Tap here to leave a review: …") that lands the customer
in the same `/q/<opaque-token>` flow QR codes and NFC tags already use. Owner
language is **Text Requests**, never "campaigns"; there is no marketing/promotion
path here, by design.

**PostgreSQL is the source of truth.** Consent, message state, quota, billing,
suppression, the outbox, and the webhook inbox are all durable Postgres tables.
Nothing authoritative lives in application memory or an in-memory queue. This is
technical compliance and reliability infrastructure — not a claim of legal SMS
certification.

## Status legend

- **[impl]** implemented in this PR
- **[test-ci]** covered by automated tests that run in CI (`vitest` and/or the
  `supabase test db` pgTAP suite)
- **[needs-provider]** requires a real SMS provider account/credentials to run
  for real
- **[needs-live]** requires an actual send/receive against a live carrier to be
  considered verified — not provable in CI

---

## 1. Reuse of existing infrastructure

Audited before building; reused rather than duplicated:

- **Tenancy & RLS helpers** — `app.is_org_member`, `app.has_org_role`,
  composite `(id, org_id)` foreign keys, the `app`-private-schema +
  `public.rpc_*`-wrapper pattern.
- **Idempotency / rate limits / audit** — `app.consume_rate_limit`,
  `public.audit_events`, the existing idempotency ledger conventions.
- **Crypto** — the same AES-256-GCM `encrypt`/`decrypt` and domain-separated
  keyed `keyedDigest` already used for notes and stand tokens.

What was **missing**: there was no phone number anywhere in the system (the
customer flow is deliberately anonymous), and no consent, suppression, quota,
outbox, webhook-inbox, or message model. Those are what this PR adds.

## 2. Schema (migrations `20260902000100`–`000700`)

| Table | Purpose |
| --- | --- |
| `sms_consent_events` | append-only consent ledger **[impl][test-ci]** |
| `sms_consent_state` | current-consent projection (cache, not truth) **[impl][test-ci]** |
| `sms_suppressions` | durable suppression (opt-out, STOP, compliance, dedupe windows) **[impl][test-ci]** |
| `text_requests` | one intended review-request message, explicit state machine **[impl][test-ci]** |
| `sms_delivery_attempts` | per-provider attempts; single-in-flight guard **[impl][test-ci]** |
| `sms_outbox` | transactional outbox with lease/retry/dead-letter **[impl][test-ci]** |
| `sms_webhook_inbox` | durable, deduplicated provider events **[impl][test-ci]** |
| `sms_quota_ledger` | append-only usage/billing ledger **[impl][test-ci]** |
| `sms_quota_balance` | quota projection (cache, not truth) **[impl][test-ci]** |

Phone numbers are stored exactly as tokens are: `*_phone_hash` (keyed HMAC, the
match key), `*_phone_encrypted` (AES-256-GCM, for read-back), `*_last_four`
(recognition). The raw number never reaches a query and never sits in clear.

## 3. Consent architecture **[impl][test-ci]**

Consent is an **event** (`customer / phone / org / purpose / status / source /
timestamp / location / evidence`), appended and never overwritten. States:
`opted_in`, `opted_out`, `unknown`. The existence of a phone number is **never**
consent — an unrecorded number is `unknown`, which blocks sending. `sms_consent_state`
is a projection maintained in the same transaction as the event it reflects.

## 4. Suppression & the pre-send gate **[impl][test-ci]**

`app.sms_can_send(org, phone_hash, purpose)` is the single authoritative
answer. It blocks in this order: a **phone-level opt-out** (see §5) first, then
consent = `opted_in`, then no active suppression. Suppression reasons:
`opt_out`, `stop_keyword`, `compliance`, `hard_bounce`, `recent_send`,
`completed_flow` (dedupe window), `manual`. Permanent reasons never expire;
dedupe reasons carry an `expires_at`. **The gate runs again in
`app.sms_begin_dispatch`, immediately before the provider call** — not only at
schedule time — so a STOP that arrives after scheduling still stops the send.

## 5. STOP / START / HELP **[impl][test-ci]**

`classifyKeyword` (TS) normalises case/whitespace and matches an exact keyword as
the first word (or "OPT OUT"/"OPT IN") — no fuzzy matching. `app.sms_apply_inbound_keyword`
applies it idempotently to every org that has a consent relationship with the
number: STOP → `opted_out` + `stop_keyword` suppression; START → `opted_in` +
clears only the customer's own stop/opt-out (never a compliance hold); HELP →
no consent change.

**Phone-level opt-out (STOP before any consent).** A STOP is a fact about the
number, not one org. `app.sms_apply_inbound_keyword` records the intent in
`sms_phone_optout` (keyed by `phone_hash`, org-agnostic) *before* the per-org
loop, so a STOP from a number no business has ever texted is still honoured; the
gate checks it ahead of consent. A later owner import cannot override it — **only
the customer's own START clears it**. pgTAP covers the full STOP-before-consent →
owner-opt-in → START sequence and STOP idempotency on retry.

**Ordering limitation (documented, not faked).** Twilio's inbound webhook payload
carries **no trustworthy customer send-time** to order two keywords by, so no
event timestamp is invented. Ordering therefore follows verified provider
arrival/processing order: exact duplicate/retry processing is idempotent
(`sms_record_consent` dedupes, suppression upserts are idempotent, the phone-level
record is a single-row upsert), concurrent processing for one identity is
serialised by an advisory lock in `sms_record_consent`, and a legitimate later
START always reverses a prior STOP. Where a stronger provider ordering signal
does not exist, last-verified-arrival wins — deliberately, and STOP is never made
permanently sticky against a genuine later START.

## 6. Message state machine **[impl][test-ci]**

`scheduled → queued → sending → submitted → delivered` with branches to
`suppressed`, `failed`, `provider_unknown`, `cancelled`. Edges are enforced by
`app.sms_request_transition_allowed`; there is no mutable `sent=true` boolean.
`provider_unknown` (a timeout after submit) is **never auto-retried** and keeps
its quota reserved until a durable reconciler resolves it: attach a looked-up
SID (and replay any parked receipts), or fail+release. The reconciler never
sends.

## 7. Delivery attempts & duplicate protection **[impl][test-ci]**

Each attempt records provider, provider message id, dispatch time, normalized
error class, reconciliation state. A **partial unique index** allows at most one
`created`/`dispatched` attempt per request — the duplicate-send guard.
`app.sms_settle_attempt` is idempotent (a redelivered settle for an already-settled
attempt is a no-op, so quota is never re-consumed). A request left in `sending` by
a worker that died mid-send is **recovered** on the next claim: `begin_dispatch`
parks it (and its open attempt) as `provider_unknown` for reconciliation rather
than re-sending or leaving it stuck forever. pgTAP covers both.

## 8. Transactional outbox **[impl][test-ci]**

`app.sms_schedule_request` commits the `text_requests` row, the quota
reservation, and the `sms_outbox` job in one transaction. Workers claim with
`app.sms_outbox_claim` (FOR UPDATE SKIP LOCKED + lease), so many workers are
safe and a crashed worker's lease is reclaimable. `complete`/`fail`/`defer` are
**lease-owner guarded**, so a stale worker cannot mutate a job another worker has
reclaimed. Failures back off exponentially; `max_attempts` sends a job to
`dead_letter` (a durable "needs a human"), never a silent drop — including an
expired-lease job that has already used all its attempts. A dead-lettered job
whose request is still `queued` (retryable 429 path) **fails the request and
releases its reservation in the same transaction**. A dead-letter while the
request is `sending` parks it as `provider_unknown` and keeps the reservation
(the provider may already have accepted the message). Entering
`provider_unknown` enqueues a `sms.reconcile` outbox job (idempotent) with
`available_at = now() + 30 seconds` so a same-tick empty Twilio list cannot
release a send Twilio is still accepting. Dispatch claim is topic-filtered so
it cannot pick reconcile work. A lookup of `not_found` within two minutes of
`dispatched_at` is treated as `unknown` (Twilio may still be accepting). A
reconcile dead-letter **fails+releases** (lookup never confirmed a SID; still
never a re-send). `fail_outbox` is retried in the worker; a lost write leaves
the job leased until expiry, then the same terminal SQL paths run.

## 9. Webhook inbox **[impl][test-ci]**

Signature is **verified before** the deduplicated write, so an unverified request
can never occupy a real event's `(provider, dedupe_key)` and suppress the
authentic retry — unverified payloads are captured under a separate `unverified:`
namespace and rejected (HTTP 403). A verified event is written by
`app.sms_webhook_receive`; a genuine already-`processed` duplicate is a no-op,
but a retry of an event that never reached `processed` (a transient failure) is
**reclaimed for reprocessing** (all business handlers are idempotent). The
`processed` settle is error-checked so a lost settle leaves the row reclaimable
rather than acknowledged-and-skipped. A terminal delivery receipt that arrives
before the attempt records its provider message id is **parked by SID**
(`pending_terminal`) and acknowledged with HTTP 200; `app.sms_settle_attempt`
**and `app.sms_reconcile_attach_sid` replay it in the same transaction** that
persists the SID — including timeout-after-accept, where the provider accepted
but we never stored the SID. Recovery does not depend on an unsolicited
provider retry. The raw body is stored encrypted.

## 10. Provider boundary **[impl]** / Twilio **[needs-provider]**

`SmsProvider` (`send`, `lookup`, `classifyError`, `verifySignature`, `parseWebhook`) is the
only thing domain code depends on. `lookup` is **read-only** (never a send).
`FakeSmsProvider` is deterministic and drives every test, including
timeout-after-accept (SID minted internally, omitted from `send`, returned by
`lookup`) **[test-ci]**. In **production** the fake no longer trusts every
webhook: it requires a shared secret (`SMS_FAKE_WEBHOOK_SECRET` in the
`x-fake-signature` header), closing the forged-consent hole. `TwilioSmsProvider`
maps Twilio's API, X-Twilio-Signature scheme, and status/inbound webhooks —
inbound messages (which Twilio tags `SmsStatus=received`) are classified by their
`Body`, so STOP/START are never misrouted into the delivery-status branch; a
`StatusCallback` is set when `SMS_PUBLIC_WEBHOOK_BASE_URL` is configured so direct
sends still reach a terminal state. `lookup` is a **GET** of `Messages.json`
(never a re-POST, which could send if the original never arrived). Unconfigured
credentials return `unknown`, not `not_found`. **No credentials are committed, and it
performs no send unless `TWILIO_*` are configured at runtime.** **[needs-provider]** for a live lookup.

## 11. Quiet hours **[impl][test-ci]**

`isWithinSendWindow` / `nextAllowedSendTime` compute the recipient's local send
window from the stand location's IANA zone using `Intl` — DST-correct, never a
fixed UTC offset. The window is configurable (`DEFAULT_QUIET_HOURS = 09:00–20:00`).
Tests assert the same wall-clock intent yields different UTC instants under EDT
vs EST, and that a non-existent spring-forward wall time resolves **forward** to
the first valid instant, never backward into quiet hours. The window is also
**re-checked at dispatch** (`app.sms_begin_dispatch`, DST-safe Postgres tz math):
a job claimed late by a delayed worker is `deferred` to the next window via
`app.sms_outbox_defer` rather than delivered overnight.

The recipient timezone is resolved from the stand's location and the lookup
**fails closed**: `resolveStand` turns a database error into a 503 rather than
silently substituting UTC (which could schedule into quiet hours). `resolveTimezone`
applies the deliberate, documented fallback — a valid IANA zone is kept; a
successfully-read missing/invalid zone falls back to `UTC`. Both paths are unit
tested.

## 12. Dedupe **[impl][test-ci]**

`text_requests` has a unique `(org_id, dedupe_key)`; `reviewRequestDedupeKey`
derives a stable key from `(recipient, stand, time-bucket)` or honours an
explicit client `Idempotency-Key`. The DB uniqueness — not app memory — collapses
repeated clicks, API/worker/webhook retries, and concurrency. Two durable
suppression windows back the business rule "don't text someone twice in the
window": `completed_flow` (set when the customer completes the rating flow) and
`recent_send` (set when a message is actually submitted), the latter closing the
UTC-bucket boundary gap in the derived key with a rolling DB-backed guard.

## 13. SMS segment engine **[impl][test-ci]**

`computeSegments` distinguishes GSM-7, GSM-7 extension chars (2 units), and
UCS-2, honours single (160/70) and concatenated (153/67) limits, and never
splits a multi-unit character across a boundary. Extensive vectors: ASCII, curly
quotes, emoji (surrogate pairs), accented letters, exact boundaries, multi-segment.

## 14. Cost preview **[impl][test-ci]** / pricing **[needs-provider]**

`estimateMessageCost` / `previewCost` compute in integer **micro-units** (no
floats, currency explicit). The per-segment rate is external config
(`SMS_RATE_PER_SEGMENT_MICROS` / `SMS_RATE_CURRENCY`); **no production price is
invented** — production throws if the rate is unset. All arithmetic is
**safe-integer-checked**: the rate must be a `Number.isSafeInteger` value (a
merely-`isInteger` value above 2^53 loses precision), and every product and sum
is proven to stay within `Number.MAX_SAFE_INTEGER` before it is returned —
otherwise it throws rather than hand a rounded, wrong total to a Postgres bigint.
`getProviderRate` applies the same safe-integer validation at config load. Tests
cover the boundary and overflow cases.

## 15. Quota ledger **[impl][test-ci]**

Append-only `sms_quota_ledger` with kinds `allocation / reservation /
consumption / release / refund / expiration / adjustment`, each idempotent on a
unique `(org, kind, correlation_key)`. `sms_quota_balance` is a projection.
`app.sms_quota_reserve` locks the balance row, so concurrent reservations cannot
double-spend; pgTAP asserts an over-budget reservation is refused and a repeated
key does not double-count. **Expiry is enforced**: `app.sms_quota_apply_expirations`
(swept under the lock before every reservation, and by the `app.sms_quota_expire`
cron target) appends an idempotent `expiration` entry and removes lapsed
allocations from the projection, and `app.sms_quota_available` discounts any
not-yet-swept expired allocation — so an allocation past its `expires_at` is never
spendable. Unused remainder is attributed with **locked FIFO** (`effective_at`,
then `id`) so equal-timestamp grants cannot claim the same ledger movement.
pgTAP asserts an already-expired grant yields zero available, a reservation
against it is refused, and equal-timestamp overlapping grants expire
`sum(grants) - net_reserved` (not a double-attributed remainder).

## 16. API endpoints **[impl][test-ci for auth/isolation via pgTAP]**

All under `/api/v1`, authenticated + org-scoped (RLS), Zod-validated, opaque
errors, rate-limited where it matters:

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| POST | `/text-requests` | owner/admin | schedule (rate-limited, idempotent) |
| GET | `/text-requests` | any member | list recent |
| POST | `/text-requests/preview` | owner/admin | segment + cost preview |
| POST | `/text-requests/{id}/cancel` | owner/admin | cancel if not yet dispatched |
| POST | `/webhooks/sms/{provider}` | provider (signed) | delivery + inbound events |
| POST | `/internal/sms/dispatch` | worker secret | run one dispatch batch, then one reconcile batch |

## 17. Security model **[impl][test-ci]**

- RLS on every tenant table; anon has no access; cross-org reads/writes proven
  impossible by pgTAP (a member of one org sees none of another's requests).
- No client role may write consent, suppression, requests, or attempts — only
  the `app.*` definer functions do, reached by the service role through
  `public.rpc_sms_*` wrappers (service-role-only). **Scheduling is service-role
  only**: the segment count drives quota and the real message length, so it must
  be the server's own computation over the true body, never a value an
  authenticated client could forge by calling the RPC directly; the Node service
  authenticates the owner/admin and the wrapper re-verifies membership, role, and
  stand ownership against the acting user it is passed. Cancel stays an
  authenticated, role-checked wrapper.
- Service-role key stays server-only (never `NEXT_PUBLIC_`).
- Phone/PII encrypted at rest; webhook signature boundary; webhook replay
  harmless; per-org rate limiting (**fails closed** if its store is unreachable);
  idempotency at the DB.
- Logs carry hashes and safe metadata only — never a raw number, token, or
  provider credential.

## 18. Tests **[test-ci]**

- **vitest** (`tests/unit/sms-*.test.ts`): provider, webhook, dispatch, and
  reconcile coverage including 429/5xx classification, parked unmatched receipts,
  timeout-after-accept lookup, fail_outbox retries, dead-letter vs retryable
  outbox outcomes, plus segments, phone normalization, keywords, quiet-hours/DST,
  cost, dedupe, and the timezone fail-closed policy.
- **pgTAP** (`supabase/tests/text_requests_test.sql`): 129 assertions across RLS
  isolation, the consent ledger + projection, the suppression gate, STOP/START,
  phone-level opt-out, the state machine, quota (double-spend, idempotency,
  partial expiry, FIFO equal-timestamp attribution), the
  schedule→dispatch→settle lifecycle, quiet-hours defer, stranded-send recovery,
  outbox leasing, dead-letter fail+release, webhook dedupe, receipt-before-SID
  park + atomic settle replay, provider_unknown reconcile (SID attach + parked
  replay, fail+release, topic-filtered claim), and the single-in-flight guard.

## 19. CI

No new workflow was justified: the existing `Backend database` job already runs
migrations from empty (twice, for idempotency), checks drift, and runs the pgTAP
suite; the `Type check, build, and contract tests` job runs `tsc`, `vitest`, and
`next build`; the secrets and review-gating jobs already scan this code. All of
them trigger on `supabase/**`, `frontend/lib/server/**`, and `frontend/app/api/**`.

## 20. Requires a real provider/account (isolated) **[needs-provider]/[needs-live]**

- Twilio (or another gateway) account + `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  and a From number / Messaging Service SID. **[needs-provider]**
- `SMS_RATE_PER_SEGMENT_MICROS` + `SMS_RATE_CURRENCY` (real pricing). **[needs-provider]**
- `SMS_WORKER_SECRET` for the dispatch trigger, and a scheduler (cron) to call it. **[needs-provider]**
- The provider's webhook URL pointed at `/api/v1/webhooks/sms/twilio`, and the
  URL used for signature verification matching the configured public URL.

## 21. Still missing before a real SMS can be sent

- A configured provider + credentials + verified sending number (above). **[needs-provider]**
- An allocation of quota per org (`rpc_sms_quota_allocate`) tied to billing — the
  ledger exists; the purchase/plan integration does not. **[impl: ledger only]**
- Recording real consent per recipient (an import path or a capture point);
  without `opted_in` consent, every send is correctly suppressed. **[impl: mechanism]**
- Wiring rating-flow completion to `app.sms_mark_flow_completed` for full
  completed-flow dedupe attribution (the mechanism exists; the trigger from the
  public flow is a follow-up, as it needs a per-recipient link). **[impl: mechanism]**
- A live end-to-end send/receive test on a real carrier — not provable in CI. **[needs-live]**
- Owner UI (out of scope for this backend phase).

Nothing here should be read as "SMS compliance is done." The technical controls
exist and are tested; legal review and live verification are separate steps.
