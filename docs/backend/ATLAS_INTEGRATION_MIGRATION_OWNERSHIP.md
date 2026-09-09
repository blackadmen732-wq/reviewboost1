# ATLAS integration — migration ownership and order

Isolated integration branch only. Does **not** merge to `main`. Customer Page V2
and frontend redesign PRs are out of scope and must stay frozen.

This note exists so version numbers are assigned by **ownership**, not by
incrementing until the collision disappears.

## The collision

Two open tips both claim Supabase version `20260908000400`:

| Claimant | Tip SHA | File | What it actually is |
|---|---|---|---|
| PR #48 | `1ab4eb682eedaec57aceca9d1ba28c05dbb965b9` | `20260908000400_privilege_attack_pass.sql` | Rename of #45's `20260908000100_privilege_attack_pass.sql` after #47 already owned `00100` |
| PR #54 | `e0115c390b924f55669acdf137cef6820d50b587` | `20260908000400_sms_reconcile_sid_conflict.sql` | Next SMS `CREATE OR REPLACE` of `app.sms_reconcile_attach_sid` introduced in #47 `00300` |

Same version, unrelated SQL. A blind `git mv` of either file would either
overwrite the other claimant or leave already-migrated databases with the wrong
blob recorded under that version.

A second, earlier collision is why #48 exists at all:

| Claimant | Version | File |
|---|---|---|
| PR #45 | `20260908000100` | `privilege_attack_pass.sql` |
| PR #47 (includes #41) | `20260908000100` | `sms_settle_quota_fixes.sql` |

#48 moved privilege to `00400` to sit after #47's `00300`. #54 then independently
took `00400` as the next SMS step. That is how both tips landed on the same
number.

## Ownership (decided first)

Two trains. They do not share a version.

### SMS train owns `20260908` `00100`–`00400`

Chain: #41 ⊂ #47 ⊂ #53 ⊂ #54. Each step is a function replacement or additive
fix on the Text Requests settle / quota / reconcile path.

| Version | Owner | File | Why this train owns it |
|---|---|---|---|
| `20260908000100` | #41 / #47 | `sms_settle_quota_fixes.sql` | First 20260908 SMS migration; settle / quota / retry |
| `20260908000200` | #47 | `sms_receipt_quota_retry_hardening.sql` | Receipt-before-SID + FIFO expiry as #47 shipped it |
| `20260908000300` | #47 | `sms_provider_unknown_reconcile.sql` | Introduces `app.sms_reconcile_attach_sid` |
| `20260908000400` | #54 | `sms_reconcile_sid_conflict.sql` | Semantic next step: same function, refuse another attempt's SID |

#54 keeps `00400` because that version is the continuation of a function #47
created in `00300`. It is not a rename looking for a free slot.

#54 also edited `00200` in place to fix FIFO ghost capacity (expired grant A
must not count as `prior_capacity`). That in-place edit is **not** brought onto
this branch. `00200` stays the #47 blob. The FIFO body lands as a **new
forward** so a database that already applied #47's `00200` still receives the
fix.

### Privilege train owns `20260908000500`

Chain: #45 → #48. Independent grant / Data API / reprint-RPC work. #48's use of
`00400` was collision avoidance, not a semantic claim.

| Version | Owner | File | Why |
|---|---|---|---|
| `20260908000500` | #45 / #48 | `privilege_attack_pass.sql` | Unique. Runs **after** the SMS train so `REVOKE ALL ON ALL FUNCTIONS … FROM PUBLIC` sweeps functions #47/#54 just created |

Privilege does not depend on SMS function bodies. It does depend on those
functions *existing* so the sweep and the attack tests see them. After #47,
`rpc_sms_claim_outbox` is `(text, integer, integer, text)` — the #45 attack
file still named the 3-arg overload, which #47 drops. Integration updates that
one signature so #45 is orderable **behind** this resolution.

## Order on a fresh install (from `main`)

```
… 20260902000700 (main)
20260908000100  sms settle / quota          #47
20260908000200  receipt + #47 FIFO           #47 (unedited)
20260908000300  provider_unknown reconcile   #47
20260908000400  SID attach conflict          #54
20260908000500  privilege / grant pass       #45
20260909000100  FORWARD sms settle           idempotent; repairs #45 DBs
20260909000200  FORWARD SID conflict         idempotent; repairs #48 DBs
20260909000300  FORWARD FIFO remaining       #54 delta; repairs #47 DBs
```

#45 and #47 are therefore orderable: SMS `00100`–`00400`, then privilege
`00500`, then forwards that no already-applied version can skip.

## Already-migrated databases — new forwards, not renames

Supabase records **version numbers**, not filenames. If a database already
applied a colliding version, changing the file on disk does nothing for that
version. Fixes must be new later versions. Every forward is `CREATE OR REPLACE`
/ grant-revoke and is safe to run twice.

| Database already applied | Recorded version | Missing on this branch | Repair |
|---|---|---|---|
| #45 only (`de342a5b`) | `00100` = privilege | SMS settle `00100` | `20260909000100` reapplies settle SQL |
| #48 reset (`1ab4eb68`) | `00400` = privilege | SMS SID `00400` | `20260909000200` reapplies attach SID |
| #45 then #48, no reset | `00100` = privilege | SMS settle **and** SID | both `09000100` and `09000200` |
| #47 (`64e76371`) | `00100`–`00300` = SMS | SID + privilege + FIFO delta | `00400`, `00500`, `09000300` |
| #54 (`e0115c39`) | `00100`–`00400` = SMS | privilege (and FIFO already in their `00200`) | `00500`; `09000300` is a no-op replace |
| `main` / fresh | none of the above | full stack | all files apply; forwards are no-op replaces |

Do **not** rewrite history on `00100`–`00400` for databases that already ran
those versions. Do **not** tell an already-migrated database to `db reset`
unless it is a disposable local clone.

## Out of scope (frozen)

- Customer Page V2 (`#37`, `#42`, `#44`, `#49`)
- Frontend redesign / owner constitution (`#57` and related UI trains)
- Merging this branch to `main`
- Live Twilio, hosted Supabase apply, or any production migrate

## After the critical path

Issue #40 / `docs/backend/deep-research/03-scale-and-capacity.md` (PR #40,
`a61652245c173b2ad3c5d8199e76ca17ec0a9181`): reproduce the owner-inbox RLS
shape and propose measured index / predicate changes that do **not** weaken
tenant isolation. Evidence first; optional follow-up commits only if the
measurement holds.
