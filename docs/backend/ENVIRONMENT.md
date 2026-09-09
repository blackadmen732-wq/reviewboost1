# Environment Variables

All variables are consumed by the Next.js application in `frontend/`.
Copy `frontend/.env.example` to `frontend/.env.local` for development.
That file is gitignored; never commit real values.

## Supabase

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase anonymous (public) key |
| `SUPABASE_URL` | yes | Same project URL, server-side |
| `SUPABASE_ANON_KEY` | yes | Same anon key, server-side |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Supabase service role key (server-only, bypasses RLS). Never prefix with `NEXT_PUBLIC_` — the prefix controls browser bundling, so the naming *is* the security boundary. |

## Encryption and Token Digest Keys

| Variable | Required | Encoding | Description |
|---|---|---|---|
| `CUSTOMER_NOTE_ENCRYPTION_KEY` | yes | base64, 32 bytes | AES-256-GCM key for PII encryption (customer notes, praise, staff names, reprintable stand tokens). Generate with `openssl rand -base64 32`. **Must be its own independent value — never reuse a secret from another service** (a live payment key was once pasted here, which broke decryption and exposed that key). Store in a managed secret store and back up separately — a database restore without this key yields unreadable notes. |
| `TOKEN_DIGEST_KEY` | no | base64, 32 bytes | HMAC key for stand, session, and response token digests. Falls back to `CUSTOMER_NOTE_ENCRYPTION_KEY` if unset. Keeping it separate lets you rotate token digests without re-encrypting content. Generate with `openssl rand -base64 32`. |
| `TOKEN_DIGEST_KEY_VERSION` | no | integer (1–32767) | Current key version. Defaults to `1`. Increment when rotating `TOKEN_DIGEST_KEY`. |
| `TOKEN_DIGEST_KEY_PREVIOUS` | no | base64, 32 bytes | The key being rotated away from. Set only during rotation — stands migrate lazily as customers scan them. Remove once no stands remain on the old version (check `public_token_key_version` in the `review_stands` table). |

## Application URLs

| Variable | Required | Description |
|---|---|---|
| `PUBLIC_FRONTEND_URL` | yes (production) | Origin used in QR codes and NFC tags (`{PUBLIC_FRONTEND_URL}/q/{token}`). Production refuses to start without it. In production this MUST be `https://reviewboost.fit` — never `http://localhost:3000` or a `*.vercel.app` preview URL, because a stand printed against the wrong origin cannot be recalled. Use `http://localhost:3000` only in development. |

## Development-only

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_USE_CUSTOMER_FIXTURES` | `false` | Enable client-side fixtures for the customer flow. Ignored when `NODE_ENV` is `production` (the build fails if enabled). |
| `NEXT_PUBLIC_API_BASE_URL` | (empty) | API base URL. Leave blank for same-origin requests, which is the normal case. |

## Local Supabase

```bash
npx supabase start        # Start local Supabase (requires Docker)
npx supabase db reset      # Apply all migrations + seed data
npx supabase test db       # Run pgTAP tests
npx supabase stop          # Stop local Supabase
```

The local instance prints connection details including the anon key and service
role key on startup. Copy them into `frontend/.env.local`.

## Token Digest Key Rotation Procedure

1. Generate a new key: `openssl rand -base64 32`
2. Set `TOKEN_DIGEST_KEY_PREVIOUS` to the current `TOKEN_DIGEST_KEY` value.
   If `TOKEN_DIGEST_KEY` was never explicitly set, use the current
   `CUSTOMER_NOTE_ENCRYPTION_KEY` value instead — that is the effective digest
   key when the dedicated variable is absent.
3. Set `TOKEN_DIGEST_KEY` to the new key.
4. Increment `TOKEN_DIGEST_KEY_VERSION`.
5. Deploy. Stands migrate lazily: each customer scan re-digests the stand under
   the new key. All public reads and writes accept both keys during rotation.
6. Monitor: `SELECT count(*) FROM review_stands WHERE public_token_key_version < {new_version}`.
   When zero, all stands have migrated.
7. Wait at least 24 hours after step 5 (the maximum session and response token
   lifetime). Session and response tokens are stored as current-key digests but
   recomputed on every subsequent request. During rotation, lookups try both
   keys, but the previous key must remain available until every token created
   under it has expired.
8. Remove `TOKEN_DIGEST_KEY_PREVIOUS` and deploy again.

## Separation of Environments

- **Development**: local Supabase, `frontend/.env.local`
- **Preview**: Vercel preview deployments, separate Supabase project
- **Production**: Vercel production, separate Supabase project

Service role keys and encryption keys must differ across all three environments.
Never reuse production credentials in development or preview.

## Preview must wire Supabase env (fail closed)

Vercel preview (and any other hosted deploy) **must** set
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` against that
preview project's publishable credentials, plus the matching server-side
`SUPABASE_*` secrets.

Those values are required to construct a Supabase client. The proxy will not
pass empty strings into `createServerClient` (that 500s every matched request,
including the public homepage). It also will **not** skip the owner-page auth
gate when the values are missing. Owner prefixes (`/home`, `/feedback`,
`/praise`, `/stands`, `/settings`, `/onboarding`, `/reviews`, `/customers`,
`/select-org`) fail closed with HTTP 503. Public routes may still render.

Do not "fix" a preview homepage 500 by returning `NextResponse.next()` before
the owner-route check. Wire the preview Supabase project instead.

## Internal SMS worker scheduler

`frontend/vercel.json` registers Vercel Cron for:

| Path | Schedule | Purpose |
|---|---|---|
| `GET /api/v1/internal/sms/dispatch` | `0 6 * * *` | One outbox dispatch batch |
| `GET /api/v1/internal/sms/expire-quota` | `15 6 * * *` | `rpc_sms_quota_expire` credit sweep |

Both expressions are **once per day** so a Vercel Hobby project can deploy
`frontend/vercel.json`. An external scheduler may still POST more often. A Pro
plan can tighten the dispatch expression (e.g. `*/5 * * * *`) without a code
change to the routes.

Both routes also accept POST for an external scheduler. They authenticate with
`Authorization: Bearer` against `SMS_WORKER_SECRET` or `CRON_SECRET` (Vercel
sends `CRON_SECRET` automatically when that env is set). If neither secret is
configured the routes 404. They do not send live SMS; the dispatch worker uses
whatever `getSmsProvider()` selects (`SMS_PROVIDER=fake` in tests).

Delivery reconciliation is webhook-driven (`/api/v1/webhooks/sms/{provider}`).
Stranded `sending` rows are recovered on the next dispatch claim. There is no
Twilio status poller.

## Hosted Supabase Auth (production)

ReviewBoost is passwordless: the app calls `signInWithOtp` → `verifyOtp` and the
UI (web and mobile) accepts exactly a **6-digit** code. The hosted GoTrue config
must match, or real codes are rejected. `supabase/config.toml` is the source of
truth; apply it with `supabase config push`, or set each value in the dashboard
(Authentication → Providers → Email, → URL Configuration, → Emails):

| Setting | Required value | Why |
|---|---|---|
| Email OTP length | `6` | The code inputs accept exactly 6 digits. An 8-digit code cannot be entered. |
| Email OTP expiration | `3600` seconds | One hour; matches `otp_expiry`. |
| Confirm email | **OFF** | Passwordless OTP proves control of the address already. With it ON, a first-time user also receives a separate "Confirm your email address" email, which does not match the sign-in screen. |
| Site URL | `https://reviewboost.fit` | Used for the email fallback link. Keep localhost only in *additional redirect URLs* for dev. |
| Magic Link template | subject `Your ReviewBoost sign-in code`, body leads with `{{ .Token }}` | The sign-in email. See `supabase/templates/magic-link.html`. |
| Confirm signup template | same code-first wording | So first sign-in looks identical if confirmations are ever enabled. See `supabase/templates/confirmation.html`. |
| Custom SMTP | Resend, sender `ReviewBoost <no-reply@reviewboost.fit>` | The verified `reviewboost.fit` domain (DKIM + SPF). |

## Migration History Repair

The Supabase MCP `apply_migration` names migrations with a server-generated
timestamp, which can diverge from the repo filename. When `supabase migration
list` shows a repo file and a hosted ledger row for the *same* migration under
*different* versions, repair the ledger — do **not** re-run the DDL (it is
already applied). Known drift from the NFC work:

| Repo file | Hosted ledger version |
|---|---|
| `20260831000100_nfc_provisioning.sql` | `20260901112609` |
| `20260901120000_revoke_anon_nfc_provision.sql` | `20260901163415` |

Safe, supported repair (ledger only, runs no SQL):

```bash
supabase link --project-ref zoyqikgqfqulwkihjbev
supabase migration repair --status reverted 20260901112609 20260901163415
supabase migration repair --status applied  20260831000100 20260901120000
supabase migration list        # confirm local and remote align
```

Do not use `apply_migration` (re-runs SQL under a new timestamp) or a raw
`UPDATE` (the SQL endpoint is read-only). No database reset.
