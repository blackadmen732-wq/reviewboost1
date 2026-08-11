# Legacy Backend Requirements

Harvested from `backend/` (Express/PostgreSQL/Redis/BullMQ) before removal.
The legacy code is preserved on branch `archive/legacy-express-backend`.

## Requirements worth carrying forward

### SMS / Twilio
- Carrier-accurate segment counting: GSM-7 160/153, UCS-2 70/67
- Integer-cent money (never floats)
- Consent capture with evidence
- STOP/START/HELP command handling
- Suppression list checked immediately before each send
- Quiet hours in the recipient's timezone
- Durable transactional outbox
- Message attempt records with provider status
- 10DLC campaign registration status tracking

### Rate Limiting
- Per-IP and per-token limits
- Exponential backoff on repeated violations
- Account lockout after threshold

### Encryption
- AES-256-GCM with key versioning (carried forward to new stack)
- PII field-level encryption

### Billing / Stripe
- Webhook signature verification
- Event-ID deduplication
- Subscription state machine
- Quota ledger with atomic reservation/commit/release

### Campaign System
- BullMQ job queue for async processing
- Campaign audience snapshots (immutable)
- Delivery status tracking
- Cost reconciliation

## Patterns explicitly NOT carried forward

- Custom JWT authentication → replaced by Supabase Auth (passwordless OTP)
- Express session middleware → replaced by Supabase cookie sessions
- Redis session store → not needed with Supabase
- `review_threshold` / review gating → prohibited by product rules
- `feedback_intercepted` flag → prohibited
- Required low-rating feedback → prohibited (all feedback is optional)
- Contact collection on low ratings → prohibited
- Password-based auth + MFA → replaced by passwordless OTP
- Docker Compose orchestration → replaced by Supabase + Vercel

## Test patterns worth preserving

The legacy test suite (209 tests) verified:
- HTTP contract compliance (status codes, headers, CORS)
- Authentication boundary tests
- CSRF protection
- Input validation with Zod-equivalent schemas
- Rate limit behavior
- Domain logic (SMS segments, pricing, phone normalization)
- Cryptographic primitives (encryption round-trip, tamper detection)
