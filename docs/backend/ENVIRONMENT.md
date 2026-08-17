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
| `CUSTOMER_NOTE_ENCRYPTION_KEY` | yes | base64, 32 bytes | AES-256-GCM key for PII encryption (customer notes, praise, staff names, reprintable stand tokens). Generate with `openssl rand -base64 32`. Store in a managed secret store and back up separately — a database restore without this key yields unreadable notes. |
| `TOKEN_DIGEST_KEY` | no | base64, 32 bytes | HMAC key for stand, session, and response token digests. Falls back to `CUSTOMER_NOTE_ENCRYPTION_KEY` if unset. Keeping it separate lets you rotate token digests without re-encrypting content. Generate with `openssl rand -base64 32`. |
| `TOKEN_DIGEST_KEY_VERSION` | no | integer (1–32767) | Current key version. Defaults to `1`. Increment when rotating `TOKEN_DIGEST_KEY`. |
| `TOKEN_DIGEST_KEY_PREVIOUS` | no | base64, 32 bytes | The key being rotated away from. Set only during rotation — stands migrate lazily as customers scan them. Remove once no stands remain on the old version (check `public_token_key_version` in the `review_stands` table). |

## Application URLs

| Variable | Required | Description |
|---|---|---|
| `PUBLIC_FRONTEND_URL` | yes (production) | Origin used in QR codes and NFC tags (`{PUBLIC_FRONTEND_URL}/q/{token}`). Production refuses to start without it. Use `http://localhost:3000` in development. |

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
3. Set `TOKEN_DIGEST_KEY` to the new key.
4. Increment `TOKEN_DIGEST_KEY_VERSION`.
5. Deploy. Stands migrate lazily: each customer scan re-digests the stand under
   the new key. All public reads and writes accept both keys during rotation.
6. Monitor: `SELECT count(*) FROM review_stands WHERE public_token_key_version < {new_version}`.
   When zero, all stands have migrated.
7. Remove `TOKEN_DIGEST_KEY_PREVIOUS` and deploy again.

Session and response tokens do not need previous-key fallback — they are created
and stored under the current key, then matched by exact equality. They expire
within 24 hours, so a rotation naturally drains them.

## Separation of Environments

- **Development**: local Supabase, `frontend/.env.local`
- **Preview**: Vercel preview deployments, separate Supabase project
- **Production**: Vercel production, separate Supabase project

Service role keys and encryption keys must differ across all three environments.
Never reuse production credentials in development or preview.
