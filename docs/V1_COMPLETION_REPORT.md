# ReviewBoost V1 — completion report

Living document. Updated at every meaningful stage, not at the end.

**Last updated:** 2026-09-15
**Integration branch:** `claude/reviewboost-v1-recovery-cokccs`
**Branch head:** `5fc6b67`
**`main` at start of this program:** `6b8adc5`
**Current stage:** destination layer landed on the integration branch; Tags and
entitlements next.

## How to read the statuses

| Status | Means |
|---|---|
| **DONE** | Implemented, and verified by something that would fail if it broke |
| **IN PROGRESS** | Being worked on now |
| **BLOCKED — EXTERNAL** | Code is finished; the remaining step needs credentials, hosted access, or hardware this session does not have |
| **BLOCKED — CODE** | Something in the repository has to change first |
| **NOT STARTED** | Does not exist |

Implementation existing is not DONE. A passing unit test is not a live
verification. Where this document says DONE it names the evidence.

## Verification available in this environment

| Gate | Available | Notes |
|---|---|---|
| TypeScript, ESLint, Vitest | yes | run per commit |
| Next production build | yes | run per commit |
| Playwright (e2e, Axe, visual) | yes | Chromium preinstalled; `PLAYWRIGHT_CHROMIUM_EXECUTABLE` points at it |
| Migrations + pgTAP | yes | via `scripts/backend/local-postgres.sh` — see below |
| Populated-upgrade proof | yes | `local-postgres.sh upgrade <baseline>` |
| `supabase start` / `supabase db reset` | **no** | the egress policy returns 403 for `production.cloudfront.docker.com` and `pkg-containers.githubusercontent.com`, so no container image can be pulled |
| GitHub Actions | yes | runs on push; it *can* pull images, so `supabase db reset` runs there |
| Vercel preview | yes | builds on push |
| Real Stripe / Twilio / device | **no** | no credentials, no hardware |

`scripts/backend/local-postgres.sh` runs the migrations and pgTAP against a
plain PostgreSQL 16 server with a minimal Supabase-shaped bootstrap (four
roles, `auth.uid()`, `auth.users`, pgcrypto in `extensions`). It proves the SQL
is correct. It cannot prove Supabase's own platform pieces agree with it —
`supabase db reset` in CI remains the reference.

## Stage status

| Layer | Status | Evidence / what remains |
|---|---|---|
| Public V1 customer contract | **DONE** | No public note, no active Team Praise, strict request schemas, dashboard indexes. 412 vitest cases, 26 Playwright cases |
| One-tap customer flow | **DONE** | Star tap → rating saved → destination. Byte-identical handoff and one identical destination asserted for ratings 1–5 in jsdom and in a real browser |
| Destination / ReviewBoost owns the door | **DONE** | `destination_provider` + `destination_url`, provider allowlist, backfill, resolver reshaped by drop/recreate, owner write with explicit org + audit. 37-assertion pgTAP suite; 20-assertion populated-upgrade proof |
| Tags + entitlements | **NOT STARTED** | Next. Caps enforced atomically in the database; missing entitlement fails closed |
| Customer Page | **NOT STARTED** | Build clean from the integration branch; #67 is reference only |
| Billing / Stripe | **NOT STARTED** | Code is buildable here; live verification is BLOCKED — EXTERNAL |
| SMS money ledger | **NOT STARTED** | Monthly-first, purchased-second. #59/#64 are read-only references |
| Text Requests / Twilio | Partially built on `main` | Backend exists and is CI-tested; owner UI not built; live send BLOCKED — EXTERNAL |
| Unified web frontend | **NOT STARTED** | #68 is the design source; port selectively from the integration branch |
| Mobile | Partially built on `main` | Expo app exists; parity work not started; physical NFC BLOCKED — EXTERNAL |
| Security pass | **IN PROGRESS** | Org isolation and RLS carried forward and extended by the destination suite; full audit not run |
| Live verification | **BLOCKED — EXTERNAL** | Stripe, Twilio, QR, NFC all need credentials or hardware |

## Product rules this work is bound by

These are settled. Any change to them is a product decision, not an
implementation detail.

- ReviewBoost owns the door. QR and NFC carry `/q/{token}` and never a
  provider's URL. Changing the destination changes no hardware.
- Google is provider #1, not the architecture.
- Every rating gets the same destination. No review gating, ever.
- No permanent free plan. A 7-day trial requires a card and gets 0 SMS.
- Starter $49 / 1 location / 3 Tags / 150 SMS. Growth $79 / 2 / 8 / 500.
  Pro $129 / 5 / 25 / 1500.
- SMS has exactly two balances: monthly included, and purchased prepaid.
  Monthly is spent first and does not roll over. Purchased persists.
- The database is authoritative for limits and money. Stripe's webhooks and
  the database are authoritative for billing state — never a browser redirect.

## Open pull requests at the start of this program

33 were open. None has been closed yet: nothing is closed until its useful
work is either landed canonically or explicitly rejected.

| PR | Disposition |
|---|---|
| #70 | Work carried onto the integration branch and extended; the wizard it left in place is removed |
| #69 | Source material for the Tags stage, not yet landed |
| #68 | Frontend design source, not yet landed |
| `claude/destination-abstraction-j7nhgo` | Superseded. Its `create or replace` of the resolver could not have applied to a populated database; the landed version drops and recreates in dependency order |
| #67, #66, #65, #64, #63, #61, #60, #59, #57, #56, #55, #53–#37, #23, #21, #9, #4 | Not yet triaged |

## Known defects found and fixed during this program

- The wizard after the star tap (a Google screen and a Continue button) was
  still in #70. Removed; the contract is one tap.
- `a`/`button { color: inherit }` sat outside a cascade layer and silently
  defeated `text-on-brand` on every primary button. Invisible in light mode;
  a 2.8:1 contrast failure in dark mode on the customer's own screen.
- The TypeScript destination validators accepted a port where the database
  refuses one — an owner-visible 503 with no explanation.
- Zod 4's `.uuid()` rejects this repository's own fixture ids.

## Next dependency

Tags and entitlements, on top of the landed destination layer.
