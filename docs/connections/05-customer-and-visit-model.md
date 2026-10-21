# 5. Canonical customer and visit data model

**Status: PROPOSED.** A revision of open PR #74, not a second model.

## 5.1 What ReviewBoost needs, and nothing else

The only workflow is: find a person who visited, check whether they may be
texted, send one review request. That needs a reachable phone number, a name
to recognise them by, where it came from, and the visit that prompted it.

ReviewBoost is not a CRM. No addresses, birthdays, emails (V1), notes, spend,
order contents, staff, or marketing segments are imported, even when the
provider offers them.

## 5.2 Entities

```
customers                    one reachable contact in one org (keyed by phone)
  └─ customer_source_profiles    how each connected source knows this contact
  └─ customer_visits             visits from sources, attributed and versioned
sms_consent_* / sms_phone_optout  unchanged; the only place consent lives
```

### `customers` (from #74, amended)

| Column | Notes |
|---|---|
| `id`, `org_id` | |
| `phone_hash`, `phone_encrypted`, `phone_key_version`, `phone_last_four` | Same convention as Text Requests. Unique `(org_id, phone_hash)` |
| `phone_status` | `valid_format` or `invalid`. **Format validity only.** Not ownership, not line type, not consent |
| `display_name_encrypted` | Changed from #74's plaintext `display_name`: staff names and notes are already encrypted (`ARCHITECTURE.md`), customer names should be too. Chosen as the most recent name from the most recently updated source profile, and shown with its source |
| `first_seen_at`, `last_seen_at`, `created_at`, `updated_at` | |

Email columns from #74 are kept nullable but **not populated** by any V1
adapter (decision D-5.1). Removing them is also fine.

### `customer_source_profiles` (replaces #74's `customer_external_links`)

| Column | Notes |
|---|---|
| `id`, `org_id`, `customer_id` | |
| `connection_id` | FK to `integration_connections`. Null only for `manual` and `csv` |
| `source_kind` | `manual`, `csv`, `integration` |
| `external_id` | Square customer id |
| `name_encrypted` | The name *this source* gives. Kept per source so conflicts are visible |
| `source_created_at`, `source_updated_at`, `source_version` | From the provider (Square `created_at`, `updated_at`, `version`) |
| `last_synced_at`, `config_version` | |
| `status` | `active`, `detached` (provider deleted it or phone changed), `purged` |

Unique `(connection_id, external_id)` for integrations, replacing #74's
`(org_id, source_kind, external_id)`: two Square accounts (after a disconnect
and a reconnect to a different merchant) must not collide on an id they each
issued.

### `customer_visits` (from #74, amended)

| Column | Notes |
|---|---|
| `id`, `org_id`, `customer_id` | |
| `location_id` | **Added.** Mapped from the provider location; required for integrations. Quiet hours and which Tag link to send depend on it |
| `connection_id`, `source_kind`, `external_id` | Square payment id or booking id |
| `kind` | `payment` or `appointment` |
| `status` | `completed` (payment `COMPLETED`), `appointment_time_passed`, `cancelled`, `no_show`, `pending` |
| `occurred_at` | Payment completion time, or booking `start_at` |
| `source_updated_at`, `source_version` | For the out-of-order guard (§5.6) |
| `config_version` | Which mapping produced it |
| `created_at`, `updated_at` | |

Unique `(connection_id, kind, external_id)`. #74's `nulls not distinct`
constraint on `(org_id, source_kind, external_id)` is removed: it allowed at
most one manual visit with no external id per org, which would silently
collapse distinct manual visits.

**Not stored:** amounts, tips, items, card details, booking notes, staff,
service names. #74's `note_encrypted` and `meta` columns are dropped for
integration rows; `meta` invites exactly the unbounded storage this section
rules out.

### Import jobs and rows

#74's `customer_import_jobs` / `customer_import_rows` stay for CSV and manual
imports. Integration syncs use `integration_sync_runs` and
`integration_record_issues` (doc 6), which carry connection and config
version and are shaped for incremental runs rather than one-shot uploads.

## 5.3 Field mapping (Square)

| Canonical | Square source | Rule |
|---|---|---|
| `external_id` | `Customer.id` | Required |
| name | `given_name` + `family_name`, else `company_name`, else none | Trim, collapse spaces, max 120 chars. Never invented from email or phone |
| phone | `Customer.phone_number` | `normalizePhone()` from `sms/phone.ts` to E.164 using the location's country; invalid → profile kept, `phone_status = invalid`, not messageable |
| `source_*` | `created_at`, `updated_at`, `version` | Required for ordering |
| visit `external_id` | `Payment.id` / `Booking.id` | |
| visit `location_id` | `Payment.location_id` / `Booking.location_id` via mapping | Unmapped → skipped, counted |
| visit `occurred_at` | Payment `updated_at` when it became `COMPLETED`; booking `start_at` | |
| visit customer | `Payment.customer_id` / `Booking.customer_id` | Missing → no visit, counted as "no customer attached" |

A customer profile with no phone is stored as a source profile only if a visit
references it, so the sync summary can say "3 visits had no phone number";
otherwise it is not stored at all (minimal data).

## 5.4 Phone normalization

- Normalized to E.164 with the existing `normalizePhone`. A number that does
  not parse is `invalid`.
- `valid_format` means "could be dialled". It does **not** mean the person
  owns it, that it can receive SMS, or that they agreed to anything.
- No paid line-type or carrier lookup in V1 (decision D-5.2). The provider's
  delivery result after a first send is the real signal; a hard failure adds a
  `hard_bounce` suppression through the existing path.

## 5.5 Identity matching

**The messaging identity is the phone number.** Consent, opt-out and
suppression are already keyed by `phone_hash` per org, so the contact a
message goes to must be the same key. This is why `customers` stays unique on
`(org_id, phone_hash)`, as #74 has it.

Rules, in order:

1. **Same connection, same external id** → same source profile. Always.
2. **Different source, same phone** → the same `customers` row (same reachable
   contact), with **separate source profiles**. Names are not merged; each
   profile keeps its own.
3. **Same name, different phone** → **never merged.** Two different
   `customers` rows. Matching names is not identity.
4. **Same external id, phone changed at the source** → the source profile
   moves to the `customers` row for the new phone (created if needed). The old
   contact keeps its consent and opt-out history untouched, because that
   history belongs to the number. If the old contact has no remaining profiles
   and no message or consent history, it becomes eligible for purge.
5. **Same phone, conflicting names across sources** (for example a family
   sharing one number, or a business line) → flagged `names_differ` on the
   contact. The composer shows "Known as Ana Ruiz (Square) and A. Ruiz (CSV)"
   so the owner sees who they are texting. No automatic choice is presented as
   fact.

**Manual review** is needed only for case 5, and only informationally in V1:
the owner sees the conflict at send time. There is no merge or split tool in
V1 because merging is never automatic and the phone-keyed model gives nothing
to split. If a future workflow needs person-level identity (one person, two
phones), that is a new design, not a flag on this one.

## 5.6 Updates and ordering

A provider update is applied only if it is newer than what is stored:
`incoming.source_version > stored.source_version`, or, when the provider gives
no version, `incoming.source_updated_at > stored.source_updated_at`. Equal or
older is a no-op and is counted as `stale` in the run. Because the adapter
re-fetches the object on each event (doc 4 §4.3), the newest state wins
regardless of delivery order.

A visit can move `appointment_time_passed → no_show` or `→ cancelled` later.
That retracts it as a messaging prompt; if a Text Request was already sent,
nothing is unsent and the history says so.

## 5.7 Access control

- Reads: `owner` and `admin` only, through RLS (#74 already restricts to
  these roles). `member` and `viewer` cannot list customers, matching who may
  send Text Requests today.
- Decryption of names and phones happens server-side only, for the composer's
  search results and the selected recipient, and only for the caller's org.
- No API returns a full phone number. The composer shows last four digits;
  the server sends using the stored ciphertext.

## 5.8 Retention, deletion, and disconnect

PROPOSED defaults (D-5.3, owner and counsel to confirm):

| Data | Kept | Then |
|---|---|---|
| Credentials | Until disconnect | Hard-deleted at disconnect |
| Source profiles and visits from a connection | While connected | On disconnect: 30-day grace (reconnecting the same account restores them), then deleted |
| Visits from an active connection | 13 months from `occurred_at` | Deleted by the maintenance worker |
| `customers` rows with no profiles, no consent events, no Text Requests | — | Deleted with their last profile |
| `customers` rows with message or consent history | As long as that history is retained | Phone kept as hash and ciphertext; name dropped when the last profile goes |
| Consent events, `sms_phone_optout`, suppressions | Indefinitely (legal record; STOP must keep working) | Never deleted by a disconnect |
| `text_requests` and attempts | Per the existing Text Requests policy | Unchanged |
| Sync runs, issues, inbox rows | 90 days | Deleted; counts survive in run summaries |

**Account deletion** (PR #67 adds it) must be extended to cover every table in
docs 4–6 and to call provider revocation first.

**Customer deletion request** (a person asks a business to delete them): the
owner can remove a contact; the server deletes profiles and visits, drops the
name, and keeps only what the opt-out and suppression record needs.

## 5.9 Amendments to PR #74, in one list

1. Replace `customer_source_connections` with `integration_connections`
   (doc 4). Keep a synthetic source for manual/CSV.
2. Replace `customer_external_links` with `customer_source_profiles`, unique
   per connection, with per-source name and source version fields.
3. Encrypt names.
4. Add `location_id`, `kind`, `status`, `source_*`, `config_version` to visits;
   drop `meta` and `note_encrypted`; replace the `nulls not distinct` key.
5. Reduce `customer_source_kind` to `manual`, `csv`, `integration`; provider
   identity lives in `integration_connections.provider_id`.
6. Move `customer_source_sync_checkpoints` into `integration_sync_checkpoints`
   keyed by connection and stream (doc 6).
7. Keep: phone-keyed upsert with `xmax` detection, idempotent import jobs,
   consent kept separate, service-role-only writers.
