# API layer — correctness, security, and scale audit

The Next.js HTTP API is a carefully designed BFF: public customer writes are capability-token RPCs under the service role, owner writes are caller-JWT + RLS + SECURITY DEFINER functions, errors are opaque, and the five public routes match `openapi/reviewboost-public-v1.yaml`. It is **not** production-verified, and it is **not** the complete security story the foundation docs describe. The approved MFA/lockout/CSRF/TOTP controls are largely absent from this layer (TOTP is disabled in `supabase/config.toml`); member-administration RPCs are reachable on PostgREST with no AAL2 check; additional stands created via `POST /api/v1/review-stands` call a dropped ciphertext RPC and silently fail to store a reprintable token; multi-org QR/NFC fetches omit both the org cookie and `X-Organization-Id`; and the hottest unauthenticated surfaces (public scan flow, SMS webhook sink) either fail open or have no rate limit at all. Those are real defects and control gaps in code that exists today. Billing, PII export, API keys, organisation deletion, and integration connection remain **NOT BUILT** — the MFA rule that names them is APPROVED policy, not a broken live control.

## Method

Read, in this order: `SYSTEM_CONTEXT.md`, `STATUS.md`, `TESTING.md`, `LESSONS.md`, `docs/backend/ARCHITECTURE.md`, `docs/backend/CHANGE_SAFETY_ARCHITECTURE.md`, `docs/backend/ENVIRONMENT.md`, `docs/backend/TEXT_REQUESTS.md`, `frontend/AGENTS.md`. Consulted the bundled Next.js 16.3 guides in `frontend/node_modules/next/dist/docs/` for Route Handlers, caching (Cache Components and the previous model), `runtime`, `params` as a Promise, and route-segment config. `frontend/next.config.ts` does **not** set `cacheComponents`.

Enumerated all 26 `frontend/app/api/**/route.ts` files, the single server action `frontend/features/auth/select-org-action.ts`, `frontend/proxy.ts`, and `frontend/lib/server/**` (auth, tenancy, HTTP, validation, crypto, logging, env, Supabase clients, customer-flow, owner-service/owner-data, SMS). Cross-checked `openapi/reviewboost-public-v1.yaml`, the generated client, the Expo client in `apps/mobile/data/api.ts` / `apps/mobile/data/supabase.ts`, and existing unit tests under `frontend/tests/unit/` (not re-run).

Live Postgres (migrated, read-only) was queried through `docker exec` into `supabase_db_reviewboost` (`psql` is not on the host PATH). Confirmed function existence/grants, RLS flags, table privileges, and that `rpc_set_stand_token_ciphertext` is absent. No migrations, no `db reset`, no writes.

This audit is **not** live-verified against production Vercel/Supabase/Twilio. Labels below follow the repository discipline: implemented means the code exists; CI-tested means tests exist in-repo; nothing here is claimed production-ready.

## Route inventory

Auth column: **anon** = stand token in the path only; **bearer** = `Authorization: Bearer <Supabase access token>` verified with `db.auth.getUser()` in `frontend/lib/server/auth.ts`; **org** = `requireOrganizationContext` (header `X-Organization-Id`, else cookie `rb-active-org`, else query `org_id`, then membership check); **worker** = `SMS_WORKER_SECRET` Bearer; **signature** = provider webhook signature.

Tenancy: **token** = stand token hash (service-role RPCs derive the org); **membership** = `org_id` from authenticated context, never trusted from the body as authorization; **n/a** = not tenant-scoped.

Validation: **zod-strict** = `z.strictObject` via `parseOrThrow`; **zod-token** = path token schema; **adhoc** = hand-rolled checks; **raw** = `request.text()` with a byte ceiling.

Unless noted, handlers export `runtime = "nodejs"` and `dynamic = "force-dynamic"`, wrap in `handle()`, and return `Cache-Control: no-store`.

| Path | Methods | Auth | Tenancy | Request validation | Success shape |
|---|---|---|---|---|---|
| `/api/v1/public/q/[token]` | GET, OPTIONS | anon | token | zod-token | Raw `CustomerReviewContext` (no envelope). 404 identical for unknown/inactive/unconfigured. |
| `/api/v1/public/q/[token]/sessions` | POST, OPTIONS | anon | token | zod-token + `Idempotency-Key` + `createSessionSchema` | `{ sessionId }` 201 created / 200 replay |
| `/api/v1/public/q/[token]/responses` | POST, OPTIONS | anon | token | zod-token + key + `submitResponseSchema` | `{ responseId }` 201 / 200 |
| `/api/v1/public/q/[token]/google-click` | POST, OPTIONS | anon | token | zod-token + key + `googleClickSchema` | 204 empty |
| `/api/v1/public/q/[token]/team-praise` | POST, OPTIONS | anon | token | zod-token + key + `teamPraiseSchema` | `{ teamPraiseId }` 201 / 200 |
| `/api/v1/onboarding` | GET, POST, OPTIONS | bearer (no org) | user memberships | POST: zod-strict org/location/stand fields | GET `{ data: onboardingState, requestId }`; POST 201 `{ data: { organizationId, locationId, standId, standUrl, standToken }, requestId }` |
| `/api/v1/settings` | PATCH, OPTIONS | bearer+org | membership; owner/admin | zod-strict optional fields | `{ data: { updated: true }, requestId }` |
| `/api/v1/staff` | POST, OPTIONS | bearer+org | membership; any active member | zod-strict name/roleLabel | 201 `{ data: { staffId, name }, requestId }` |
| `/api/v1/staff/[staffId]` | PATCH, OPTIONS | bearer+org | membership; RPC requires owner/admin | UUID path + zod-strict | `{ data: { staffId }, requestId }` |
| `/api/v1/customer-responses` | GET, OPTIONS | bearer+org | membership + `.eq("org_id")` | `limit` clamped in service; `cursor` **not** schema-validated | `{ data, meta: { hasMore, nextCursor }, requestId }` |
| `/api/v1/customer-responses/[responseId]` | GET, OPTIONS | bearer+org | membership + id+org lookup | UUID path | `{ data: response, requestId }` or 404 |
| `/api/v1/customer-responses/[responseId]/resolve` | POST, OPTIONS | bearer+org | RPC `auth.uid()` + membership | UUID + `{ resolved: boolean }` | `{ data: { responseId, isResolved }, requestId }` |
| `/api/v1/customer-responses/[responseId]/read` | POST, OPTIONS | bearer+org | RPC membership | UUID | **Always 200** `{ data: { responseId, isRead: true, changed }, requestId }` |
| `/api/v1/customer-responses/[responseId]/notes` | POST, OPTIONS | bearer+org | RPC checks response.org_id = `context.orgId` | UUID + note schema | 201 `{ data: { noteId, createdAt }, requestId }` |
| `/api/v1/live-feed` | GET, OPTIONS | bearer+org | membership + `.eq("org_id")` | `limit` clamped; cursor strictly parsed | `{ data, meta, requestId }` |
| `/api/v1/team-praise` | GET, OPTIONS | bearer+org | membership via `praise_safe_view` | `limit` clamped; timestamp cursor unvalidated | `{ data, meta, requestId }` |
| `/api/v1/team-praise/[praiseId]` | PATCH, OPTIONS | bearer+org | RPCs load row then membership | UUID + zod-strict staffId/shared/archived | `{ data: { praiseId, status }, requestId }` |
| `/api/v1/review-stands` | GET, POST, OPTIONS | bearer+org; POST owner/admin | membership; POST `rpc_create_stand` checks location belongs to org | GET none; POST **adhoc** UUID locationId + label ≤ 100 | GET `{ data: stands[≤100], requestId }`; POST 201 `{ data: { standId, standUrl, standToken }, requestId }` |
| `/api/v1/review-stands/[standId]/rotate-token` | POST, OPTIONS | bearer+org owner/admin | RPC stand+org+role | UUID | `{ data: { standId, standUrl, standToken }, requestId }` |
| `/api/v1/review-stands/[standId]/nfc-provision` | POST, OPTIONS | bearer+org owner/admin | RPC | UUID | 204 |
| `/api/v1/review-stands/[standId]/qr` | GET, OPTIONS | bearer+org owner/admin | id+org select then decrypt | UUID; `format` ∈ svg/png/json; png `size` 150–4096 | JSON `{ data: { standUrl, label }, requestId }` or image bytes (`Cache-Control: no-store, private`) |
| `/api/v1/text-requests` | GET, POST, OPTIONS | bearer+org; POST owner/admin; GET member/viewer | membership; POST service-role RPC re-checks actor | POST zod-strict + per-org rate limit; GET `limit` 1–100 | POST 201/200 `{ data: ScheduleResult, requestId }`; GET `{ data: { items }, requestId }` |
| `/api/v1/text-requests/preview` | POST, OPTIONS | bearer+org owner/admin | stand digest matched under RLS | zod-strict phone + standToken + template | `{ data: PreviewResult, requestId }` |
| `/api/v1/text-requests/[requestId]/cancel` | POST, OPTIONS | bearer+org owner/admin | `rpc_cancel_text_request` uses `auth.uid()` | UUID | `{ data: { requestId, status: "cancelled" }, requestId }` or 409 |
| `/api/v1/internal/sms/dispatch` | POST | worker secret (404 if unset/mismatch) | global worker (all orgs) | none | `{ data: DispatchSummary, requestId }` |
| `/api/v1/webhooks/sms/[provider]` | POST | signature (`twilio` / `fake`) | derived from provider event | provider ∈ known set; body ≤ 64 KiB raw | 200 `{ data: { received, duplicate, action }, requestId }` or 403 unverified |

**Not HTTP routes, but part of the server surface**

| Surface | Kind | Auth | Notes |
|---|---|---|---|
| `selectOrganization` in `frontend/features/auth/select-org-action.ts` | Next.js server action | cookie session via `listUserOrganizations` | Sets `rb-active-org` (`httpOnly`, `sameSite=lax`, `secure` in production, 1-year maxAge). Only mutating server action found. |
| `frontend/proxy.ts` | Session refresh + owner-page redirect | cookie `getUser()` | Matcher includes **all** `/api/v1/*` except `/api/v1/public`. Convenience, not the API security boundary. |
| Owner dashboard pages | RSC via `frontend/lib/server/owner-data.ts` | cookie session | Separate from the JSON API; same RLS client. Unbounded `listStaff` / `listStands` live here. |
| PostgREST `/rest/v1/rpc/*` | Supabase Data API | user JWT + anon key | Parallel write surface. `authenticated` can `EXECUTE` member-admin and most owner RPCs directly. **anon execute on `rpc_*` is empty** (live grant query). |
| Expo `apiFetch` | Client of this API | Bearer + `X-Organization-Id` | No cookies. Native fetch typically sends no `Origin`. |

**Role gating (HTTP)**

| Role | Can call |
|---|---|
| any signed-in user | `GET/POST /onboarding` |
| any active org member | listings (responses, live-feed, praise, stands, text-requests GET); response read/resolve/notes; praise PATCH; staff POST |
| owner/admin only (HTTP `requireRole` or equivalent) | settings, stand create/rotate/QR/NFC, text-requests POST/preview/cancel |
| owner/admin only (RPC, not HTTP `requireRole`) | staff PATCH (`rpc_update_staff`) |
| viewer | listed on text-requests GET; other listings do not extra-filter by role |

There are **no** HTTP routes for member administration, billing, API keys, PII export, organisation deletion, or integration connection. Those RPCs exist in Postgres (`rpc_change_member_role`, `rpc_remove_member`, `rpc_suspend_member`) without a Next.js wrapper.

## Findings

### 1. Additional stands never store a reprintable token — High

**Files / routes:** `frontend/lib/server/owner-service.ts` (`createStand`); `frontend/app/api/v1/review-stands/route.ts` `POST`; live DB (function catalog); `supabase/migrations/20260813215530_praise_view_and_state_machine.sql` (drop); `supabase/migrations/20260831000100_nfc_provisioning.sql` (`rpc_create_stand`); `frontend/features/dashboard/add-stand-button.tsx`.

**What the code does:** `createStand` generates a token, calls `rpc_create_stand` (hash + prefix only — confirmed live: no ciphertext arguments), then `await context.db.rpc("rpc_set_stand_token_ciphertext", ...)`. That RPC **does not exist** in the migrated database (dropped in `20260813215530_praise_view_and_state_machine.sql`). The await does not check `{ error }`. The HTTP handler still returns 201 with `standToken`. The web UI discards that body and `router.refresh()`es; subsequent QR/NFC/reprint go through `GET /api/v1/review-stands/[standId]/qr`, which decrypts `public_token_encrypted` and returns 409 if null.

**Risk:** Every stand created after onboarding is a live capability token whose only plaintext copy is in a 201 the UI throws away. QR export, Copy NFC Link, and Web NFC for that stand fail until the owner rotates (rotation *does* persist ciphertext via `rpc_rotate_stand_token`). This also violates the project rule that every `.rpc()` is error-checked and becomes 503, never a silent empty. Onboarding `POST /api/v1/onboarding` is the exception: it passes ciphertext into `rpc_create_organization`.

**Change:** Extend `rpc_create_stand` to take ciphertext + key version (same pattern as rotate/onboarding) and persist atomically. Delete the call to the dropped RPC. Fail 503 if the write does not land. Cover with a route test that asserts the ciphertext RPC/arguments and a pgTAP row check. Stop discarding `standToken` in the UI until reprint works.

This is a **real defect** in implemented code, not an unbuilt feature.

### 2. Multi-org QR/NFC clients omit the org cookie and do not send `X-Organization-Id` — High

**Files / routes:** `frontend/lib/hooks/use-authenticated-qr.ts`; `frontend/features/dashboard/stand-card.tsx`; `frontend/features/dashboard/web-nfc-writer.tsx`; `frontend/lib/server/auth.ts` (`requireOrganizationContext`); `GET /api/v1/review-stands/[standId]/qr`.

**What the code does:** Org selection priority is header, then `rb-active-org` cookie, then `org_id` query, then auto-pick if the user has exactly one membership, else 400 `organization_selection_required`. QR and NFC JSON fetches send `Authorization` with `credentials: "omit"`, so the org cookie is not sent, and they never set `X-Organization-Id`. `frontend/tests/unit/security-fixes.test.ts` asserts `credentials: "omit"` as a security property.

**Risk:** A user in two organisations cannot load QR SVG/PNG/JSON or the NFC URL for a stand in the selected org; the handler cannot tell which tenant to use. Single-org accounts still work. CSRF was the reason for `omit`; Bearer is already required, so same-origin cookies are not a CSRF gadget on these routes.

**Change:** Send `X-Organization-Id` on every owner `fetch` (web and Expo already do this in `apps/mobile/data/api.ts`), or use `credentials: "same-origin"` now that Authorization is mandatory. Keep `credentials: "omit"` on the *public* customer client (`frontend/lib/api/production-customer-flow-api.ts`), which is correct.

Real defect in the multi-org path that the API was written to support.

### 3. Approved MFA is not implemented on the HTTP API, and TOTP is disabled — High

**Files / routes:** `SYSTEM_CONTEXT.md` §9; `supabase/config.toml` `[auth.mfa.totp]` (`enroll_enabled = false`, `verify_enabled = false`); every owner route under `frontend/app/api/v1/`; live grants on `rpc_change_member_role`, `rpc_remove_member`, `rpc_suspend_member`.

**What the code does:** `requireUser` accepts any valid Supabase access token. No route inspects `aal`, `amr`, or enrolled factors. Hosted/local GoTrue has TOTP enrollment off. Billing, API key creation, PII export, organisation deletion, and integration connection are **NOT BUILT**. Member administration **is** built at the database: those three RPCs are `SECURITY DEFINER`, granted to `authenticated`, and mention neither `aal` nor MFA (live `pg_get_functiondef`). Anyone who can present a member JWT to PostgREST can invoke them without passing Next.js.

**Risk:** The APPROVED rule (“MFA required for billing, member administration, integration connection, API key creation, PII export, and organisation deletion”) is not a property of this API. The most sensitive *existing* operations — Google-URL settings, stand token rotation (prints a live capability), Text Request schedule (consent + quota + SMS), NFC provision — also have no step-up. Putting MFA only in future Next.js handlers would be bypassable via `/rest/v1/rpc/...` unless the RPCs themselves require AAL2.

**Change:** Treat this as **NOT BUILT**, not implemented. Enable TOTP in GoTrue when the product is ready; add an `requireAal2` helper and enforce it in SQL on the named RPCs (not only in route handlers). Do not claim TOTP/MFA in `SYSTEM_CONTEXT.md` until enroll/verify are on and tests prove aal1 is rejected.

Designed-but-unbuilt for billing/export/deletion; **control gap** for member-admin RPCs and today’s destructive owner routes.

### 4. The public scan limiter fails open; the webhook sink and most owner mutates have no limit — High

**Files / routes:** `frontend/lib/server/customer-flow-service.ts` (`consume`); `supabase/migrations/20260808000500_rate_limits.sql`; `frontend/app/api/v1/webhooks/sms/[provider]/route.ts`; `frontend/lib/server/sms/webhook-service.ts`; `frontend/app/api/v1/text-requests/preview/route.ts`; all owner POST/PATCH except `POST /api/v1/text-requests`.

**What the code does:** Public reads consume `public-context` (240/min per stand hash); writes consume `public-write-stand` (60/min per stand) and `public-write-client` (30/5 min per daily IP+/64+UA digest). Store is `rate_limit_buckets` via `rpc_consume_rate_limit` (service-role only, live grant). On RPC error the public path **logs and allows**. Text-request *schedule* fails closed (503). Preview, webhook, dispatch, stand create/rotate/QR, notes, praise, staff, settings, onboarding, and response mutations do not call the limiter. Webhooks still `INSERT` an encrypted raw body under `unverified:` before returning 403.

**Risk:** At 15k–20k businesses the customer scan path is the shared hot path. If PostgREST or the upsert is unhappy, fail-open removes the only cross-instance brake and every stand’s GET/POST budget becomes “unlimited” on the same database. Independently, an unauthenticated client who knows the public webhook URL can POST 64 KiB blobs forever; each is encrypted and stored. That is write amplification against a global table, not one tenant. Preview is cheaper but unbounded per stolen owner token.

**Change:** Fail closed (or fail closed with a tiny local emergency budget) on public limiter errors once the limiter is itself highly available. Rate-limit the webhook by IP *and* by provider before the inbox write; drop unverified payloads after a short forensic sample, or write a hash only. Add per-org limits on preview, rotate, stand create, and notes. Keep schedule fail-closed.

Fail-open is an explicit comment (“nuisance, not a breach”). At this scale it is a shared-availability issue, which is why it is High.

### 5. Stand token rotation is a destructive mutate with no idempotency key — High

**Files / routes:** `POST /api/v1/review-stands/[standId]/rotate-token`; `frontend/lib/server/owner-service.ts` `rotateStandToken`.

**What the code does:** Each POST generates a new 256-bit token and commits hash/prefix/ciphertext in one RPC. The previous token stops resolving immediately. There is no `Idempotency-Key`. A client retry or double-click issues a *second* token and invalidates the first response’s value. QR already on the table is dead after the first call; the second call kills the reprint of the first.

**Risk:** Not money-moving, but it is the most destructive owner action that exists today (physical stands). Public customer mutates correctly require a key because “the request that times out is the normal case.” Rotation is the same class of timeout on a phone in a kitchen.

**Change:** Require `Idempotency-Key` (or reuse the public ledger) and return the stored token on replay. Alternatively make the RPC return the current ciphertext if invoked twice inside a window with the same key. Add a vitest for double POST.

Real defect. Public-flow idempotency is the template.

### 6. `rpc_sms_record_consent` is service-role with no actor/org re-check — Medium

**Files / routes:** `frontend/lib/server/sms/text-request-service.ts`; `POST /api/v1/text-requests` when `consent` is present; `public.rpc_sms_record_consent` (live: `checks_membership = false`); contrast `public.rpc_schedule_text_request` (re-verifies owner/admin + stand ownership).

**What the code does:** After `requireOrganizationContext`, the handler calls the service-role client with `p_org_id: context.orgId`. The wrapper is `SECURITY DEFINER` and delegates to `app.sms_record_consent` with no membership predicate. RLS is bypassed. `rpc_schedule_text_request` on the same request *does* re-check `p_actor_user`.

**Risk:** Today the org id comes from a membership lookup, so this is defense-in-depth, not an open IDOR. The next caller who passes a body `orgId` (or copies the consent block) writes opted-in consent for any tenant — a compliance and SMS-abuse hole. The file comment in `frontend/lib/server/supabase.ts` says the service role must only call narrow functions that derive the tenant from a stand token; this function takes `p_org_id` from the app.

**Change:** Mirror schedule: require `p_actor_user`, verify active owner/admin, verify `p_location_id` belongs to `p_org_id`. pgTAP a cross-org consent attempt as service_role with a foreign `p_org_id` and a mismatched actor.

Real gap in an implemented path; exploit requires a bug or a future caller, not a craftable public request.

### 7. Mark-read returns HTTP 200 for missing and cross-tenant IDs — Medium

**Files / routes:** `frontend/app/api/v1/customer-responses/[responseId]/read/route.ts`; `rpc_mark_response_read`.

**What the code does:** If the RPC error message contains `not_found_or_forbidden`, the handler still returns 200 `{ isRead: true, changed: false }`. `changed` is `!error`, so an already-read row (RPC no-op, no error) reports `changed: true`. Other by-id routes return 404.

**Risk:** Weak IDOR oracle (existence in *this* org vs not) that GET already provides more clearly. Clients that treat 200 as “marked read” will lie. Cross-tenant remains indistinguishable from missing, which is the intended 404 property — except this route does not use 404.

**Change:** 404 on `not_found_or_forbidden`. Return `changed: false` from the RPC when already read. Same envelope as resolve.

Real defect, limited blast radius.

### 8. CORS allowlist cannot support the Expo (or any other-origin) browser client, and omits PATCH — Medium

**Files / routes:** `frontend/lib/server/http.ts` (`corsHeaders`, `ALLOWED_REQUEST_HEADERS`); `apps/mobile/data/api.ts`; every `OPTIONS` handler.

**What the code does:** If `Origin` is present and equals `publicFrontendUrl()`, the response allows `GET, POST, OPTIONS` and a fixed header list. `Cross-Origin-Resource-Policy: same-origin`. PATCH is used by settings, staff, and praise. Expo sets `EXPO_PUBLIC_API_URL` to a different origin and sends Bearer + `X-Organization-Id`. Native fetch usually has no `Origin` (CORS does not apply). An Expo-web or other-origin browser preflight for PATCH fails.

**Risk:** Latent for current native-only mobile usage; hard-break if the same API is called from a browser on another origin. CORP is fine for no-cors subresources; it is not a substitute for an Expo origin allowlist.

**Change:** Decide whether the JSON API is same-origin only (document that Expo must be native or reverse-proxied) or add the mobile web origin and `PATCH`/`DELETE` to the preflight. Do not reflect arbitrary `Origin`.

Designed same-origin assumption colliding with a second implemented client.

### 9. Twilio signature verification uses `request.url` as the signed URL — Medium

**Files / routes:** `frontend/app/api/v1/webhooks/sms/[provider]/route.ts`; `frontend/lib/server/sms/provider/twilio.ts` `verifySignature`; `docs/backend/TEXT_REQUESTS.md` §20.

**What the code does:** The handler passes `url: request.url` into HMAC-SHA1 over URL + sorted POST params. Twilio signed whatever URL it was configured to call (`SMS_PUBLIC_WEBHOOK_BASE_URL`). Next.js `request.url` behind Vercel/Kong can differ by scheme, host, trailing slash, or internal rewrite. Tests sign a hand-built URL, not `new Request(vercelInternal).url`.

**Risk:** When (not if) the URLs differ, every authentic Twilio POST is stored as unverified and 403’d: STOP/START and delivery receipts do not apply. Combined with finding 4, retries amplify inbox writes. This is not live-verified.

**Change:** Sign over the configured public webhook URL (scheme+host+path), not `request.url`. Add a test where `request.url` is `http://127.0.0.1:3000/...` and the configured public URL is `https://reviewboost.fit/...`. Document the exact Twilio console URL.

Implemented, unverified, operationally brittle. Classic Twilio + reverse-proxy failure.

### 10. Worker-secret compare leaks length and does not use `secureCompare` — Medium

**Files / routes:** `frontend/app/api/v1/internal/sms/dispatch/route.ts`; `frontend/lib/server/crypto.ts` `secureCompare`; `frontend/lib/server/sms/provider/fake-provider.ts`.

**What the code does:** `authorized()` returns false immediately if `Buffer.from(token).length !== Buffer.from(secret).length`, then `timingSafeEqual`. `secureCompare` already hashes both sides to fixed size specifically to avoid that leak. Fake production webhooks have the same length short-circuit. Extra invocations cannot double-send (outbox leases); they *can* burn provider calls and decrypt phones in-process if the secret is known.

**Risk:** Offline length leak of `SMS_WORKER_SECRET` / `SMS_FAKE_WEBHOOK_SECRET` is low-practical. An attacker with only the public URL and **no** secret gets 404 (good). An attacker with the secret becomes a global dispatcher for every tenant.

**Change:** Use `secureCompare`. Refuse to boot production without `SMS_WORKER_SECRET` if SMS is enabled. Rate-limit the route even when authorized. Keep the 404-on-failure indistinguishability.

Real but small cryptographic hygiene gap; the 404 cover is correctly implemented.

### 11. Owner listing cursors are inconsistently validated; one `.or()` interpolates decoded values — Medium

**Files / routes:** `GET /api/v1/live-feed` + `listLiveFeed` in `frontend/lib/server/owner-service.ts` (strict); `GET /api/v1/customer-responses` and `GET /api/v1/team-praise` (timestamp `.lt()`, no decode); `frontend/lib/server/owner-data.ts` `decodeCursor` for **pages**, not the JSON API.

**What the code does:** Architecture says invalid cursors are treated as “no cursor,” UUID+timestamp checked before interpolation. Live-feed matches that spirit but **400s** on bad input, and validates a tight ISO subset before interpolating into PostgREST `.or()` — this is the LESSONS.md cursor-injection fix, and it is real. Customer-responses/team-praise pass the raw query string into `.lt("submitted_at"|"created_at", cursor)` with no format check; PostgREST errors become 503 via `databaseFailure`. `owner-data.ts` still uses `Date.parse`, which accepts `Aug 20, 2026 10:00 GMT` (confirmed in this environment); that string contains commas, which are PostgREST `.or()` separators. Those page helpers are not API routes but they are the same class of bug the API was hardened against.

**Risk:** API live-feed is in good shape. API list endpoints can 503 on garbage instead of 400/first page. SSR pages remain the weaker `.or()` path.

**Change:** One cursor codec for API and pages; reject or ignore invalid input before `.or()`/`.lt()`. Never `Date.parse` a value that will be interpolated. Add the comma-in-timestamp attack to unit tests.

Partial real defect (503 vs documented behaviour on two GET APIs); page-layer interpolation is adjacent.

### 12. Log redaction misses fields this API actually handles — Medium

**Files:** `frontend/lib/server/logger.ts`; SMS dispatch/webhook; owner create/rotate returning `standToken`.

**What the code does:** Recursive key-based redaction. Keys are compared after lowercasing and stripping `_`/`-`. The set includes `token`, `phone`, `note`, `authorization`, `secret`, etc. It does **not** include `standToken` → `standtoken`, `standUrl`, `lastFour` / `recipientLastFour`, `to`, `from`, `body`, `rawBody`, `phoneHash`. `Error` objects always log `message: "[redacted]"`, so SQL text is not leaked that way — and operators also cannot see the real error string in the JSON line (the object is still passed into `redact`, but only `name`/`message` are kept).

**Risk:** A future `logger.info("sms.scheduled", result)` or logging `provider.send` params would print recipient last-four and possibly the review URL (which embeds the stand token). Dispatch does not currently log `to`/`body`; the hole is the denylist, not a demonstrated leak in today’s call sites. Always-redacting `Error.message` fights the “503 with requestId” debug story.

**Change:** Redact by suffix (`token`, `url` if it contains `/q/`) and add `to`, `from`, `body`, `lastfour`, `rawbody`. Log `error.name` + a safe `code` (Postgres `errcode`, HTTP status) rather than wiping every message. Add a unit test around `__redactForTests` — there isn’t one.

Real denylist gap; no evidence of a current production leak from existing `logger.*` call sites.

### 13. `POST /api/v1/review-stands` validates ad-hoc and ignores extra fields — Medium

**Files / routes:** `frontend/app/api/v1/review-stands/route.ts` POST; contrast `frontend/lib/server/validation.ts` (strict objects for the public flow).

**What the code does:** `readJsonBody` then `body as Record<string, unknown>`. Checks `locationId` UUID and `label` type/length. Unknown fields are ignored (mass-assignment is limited because only those two are forwarded). `locationId` is *client input* but `createStand` passes `context.orgId` into `rpc_create_stand`, which verifies the location’s `org_id`. That is a real ownership check, not IDOR.

**Risk:** Inconsistent contract, no `strictObject`, easier to drift. Not an org-id injection.

**Change:** A shared zod schema; reject unknown keys like the public API.

Real inconsistency, not an authorization hole.

### 14. Several mutating owner endpoints have no idempotency key and should — Medium

**Routes:** `POST /api/v1/staff` (duplicate roster rows); `POST /api/v1/customer-responses/[responseId]/notes` (duplicate internal notes, append-only by design so retries duplicate); `POST /api/v1/onboarding` (slug unique → 409, acceptable); `POST /api/v1/text-requests` (optional body `idempotencyKey` + DB unique `(org_id, dedupe_key)` — **good** if the client sends a key; windowed implicit key also collapses same phone+stand+UTC bucket); cancel (second call 409 — acceptable); resolve/read/praise/nfc (RPC no-ops — acceptable).

**Risk:** Double-submit on staff and notes is a data-quality bug, not a cross-tenant one. Text-request money/message path is the one that matters and is mostly covered at the DB.

**Change:** Mandatory idempotency on notes and staff create, matching the public customer flow. Keep schedule’s DB unique key; consider promoting the optional body field to the `Idempotency-Key` header for one client convention.

Mix of real retry bugs and designed RPC idempotency.

### 15. Foundation docs overclaim CSRF, account lockout, and TOTP as implemented in this repository — Medium

**Files:** `SYSTEM_CONTEXT.md` §9; `supabase/config.toml` `[auth]` / `[auth.rate_limit]` / `[auth.mfa]`; `frontend/lib/server/auth.ts`; `frontend/features/auth/select-org-action.ts`.

**What the code does:** Refresh-token rotation is real (`enable_refresh_token_rotation = true`, reuse interval 10s). Short-lived access tokens (`jwt_expiry = 3600`) are real. `requireUser` verifies with GoTrue, not local JWT parse. Cookie `rb-active-org` is `httpOnly` + `sameSite=lax`. Owner JSON APIs require an `Authorization` header (browsers do not add that on a cross-site form POST — this **is** CSRF defense for those routes). There is **no** CSRF token, no CSRF middleware, no per-account lockout table or GoTrue lockout setting. Sign-in is bounded per IP (`sign_in_sign_ups = 30` / 5 min, `token_verifications = 30` / 5 min, `email_sent = 2` / hour). TOTP is off (finding 3).

**Risk:** Readers treat §9 as an inventory of working controls. The CSRF story is “Bearer + SameSite,” not a CSRF implementation. IP rate limits are not account lockout (shared NAT, rotating IPs).

**Change:** Relabel: refresh rotation **implemented**; CSRF token **NOT BUILT** (Bearer mitigation **implemented** for JSON APIs); account lockout **NOT BUILT** (GoTrue IP limits **implemented**); TOTP **NOT BUILT**.

Honesty defect in docs, not a new runtime hole beyond finding 3.

### 16. Per-request auth cost is two GoTrue `getUser` calls plus a memberships query — Medium (scale)

**Files:** `frontend/proxy.ts` (matcher includes `/api/v1/*` except public); `frontend/lib/server/auth.ts` `requireUser` / `requireOrganizationContext`.

**What the code does:** Every non-public API request runs `proxy` → `createServerClient` + `getUser()` (cookie). The handler then `createClient(anon, persistSession: false)` with the Bearer token and `getUser()` again, then `SELECT` all active memberships. A new JS Supabase client is allocated per owner request. `serviceRoleClient()` is a module singleton.

**Risk:** Not a security bug. At 15k owners opening dashboards and the mobile app polling live-feed, this is three network hops to GoTrue/PostgREST before business SQL. Mobile sends no auth cookies, so the proxy `getUser()` is wasted.

**Change:** Exclude `/api/v1/` from `proxy.ts` (pages still refresh the cookie). Cache memberships briefly per `(userId, orgId)` if needed. Reuse one client instance per request.

Scale / layering; documented as convenience-not-boundary, which is accurate.

### 17. No health route despite `validateServerConfig` — Low

**Files:** `frontend/lib/server/env.ts`; no `app/api/health/route.ts`.

Misconfiguration (missing encryption key, `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` set, bad `PUBLIC_FRONTEND_URL`) is discovered on the first customer request, not at deploy. Add `GET /api/internal/health` gated by network, calling `validateServerConfig()`.

### 18. `GET /onboarding` uses the user’s first membership, not the selected org — Low

**Files / routes:** `getOnboardingState` in `frontend/lib/server/owner-service.ts`; `GET /api/v1/onboarding`.

Progress is derived from `organizations[0]`. A second-org user sees the first org’s completeness. Selection is otherwise cookie/header based. Fix: take `requireOrganizationContext` when any membership exists.

### 19. Fake SMS webhooks are trusted whenever `NODE_ENV !== "production"` — Low

**Files:** `frontend/lib/server/sms/provider/fake-provider.ts`.

By design for tests. A preview or mislabelled environment with `SMS_PROVIDER=fake` and `NODE_ENV=development` accepts forged STOP/START. Production requires `SMS_FAKE_WEBHOOK_SECRET`. Keep fail-closed unless `SMS_PROVIDER=fake` **and** a secret is set, in every deployed environment.

### 20. Caching of authenticated JSON is currently safe; the Next 16 default is easy to get wrong later — Observation

**Files:** `frontend/next.config.ts` (no `cacheComponents`); every `route.ts` `dynamic = "force-dynamic"`; `frontend/lib/server/http.ts` `Cache-Control: no-store`; bundled docs `01-app/01-getting-started/15-route-handlers.md`, `01-app/02-guides/caching-without-cache-components.md`, `01-app/03-api-reference/03-file-conventions/02-route-segment-config/index.md`.

Route Handlers are **not** cached by default. `dynamic` / `revalidate` / `fetchCache` are removed **only when Cache Components is enabled**; it is not. GET handlers all read `request` (headers, cookies, or `await params`), which would also opt them out of prerender under Cache Components. `json()` sets `no-store`. QR images set `no-store, private`. `React.cache()` in `owner-data.ts` is per-request memoization, not a shared tenant cache.

**Residual risk:** enabling `cacheComponents: true` later, or adding `export const dynamic = "force-static"` / `"use cache"` on a GET that includes org data, would be a cross-tenant leak class. There is no test that fails the build if those appear under `app/api`.

**Change:** A source test: no `use cache` / `force-static` / `unstable_cache` under `app/api` or `lib/server`. Keep `no-store` on authenticated responses.

### 21. Service-role key containment is real; not every service-role call derives tenancy from a token — Observation / see 6

**Files:** `frontend/lib/server/supabase.ts`; `frontend/lib/server/env.ts`; `apps/mobile/scripts/check-no-service-secret.js`; live grants.

`import "server-only"` on the client; `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` throws at read; mobile CI script decodes JWTs for privileged `role` claims. Live: `anon` cannot execute any `public.rpc_*`. Public customer RPCs are service-role-only and key by stand/session/response **hashes**. SMS worker/webhook RPCs are service-role-only and global by design (outbox, inbox). Owner path uses the caller JWT except schedule + consent (finding 6). Direct table `.from()` on the service-role client was not found in production server code; SMS/customer-flow use `.rpc()` only.

This matches the documented containment story, with the consent exception.

### 22. `org_id` as client input is selection, not authorization — Observation

**Files:** `frontend/lib/server/auth.ts`; resource-by-id routes; `rpc_create_stand` / `rpc_add_response_note` / `rpc_schedule_text_request` (live).

Header/cookie/query org ids are UUID-checked and matched against **this user’s** active memberships; mismatch is 404. Body `locationId` / path `standId` / `responseId` / `staffId` / `praiseId` / `requestId` are then passed into RPCs that `SELECT` the row and compare `org_id` plus `auth.uid()` (or `p_actor_user` on schedule). Live table grants: `authenticated` has **SELECT only** on tenant tables (plus `profiles` column UPDATE). `anon` has **no** table grants in `public` for the inventoried tables. That is the IDOR story, and it is implemented, CI-tested in pgTAP, not live-verified.

No HTTP route was found that takes an org id from the JSON body and uses it as the tenant without a membership check. Query `org_id` is a documented fallback for `requireOrganizationContext`, still membership-validated.

## OpenAPI drift

`openapi/reviewboost-public-v1.yaml` is explicitly the contract for **the five anonymous customer-flow operations only**. That is a design choice (`docs/backend/CHANGE_SAFETY_ARCHITECTURE.md`), not an accident. Drift against that document:

| Item | Spec | Code |
|---|---|---|
| Five public paths and methods | GET context; POST sessions/responses/google-click/team-praise | Match |
| Idempotency-Key required on the four POSTs | required header | `parseIdempotencyKeyOrThrow` |
| Strict request bodies | `additionalProperties: false` | `z.strictObject` |
| Success bodies | unenveloped DTOs | `json()` raw DTO (no `{ data }`) |
| Error envelope | `{ error: { code, message, details? }, requestId }` | `errorResponse` |
| Public error `code` enum | no `not_found` / `forbidden` / `quota_exhausted` / `organization_selection_required` | Those codes exist in `ERROR_CODE` for **owner/SMS** routes only |
| 404 inactive stand | `review_link_inactive` | `reviewLinkInactive()` |
| google-click success | 204 only | 204 on create and replay |
| OPTIONS / CORS | “same origin, no preflight” | OPTIONS implemented anyway for non-browser callers |
| `Cache-Control: no-store` | documented on GET context | set on all `json()` responses |
| Owner, internal, webhook, text-requests | **absent** | 21 additional `route.ts` files |
| Member-admin RPCs | absent | reachable on PostgREST, not Next.js |

**Spec but not code:** none of the five public operations.

**Code but not spec:** everything in the inventory table except those five, plus the server action. There is no owner OpenAPI document. Generated `frontend/lib/api/generated/customer-flow.ts` is public-only.

**Shape/status mismatches on the public five:** none found in handlers versus YAML. Owner routes wrap `{ data, requestId }` which would be wrong if they were under this spec; they are not.

If the public spec is the “single source of truth” for *the platform HTTP API*, that statement is false today. It is true for the customer page.

## Behaviour at 15,000–20,000 businesses

Assumptions: Next.js on Vercel (nodejs runtime, not Edge — Edge is deprecated in this Next 16), Supabase-hosted Postgres + PostgREST, Expo and browsers as clients, public `/q/{token}` as the viral surface. Not load-tested (`STATUS.md`).

**What one request costs**

- Public GET context: 2 service-role RPCs (rate-limit upsert + resolve stand) on the process-wide `serviceRoleClient()`. Optional fire-and-forget digest upgrade. No GoTrue. Proxy matcher **excludes** this path — good.
- Public POST (session/response/click/praise): 2 rate-limit RPCs + 1 domain RPC; AES-GCM encrypt of note/body; mandatory idempotency ledger inside the domain RPC.
- Owner GET: proxy `getUser` (cookie) + handler `getUser` (Bearer) + memberships select + query. Live-feed: two parallel selects then merge-sort. Customer-responses list: one select, limit+1.
- Owner mutate: same auth tax + one SECURITY DEFINER RPC (caller JWT), except Text Request schedule (service-role RPC + optional consent RPC + two RLS reads for stand/location).
- Dispatch POST: claim up to 25 outbox rows, then **synchronous** `provider.send` per job (Twilio HTTP, 15s timeout) while holding a lease. That is the right side of the outbox, but the HTTP request duration is `O(claimed sends)`.

Next.js does **not** open Postgres connections. It talks HTTP to PostgREST (local Kong `:54321`; hosted project URL). Local `[db.pooler] enabled = false`. Hosted Supabase typically places PostgREST against a pooled Postgres; that pool is the ceiling, not “one PG connection per serverless isolate.” Isolates still fan out HTTP to PostgREST; a scan burst is a PostgREST + `rate_limit_buckets` hot-row problem, not a PG connection storm from Next.

**Payload / pagination**

- API lists clamp to 100 (25 default) except `GET /review-stands` (hard `MAX_PAGE_SIZE = 100`, no cursor) and `GET /text-requests` (no cursor, max 100).
- Unbounded reads live on **RSC** helpers: `listStaff`, `listStands`, `listLocations` in `owner-data.ts`. A chain with thousands of staff decrypts and sorts in the server process (the file says so).
- `max_rows = 1000` in `supabase/config.toml` caps accidental Data API dumps; the BFF usually asks for less.

**Public tap/scan (highest-volume unauthenticated surface)**

Cost per scan that completes the flow: context GET + session POST (records the scan unless UA looks like a bot) + response POST + optional google-click + optional praise. Dedup of scans/responses is DB idempotency (keyed digest of client key + body), plus a 24h session TTL. Rate limits are per-stand and per-client fingerprint, not global. One viral stand can consume **its** 240 GET/min and 60 write/min; it does not steal another stand’s token-hash bucket. It **does** share PostgREST, Postgres, and (if the limiter errors) the fail-open path with every tenant (finding 4). A restaurant NAT shares the client fingerprint’s IP component; UA diversity usually splits buckets; the comments in `customer-flow-service.ts` are accurate.

Write amplification on the public path is one RPC transaction per mutate (idempotency row + domain row). The webhook path is worse (finding 4).

**Cold start, region, sync provider I/O**

- `runtime = "nodejs"` on all routes; no `preferredRegion`. If Vercel is not in the same region as Supabase, every public GET pays that RTT twice.
- No Edge (cannot use `node:crypto` there anyway).
- Owner schedule does **not** call Twilio; dispatch does. Do not invoke dispatch from a user-facing request. Cron the worker. Cap `limit` (today 25) against Twilio concurrency.
- `validateServerConfig` is not on a probe; cold instances can 500 on missing secrets at first traffic.

**N+1 / dashboard assembly**

The JSON API is relatively lean. The expensive N+1 is `getRatingBreakdown` (five `count` heads) and `getOwnerCounts` (six parallel heads) in `owner-data.ts` — page data, not `/api`. `listReviews` adds a notes `in (...)` query per page. Do not copy that pattern into new API routes without a single SQL aggregate.

## Test coverage gaps

Named tests that do **not** exist (or do not prove the property):

1. `POST /api/v1/review-stands` persists ciphertext / QR reprint succeeds without rotate (would have caught finding 1).
2. Multi-org `GET .../qr` with `credentials: "omit"` and only the `rb-active-org` cookie (finding 2).
3. `requireAal2` / TOTP rejected on settings, rotate, schedule, member RPCs (finding 3).
4. Public rate-limit RPC error → 429, not 200 (finding 4).
5. Webhook 64 KiB / burst: unverified POSTs are bounded and do not grow `sms_webhook_inbox` without limit.
6. Double `POST .../rotate-token` returns the same token (finding 5).
7. Service-role `rpc_sms_record_consent` with a foreign `p_org_id` and non-member actor is denied (finding 6).
8. `POST .../read` on a random UUID is 404, not 200 (finding 7).
9. Twilio `verifySignature` with `request.url` host ≠ configured public host.
10. Logger `__redactForTests` on `standToken`, `lastFour`, `to`, `body`.
11. `POST /api/v1/review-stands` unknown JSON fields rejected (zod-strict).
12. Owner route OPTIONS preflight allows PATCH if cross-origin is in scope.
13. No `use cache` / `force-static` under `app/api`.
14. HTTP tests for text-requests schedule/preview/cancel, internal dispatch 404-without-secret, webhook 403-without-signature (logic is unit-tested in `sms-*.test.ts` / pgTAP, **not** as route handlers).
15. `GET /api/v1/customer-responses?cursor=` garbage → 400 or first page, not 503.
16. Proxy matcher does not call GoTrue for `/api/v1/*` (once excluded).
17. pgTAP: NFC provision still has no dedicated file (`TESTING.md`).
18. Expo `apiFetch` against CORS/CORP (none).

Existing coverage that **does** hold (do not redo): `frontend/tests/unit/public-api-contract.test.ts` (public status/envelope/rating-blindness, mocked DB); `owner-api.test.ts` and `multi-org-isolation.test.ts` (Bearer required, org header/cookie, some IDOR wiring); `sms-provider.test.ts` (Twilio HMAC with a matching URL, fake production secret); pgTAP tenant isolation and Text Requests (326 planned assertions). Those do not prove findings 1–7.

## Priority-ordered remediation list

1. **Fix additional-stand ciphertext** (finding 1): persist token material in `rpc_create_stand`; 503 on failure; stop calling a dropped RPC. This is broken owner product, not a backlog item.
2. **Fix multi-org QR/NFC org selection** (finding 2): send `X-Organization-Id` on every owner fetch.
3. **Idempotent rotate** (finding 5): mandatory replay key; never mint a second token for the same key.
4. **Close the public limiter and webhook flood paths** (finding 4): fail-closed (or small emergency budget) on limiter errors; rate-limit and cap unverified webhook writes before encrypt/insert.
5. **Tell the truth about MFA/CSRF/lockout/TOTP** (findings 3, 15): relabel `SYSTEM_CONTEXT.md`; when member-admin or billing ships, enforce AAL2 **in the RPC**, not only in Next.js.
6. **Re-check actor inside `rpc_sms_record_consent`** (finding 6).
7. **Mark-read 404** (finding 7); **Twilio sign the configured URL** (finding 9); **`secureCompare` on worker/fake secrets** (finding 10).
8. **One cursor library**; stop interpolating `Date.parse` output (finding 11).
9. **Exclude `/api/v1` from `proxy.ts`**; add a gated health check that runs `validateServerConfig` (findings 16, 17).
10. **Owner OpenAPI** (or an explicit “public-only spec” sentence in `CHANGE_SAFETY_ARCHITECTURE.md`); zod-strict on stand create; redaction tests; CORS decision for Expo web (findings 8, 12, 13, OpenAPI).
11. **Idempotency on notes and staff create**; per-org limits on preview/rotate (finding 14).
12. **Load-test** the public GET+POST pair and `rate_limit_buckets` under a one-stand burst and a many-stand burst before calling the scan path live-verified.
)
