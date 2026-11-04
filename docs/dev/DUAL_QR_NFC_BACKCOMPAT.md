# Dual QR / NFC entry — backward-compat plan

Status: **plan only for this PR**. No production token migration.
Written before any schema change that could touch `review_stands` tokens.

## What exists today (trusted floor `#57` @ `9a8b01bd`)

One stand has **one** public token. QR and NFC both resolve to:

```
{PUBLIC_FRONTEND_URL}/q/{token}
```

The digest lives on `review_stands.public_token_hash`. Rotation replaces that
one digest. NFC provision is a timestamp on the same row
(`nfc_provisioned_at`). There is no second token, no NDEF type column, and no
QR-only vs NFC-only capability id.

Existing printed codes and programmed tags keep working because this PR does
**not** rewrite `rpc_public_resolve_stand`, token ciphertext, or rotation.

## Why not migrate now

A dual-token world (QR token ≠ NFC token) would let an owner reprint a code
without rewriting a tag, or the reverse. That is a real product want. It is
also a production-data rewrite: every live stand, every printed sticker, and
every already-programmed tag would need a dual-read window or they go dark.

This PR does not need that to ship Tags list/detail, Program Tag, or the
customer-page preview (`20260909000900_customer_page_and_entitlements.sql`).
QR and NFC already open the same customer page.

## Dual-read plan (when we do it later)

Do these in order. Do not skip to a rewrite.

1. **Additive columns only** — e.g. `nfc_token_hash` / `qr_token_hash` nullable
   beside the existing `public_token_hash`. Never drop or rename the current
   column in the same migration.
2. **Dual-read resolver** — `rpc_public_resolve_stand` accepts the inbound
   digest and matches `public_token_hash` **or** (when present) the new QR/NFC
   hashes. Unknown / paused / retired stay indistinguishable 404s.
3. **Write path stays single until backfill** — new stands still mint one
   token and copy it into both new columns. Old stands keep `NULL` on the new
   columns and resolve through `public_token_hash`.
4. **Lazy backfill on scan** — same pattern as digest key rotation. A stand
   nobody taps is not a live exposure.
5. **Owner UI then splits** — “Print a new code” vs “Program the tag again”
   only after dual-read is live and proven. Until then, one link is the truth.
6. **No reprint required** — a customer holding an old QR or an old tag must
   still open `/q/{that-token}` during the whole window.

## This PR

- Keeps the single-token stand. QR download, print, preview, and NFC write
  all use the existing `/api/v1/review-stands/{id}/qr` JSON URL.
- Tags list status (`Ready` / `Needs QR` / `Needs NFC` / `Both`) is a
  **read-model** over `nfc_provisioned_at` + `token_rotated_at`. It does not
  invent a second token.
- Customer page publish is org-level artwork. It does not change how a stand
  token resolves.

## Rejected in this PR

- Rewriting `20260808000800_rotatable_token_digests.sql` or any applied
  migration.
- Minting a second token per stand.
- Showing NDEF / hash / RPC words to an owner.
- Treating QR and NFC as two products that can drift to two customer pages.
