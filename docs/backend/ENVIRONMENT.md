# Environment Setup

## Required environment variables

The frontend requires the following environment variables. In local development,
create `frontend/.env.local`.

### Supabase

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-only, never in client bundles) |

### Encryption

| Variable | Description |
|---|---|
| `ENCRYPTION_KEY` | AES-256-GCM key for PII encryption (hex-encoded, 32 bytes) |
| `STAND_TOKEN_HMAC_KEY` | HMAC key for stand token digests |
| `ENCRYPTION_KEY_VERSION` | Current key version (integer) |

### Application

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_FRONTEND_URL` | Public URL of the frontend (for stand QR codes) |

## Local Supabase

```bash
npx supabase start        # Start local Supabase (requires Docker)
npx supabase db reset      # Apply all migrations + seed data
npx supabase test db       # Run pgTAP tests
npx supabase stop          # Stop local Supabase
```

The local Supabase instance prints connection details including the anon key and
service role key on startup.

## Separation of environments

- Development: local Supabase, `frontend/.env.local`
- Preview: Vercel preview deployments, separate Supabase project
- Production: Vercel production, separate Supabase project

Service role keys and encryption keys must differ across all three environments.
Never reuse production credentials in development or preview.
