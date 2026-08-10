# Backend environment

Server-only configuration for the public customer flow. None of these are read
anywhere except `frontend/lib/server/env.ts`, and none may ever carry the
`NEXT_PUBLIC_` prefix — that prefix is what decides whether Next inlines a value
into the browser bundle, so the naming *is* the security boundary.

`.env.example` is a shared file the backend has not edited. Copy the block below
into `frontend/.env.local` for development.

---

## Required

```bash
# Supabase project. Local development values come from `supabase start`.
SUPABASE_URL=http://127.0.0.1:54321

# Bypasses row level security entirely. Server-only, never logged, never
# NEXT_PUBLIC_. In production this belongs in a managed secret store, not a file.
SUPABASE_SERVICE_ROLE_KEY=

# Encrypts customer notes and praise, and keys the lookup digests for stand,
# session, and response tokens.
#   openssl rand -base64 32
CUSTOMER_NOTE_ENCRYPTION_KEY=

# The origin printed into every QR code and written to every NFC tag, as
# {PUBLIC_FRONTEND_URL}/q/{token}. Production refuses to start without it.
PUBLIC_FRONTEND_URL=http://localhost:3000
```

### `CUSTOMER_NOTE_ENCRYPTION_KEY` — read this before rotating

It does two jobs, and only one of them is reversible.

- **Encryption.** Notes and praise are AES-256-GCM. Re-encrypting old rows under
  a new key is possible: the ciphertext carries a key version, so old and new can
  coexist during a migration.
- **Lookup digests.** Stand, session, and response tokens are stored only as
  keyed HMACs of this key. These are **not** recoverable. Rotating the key
  invalidates every existing digest, which means **every printed QR code and
  every NFC tag stops resolving** — the stands would have to be reissued and
  physically replaced.

Treat it as permanent. Store it in a managed secret store, include it in the
backup procedure, and never rotate it casually. Losing it makes every encrypted
column unreadable *and* every stand unresolvable.

The right long-term fix is to derive token digests from a separate, rotatable
key with its own version column, so token rotation and content rotation are
independent. That is not built. It should be, before the first stand is printed
for a paying customer.

---

## Local development

```bash
supabase start          # prints SUPABASE_URL and the service role key
supabase db reset       # applies every migration, then supabase/seed.sql
supabase test db        # runs the row level security tests

cd frontend && npm run dev
```

Mint a working stand and get a URL to open on a phone:

```bash
CUSTOMER_NOTE_ENCRYPTION_KEY=<same key the app uses> \
  node scripts/backend/seed-stand.mjs
```

The token is printed once and only its digest is stored, so there is no way to
recover it afterwards. That is the design, not an inconvenience.

---

## What must never happen

| Rule | Why |
|---|---|
| No `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`, ever | It would hand every visitor a key that bypasses row level security. `env.ts` throws if it sees one, and CI fails the build. |
| No secret in `frontend/lib/**` outside `lib/server/**` | Everything in `lib/server` imports `server-only`, so a client import is a build error rather than a silent leak. |
| Separate keys per environment | A preview deployment sharing production's key means a preview bug is a production incident. |
| Never log a token, note, name, or key | `lib/server/logger.ts` redacts these recursively by key name; the realistic leak is a nested provider error echoing content back, not a direct log call. |

---

## Not yet configured

These arrive in later phases and are listed so nobody wires them in early:

- Stripe — subscription billing, separate from anything in the customer flow
- Twilio — SMS. Needs a durable worker, which Route Handlers do not provide;
  that is an open architecture decision, not a missing variable.
- Resend — transactional email
- Google Business Profile — OAuth and review sync
