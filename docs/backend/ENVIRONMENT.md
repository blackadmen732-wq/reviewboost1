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

### Optional but recommended

```bash
# Produces the stand, session, and response token digests. Separate from the
# encryption key on purpose — see below. Falls back to
# CUSTOMER_NOTE_ENCRYPTION_KEY if unset.
TOKEN_DIGEST_KEY=

# Set only during a rotation. See "Rotating the token digest key".
TOKEN_DIGEST_KEY_PREVIOUS=
TOKEN_DIGEST_KEY_VERSION=1
```

### Why the two keys are separate

They have completely different rotation properties, and conflating them makes
one of them effectively un-rotatable.

- **`CUSTOMER_NOTE_ENCRYPTION_KEY`** protects content that must be readable
  again. Re-encrypting is possible: the ciphertext carries a key version, so old
  and new coexist during a migration.
- **`TOKEN_DIGEST_KEY`** produces one-way digests. A digest cannot be recomputed
  without the original token, and the whole point is that we never keep one.

When these were the same key, rotating it — the ordinary response to a suspected
exposure — would have invalidated every `public_token_hash` at once. **Every
printed QR code and NFC tag in the field would have stopped resolving.** Those
are physical objects on customers' tables; they cannot be recalled. The rotation
would have cost the customer money and downtime, which means in practice it
would never have been done, and a leaked key would have stayed live.

### Rotating the token digest key

Survivable, because the raw token *does* exist for one instant: when a customer
scans the code. Resolution accepts the old digest as a fallback and rewrites the
row under the new key on the way past.

```bash
# 1. Keep the current key as the fallback, install a new one, bump the version.
TOKEN_DIGEST_KEY=<new key>
TOKEN_DIGEST_KEY_PREVIOUS=<the key you are retiring>
TOKEN_DIGEST_KEY_VERSION=2

# 2. Deploy. Stands migrate themselves as they are scanned. Nothing is
#    reprinted, nothing goes down, and customers notice nothing.

# 3. Watch the migration drain:
select public_token_key_version, count(*)
  from public.review_stands group by 1;

# 4. When nothing is left on the old version, remove TOKEN_DIGEST_KEY_PREVIOUS.
```

A stand nobody scans stays on the old key until someone does. That is correct:
an unscanned stand is not a live exposure, and it migrates the moment it becomes
one. If a stand must be retired sooner, rotate *its token* — which does mean
reprinting that one stand.

`CUSTOMER_NOTE_ENCRYPTION_KEY` still belongs in a managed secret store and in
the backup procedure. Losing it makes every encrypted note unreadable.

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
