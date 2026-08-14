# ReviewBoost

Private feedback and honest Google reviews for local businesses.

A physical stand (QR/NFC) that a customer taps after a visit. Every rating
from 1 through 5 is stored, and every customer receives the same neutral
Google review opportunity regardless of the rating they selected.

## Repository layout

```
frontend/          Next.js 16 App Router (TypeScript strict)
supabase/
  migrations/      Ordered SQL migrations (Supabase CLI)
  tests/           pgTAP database tests
  seed.sql         Development seed data
  config.toml      Supabase local config
openapi/           OpenAPI spec (single source of truth for contracts)
docs/backend/      Architecture and environment documentation
```

## Getting started

### Prerequisites

- Node.js 20+
- Supabase CLI (`npx supabase`)
- Docker (for local Supabase)

### Local development

```bash
# Start Supabase locally
npx supabase start

# Install frontend dependencies
cd frontend && npm install

# Run the dev server
npm run dev
```

### Database

```bash
# Apply migrations
npx supabase db reset

# Run pgTAP tests
npx supabase test db
```

### Type checking and linting

```bash
cd frontend
npx tsc --noEmit
npx eslint .
```

## Security model

- Row Level Security on every tenant table
- SECURITY DEFINER RPCs for all state transitions (no direct UPDATE grants)
- Column-level SELECT grants (encrypted fields, no response_id on praise view)
- FOR UPDATE row locking on concurrent state transitions
- Audit events on every state change, append-only
- Customer-facing routes require no authentication cookies
- Stand tokens stored as keyed digests; reprinting uses AES-256-GCM ciphertext

See `docs/backend/ARCHITECTURE.md` for details.

## Binding product rules

- Every rating from 1 through 5 is stored
- Every rating receives the same neutral Google review opportunity
- No rating threshold, no review gating
- Never claim a Google review was posted
- Unknown and inactive stand tokens produce indistinguishable public responses
- Public customer endpoints do not require authentication cookies
- Customer-facing routes never leak org IDs, location IDs, database IDs, or ciphertext
