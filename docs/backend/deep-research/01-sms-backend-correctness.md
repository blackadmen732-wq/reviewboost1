# Text Requests backend — correctness audit

The SMS backend is a carefully designed, CI-tested PostgreSQL-authoritative pipeline whose consent gate, quota lock, unique-request dedupe, outbox lease, and segment/cost engines match their documentation on the paths that are actually implemented. It is **not** production-ready and is **not** live-verified. The most serious problems are not “the gate is missing”; they are (1) delivery receipts that arrive before we persist a provider message id are acknowledged and then unrecoverable, (2) `provider_unknown` has no implemented reconciliation and a timeout never stores a SID, (3) retryable provider failures are treated as terminal, and (4) the dispatch worker’s sequential batch can outlive its own lease, parking a live send as unknown and discarding the SID. Those defects are real in the code. Several other gaps (HELP auto-reply, quota purchase, a scheduler, `sms_mark_flow_completed` wiring, a poller) are designed but unbuilt. Under a target of 15,000–20,000 businesses the STOP fan-out has no `phone_hash` index, the outbox has no `request_id` index, and a single HTTP batch of 25 jobs is not a send platform.

## Method

Read, in this order: `SYSTEM_CONTEXT.md`, `STATUS.md`, `TESTING.md`, `LESSONS.md`, `docs/backend/TEXT_REQUESTS.md`, `docs/backend/ARCHITECTURE.md`, `docs/backend/CHANGE_SAFETY_ARCHITECTURE.md`, `frontend/AGENTS.md`.

Read every SMS application module: `frontend/lib/server/sms/{cost,dedupe,dispatch,keywords,phone,quiet-hours,segments,text-request-service,webhook-service}.ts` and `frontend/lib/server/sms/provider/{index,types,twilio,fake-provider}.ts`. Read the API routes under `frontend/app/api/v1/text-requests/`, `frontend/app/api/v1/internal/sms/dispatch/`, and `frontend/app/api/v1/webhooks/sms/`. Read supporting primitives in `frontend/lib/server/crypto.ts`, `frontend/lib/server/logger.ts`, and `frontend/lib/server/env.ts` (`encryptionKey`, `tokenDigestKey`). Read migrations `supabase/migrations/20260902000100_text_requests_consent.sql` through `20260902000700_text_requests_service_rpcs.sql`, plus `supabase/migrations/20260808000500_rate_limits.sql` for the schedule limiter. Read all eight `frontend/tests/unit/sms-*.test.ts` files (78 `it(...)` cases) and `supabase/tests/text_requests_test.sql` (`plan(59)`).

Inspected the already-migrated local Postgres 17.6 in `supabase_db_reviewboost`. Host `psql` is not on `PATH`; every query ran read-only via `docker exec supabase_db_reviewboost psql -U postgres -d postgres`. Commands used:

- `\dt public.sms*` and `\dt public.text_requests`
- index catalog join on the ten SMS tables (`pg_class` / `pg_index` / `pg_get_indexdef`)
- `pg_constraint` + `pg_get_constraintdef` for those tables
- `information_schema.triggers` for those tables
- `pg_policies` and `pg_class.relrowsecurity` / `relforcerowsecurity`
- `information_schema.role_table_grants` for `anon` / `authenticated` / `service_role` / `postgres`
- `information_schema.columns` for money, PII, outbox, and inbox columns
- `pg_proc` listing of every `app.sms_*`, `public.rpc_sms_*`, `rpc_schedule_text_request`, `rpc_cancel_text_request` (security definer, volatility, owner)
- `information_schema.routine_privileges` for execute grants
- `pg_get_functiondef` on `app.sms_record_consent`, `app.sms_settle_attempt`, `app.sms_apply_delivery_status`, `app.sms_outbox_claim`, `app.sms_begin_dispatch`, `app.sms_quota_reserve`, grepped for `FOR UPDATE`, `SKIP LOCKED`, `transition_allowed`, `occurred_at`, `can_send`
- a targeted count confirming **zero** indexes with leading `sms_consent_state.phone_hash` and **zero** indexes involving `sms_outbox.request_id`

No migrations, no `supabase db reset`, no large datasets, no writes, no git operations. Tests were **read**, not re-run. Concurrency and load behaviour is inferred from locks, indexes, and the dispatch loop, not from a soak test. Nothing here is live-verified against Twilio.

## Findings

### 1. High — unmatched delivery receipts are acknowledged as processed

**Files / symbols:** `frontend/lib/server/sms/webhook-service.ts` (`receiveWebhook`), `app.sms_apply_delivery_status`, `app.sms_webhook_receive`, `app.sms_webhook_settle`.

**What the code does:** After signature verification, a verified event is inserted (or reclaimed) in `sms_webhook_inbox`. For `kind === "delivery_status"` with a terminal status, Node calls `rpc_sms_apply_delivery_status`. That function looks up `sms_delivery_attempts` by `(provider, provider_message_id)` **without `FOR UPDATE`**, and if nothing matches it returns `'no_matching_attempt'`. That string is a successful RPC result, not an error. `receiveWebhook` then always calls `rpc_sms_webhook_settle(..., 'processed')`. A later retry of the same `(provider, dedupe_key)` is treated as an already-processed duplicate (`inserted = false`) and is not re-applied.

**Why it is a problem:** This is a **real defect**. Twilio’s StatusCallback can fire after the REST `POST /Messages` returns a SID and **before** `dispatch.ts` has committed `rpc_sms_settle_attempt` with that SID. If that first callback is already `delivered` / `undelivered` (Twilio is allowed to skip intermediate statuses), the inbox row is permanently processed, the SID is then stored, and the genuine terminal receipt will never be applied. The request stays `submitted` (or `provider_unknown`) forever. pgTAP covers duplicate *processed* webhooks, not this race.

**Recommended change:** On `'no_matching_attempt'`, settle the inbox row as `'failed'` (or leave it `'processing'`) so a provider retry reclaims it; alternatively buffer unmatched receipts and re-apply once the attempt row exists. Lock the attempt row `FOR UPDATE` when matched. Add a pgTAP/vitest case that inserts a terminal webhook before the SID is stored, then settles the attempt, then retries the webhook.

### 2. High — `provider_unknown` cannot be reconciled if the SID was never stored

**Files / symbols:** `TwilioSmsProvider.send`, `app.sms_settle_attempt`, `app.sms_apply_delivery_status`, `app.sms_begin_dispatch` (stranded-`sending` recovery), `frontend/lib/server/sms/dispatch.ts`. Allowed edges in `app.sms_request_transition_allowed`: `provider_unknown → {delivered, failed, submitted, queued}`.

**What the code does:** A Twilio `fetch` abort/timeout returns `{ outcome: "provider_unknown" }` with **no** `providerMessageId`. `sms_settle_attempt` writes that onto the attempt, sets `reconciliation_state = 'unresolved'`, keeps the quota reservation, and does not retry. A worker crash after `begin_dispatch` similarly parks the in-flight attempt as `provider_unknown` with `error_class = 'worker_lost'` and **does not copy a SID** (there isn’t one yet). The only implemented resolver is `sms_apply_delivery_status`, which matches **only** on `provider_message_id`. There is no poller, no Twilio list/fetch-by-idempotency-token path, and no code that walks `reconciliation_state = 'unresolved'`. `I-Twilio-Idempotency-Token: req:<request_id>` is sent, which would make a *retry* of the same send safe inside Twilio’s idempotency window, but `dispatch.ts` explicitly never retries `provider_unknown`.

**Why it is a problem:** Two layers. (a) **Real defect:** a timeout after Twilio accepted the message produces a later StatusCallback whose SID cannot match; combined with finding 1 the receipt is discarded. Quota stays reserved; the customer may have been texted; the state machine cannot move. (b) **Designed-but-unbuilt:** `TEXT_REQUESTS.md` and the transition function describe reconciliation, including `provider_unknown → queued` / `submitted`. No worker implements it.

**Recommended change:** Persist the idempotency token on the attempt. On timeout, do not ACK unmatched webhooks (finding 1). Add a reconciliation job that (i) reapplies buffered receipts, (ii) fetches the message from Twilio by idempotency/SID if the API allows, (iii) only then offers a human/dead-letter path. Until that exists, treat `provider_unknown` as an operational incident, not a self-healing state.

### 3. High — retryable provider failures are settled as terminal `failed`

**Files / symbols:** `TwilioSmsProvider.send`, `classifyTwilioCode`, `app.sms_settle_attempt`, `dispatchOnce`.

**What the code does:** Any non-OK HTTP response, including 429 (`20429` → `rate_limited`) and 5xx (`provider_error`), is returned as `{ outcome: "failed" }`. `dispatchOnce` then calls `sms_settle_attempt` with that outcome, which marks the request `failed`, **releases quota**, and completes the outbox job. The outbox retry/backoff path (`rpc_sms_fail_outbox`) runs only in the `catch` around RPC/decrypt/unexpected throws — not on classified provider errors. `SmsErrorClass` includes `rate_limited` and `insufficient_funds`, but they never cause a retry. Twilio `21610` (unsubscribed) is also `failed` and does **not** write a suppression row.

**Why it is a problem:** **Real defect** relative to the outbox’s own retry design. A burst of 20,000 businesses hitting Twilio at 09:00 local will 429. Those requests become terminal `failed` with quota returned; they will not send unless an owner reschedules. Unsubscribed numbers remain eligible for the next schedule (only a later `STOP` or an owner-made suppression would block them).

**Recommended change:** Map 429/5xx/timeouts-before-send to an outbox `fail`/`defer` without calling `sms_settle_attempt` as `failed` (leave the request `sending` or roll it back to `queued` under `FOR UPDATE`, and close the in-flight attempt as a *retryable* class distinct from terminal failure). On `unsubscribed`, write `sms_add_suppression(..., 'opt_out', null)` (and/or phone-level intent) in the same transaction as settle.

### 4. High — sequential dispatch batches outlive the lease and discard in-flight SIDs

**Files / symbols:** `frontend/app/api/v1/internal/sms/dispatch/route.ts` (`limit: 25`, `leaseSeconds: 90`), `dispatchOnce`, `app.sms_outbox_claim`, `app.sms_begin_dispatch`, `TwilioSmsProvider.send` (`AbortSignal.timeout(15_000)`).

**What the code does:** One invocation claims up to 25 jobs (`FOR UPDATE SKIP LOCKED`, `attempts = attempts + 1`, lease 90s) and then processes them **sequentially**. Each Twilio call may run to 15s. `25 × 15s = 375s > 90s`. When the lease expires, a second worker can claim the same job. If the first worker has not yet called `begin_dispatch`, the second worker sends (one send — the request row lock still serialises). If the first worker is **inside** `provider.send` (`status = 'sending'`, attempt `created`), the second worker’s `begin_dispatch` takes the stranded-`sending` branch: it flips the attempt to `provider_unknown` and returns `recovered_unknown` **without sending**. The first worker then calls `sms_settle_attempt`; the attempt is no longer `created`/`dispatched`, so the function returns `'already_settled'` and **drops the SID**. `sms_outbox_complete` is lease-owner guarded, so the first worker cannot complete the job either.

**Why it is a problem:** **Real defect** under slow provider responses, which is exactly when timeouts happen. Duplicate send of one request is still prevented (request `FOR UPDATE` + partial unique index `sms_delivery_attempts_one_inflight_idx`). The failure mode is the finding-2 hole: one real send, no SID, `provider_unknown`, reserved quota, webhook cannot match. At ten orgs with fast Twilio this will not show; at 20,000 businesses with a 15s tail it will.

**Recommended change:** Claim `limit = 1` per lease, or set `leaseSeconds` strictly above `limit × (provider timeout + settle RPC budget)`, or process claimed jobs concurrently **each with its own lease extension**. Heartbeat/`leased_until` while `provider.send` is in flight. Never run stranded-send recovery unless the *lease owner* is empty/expired **and** no process still holds that worker id.

### 5. High — STOP fan-out has no `phone_hash` index (wrong at 20,000 businesses)

**Files / symbols:** `app.sms_apply_inbound_keyword`, live catalog on `sms_consent_state`.

**What the code does:** Inbound STOP/START records phone-level intent, then `SELECT DISTINCT ... FROM sms_consent_state s WHERE s.phone_hash = p_phone_hash` and loops orgs. The primary key is `(org_id, phone_hash, purpose)`. There is **no** index with `phone_hash` as a leading column (confirmed in the live database). Phone-level `sms_phone_optout` is keyed by `phone_hash` and is O(1). The per-org loop is not.

**Why it is a problem:** **Real at the stated scale**, not at 10 orgs. At ~20,000 businesses × hundreds–thousands of customers, `sms_consent_state` is tens of millions of rows. A STOP webhook then sequential-scans that table. While it runs, `sms_can_send` still reads the old projection/phone-optout row; if the scan is slow enough that the webhook RPC times out, settle goes to `'failed'` and Twilio retries, but in-flight dispatches continue to send. Phone-level opt-out *is* written first, which mitigates **new** `can_send` checks once that upsert commits — but the upsert and the scan are one function, one transaction. The phone-level row is invisible to other workers until commit. A long transaction delays the STOP for everyone.

**Recommended change:** `CREATE INDEX sms_consent_state_phone_hash_idx ON public.sms_consent_state (phone_hash);` Commit the phone-level upsert in a separate short transaction before the per-org loop (or use `sms_record_phone_intent` then a second RPC). Add a pgTAP/explain test that the inbound-keyword plan uses the new index.

### 6. High — phone lookup HMAC is bound to the rotatable token key with no dual-read

**Files / symbols:** `phoneHash` in `frontend/lib/server/sms/phone.ts` (calls `keyedDigest(..., "sms_phone", tokenDigestKey())`), `digestStandTokenWithPreviousKey` in `frontend/lib/server/crypto.ts`, `tokenDigestKey` / `previousTokenDigestKey` in `frontend/lib/server/env.ts`. Every SQL lookup (`sms_can_send`, `sms_current_consent`, `sms_apply_inbound_keyword`, suppressions, requests) is by `phone_hash` only.

**What the code does:** Stand-token digests use `TOKEN_DIGEST_KEY` and, during rotation, try `TOKEN_DIGEST_KEY_PREVIOUS`. Phone hashes use the **same** current token key and **never** try the previous key. `phone_key_version` is stored on ciphertext rows (`KEY_VERSION = 1` constant) but `decrypt()` only understands ciphertext payload version `v1` under the **current** `CUSTOMER_NOTE_ENCRYPTION_KEY`; it does not read `phone_key_version`.

**Why it is a problem:** **Real defect** in the rotation story the rest of the product already has. Rotating `TOKEN_DIGEST_KEY` (the documented way to recover from token-key exposure without rewriting every note) makes every stored `phone_hash` unmatchable. Consent, STOP, and suppression lookups silently miss; `sms_current_consent` returns `unknown`; worse, a **new** hash of the same E.164 is a different identity, so an owner import can record a fresh `opted_in` that does not collide with the old STOP hash, while `sms_phone_optout` is also keyed by the old hash. Encryption-key loss is documented as catastrophic; token-key rotation is documented as survivable. For SMS it is not.

**Recommended change:** Give phones their own digest key, or dual-read previous token key on every hash lookup (as stands do) and rewrite hashes on successful match. Decrypt using an explicit key-version table, not a global singleton. Add tests that a previous-key hash still matches through `sms_can_send`.

### 7. High — HELP is classified and then discarded; no auto-reply exists

**Files / symbols:** `classifyKeyword`, `receiveWebhook`, `app.sms_apply_inbound_keyword` (`if p_intent = 'help' then return 0`).

**What the code does:** HELP/INFO are recognised. The webhook path calls `sms_apply_inbound_keyword`, which intentionally changes no consent and returns 0. Nothing sends a reply with business identity and opt-out instructions. START similarly restores consent without a confirmation text.

**Why it is a problem:** **Designed-but-unbuilt**, not a mis-parse. `TEXT_REQUESTS.md` describes honouring HELP as a technical control; CTIA/carrier rules for a live A2P program generally require a HELP reply. Shipping the current worker against a real number without Twilio Advanced Opt-Out (also **not live-verified**, not configured) would fail that control. Do not label this verified compliance.

**Recommended change:** After classifying HELP, enqueue a transactional-outbox auto-reply (separate from review-request quota, itself gated by quiet hours and STOP) or enable and live-verify the provider’s native HELP handling. Test that HELP still never flips consent.

### 8. Medium — consent projection is last-write-wins, not latest-`occurred_at`

**Files / symbols:** `app.sms_record_consent`, `app.sms_current_consent`, `sms_consent_state.last_event_id` (FK `ON DELETE CASCADE`).

**What the code does:** An advisory lock plus `SELECT ... FOR UPDATE` on the projection serialises writers for one `(org, phone, purpose)`. Idempotency is “same status, source, **and** `occurred_at` as the **current** last event”. Any other event is appended and the projection is **always** overwritten with that event, even if `p_occurred_at` is older than `v_last.occurred_at`. `sms_current_consent` reads **only** the projection (`coalesce(status, 'unknown')`) — it never recomputes from `sms_consent_events`. There is no unique constraint on the ledger. There is no trigger forbidding `UPDATE`/`DELETE` on `sms_consent_events`. Live grants: `service_role` has `UPDATE` and `DELETE` on the ledger. Deleting the current last event **deletes the projection row** (cascade) and does not rebuild from remaining events, so consent becomes `unknown` even if older `opted_in` rows still exist.

**Why it is a problem:** **Real defect** in the projection rule, currently latent for the Node schedule path (which passes `new Date().toISOString()`). Any caller of `rpc_sms_record_consent` with a historical `p_occurred_at` (an import, a backfill) can roll the projection backwards. A replay of a non-latest event is not recognised as a duplicate. The documented keyword policy (“last verified arrival wins”) is implemented for STOP/START because those pass SQL `now()`. It is not implemented for the ledger in general. Phone-level STOP still blocks `can_send` even if a stale org-level `opted_in` wins the projection — that is the saving throw, and it only applies when the STOP went through `sms_apply_inbound_keyword`.

**Recommended change:** Update the projection only when `p_occurred_at >= v_last.occurred_at` (and define a tie-break: processing order or STOP-wins). Keep appending either way. Block `UPDATE`/`DELETE` on `sms_consent_events` with a trigger. On last-event delete (if ever allowed), rebuild from `ORDER BY occurred_at DESC, created_at DESC`. pgTAP: insert opted_out at t1, opted_in at t0, assert projection remains opted_out.

### 9. Medium — the pre-send gate commits before the provider HTTP call

**Files / symbols:** `app.sms_begin_dispatch` (`sms_can_send` then insert attempt then return ciphertext), `dispatchOnce` (`decrypt` then `provider.send`), `app.sms_apply_inbound_keyword`.

**What the code does:** Consent, phone-level opt-out, and suppressions are re-checked inside `begin_dispatch` under `FOR UPDATE` on the **request** row. That transaction then **commits**. Node decrypts and calls Twilio afterwards. A STOP webhook is a different transaction and does not take the request lock.

**Why it is a problem:** **Residual, largely inherent.** A STOP that commits in the window after `begin_dispatch` and before Twilio accepts the message will not stop that send. The gate is as late as it can be without holding a DB lock across the network, which this architecture correctly refuses to do. This is not a missing `can_send` at dispatch — pgTAP and the SQL both show the recheck. It is also not a duplicate-send hole. It **is** a compliance-shaped race that grows with provider latency (finding 4). Two concurrent in-flight requests to the **same** phone (different stands or two explicit idempotency keys) can both pass `can_send` before either writes `recent_send`.

**Recommended change:** Keep the gate where it is. Shorten the window (findings 3–4). Consider a phone-level `FOR UPDATE` on `sms_phone_optout` / a per-hash advisory lock during `begin_dispatch` so a STOP waits rather than overtaking. After a successful submit, `recent_send` already exists; extend tests to two concurrent requests for one hash.

### 10. Medium — quiet-hours logic is duplicated and defer still consumes a claim attempt

**Files / symbols:** `DEFAULT_QUIET_HOURS` in `frontend/lib/server/sms/quiet-hours.ts`; `c_open_start = 9`, `c_open_end = 20` in `app.sms_begin_dispatch`; `app.sms_outbox_defer`; `app.sms_outbox_claim` (`attempts = attempts + 1`).

**What the code does:** Schedule-time uses `nextAllowedSendTime` (Intl, DST, spring-forward gap resolved forward — unit tested). Dispatch-time recheck uses Postgres `now() at time zone v_tz` and hardcoded 09:00–20:00, then `v_target at time zone v_tz`. A bad zone falls back to UTC in both stacks. `sms_outbox_defer` comments “without spending an attempt”, but the attempt was already incremented at claim time; defer only clears the lease and sets `available_at`.

**Why it is a problem:** **Real, currently small.** Changing TS `DEFAULT_QUIET_HOURS` does not change SQL. A worker that only runs during quiet hours will claim, defer to 09:00, and burn one of eight attempts per night; eight such nights dead-letters a never-sent request. If `rpc_sms_defer_outbox` fails, the `catch` path calls `rpc_sms_fail_outbox` with exponential backoff **while still inside quiet hours**, which can burn the rest of `max_attempts` in one night. Spring-forward handling in SQL is not covered by pgTAP (the suite uses `Etc/GMT±N` fixed offsets).

**Recommended change:** One source of window bounds (config table or identical constants generated into both). Decrement `attempts` on defer, or do not increment until a send is actually attempted. If defer RPC fails, defer anyway rather than fail-backoff. Add a pgTAP DST gap case.

### 11. Medium — append-only quota and consent ledgers are convention, not enforcement

**Files / symbols:** `sms_quota_ledger`, `sms_consent_events`; live `role_table_grants`; triggers (none except `touch_updated_at` on other tables).

**What the code does:** Quota movements go through `app.sms_quota_*` with unique `(org_id, kind, correlation_key)` and a `FOR UPDATE` on `sms_quota_balance` **before** the availability check (`app.sms_quota_lock_balance` then `apply_expirations` then read). There is **no** read-projection-then-write race on the reserve path — that specific double-spend window is closed. `amount >= 0` CHECKs hold. `adjustment` exists on the enum and **no function writes it**. Live DB: `service_role` has `UPDATE`/`DELETE`/`TRUNCATE` on both ledgers; no trigger rejects those statements.

**Why it is a problem:** The **reserve lock is correct** (real, verified in function body). The **append-only claim is not enforced**. A buggy admin script or a compromised service role can rewrite history; the projection will not notice. `sms_quota_consume` / `release` / `refund` do not require a matching reservation row or matching `amount`; they are not exposed as public RPCs (only called from the pipeline), which limits the blast radius. Consume+release with the same `correlation_key` `'req:' || id` are **different kinds**, so both can apply if a caller ever invoked both — the pipeline currently does not.

**Recommended change:** `BEFORE UPDATE OR DELETE` triggers that `RAISE` on both ledgers. Optionally generate the projection from the ledger in a check job. Add `sms_quota_adjust` or drop the enum value. pgTAP: concurrent reserve of the last unit (two sessions, not serial `is()`).

### 12. Medium — inbound From is hashed without E.164 normalisation

**Files / symbols:** `receiveWebhook` (`phoneHash(parsed.from)`), `normalizePhone` / `phoneHash` in `phone.ts`, `TwilioSmsProvider.parseWebhook`.

**What the code does:** Schedule-time identity is `normalizePhone` then `phoneHash(e164)`. Inbound STOP/START hashes Twilio’s `From` as a raw string. Twilio SMS `From` is typically E.164 (`+1…`). The fallback inbound `dedupe_key` is `` `in:${from}:${hashShort(body)}` `` when `MessageSid` is missing — **plaintext phone number in `sms_webhook_inbox.dedupe_key`**, which has a CHECK of length 8–200 and is not encrypted.

**Why it is a problem:** **Real defect** if `From` ever differs in form (missing `+`, spaces, `whatsapp:+…`). The STOP then writes `sms_phone_optout` and org rows under a hash that `sms_can_send` will never see. The plaintext fallback is a **PII leak** into a table the service role can read; Twilio normally sends `MessageSid`, so this is a fallback path, not the happy path.

**Recommended change:** Run `normalizePhone` on inbound `From`; on failure, do not apply keywords and settle the webhook as failed. Never put `From` in `dedupe_key`. Redact inbox `dedupe_key` in any log. Test `From=1555…` vs stored `+1555…`.

### 13. Medium — dead-lettered outbox jobs leave the request `scheduled` with quota reserved

**Files / symbols:** `app.sms_outbox_claim` (expired lease + `attempts >= max_attempts` → `dead_letter`), `app.sms_outbox_fail`, `app.sms_schedule_request`, `app.sms_cancel_request`.

**What the code does:** Poison / exhausted jobs become `dead_letter`. That update does **not** transition `text_requests`, does **not** release quota, and does **not** page a human. There is no public wrapper for `app.sms_purge_suppressions`; `rpc_sms_quota_expire` exists but is not scheduled. `pg_cron` in this repository schedules rate-limit cleanup, not SMS.

**Why it is a problem:** **Real operational defect.** After eight quiet-hour defer failures (finding 10) or eight RPC errors, the customer is never texted and the org cannot spend the reserved segments until someone cancels or a new mechanism releases them. At 20,000 businesses this is a silent leak of “available” quota as seen by owners who only look at `sms_quota_balance.reserved`.

**Recommended change:** On dead-letter, move the request to `failed` or a new `dead_letter` status, release quota, audit. Expose purge/expire to the same scheduler that must exist for dispatch. Monitor `sms_outbox` where `status = 'dead_letter'`.

### 14. Medium — `sms_settle_attempt` does not use the transition helper or lock the request

**Files / symbols:** `app.sms_settle_attempt`, `app.sms_request_transition_allowed`, `app.sms_apply_delivery_status`, `app.sms_begin_dispatch`, `app.sms_cancel_request`.

**What the code does:** Legal edges live in `sms_request_transition_allowed`. Webhook apply uses it. Settle does **not**; it `FOR UPDATE`s the **attempt**, then `UPDATE text_requests SET status = 'submitted'|'failed'|'provider_unknown' WHERE id = … AND status = 'sending'`. Begin-dispatch, cancel, and suppress also bypass the helper with their own predicates. Allowed but **unimplemented** edges: `failed → queued`, `provider_unknown → queued` / `submitted`. Terminal `delivered`, `cancelled`, `suppressed` have no outgoing edges — **verified in the helper**, and cancel/begin_dispatch refuse non-`(scheduled, queued)` / non-startable statuses. Attempt status `dispatched` and outbox status `failed` are in the enums and unused.

**Why it is a problem:** The status predicate is a real guard; a second settle of a terminal attempt is a no-op (`already_settled`) — pgTAP does not cover that, but the SQL does. Drift risk: someone adds an edge to the helper and not to settle, or vice versa. The unimplemented `→ queued` edges are **designed-but-unbuilt** retry, which is why finding 3’s terminal `failed` is so costly.

**Recommended change:** Every request status write should call `sms_request_transition_allowed` (or a single `sms_request_transition` that locks the row). Lock the request `FOR UPDATE` in settle. Either implement retry from `failed`/`provider_unknown` or remove those edges so the helper matches reality.

### 15. Medium — encryption key versioning is stored and ignored

**Files / symbols:** `toStoredPhone` (`phoneKeyVersion: KEY_VERSION`), `decrypt` in `crypto.ts`, `dispatchOnce` (`decrypt(b.phone_encrypted)` — does not pass `phone_key_version`).

**What the code does:** Ciphertext is `v1:<iv>:<tag>:<ct>` under `CUSTOMER_NOTE_ENCRYPTION_KEY`. Column `phone_key_version` / `message_key_version` is written and never read. `env.ts` documents that this key is not rotatable without re-encrypting every row.

**Why it is a problem:** Consistent with notes/praise, **not** a new hole, but SMS adds a second class of ciphertext (phones, bodies, webhook raw bodies) on the same key. Losing or rotating the key bricks dispatch (`decrypt_failed` → terminal `failed` in `dispatch.ts`). Combined with finding 6, SMS has the worse of both keys.

**Recommended change:** Same as the rest of the product: a versioned keyring and a decrypt that selects by stored version. Until then, backup procedure must include this key; say so next to the SMS runbook, which does not exist yet.

### 16. Medium — missing `sms_outbox(request_id)` index and unbounded infrastructure tables

**Files / symbols:** live indexes; `app.sms_cancel_request` (`UPDATE sms_outbox … WHERE org_id AND request_id`); `sms_webhook_inbox`; `sms_consent_events`; `sms_quota_ledger`.

**What the code does:** Cancel updates outbox by `request_id`. PostgreSQL does not index that FK. Claim uses a partial index on `available_at` where `status IN ('pending','leased')` — **this is the right shape** for the hot path and does not scan `done` rows. Webhook inbox, consent events, quota ledger, and `done` outbox rows are never purged. `sms_quota_expire` does `SELECT DISTINCT org_id FROM sms_quota_ledger WHERE kind = 'allocation' AND expires_at <= now()` with no supporting `(kind, expires_at)` index.

**Why it is a problem:** Correct at 10 orgs. At 20,000 businesses, cancel and expire become sequential scans of large heaps. Unbounded growth is certain if dispatch ever runs.

**Recommended change:** Index `sms_outbox(request_id)` (and probably `(org_id, request_id)`). Partition or TTL processed inbox / done outbox / old ledger rows. Index lapsed allocations.

### 17. Low — keyword matching misses homoglyphs, zero-width, and non-English STOP

**Files / symbols:** `classifyKeyword`.

**What the code does:** NFC, upper-case, split on `[^A-Z0-9]+`, first token (or `OPT OUT` / `OPT IN`). Exact list: STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT/OPTOUT, START/YES/UNSTOP/SUBSCRIBE/OPTIN, HELP/INFO. “please stop” does not match (tested). `STOP please` does. There is no Unicode confusable folding, no zero-width stripping, no ARRETE/ALTO/BASTA.

**Why it is a problem:** **By design** (the comment correctly refuses fuzzy matching). Residual missed-STOP risk if Twilio Advanced Opt-Out is off. Not a false-STOP problem.

**Recommended change:** Strip Cf (format) characters before tokenising; keep the exact list. Rely on the provider’s native STOP for live traffic, and live-verify it. Do not silently broaden the list without tests.

### 18. Low — logger redaction misses `from` / `to` / `e164` / `last_four`

**Files / symbols:** `SENSITIVE_KEYS` in `frontend/lib/server/logger.ts`; `dispatchOnce` (`p_error: jobError.message` into `sms_outbox.last_error`); webhook `SAFE_HEADER_KEYS` includes `x-forwarded-for`.

**What the code does:** Recursive key-based redaction includes `phone` and entire `Error.message`. Dispatch does not log `to` or body. Outbox payload is `{ requestId }`. Audit metadata is segments/encoding. Inbox raw body is encrypted. `last_error` stores the raw exception message (capped 500). `x-forwarded-for` is stored on the inbox row.

**Why it is a problem:** Current SMS log sites look clean. A future `logger.info("sms.inbound", parsed)` would leak `from`. DB `last_error` is outside the logger.

**Recommended change:** Add `from`, `to`, `e164`, `body`, `lastfour` to `SENSITIVE_KEYS`. Do not store client IPs on the inbox if not required. Redact `last_error` the same way.

### 19. Observation — several documented pieces are not built

Not defects in existing functions; they are absences. Quota **purchase** / plan grants: ledger RPCs exist (`rpc_sms_quota_allocate`), no billing. `app.sms_mark_flow_completed` / `rpc_sms_mark_flow_completed`: no caller from the public rating flow (`TEXT_REQUESTS.md` says so). No scheduler calls `POST /api/v1/internal/sms/dispatch`. No owner UI. No live Twilio account. `getSmsProvider()` in production fails closed unless `SMS_PROVIDER=twilio` with credentials or explicit `fake`; in non-production, `SMS_PROVIDER=twilio` without credentials **falls through to `FakeSmsProvider`**. Webhook signature verification uses Next `request.url`, not `SMS_PUBLIC_WEBHOOK_BASE_URL` (that env var is only used to set Twilio `StatusCallback`). `sms_quota_expire` and `sms_purge_suppressions` have no cron. Provider interface is genuinely swappable as a TypeScript boundary; runtime is a singleton (`getSmsProvider`) and `KNOWN_PROVIDERS` is `{twilio, fake}` — not multi-provider concurrent.

### 20. Observation — money and segments at this volume do not overflow JS numbers

`estimated_cost_micros` and quota `amount` are `bigint` with `>= 0` checks. `cost.ts` uses `Number.isSafeInteger` on the rate and on every product/sum. Realistic load (20,000 orgs × thousands of recipients × a few segments × ~10⁴ micros) stays orders of magnitude below `2^53 − 1`. There is no float on the cost path; `Number(process.env.SMS_RATE_PER_SEGMENT_MICROS)` rejects non-safe integers. Currency is a single configured ISO code per process, stored per request; quota is in **segments**, not money, so it cannot mix currencies. No path still does `length / 160` (only a comment in `segments.ts`). GSM-7 extension table (`€`, `[]{}`, etc. as 2 septets), concatenated 153/67, and surrogate-pair atomic packing are implemented and unit-tested. Remaining segment caveats: grapheme clusters / ZWJ sequences / flag pairs are packed per code point, not per grapheme — the same limitation as most gateways.

## What is genuinely solid

These are verified from function bodies, constraints, and/or tests, not from production traffic.

- **Unknown number is not consent.** `app.sms_current_consent` returns `'unknown'` when the projection row is missing. `app.sms_can_send` returns `allowed = false, reason = 'no_consent'` unless status is exactly `opted_in`, after a phone-level opt-out check. pgTAP asserts both. Dispatch uses this function, not a second copy of the rule.
- **Phone-level STOP before any org row.** `sms_apply_inbound_keyword` writes `sms_phone_optout` first; `sms_can_send` checks it first; owner `opted_in` cannot override; only START clears it. pgTAP covers that sequence and STOP idempotency of the phone-level row.
- **Schedule is one transaction for request + quota reserve + outbox + audit.** `app.sms_schedule_request` inserts the request (`ON CONFLICT (org_id, dedupe_key) DO NOTHING`), reserves `'req:' || id` under the balance row lock, inserts `sms_outbox` with `idempotency_key = 'dispatch:' || id`, then audits. Insufficient quota raises `quota_exhausted` and rolls back. Duplicate dedupe returns the existing id and does not reserve again. Unique `(org_id, dedupe_key)` is the concurrency boundary, not process memory.
- **Outbox claim is `FOR UPDATE SKIP LOCKED` with a lease, owner-guarded complete/fail/defer, and dead-letter after `max_attempts`.** Two workers cannot receive the same row while the lease holds. Stale complete/fail/defer is a no-op. Confirmed in live `pg_get_functiondef` and pgTAP (second worker gets 0 rows).
- **Single in-flight attempt.** Partial unique index on `sms_delivery_attempts(request_id) WHERE status IN ('created','dispatched')`. pgTAP `throws_ok` 23505.
- **Webhook signature is verified before occupying the real `(provider, dedupe_key)`.** Unverified payloads use an `unverified:` HMAC namespace. A forged STOP cannot squat an authentic event id. (The Node orchestration itself has **no** vitest coverage; the SQL reclaim/dedupe path does.)
- **Quota reserve serialises per org.** `lock_balance` + expire sweep + availability check + insert. Expired allocations are subtracted in `sms_quota_available` even before sweep; reserve sweeps under the same lock. pgTAP: over-budget refused; expired grant unspendable; repeated correlation key does not double-count. Not proven with two concurrent sessions.
- **Segment engine and micro-unit cost preview** match the documented GSM-7 / UCS-2 rules and safe-integer guards (78 vitest cases include exact 160/161, 70/71, euro extension, emoji pairs, overflow).
- **RLS shape.** Tenant tables ENABLE RLS (not FORCE); authenticated has SELECT-only policies; `sms_outbox`, `sms_webhook_inbox`, `sms_phone_optout` have RLS and **no** client policy. `rpc_schedule_text_request` is service-role only; `rpc_cancel_text_request` is authenticated and re-checks owner/admin. pgTAP: outsider sees 0 requests; member cannot read consent; client INSERT on `text_requests` is 42501.
- **Fail-closed provider selection in production** and fail-closed location lookup on DB error (`resolveStand` → 503, not UTC). Fake webhooks in production require `SMS_FAKE_WEBHOOK_SECRET`.

## Behaviour at 15,000–20,000 businesses

What remains correct: per-org quota is one `sms_quota_balance` row, so concurrent schedules for **one** busy org serialise (latency, not double-spend). Different orgs do not contend on that row. Outbox claim is a single global partial index, `SKIP LOCKED`, `LIMIT 25` — workers do not scan all orgs. Dedupe and in-flight uniqueness are index operations. Phone-level opt-out is a primary-key lookup.

What breaks or becomes unsafe:

- **STOP processing** (finding 5) is the sharp correctness-under-load issue: a sequential scan of `sms_consent_state` holds the transaction that must commit before other sessions see the opt-out.
- **Dispatch throughput.** `POST /internal/sms/dispatch` does 25 sequential sends per call. There is no in-repo scheduler and no job platform (`ARCHITECTURE.md` still marks that decision open). One cron per minute is 25 messages/minute/instance. A morning quiet-hours release across 20,000 orgs is a thundering herd on one `available_at` index, not an O(n) loop of orgs, but it still needs a worker fleet and a lease story that survives Twilio’s tail latency (finding 4). There is **no per-org fairness**: one org with 10,000 due jobs occupies the head of the index.
- **Hot rows.** The dangerous lock is per-org quota, not a global counter. A single org blasting hundreds of concurrent `rpc_schedule_text_request` calls will queue on `sms_quota_balance`. The schedule HTTP limiter is 60/minute/org (`rpc_consume_rate_limit` on `sms_schedule` / `orgId`) — that caps API abuse but also caps legitimate bursts (CSV import of “text last night’s customers”).
- **Cancel** updates `sms_outbox` by unindexed `request_id` (finding 16).
- **Table growth** of inbox, done outbox, consent events, and quota ledger is unbounded. Claim itself stays cheap because of the partial index; everything else does not.
- **`sms_quota_expire`** as written will sequential-scan the ledger for lapsed allocations as that table grows.
- **No load test exists** (`STATUS.md` / `SYSTEM_CONTEXT.md`). The above is design analysis, not a measurement.

## Test coverage gaps

The 78 vitest cases cover pure functions (segments, cost, phone, keywords, quiet hours, dedupe key derivation, provider parse/signature/rate) plus `resolveStand` timezone policy. The 59 pgTAP assertions cover RLS, consent happy path, STOP/START/HELP, phone-level STOP-before-consent, three transition-helper examples, quota allocate/reserve/refuse/expiry, schedule dedupe, one happy dispatch→submit→delivered, suppress-at-gate, quiet-hours defer with a fake offset zone, stranded-`sending` recovery, outbox lease exclusion, webhook processed-duplicate, and the in-flight unique index.

They do **not** assert the risks in this audit. Named missing tests:

1. Terminal StatusCallback committed before `sms_settle_attempt` stores the SID, then retried — must still reach `delivered` (finding 1).
2. `provider_unknown` settle with `provider_message_id` null, then a delivered webhook for a SID Twilio issued — must not ACK-and-drop (finding 2).
3. Twilio HTTP 429 / 503 does not terminal-`failed` the request (finding 3).
4. Twilio `21610` writes a durable suppression (finding 3).
5. Claim `limit=N` with send time `> leaseSeconds` does not park a live send as `provider_unknown` or drop a SID (finding 4).
6. `EXPLAIN` / pgTAP that `sms_apply_inbound_keyword` uses an index on `phone_hash` (finding 5).
7. Phone hash lookup after `TOKEN_DIGEST_KEY` rotation with `TOKEN_DIGEST_KEY_PREVIOUS` set (finding 6).
8. HELP produces an auto-reply **or** an explicit documented skip with provider-native HELP enabled (finding 7).
9. Out-of-order `sms_record_consent` with older `occurred_at` does not move the projection backwards (finding 8).
10. Two concurrent `pg_sleep` sessions reserving the last quota unit — only one succeeds (finding 11). Direct `UPDATE`/`DELETE` on `sms_quota_ledger` / `sms_consent_events` is rejected.
11. Inbound `From` without `+` still maps to the stored E.164 hash (finding 12).
12. Dead-letter releases quota and moves the request out of `scheduled` (finding 13).
13. `sms_settle_attempt` on an already-submitted attempt is a no-op and does not consume quota twice (pipeline has the branch; pgTAP never hits `already_settled`).
14. `failed → delivered` webhook is ignored; `delivered → failed` is ignored (out-of-order receipts).
15. Receipt for a SID that was never ours: inbox not left `'processed'` if you adopt finding 1’s fix.
16. Quiet-hours defer does not increment `attempts` toward `max_attempts` (finding 10). SQL spring-forward gap matches TS.
17. Zero-width / fullwidth / homoglyph STOP bodies (finding 17).
18. No vitest for `dispatch.ts`, `webhook-service.ts`, or the three owner/internal/webhook route handlers (signature-before-write, worker-secret 404, rate-limit fail-closed).
19. No test that `rpc_schedule_text_request` is non-executable as `authenticated` (privilege tests exist for tables, not this wrapper — the grant catalog says it is revoked; a pgTAP `has_function_privilege` would pin it).
20. `sms_mark_flow_completed` is untested and unwired.
21. No test that consume then refund on `submitted → failed` returns available quota to the pre-send value, or that `provider_unknown → delivered` consumes once.
22. No test that `hashShort` / fallback inbound `dedupe_key` never contains `+`.

## Priority-ordered remediation list

1. Stop acknowledging unmatched delivery receipts as `'processed'`; buffer or fail them so a SID that appears milliseconds later can still settle the request (finding 1). This is the smallest change that re-opens the only resolution path you already have.
2. Bound dispatch: one job per lease, or a lease longer than `limit × timeout`, plus a heartbeat while `provider.send` runs. Stop running stranded-`sending` recovery against a worker that may still be in `fetch` (finding 4). Together with (1) this closes the SID-loss hole.
3. Do not call `sms_settle_attempt(..., 'failed')` for 429/5xx; use outbox backoff. On `unsubscribed`, suppress (finding 3).
4. Add `sms_consent_state(phone_hash)` and `sms_outbox(request_id)` indexes before any real STOP traffic or owner cancel at scale (findings 5, 16). Split the phone-level STOP upsert into a short transaction.
5. Persist send idempotency keys on attempts and implement the reconciliation job the state machine already allows — or stop claiming `provider_unknown` is a handled state (finding 2).
6. Align consent projection with `occurred_at` (STOP-wins on ties) and trigger-enforce append-only ledgers (findings 8, 11).
7. Dual-read phone hashes across token-key rotation; stop putting raw `From` in inbox keys; `normalizePhone` on inbound (findings 6, 12).
8. Dead-letter must release quota and fail/cancel the request; decrement attempts on quiet-hours defer; one quiet-hours config (findings 10, 13).
9. HELP auto-reply or provider-native HELP, then a live carrier test. Until then the honest label remains: technical keyword plumbing, not certification (finding 7).
10. Scheduler, quota purchase, `sms_mark_flow_completed` wiring, owner UI, and a load test at tens of millions of `sms_consent_state` rows — all **not built**, all required before the 20,000-business target is more than a thought experiment (finding 19 and scale section).
