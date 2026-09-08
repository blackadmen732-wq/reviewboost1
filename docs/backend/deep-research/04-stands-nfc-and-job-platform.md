# Stands, NFC, and the background job platform

**Part A verdict.** The public stand token is cryptographically sound: 256 bits from `node:crypto.randomBytes`, stored as a keyed HMAC plus AES-256-GCM ciphertext, looked up through a unique index, and absent from every public response and from the QR/NFC payload. That core is IMPLEMENTED and CI-tested. What is not sound is the physical-product loop around it. Additional stands created after onboarding cannot be reprinted, because `createStand` still calls `rpc_set_stand_token_ciphertext`, which was dropped. The advertised tap-time scan with per-device dedupe is not what the code does — a session, and therefore `last_opened_at`, is written only when a rating is submitted. Token rotation is atomic and admin-gated, but it kills every already-written tag with no overlap window. `rpc_record_nfc_provision` is correctly revoked from `anon` and role-gated, yet it records an honour-system timestamp with no tag UID, so a client can forge “provisioned” without a write. At 40,000–60,000 stands the missing backend is not a second token scheme; it is bulk issuance, print-run / fulfilment records, tag inventory and binding, replacement, and “this stand has gone silent.” None of that is built. NFC is not live-verified: there is no dedicated pgTAP suite, and `docs/testing/NFC_DEVICE_TEST_CHECKLIST.md` is unchecked.

**Part B verdict.** The Text Requests outbox is a real transactional queue — `FOR UPDATE SKIP LOCKED` leases, backoff, dead-letter, quiet-hours recheck, `provider_unknown` parking — and PostgreSQL is correctly the source of truth. It is not a job platform. Nothing in this repository schedules `POST /api/v1/internal/sms/dispatch`; `frontend/vercel.json` has no `crons` entry; `rpc_sms_quota_expire` exists and is not on `cron.job`; there is no reconciliation worker for `provider_unknown`. A single 25-job sequential batch cannot carry the 15,000–20,000-business workload derived below. The decision is: **keep the existing Postgres outbox as the only job record, and drive it with Vercel Cron (Pro, minute cadence, drain-until-empty) plus Supabase `pg_cron` for SQL-only maintenance.** Do not introduce Inngest, Trigger.dev, QStash, Temporal, Vercel Queues, pgmq, or SQS as a second source of truth. Promote to a long-lived worker when a measured peak can no longer be cleared inside a Fluid-compute drain. That choice is reversible because the relay is a caller of `dispatchOnce`, not a rewrite of the ledger.

---

## Method

Repository documents read first: `SYSTEM_CONTEXT.md` (§3 physical layer, §8 architecture), `STATUS.md`, `TESTING.md`, `LESSONS.md`, `docs/backend/ARCHITECTURE.md`, `docs/backend/TEXT_REQUESTS.md`, `docs/backend/CHANGE_SAFETY_ARCHITECTURE.md`, `docs/testing/NFC_DEVICE_TEST_CHECKLIST.md`, `docs/mobile/MOBILE_RELEASE.md`, `frontend/AGENTS.md`.

Code and migrations inspected: `frontend/lib/server/crypto.ts`, `frontend/lib/server/env.ts`, `frontend/lib/server/customer-flow-service.ts`, `frontend/lib/server/owner-service.ts`, `frontend/lib/server/owner-data.ts`, `frontend/lib/server/sms/dispatch.ts`, `frontend/lib/server/sms/text-request-service.ts`, `frontend/lib/server/sms/quiet-hours.ts`, `frontend/app/api/v1/public/q/[token]/`, `frontend/app/api/v1/review-stands/`, `frontend/app/api/v1/internal/sms/dispatch/route.ts`, `frontend/app/(customer)/q/[token]/page.tsx`, `frontend/features/customer-flow/customer-flow.tsx`, `frontend/features/dashboard/stand-card.tsx`, `frontend/features/dashboard/web-nfc-writer.tsx`, `apps/mobile/lib/nfc.ts`, `apps/mobile/app/stand/[id].tsx`, stand/token/NFC/outbox migrations under `supabase/migrations/`, `supabase/tests/token_rotation_test.sql`, `supabase/tests/security_hardening_test.sql`, `frontend/tests/unit/stands-system.test.ts`.

Live local Postgres (read-only, 2026-09-08): `docker exec` into `supabase_db_reviewboost` → `postgresql://postgres@127.0.0.1:54322/postgres`. Inspected `pg_get_functiondef` / `has_function_privilege` / `pg_indexes` / `pg_constraint` / column and table privileges / RLS policies / `pg_extension` / `cron.job`. Confirmed `rpc_set_stand_token_ciphertext` is absent, `anon` cannot execute `rpc_record_nfc_provision`, `public_token_hash` is uniquely indexed, authenticated `SELECT` includes `public_token_encrypted`, and `cron.job` has only rate-limit and idempotency cleanup.

GitHub: this checkout’s origin is `blackadmen732-wq/reviewboost1`. `gh issue view 31` cannot resolve an issue on that repository (GraphQL: no issue 31; REST issues API returns 403 for this token). Canonical NFC intent is therefore taken from in-repo `SYSTEM_CONTEXT.md` / `STATUS.md` (which still name issue #31 as the open spec) and from merged **PR #32** (Stands QR + NFC, merged 2026-09-01) and **PR #33** (anon NFC grant revoked). **PR #35** is the Text Requests backend.

Web sources consulted on 2026-09-08 (facts below are dated to this fetch, not to memory):

- Vercel Cron usage and pricing: <https://vercel.com/docs/cron-jobs/usage-and-pricing>
- Vercel Functions duration limits: <https://vercel.com/docs/functions/limitations>
- Vercel Cron 100-per-project changelog (2026-01-20): <https://vercel.com/changelog/cron-jobs-now-support-100-per-project-on-every-plan>
- Vercel Queues overview, concepts, pricing/limits: <https://vercel.com/docs/queues>, <https://vercel.com/docs/queues/concepts>, <https://vercel.com/docs/queues/pricing>
- Vercel Queues public beta changelog (2026-02-27): <https://vercel.com/changelog/vercel-queues-now-in-public-beta>
- Inngest pricing: <https://www.inngest.com/pricing>
- Trigger.dev Cloud pricing: <https://trigger.dev/pricing>
- Upstash QStash pricing: <https://upstash.com/pricing/qstash>
- Temporal Cloud pricing: <https://docs.temporal.io/cloud/pricing>
- Temporal Activity definition / at-least-once retry: <https://docs.temporal.io/activity-definition>
- Supabase Cron (`pg_cron`): <https://supabase.com/docs/guides/cron>
- Scheduling Edge Functions with `pg_cron` + `pg_net`: <https://supabase.com/docs/guides/functions/schedule-functions>
- Supabase pgmq: <https://supabase.com/docs/guides/queues/pgmq>
- AWS SQS delay queues (15-minute cap): <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-delay-queues.html>
- AWS Lambda timeout (900 seconds): <https://docs.aws.amazon.com/lambda/latest/dg/configuration-timeout.html>

No source files were modified. No migrations, resets, commits, branches, or pushes were performed.

---

## Part A — Stands and NFC backend audit

State labels follow `SYSTEM_CONTEXT.md`. Software for QR export, Copy NFC Link, Web NFC, native NDEF write, and `rpc_record_nfc_provision` is **IMPLEMENTED, CI-TESTED, not live-verified**. Hardware ordering is **PROPOSED / NOT BUILT**. Distinguishing those two is the point of the findings below.

### 1. Token generation, storage, and lookup are sound — Observation

**Files / RPCs.** `frontend/lib/server/crypto.ts` (`generateToken`, `digestStandToken`, `tokenPrefix`, `encrypt`); `frontend/lib/server/env.ts` (`tokenDigestKey`, `previousTokenDigestKey`); `app.resolve_public_stand` / `public.rpc_public_resolve_stand`; unique constraint `review_stands_public_token_hash_key` (live); `frontend/lib/server/google-review-url.ts` (`standUrl`).

**What the code does.** A stand token is 32 bytes from `randomBytes`, encoded base64url (~43 URL-safe characters, 256 bits of entropy). It is never stored in plaintext. Lookup uses HMAC-SHA256 under `TOKEN_DIGEST_KEY` (domain `"stand_token"`), falling back to `CUSTOMER_NOTE_ENCRYPTION_KEY` if the digest key is unset. Reprinting uses a separate AES-256-GCM ciphertext under the content key (`public_token_encrypted`). The owner-visible `public_token_prefix` is the first eight characters, not a lookup key, and is not unique. Live Postgres has `UNIQUE (public_token_hash)` and `rpc_public_resolve_stand` is granted only to `service_role`. The public URL is `{PUBLIC_FRONTEND_URL}/q/{token}` for both QR and NFC.

**Risk.** Brute-force of a 256-bit token is not a realistic attack. A leaked database without the digest and content keys yields neither a working URL nor a reprintable token. Cross-tenant correlation via the token itself is not possible: the hash is globally unique, the prefix is random, and no org id is encoded in the token. The remaining operational risk is the documented fallback that lets `TOKEN_DIGEST_KEY` share the note key — rotating the note key would then threaten every printed code. That is a configuration hazard, not an algorithm defect.

**Recommendation.** Keep this design. Require `TOKEN_DIGEST_KEY` to be set independently before any paying-customer stand is printed (already stated in `docs/backend/ENVIRONMENT.md`). Do not shorten the token for “nicer URLs.”

### 2. The internal stand id is absent from public and physical payloads — Observation

**Files / RPCs.** `frontend/lib/server/customer-flow-service.ts` (`getContext`); `frontend/app/api/v1/review-stands/[standId]/qr/route.ts`; `frontend/features/dashboard/web-nfc-writer.tsx`; `apps/mobile/lib/nfc.ts`; `apps/mobile/app/stand/[id].tsx`.

**What the code does.** `getContext` returns business name, location name, Google URL, and locales. It does not return `org_id`, `location_id`, or `stand_id`, even though `rpc_public_resolve_stand` returns those columns to the service role. QR `?format=json` returns `{ standUrl, label }` only. Web NFC and native NFC write a single NDEF URI equal to `standUrl`. The owner API and dashboard correctly expose `standId` to authenticated members of that org.

**Risk.** A guest who learns a working URL still cannot address another tenant’s rows. Enumeration of internal ids from the physical layer is not available.

**Recommendation.** Treat any future public DTO that adds an id as a contract break. Keep QR JSON and NFC on the URL-only payload.

### 3. Additional stands cannot be reprinted — High (real defect)

**Files / RPCs.** `frontend/lib/server/owner-service.ts` (`createStand`); `public.rpc_create_stand` in `supabase/migrations/20260831000100_nfc_provisioning.sql`; drop of `rpc_set_stand_token_ciphertext` in `supabase/migrations/20260813215530_praise_view_and_state_machine.sql`; `getStandTokenForReprint`; `GET /api/v1/review-stands/[standId]/qr`. Live check: `ciphertext_rpc_count = 0`.

**What the code does.** Onboarding stores hash, prefix, and ciphertext in one transaction via `rpc_create_organization`. Token rotation does the same via `rpc_rotate_stand_token` (eight required parameters, including ciphertext). The later `rpc_create_stand` path — used by `POST /api/v1/review-stands` and `AddStandButton` — inserts only hash and prefix, then calls `rpc_set_stand_token_ciphertext` as a second, unchecked RPC. That function was dropped in the praise/state-machine migration after being folded into rotation, and it does not exist on the live database. `createStand` ignores the RPC error. `AddStandButton` discards the one-time `standToken` in the 201 body and refreshes the list. The QR route then `tryDecrypt`s a null ciphertext and returns 409 (“rotate to get a new code”).

**Risk.** Every stand created after the first one is a physical object whose code cannot be reprinted without rotating — which invalidates any copy that did get printed from a cached URL. This is not an unbuilt hardware feature; it is a regression of a property the rotation and onboarding paths already have. At even tens of stands per business it becomes an owner-support incident.

**Recommendation.** Extend `rpc_create_stand` to accept `p_token_ciphertext` and `p_cipher_key_version` and write them in the same statement as the hash, matching `rpc_rotate_stand_token`. Check the RPC error. Add a pgTAP assertion that a stand created through the RPC has non-null `public_token_encrypted`. Do not resurrect the standalone ciphertext RPC.

### 4. Authenticated members can SELECT token ciphertext and hash — Medium (real defect)

**Files / RPCs.** Live `information_schema.column_privileges`: `authenticated` has `SELECT` on `public_token_encrypted`, `public_token_hash`, `nfc_provisioned_by`, and every other stand column. `getStandTokenForReprint` reads ciphertext through the caller’s RLS client.

**What the code does.** Table-wide `UPDATE` on `review_stands` is revoked (live `has_table_privilege(..., 'UPDATE')` is false; pgTAP in `security_hardening_test.sql` asserts direct hash/prefix updates throw `42501`). `SELECT` was not similarly narrowed. Any org member (including viewer) who can speak the Data API can read the ciphertext blob and the lookup hash for every stand in the org.

**Risk.** Ciphertext without the content key is inert, so this is not a guest-facing leak and not a cross-tenant leak under RLS. It does widen the blast radius of a stolen member JWT plus a stolen `CUSTOMER_NOTE_ENCRYPTION_KEY`: the browser already had a path to bulk-export every reprintable token. The hash is not reversible without the digest key.

**Recommendation.** Revoke authenticated `SELECT` on `public_token_encrypted` and `public_token_hash`. Serve reprint through a SECURITY DEFINER RPC that decrypts on the server, the same pattern used for other writes. Keep `public_token_prefix` visible.

### 5. Stand token rotation is atomic and admin-only; already-written tags die immediately — Medium (designed behaviour with an operational gap)

**Files / RPCs.** `public.rpc_rotate_stand_token`; `POST /api/v1/review-stands/[standId]/rotate-token`; `frontend/features/dashboard/stand-card.tsx`; audit action `stand.token_rotated`.

**What the code does.** Owner/admin only (route `requireRole` plus RPC membership check). One `UPDATE` writes hash, prefix, digest key version, `token_rotated_at`, and ciphertext, then inserts an audit row in the same function. Anon cannot execute the RPC (live). There is no previous-token column and no grace window: `app.resolve_public_stand` matches the current hash (and, separately, a previous *digest key* during key rotation). An old printed QR or written NFC URL resolves to the same 404 as an unknown token (`review_link_inactive`). The dashboard compares `tokenRotatedAt > nfcProvisionedAt` (and a local `rotatedLocally` flag) to show “NFC tag needs rewriting.”

This is **not** the digest-key rotation in `20260808000800_rotatable_token_digests.sql`. That path lazily re-hashes on scan so printed codes keep working. Confusing the two is how a reprint storm gets designed by accident.

**Risk.** Correct for a leaked token. Wrong as the only tool for “I need a fresh print run” or “we shipped the wrong URL to a factory.” At 40,000–60,000 stands, a mistaken bulk rotate is a field recall with no overlap. The owner learns a rewrite is needed only by opening the stand card; there is no outbound alert, no count of stale tags, and no per-tag identity (see finding 6). Concurrent rotates are last-write-wins: the RPC does not `SELECT ... FOR UPDATE` before assigning a new hash, so two admins can each receive a token of which only one survives.

**Recommendation.** Keep immediate cutover for an explicit compromise rotate. Add an optional overlap (previous hash + `previous_token_expires_at`) only for non-compromise reprint/fulfilment, default off. Lock the row with `FOR UPDATE` inside the RPC. Do not add a grace window that leaves a leaked URL live.

### 6. NFC provisioning is an honour-system timestamp, not a binding — Medium (real limitation of an implemented feature)

**Files / RPCs.** `public.rpc_record_nfc_provision` (live body matches `20260831000100_nfc_provisioning.sql`); `POST /api/v1/review-stands/[standId]/nfc-provision`; `20260901120000_revoke_anon_nfc_provision.sql`; PR #32 / PR #33.

**What the code does.** The route requires owner/admin. The RPC requires `auth.uid()`, an active owner/admin membership, and a stand in that org; missing rows raise `not_found_or_forbidden`. Live grants: `anon` execute = false, `authenticated` = true, `service_role` = true. The default PUBLIC execute that PR #33 closed is not present on this database. The write sets `nfc_provisioned_at = now()` and `nfc_provisioned_by`, and always inserts an `nfc_provisioned` audit event. There is no idempotency key, no tag UID, no NDEF payload hash, and no check that a write occurred. The HTTP handlers accept `{}`. Both Web NFC and the Expo writer POST after a successful (or same-URL) write; a member of the right role can POST without touching a tag. v1 explicitly does not store NFC UID (PR #32, migration comments).

**Risk.** Operationally the record is only good for “an owner/admin told us they wrote a tag after this timestamp,” which is enough to drive the rewrite warning after rotation and not enough to detect a fallen-off, stolen, or never-written tag. Forging a provision record does not mint a public URL and does not cross tenants. Audit spam is possible (each POST inserts). A write that succeeds on-tag but fails the POST leaves the UI in the “partial” state both clients already handle.

**Recommendation.** Keep UID out of v1 if the product does not yet need hardware identity. If fulfilment exists, the binding belongs on a tag-inventory row (UID or batch id), not on this RPC. Make the audit insert idempotent on `(stand_id, request_id)` or skip a new event when the timestamp is being refreshed. Add pgTAP for anon/member/outsider/owner (finding 16). Do not treat `nfc_provisioned_at` as proof of a physical write.

### 7. The public `/q/{token}` path does not record a tap, and “per-device dedupe” is not in the database — High (spec vs code)

**Files / RPCs.** `SYSTEM_CONTEXT.md` §3 tap flow; `frontend/app/api/v1/public/q/[token]/route.ts`; `.../sessions/route.ts`; `frontend/lib/server/customer-flow-service.ts` (`createSession`, `looksLikeBot`, `guardRead` / `guardWrite`); `frontend/features/customer-flow/customer-flow.tsx`; `app.public_create_session`; `frontend/lib/api/idempotency.ts`.

**What the code actually does.** GET context is read-only and `force-dynamic`, with `Cache-Control: no-store`. The HTML page is `robots: noindex, nofollow` and does not hit the database; the client fetches context, then creates a session only inside the rating-submit mutation. `createIdempotencyKey` mints a fresh UUID per attempt unless the in-memory/draft `sessionKey` is reused. `app.public_create_session` always inserts a `public_review_sessions` row unless that idempotency key replays. `p_record_scan` only updates `last_opened_at`; bot-like User-Agents skip that update but still get a session. There is no unique `(stand_id, client_hash, window)` constraint and no short-window per-device collapse. `client_hash` is a daily-rotating keyed fingerprint of IP + UA, stored for abuse control, not used as a dedupe key.

**Risk.** The product copy and `SYSTEM_CONTEXT.md` describe “scan recorded (deduplicated per device over a short window)” on tap. Owners using `last_opened_at` (mobile Stands tab) or live-feed “taps” are looking at rating starts, not NFC taps. A fallen-off tag that is still being tapped but not rated looks identical to a dead tag. A crawler that executes JS will hit GET (rate-limited, no scan row). A client that POSTs `/sessions` with new idempotency keys can create many sessions.

**Recommendation.** If tap counts are a product metric, create the session (or a cheaper scan row) on first interactive load, with a DB-backed `(stand_id, client_hash)` window, and keep GET itself read-only for previews. If the honest metric is “ratings started,” rename owner copy and stop calling `last_opened_at` a scan. Either way, document the chosen meaning in `SYSTEM_CONTEXT.md` so the next person does not build hardware alerting on the wrong timestamp.

### 8. Invalid, rotated, and inactive tokens are indistinguishable except for malformed strings — Low (real, limited leak)

**Files / RPCs.** `reviewLinkInactive` in `frontend/lib/server/errors.ts`; `parseTokenOrThrow` / `tokenSchema` in `frontend/lib/server/validation.ts`; `app.resolve_public_stand` (no row when unknown, paused, retired, or parent location/org inactive); missing Google URL also maps to the same 404.

**What the code does.** Unknown, inactive, and “no valid Google URL” all return HTTP 404, code `review_link_inactive`, message “This review link is not active.” Rotated tokens are unknown hashes, so they take this path. A string that fails `^[A-Za-z0-9_-]+$` or the 8–128 length bound returns HTTP 400 `validation_failed` instead. `LESSONS.md` already states unknown and inactive must match; the 400 path is the exception.

**Risk.** An attacker learns “this string is not even a token shape,” which does not help enumerate 256-bit values. Timing differences between “hash miss” and “hash hit, status inactive” on the unique index are theoretically present and practically useless at this entropy.

**Recommendation.** Optionally map malformed tokens to the same 404 so the public contract has one miss shape. Do not add distinct “rotated” or “paused” errors.

### 9. Public rate limits fail open and are cheap to multiply with unique tokens — High (real defect at public-path scale)

**Files / RPCs.** `app.consume_rate_limit` / `rpc_consume_rate_limit`; budgets in `customer-flow-service.ts` (GET: 240/min per token hash; writes: 60/min per stand hash and 30/5 min per client fingerprint); `frontend/app/api/v1/text-requests/route.ts` (schedule limiter fails closed). Live: `rate_limit_buckets` PK `(bucket, bucket_key)`; `cron.job` id 1 runs `rpc_cleanup_rate_limits` hourly on this local instance.

**What the code does.** Each public GET upserts a bucket row keyed by the *digest of the presented token*. Distinct guesses therefore create distinct rows. If the limiter RPC errors, the public path logs and continues (“fails open”) so a customer at a counter is not blocked. Writes are additionally capped per stand and per fingerprint, still fail-open. Bot UA skipping `last_opened_at` does not skip session insert.

**Risk.** A valid stolen URL: 60 session POSTs per minute per stand, more if the attacker rotates fingerprints (UA/IP), inflating that tenant’s live-feed “taps” and `last_opened_at`. Cross-tenant starvation of *scan metrics* is per-token, so one restaurant cannot directly increment another’s counts. Cross-tenant *service* degradation is real: unbounded unique-token GETs grow `rate_limit_buckets` and burn HMAC + indexed lookups on the shared database until the hourly purge (and only if `pg_cron` is actually running in that environment). The SMS schedule limiter already fails closed; the public path does not.

**Recommendation.** Fail closed on limiter-store errors for write endpoints (sessions/responses), or fail closed for all public writes and keep GET fail-open. Collapse unknown-token GET limiting onto a small number of buckets (e.g. hash of `/16` network + day, not the guessed token). Cap `rate_limit_buckets` growth. Do not count bot or unauthenticated session floods as owner-facing scans (finding 7). Load-test this path before 40k stands; it is the highest-QPS unauthenticated write-adjacent route in the product.

### 10. Write cost per real customer action is several indexed writes, not a cheap counter — Observation

**Files / RPCs.** `app.public_create_session`, `app.claim_idempotency`, `review_stands.last_opened_at`.

**What the code does.** A successful session POST: two rate-limit upserts, an idempotency claim, a session insert, an optional `last_opened_at` update, an idempotency complete. GET: one rate-limit upsert plus `rpc_public_resolve_stand` (joins stands, locations, organizations on the unique hash). Digest-key upgrade is fire-and-forget.

**Risk.** At tens of thousands of stands the unique hash lookup stays O(1). The cost that grows is `public_review_sessions` (every rating start is a row, 24h TTL on the session token but rows are not deleted — the original migration says a session is the scan the business paid for) and `rate_limit_buckets` under attack. There is no per-stand scan-count projection; `SYSTEM_CONTEXT.md` §7 “per-stand scan counts” is not a table.

**Recommendation.** If tap/scan becomes a first-class metric, add an append-only scan ledger or a projection updated in the session RPC, not a client-side count. Pair with finding 7 so the ledger’s grain is defined.

---

### Behaviour at 40,000–60,000 stands

These are **designed-but-unbuilt** gaps unless noted. `SYSTEM_CONTEXT.md` labels hardware ordering PROPOSED / NOT BUILT. The backend needed to support a physical product at that size, without designing the commercial catalogue, is:

**Bulk stand creation and batch token issuance (NOT BUILT).** Today: one `POST /api/v1/review-stands` per stand, one `generateToken()` in Node, no batch RPC. A print run of 100 stands for one location would be 100 round trips and 100 separate audit events. Need: a single owner/admin RPC that creates N stands for a location, returns N tokens *once*, stores N ciphertexts atomically (finding 3), and records a `print_run_id`.

**Print-run / fulfilment records (NOT BUILT).** There is no table for “this batch of tokens was exported on date D for printer P.” QR SVG/PNG/JSON export is per-stand and on-demand. Need: an append-only fulfilment batch (`org_id`, location, quantity, art/template version, exported_at, actor) linking to stand ids, so a bad print run can be rotated as a set.

**Tag inventory (NOT BUILT; column stub only).** `review_stands.hardware_reference` exists and is unused. `stand_type` is `'printable_qr' | 'physical_nfc'` but `rpc_create_stand` always inserts `'printable_qr'`. Need: a `tags` (or inventory) table keyed by factory UID or reel/batch id, state (`blank | bound | locked | returned | lost`), without putting UIDs on the public URL.

**Tag-to-stand binding at manufacture (NOT BUILT).** v1 writes the URL in the field and records a timestamp. Factory encoding would invert that: mint tokens in the warehouse, write NDEF before shipping, bind UID → stand. That requires the inventory table, a service-role bind RPC, and a decision about write-locking (PR #32: tags are deliberately *not* write-locked so rotation can rewrite). At scale, lock after QA and issue a replacement SKU for rotates, rather than relying on every owner to own an NFC phone.

**Replacement flows (partially IMPLEMENTED, incomplete).** Rotate + reprint + rewrite is the only replacement. It is destructive (finding 5), reprint is broken for post-onboarding stands (finding 3), and there is no “this physical unit is a replacement for stand X” link. Need: replacement as a first-class transition that optionally preserves scan history on the stand id while issuing a new token, and a reason code (`compromised | damaged | print_error | lost`).

**Silent-stand detection (NOT BUILT; metrics grain wrong).** `last_opened_at` exists but is updated only when a non-bot session is created, which is at rating submit (finding 7). The home “No scans this week” banner uses `ratingsToday === 0 && recentCount === 0`, and `recentCount` is “up to 50 ratings ever,” not a week of taps. There is no job that flags `now() - last_opened_at > expected_interval` per stand, no expected-rate model, and no owner notification channel (`SYSTEM_CONTEXT.md` lists monitoring/alerting as not built). Need: a defined scan grain, a scheduled sweep (see Part B), and a per-stand expected quiet threshold the owner can set — after the grain is honest.

**What is already adequate at this row count.** Unique hash lookup; RLS on `org_id`; token entropy; service-role-only public resolve. Do not shard tokens or introduce a shorter public id. The scale problem is operational identity of *physical objects*, not Postgres’s ability to hold 60,000 rows.

---

### Missing tests

**pgTAP (does not exist today).** `TESTING.md` lists 326 planned assertions across seven files and states there is no dedicated NFC pgTAP file. `token_rotation_test.sql` (18) covers digest-key rotation continuity and `rpc_rotate_stand_token` privilege in `security_hardening_test.sql`, not NFC and not “old URL 404 after stand-token rotate.” Minimum new file, e.g. `supabase/tests/nfc_provisioning_test.sql`:

1. `anon` `has_function_privilege(..., EXECUTE)` is false for `rpc_record_nfc_provision` (regression of PR #33).
2. Authenticated `member` and `viewer` call raises `not_found_or_forbidden`; `nfc_provisioned_at` unchanged; no audit row.
3. Outsider (other org) raises `not_found_or_forbidden`.
4. Owner and admin succeed; `nfc_provisioned_at` is set; `nfc_provisioned_by = auth.uid()`; exactly one `nfc_provisioned` audit event per call (or the idempotent behaviour you choose).
5. `rpc_create_stand` persists non-null `public_token_encrypted` (once finding 3 is fixed).
6. After `rpc_rotate_stand_token`, `app.resolve_public_stand(old_hash)` returns no row; `new_hash` returns the stand; `token_rotated_at > nfc_provisioned_at` when a provision existed.
7. Direct `UPDATE` of `nfc_provisioned_at` as authenticated throws `42501`.
8. Authenticated `SELECT` of `public_token_encrypted` is denied once finding 4 is fixed.

**Vitest.** `frontend/tests/unit/stands-system.test.ts` re-implements URL construction, role lists, and date comparison inside the test file; it does not import `standUrl`, `recordNfcProvision`, or the QR route. Replace tautologies with handler tests: member POST `/nfc-provision` → 403; owner POST → 204; create-stand followed by QR GET → 200 with a decryptable URL (not 409).

**Minimum real-device gate (unchecked).** Do not close GitHub issue #31, and do not label NFC LIVE-VERIFIED, until `docs/testing/NFC_DEVICE_TEST_CHECKLIST.md` and `docs/mobile/MOBILE_RELEASE.md` §6 pass on hardware. The blocking subset:

- Owner and admin can write; member and viewer cannot (UI hidden and POST 403).
- Blank NTAG213/215 write + `getNdefMessage()` read-back `verified: true`.
- Same-URL short-circuit records provision without a needless rewrite.
- Foreign content requires confirmation; locked tag errors cleanly.
- Second-phone tap opens `https://<PUBLIC_FRONTEND_URL>/q/<token>` and completes rating → equal Google opportunity.
- After rotate, old tag shows the inactive page; rewrite clears the dashboard warning.
- iPhone-written tag reads on Android and the reverse; Web NFC tag reads on iPhone; QR and NFC for one stand are the same URL.

CI should keep evaluating `expo config` and unit tests; it should not pretend `prebuild:check` or a tap happened.

---

## Part B — ADR: background job platform

### Context

`SYSTEM_CONTEXT.md` §8: the background-job platform is an **open decision** and must not be settled without an ADR against durability, operational burden, cost, and failure modes. Text Requests already implement a Postgres transactional outbox plus `POST /api/v1/internal/sms/dispatch`. That is a queue table and a worker entrypoint, not a platform choice. PostgreSQL is the source of truth for consent, quota, message state, and money-adjacent ledgers. A queue is transport. Redis or any broker must never be the sole record of those facts.

The application is Next.js 16 on Vercel with Supabase Postgres. There is no owner UI for Text Requests and no live provider (`SMS_PROVIDER` fails closed in production unless configured). This ADR is for the platform that must exist before a real send, not a claim that SMS is live-verified.

### Workload requirements

Stated scale: 15,000–20,000 businesses, roughly 2–3 stands each (40,000–60,000 stands). Text Requests are not yet in production, so volumes below are **planning assumptions**, not measurements.

| Assumption | Conservative | Planning (used below) | Aggressive |
|---|---|---|---|
| Businesses | 15,000 | 20,000 | 20,000 |
| Fraction sending on a given day | 10% | 25% | 50% |
| Texts per sending business per day | 8 | 12 | 30 |
| **Daily messages** | **12,000** | **60,000** | **300,000** |

Quiet hours are `[09:00, 20:00)` in the stand location’s IANA zone (`DEFAULT_QUIET_HOURS` in `frontend/lib/server/sms/quiet-hours.ts`, re-checked in `app.sms_begin_dispatch`). That is an 11-hour local window. Scheduling uses `nextAllowedSendTime` at create and stores `available_at = scheduled_for` on `sms_outbox`, so most “hours ahead” delay is a column, not a broker timer.

**Average in-window rate (planning):** 60,000 / (11 × 3,600) ≈ **1.5 messages/second**.

**Peak (planning):** US continental zones plus AK/HI. Overnight deferrals become due at 09:00 local. If 30% of daily volume is waiting at 09:00 ET and lands in a 15-minute burst: 0.3 × 60,000 / 900 ≈ **20 messages/second**. Aggressive daily volume scales that to ~100/s. Provider (Twilio A2P) throughput is a separate cap and is not characterised here — no live account.

Derived requirements, grounded in this repo:

- **Scheduled / delayed execution.** Hours ahead, DST-safe, stored as `available_at`. Re-validated at dispatch (consent, suppression, quiet hours). A 15-minute broker delay (SQS) is not enough; a 7-day delay (Vercel Queues) is enough for current Text Requests and not a reason to move the clock out of Postgres.
- **Quiet hours across US zones.** Already implemented in SQL and TypeScript. The platform must not send just because a job is “due” in UTC.
- **Retry with backoff.** `sms_outbox_fail` uses exponential backoff (`BACKOFF_BASE_SECONDS * 2^min(attempts,6)` in `dispatch.ts`); `max_attempts` default 8 then `dead_letter`.
- **Idempotency.** Unique `(org_id, dedupe_key)` on `text_requests`; unique outbox `idempotency_key`; partial unique index of one in-flight attempt; webhook inbox dedupe; Twilio send uses `idempotencyKey: req:<request_id>`.
- **`provider_unknown`.** Timeout or worker death after `sending` is parked, quota kept, **never auto-retried**. Intended resolution is a delivery webhook (`app.sms_apply_delivery_status`) or a reconciliation poll that **does not exist** as a scheduled job.
- **Ordering.** No per-recipient send ordering beyond “don’t double-send.” STOP/START follows verified provider arrival (documented limitation in `TEXT_REQUESTS.md`). Global FIFO by `available_at` is an implementation accident, not a business rule.
- **Fairness.** Not implemented. `app.sms_outbox_claim` orders by `available_at` with `SKIP LOCKED` and no `org_id` interleaving. One large sender with earlier `available_at` can occupy every claim slot.
- **Recurring jobs the system will need, none of which are wired to dispatch:** `rpc_sms_quota_expire` (exists, not in `cron.job`); `rpc_cleanup_rate_limits` and `rpc_cleanup_idempotency` (scheduled hourly **on this local** `pg_cron`); `app.purge_public_flow_ephemera` (client_hash scrub — not scheduled); `provider_unknown` reconciliation; future margin snapshots, rate-card refresh, stand-silence sweep (Part A), billing quota allocation (purchase NOT BUILT).

### Current mechanism and its limits

**How it is invoked.** `POST /api/v1/internal/sms/dispatch` checks `Authorization: Bearer` against `SMS_WORKER_SECRET` with `timingSafeEqual` (length mismatch returns false immediately). If the secret is unset, every caller gets 404. On success it runs `dispatchOnce({ limit: 25, leaseSeconds: 90 })`: claim via `rpc_sms_claim_outbox`, then a **sequential** `for` loop of begin → provider `send` → settle → complete/fail/defer.

**What schedules it today.** Nothing in-repo. `frontend/vercel.json` is `{ "framework": "nextjs" }` only. `docs/backend/TEXT_REQUESTS.md` §20 lists “a scheduler (cron) to call it” as **needs-provider**. Local `cron.job` does not call dispatch or `rpc_sms_quota_expire`.

**If it is never called.** `text_requests` sit in `scheduled`/`queued` with reserved quota; `sms_outbox` rows stay `pending` until `available_at`. No SMS leaves. Quota remains reserved. This is silent from the owner’s point of view because there is no owner UI and no alerting.

**If it is called twice concurrently.** Safe for double-send: `SKIP LOCKED` + lease-owner guards on complete/fail/defer + one in-flight attempt. Extra invocations burn worker secret checks and extra claims of *other* due jobs, which is the desired scale-out.

**Where polling breaks as the backlog grows.**

1. **Throughput.** 25 sequential provider calls at ~400 ms RTT ≈ 10 s and ≈ 2.5 sends/s per invocation. One cron tick per minute that does *not* loop yields 25/min ≈ 0.42/s — below the 1.5/s planning average, far below a 20/s peak.
2. **Duration.** The route sets no `maxDuration`. Vercel Functions default to 300 s on current Fluid limits (Hobby max 300 s; Pro default 300 s, max 800 s, extended 1800 s beta) — source: Vercel Functions limitations, fetched 2026-09-08. A naive 25-job batch fits; a drain loop must stop before the platform timeout and leave unclaimed rows for the next tick.
3. **Fairness.** Global `ORDER BY available_at` + a 25-row limit means a 10,000-message catch-up for one org blocks everyone else for many minutes.
4. **`provider_unknown`.** Parked forever unless a webhook arrives. No poller, no SLA, quota stays reserved (correct for not double-sending, wrong as an unattended state).
5. **Quota expiry.** `app.sms_quota_expire` is a cron target in comments only. Expiry is also applied under the lock on reserve, so spend is still safe; org-wide sweep of lapsed allocations will not run until something calls the RPC.
6. **Claim index.** `sms_outbox_claimable_idx` on `available_at` WHERE status in (`pending`,`leased`) is the right shape. Table growth of `done`/`dead_letter` is not the claim hot path; it is an operational retention issue (no purge job).

The outbox design is CI-tested (pgTAP leasing, dead-letter, quiet-hours defer, stranded-send recovery). The **relay** is the hole.

### Options considered

Comparison against the planning workload (60k messages/day, ~1.8M/month, peak ~20/s), with Postgres remaining SoT in every option that is viable. Cost figures are **order of magnitude** from vendor pages fetched 2026-09-08, not quotes.

| Option | Durability | Delivery semantics | Max execution | Delay / schedule | Concurrency / fairness | Observability | Lock-in | Ops burden | Failure modes | Cost magnitude at 60k/day |
|---|---|---|---|---|---|---|---|---|---|---|
| A. Existing outbox + Vercel Cron drain + `pg_cron` SQL | Postgres commit | At-least-once claim; exactly-once *effects* via existing idempotency | 300 s default / 800 s Pro max per invocation | `available_at` unbounded | Must add org interleaving in SQL | DIY (logs, later metrics) | Low (Vercel already hosts the app) | Low until a worker is required | Missed cron; timeout mid-batch (lease recovers); fail-open if secret leaked | Cron included on Pro; function CPU for drain time. Pro seat $20/user/mo (Vercel pricing page) |
| A2. Outbox + long-lived worker | Same | Same | Process lifetime | Same | Worker concurrency + SQL fairness | Same + process metrics | Low | Medium (keep a container alive, deploy, health) | Process death (lease recovers); forgotten instance | Typically a small VM; not fetched as a 2026 SKU here |
| A3. Outbox + pgmq *instead of* `sms_outbox` | Postgres; unlogged queues exist as a footgun | Visibility timeout “exactly once within VT” (pgmq docs) | Worker-defined | VT / `available_at` must be reimplemented | Same SKIP LOCKED class | DIY | Low | Medium rewrite | Lose domain coupling (quota, request FK, lease-owner) | Extension cost ≈ 0; rewrite cost is engineering |
| B. Vercel Queues / Workflows as the job record | Vercel-managed, multi-AZ (changelog 2026-02-27) | At-least-once (docs/queues/concepts) | Function limits; Workflows can sleep months | Delay cap **7 days**, TTL 7 days max (docs/queues/pricing, 2026-09-08) | Max concurrency per consumer group | Dashboard | High if it becomes SoT | Low | **Public beta**; message expiry; must not be billing SoT | $0.60 / 1M operations (changelog) + function compute. ~few USD/month as *transport* |
| C1. Inngest as SoT | Inngest cloud | At-least-once transport; step memoisation for effects (Inngest docs/blog) | Platform-managed | `step.sleep` long delays | Concurrency keys (good fairness) | Strong | High; self-host exists (SSPL caveats in third-party reviews, not used as a legal opinion here) | Low on cloud | Hobby pauses at 50k executions | Pro **$99/mo** + 1M executions included; a send as run+step ≈ 3.6M executions/month at 1.8M sends — overage |
| C2. Trigger.dev Cloud as SoT | Trigger-managed workers | At-least-once / durable tasks | **No timeout** (pricing FAQ, 2026-09-08) | Native waits; waits >5s checkpointed | 200 concurrent on Pro; +$10/50 | Dashboard | Medium; Apache 2.0 self-host | Low on cloud / high if self-host | API 1,500 req/min | Pro **$50/mo** credits; $0.000025/run + compute. ~1.8M runs × $0.000025 ≈ $45 + seconds of compute |
| C3. QStash as SoT | Upstash | At-least-once HTTP push | HTTP response duration 2 h on PAYG | Delay 1 year PAYG | PAYG parallelism 100 | Logs / DLQ | Medium | Low | Treating HTTP 200 as send success; retries duplicate unless idempotent | **$1 / 100k messages** PAYG → ~$18/month for 1.8M |
| C4. Temporal Cloud as SoT | Temporal | Workflows deterministic; **Activities at-least-once**, must be idempotent (docs.temporal.io/activity-definition, 2026-09-08) | Activity timeouts; workflows long-running | Timers first-class | Task-queue workers; APS default 500 | Excellent | High | High (workers + temporal) | Overkill; activity/workflow split easy to get wrong | **$50 / million Actions** first 5M; each send is multiple Actions → tens to low hundreds USD/month plus worker hosts |
| C5. SQS + Lambda | AWS | At-least-once | Lambda **900 s** | Queue delay **15 minutes** max — insufficient alone | Concurrency + per-queue | CloudWatch | High (second cloud) | Medium | Delay cap forces EventBridge Scheduler anyway | SQS is cheap per million; Lambda duration; **operational split-brain with Postgres** |
| D. Outbox + QStash/Inngest/Cron as *wake-up only* | Postgres remains SoT | Same as A | Same as A | Wake-up cadence | Same as A | Mix | Wake-up vendor only | Low | Wake-up down ⇒ silent backlog (same as missed cron) | Wake-up cost small; do not pay per-message on a second ledger |

#### A. Postgres-as-queue (keep `sms_outbox`), improved relay

This is the mechanism the repository already built. pgmq on Supabase (docs fetched 2026-09-08) would duplicate it with a weaker domain model: pgmq has no built-in dead-letter (community writing, 2026), no lease-owner, no FK to `text_requests`, no quota hook. The improvement that matters is **who calls `dispatchOnce`, how often, and whether claim is fair** — not a new queue table.

Supabase Cron (`pg_cron`) is documented as running SQL or HTTP via `pg_net`, with a guidance cap of 8 concurrent jobs and ~10 minutes per job (supabase.com/docs/guides/cron, 2026-09-08). HTTP from `pg_net` is fire-and-forget (Supabase schedule-functions docs). That is acceptable for `rpc_sms_quota_expire` and rate-limit purge (already SQL). It is a poor sole relay for Twilio I/O: no response-status retry, easy to overlap ticks. Local `pg_cron` is installed and already runs two SQL cleanups.

Vercel Cron on Pro: 100 jobs/project, **once per minute**, per-minute precision, included; Hobby is once per day with ±59 min (vercel.com/docs/cron-jobs/usage-and-pricing, 2026-09-08). Cron invokes a Function, so Fluid duration limits apply.

#### B. Vercel Queues / Workflows

Public beta since 2026-02-27. At-least-once, 7-day delay and TTL, per-consumer concurrency, push into Functions. Fine as a *pager* for `dispatchOnce`. Unsafe as the record of a Text Request: expiry can drop an unacked send intent that Postgres still thinks is queued, and the hard rule forbids a broker as SoT for message state. Workflows’ long `sleep()` is redundant with `available_at`.

#### C. Hosted durable execution

Inngest and Trigger.dev fit TypeScript/Vercel well and give fairness knobs this outbox lacks. Using them as SoT copies `scheduled_for`, retry, and dead-letter out of Postgres and makes `provider_unknown` someone else’s state. Using them as wake-up is option D. Temporal is the strongest durable-execution product in this list and the worst fit: worker fleet, Action-priced, Activity retries that must stay aligned with `sms_begin_dispatch`’s “never resend unknown.” SQS’s 15-minute delay cannot represent quiet-hours deferral without a scheduler product sitting in front.

#### D. Self-run worker

A container that loops `dispatchOnce` with a larger limit and parallel in-flight sends (bounded by provider and fairness). Same SQL. Highest throughput and fairest place to run a 20/s peak. Cost is one small always-on process plus engineering to deploy it. This is the **promotion path**, not the first cut, because Text Requests are not live and the first missing piece is “call the trigger at all.”

### Decision

**Adopt option A: keep `sms_outbox` as the only job record; wake it with Vercel Cron on Pro (`* * * * *` → `POST /api/v1/internal/sms/dispatch`) where the handler drains until empty or a duration budget; schedule SQL maintenance with Supabase `pg_cron`.** Do not add pgmq, Vercel Queues, Inngest, Trigger.dev, QStash, Temporal, or SQS as a ledger. Optionally add a second Cron for `rpc_sms_quota_expire` *or* call that RPC from `pg_cron` directly (preferred: no HTTP).

Reasoning, in order:

1. The durability and exactly-once *effects* for money, consent, and send state already live in Postgres and are CI-tested. Replacing that with a vendor journal violates the repository hard rule and `CHANGE_SAFETY_ARCHITECTURE.md`’s outbox doctrine.
2. The actual gap is a clock, not a queue. Vercel Cron is included on the host we already use, has minute cadence on Pro, and calls code we already have.
3. At planning volume, a drain loop inside a 300 s Function at ~2.5/s sequential sends can clear the 1.5/s average. Peak 20/s needs overlapping invocations or parallel sends inside the drain — still cheaper than standing up Temporal. When that stops being true, promote to option A2 without schema rewrite.
4. Vendor queues as SoT fail specific constraints: SQS delay 15 minutes; Vercel Queues TTL/delay 7 days and beta; Inngest execution pricing at 1.8M sends/month is the wrong meter; QStash HTTP retries fight `provider_unknown`.
5. Fairness and reconciliation are SQL and job-content problems. They should be fixed in `sms_outbox_claim` (org round-robin or token bucket per `org_id`) and a `rpc_sms_reconcile_unknown` sweep, regardless of who pokes the worker.

### Consequences

- Shipping a real send now requires `SMS_WORKER_SECRET`, a Pro cron (or equivalent), and a provider — already listed in `TEXT_REQUESTS.md`.
- Hobby Vercel cannot run minute crons; production must not live on Hobby if Cron is the relay (Vercel Cron docs, 2026-09-08).
- Overlapping cron ticks are safe; they are how peak is absorbed. The drain must be duration-aware so a 300 s timeout does not become a 504 with a held lease that then waits 90 s.
- Observability remains thin until a metrics job exists. Cron “success” is not “Twilio accepted.”
- `pg_cron` HTTP to the Next app is **not** the chosen SMS relay (`pg_net` fire-and-forget). Keep `pg_cron` for SQL.

### Reversibility

High. The decision is which process calls `dispatchOnce`. Moving the caller to a Fly/Render/ECS worker, or adding QStash as a minute wake-up in front of the same route, does not migrate `text_requests` or `sms_outbox`. Revisit when **any** of these is true:

- Measured due-backlog age stays above a few minutes after overlapping drains, or peak exceeds what parallel `dispatchOnce` invocations can claim.
- We need month-long durable sleeps that are not already `available_at` (we do not today).
- We need multi-step non-SMS workflows (GBP sync, Stripe, POS) and refuse to grow more outbox topics in Postgres — then evaluate Inngest/Trigger **as orchestrators of steps whose state still lands in Postgres**.
- Vercel Cron reliability in our account is empirically poor (missed ticks). Then add an external wake-up without changing the ledger.

Do not revisit in order to “have a job platform” while the outbox is idle.

### Migration phases

No rewrite. Keep one transaction: domain row + quota reservation + outbox insert (`app.sms_schedule_request`).

**Phase 0 — Prove the trigger (no traffic).** Set `SMS_WORKER_SECRET`. Call dispatch by hand against a non-production project with `SMS_PROVIDER=fake`. Confirm claim/complete/defer/fail and 404 without the secret.

**Phase 1 — Clock.** Add `crons` in `frontend/vercel.json` for `POST /api/v1/internal/sms/dispatch` every minute (Pro). Change `dispatchOnce` to loop until zero claims or remaining duration < lease headroom; keep per-claim limit modest (25–50). Document `maxDuration` on that route. Add `pg_cron` for `rpc_sms_quota_expire` (and keep existing cleanups). Do not HTTP-call Twilio from `pg_cron`.

**Phase 2 — Safety at modest volume.** Org-fair claim (e.g. distinct `org_id` cap per batch). Parallelise provider sends *within* one worker only after measuring; the single-in-flight-attempt guard is per request, not per process. Add `rpc_sms_reconcile_unknown`: for unresolved attempts older than T, fetch provider state if the adapter can, else alert; **never** auto-transition unknown → sending. Alert on `dead_letter` count and on cron invocation failures.

**Phase 3 — Promote the relay, not the ledger.** When Phase 1 drains cannot hold SLA, run the same `dispatchOnce` in a long-lived process (multiple replicas; `SKIP LOCKED` already allows it). Leave Cron in place as a watchdog that no-ops on empty. Optional: QStash/Inngest minute ping if Vercel Cron is the weak link — ping only, payload is empty, secret header unchanged.

**Phase 4 — Other jobs as more outbox topics.** Stand-silence sweep, rate-card refresh, margin snapshot: `INSERT INTO sms_outbox`-style tables (or a generic `app_outbox`) in the same transaction as the domain write. Same worker switch on `topic`. Do not stand up a second product for the second topic.

---

## Priority-ordered remediation list

1. **Fix reprint for `rpc_create_stand` (Part A, High).** Atomic ciphertext in the create RPC; fail the HTTP handler if storage fails; pgTAP. Blocker for any second stand, including a print run of two.
2. **Put a clock on the outbox (Part B, Critical for any real SMS).** Vercel Cron drain + `SMS_WORKER_SECRET`; `pg_cron` for `rpc_sms_quota_expire`. Without this, Text Requests cannot leave `queued` in production.
3. **Decide and implement the scan grain (Part A, High).** Either record taps on interactive load with a DB window, or stop calling rating-start a scan. Home/mobile “last scan” and future fallen-tag jobs depend on this.
4. **Harden the public limiter (Part A, High).** Fail closed on write-path limiter errors; stop allocating a bucket per guessed token; bound `rate_limit_buckets`.
5. **Org-fair outbox claim + `provider_unknown` reconciler (Part B, High).** Required before a large tenant can share the drain with everyone else, and before unknown sends can stall quota forever.
6. **NFC pgTAP + real-device gate (Part A, High for honesty).** Do not mark NFC live-verified; keep issue #31 open until the checklist is checked on hardware. Add the assertions in “Missing tests.”
7. **Revoke authenticated SELECT on token ciphertext/hash (Part A, Medium).** Reprint via definer RPC.
8. **Rotation row lock; optional non-compromise overlap (Part A, Medium).** Immediate cutover stays the default for leak response.
9. **Fulfilment backend before hardware sales (Part A, unbuilt, High when that product starts).** Batch token issuance, print-run records, tag inventory, bind-at-manufacture, replacement reason, silent-stand sweep on the honest scan grain. Not a commercial design — table/RPC list only.
10. **NFC provision audit idempotency (Part A, Low/Medium).** Stop unbounded `nfc_provisioned` rows; still do not treat the timestamp as a UID.
11. **Map malformed public tokens to the same 404 (Part A, Low).**
12. **Replace tautological `stands-system` unit tests with handler tests (Part A, Observation).**
13. **Watchdog worker (Part B, Phase 3)** only after Cron+drain is measured, not as a prerequisite for the first fake-provider send.

External facts in this document are tagged with source and fetch date in Method. Nothing here is LIVE-VERIFIED: no production NFC tap, no carrier send, and no cron invocation against a hosted Vercel project was observed in this research pass.
