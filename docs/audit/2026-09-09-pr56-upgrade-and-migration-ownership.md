# PR #56 upgrade evidence + migration ownership (2026-09-09)

**NO MERGE.** Customer Page V2 remains frozen. SMS product merges remain on HOLD.
**#56 tip frozen at** `fd806fbb8362fda3fef7a8dc278616281aa90bed` (branch `cursor/forge-stand-ciphertext-24c6`). This document does not change that tip.

Marcus authoritative for this pass:

- **FREEZE #48 and #54 landings** until `20260908000400` ownership is assigned.
- **Do not renumber blindly.** Ownership and order options only.
- **#45 and #47 stay blocked** behind migration-version ownership (and SMS product HOLD for #47).

## SHAs checked

| Ref | SHA | Notes |
|---|---|---|
| `origin/main` | `26320dde3ed04115b759159497bfa4b33b6d768c` | Live local DB started from this schema (43 migrations) |
| PR #56 tip | `fd806fbb8362fda3fef7a8dc278616281aa90bed` | Unchanged after this audit |
| PR #41 | `26556d228eeee872b83989d28f400cda1f933e02` | `20260908000100` + `000200` SMS |
| PR #45 | `de342a5b869bb809ca680c93b182ec778b6f6cc9` | `20260908000100_privilege_attack_pass.sql` |
| PR #47 | `64e76371f4dd9c6b528139ba3cb7bdd8b3a4ed4b` | #41 files + `000300` reconcile |
| PR #48 | `1ab4eb682eedaec57aceca9d1ba28c05dbb965b9` | `20260908000400_privilege_attack_pass.sql` only vs main |
| PR #51 | `a342552f1488647c002a190a0080ad7e0e1f05a2` | #47 + `000400` SID; **mutated** `000200` |
| PR #53 | `e0f21bef08a101604b7d1616dbe33a18bfd5b0c6` | FIFO-only; mutated `000200`; no `000400` |
| PR #54 | `e0115c390b924f55669acdf137cef6820d50b587` | same `000400` SID blob as #51 |
| PR #37 (C-V2, frozen) | `d24a717d27b3ca26557a195268aafb895debd9da` | also claims `20260908000100` under a third filename |

#56 migration blobs at the frozen tip:

- `20260908153000_rpc_create_stand_ciphertext.sql` → `ee82bdd953cec0b202bce8e28042aa0dec77e283`
- `20260908164000_rpc_create_stand_ciphertext_format.sql` → `22ad18a3974638d23cb12f8ed433b172be42c04c`

Those versions do **not** collide with any open tip.

---

## Mission A — upgrade from a populated main-like DB

Empty-DB `supabase db reset` was **not** the path under test. The Cloud Agent stack was already on main’s 43 migrations.

### Starting schema (before #56 SQL)

```
applied migrations: 43 (latest 20260902000700)
rpc_create_stand: rpc_create_stand(uuid,uuid,text,text,text,smallint,text)   -- 7-param only
rpc_set_stand_token_ciphertext: absent
public_token_encrypted: nullable text
stands: 0
```

### Pre-fix rows inserted on that live schema

| id | ciphertext before upgrade |
|---|---|
| `81000000-0000-0000-0000-000000000001` | NULL |
| `81000000-0000-0000-0000-000000000002` | `''` |
| `81000000-0000-0000-0000-000000000003` | `'   '` (three 0x20) |

### Upgrade commands (exact)

```bash
# Extract frozen-tip SQL (do not db reset)
git show fd806fbb8362fda3fef7a8dc278616281aa90bed:supabase/migrations/20260908153000_rpc_create_stand_ciphertext.sql
git show fd806fbb8362fda3fef7a8dc278616281aa90bed:supabase/migrations/20260908164000_rpc_create_stand_ciphertext_format.sql

docker exec -i supabase_db_reviewboost psql -U postgres -d postgres -v ON_ERROR_STOP=1 < m1.sql
docker exec -i supabase_db_reviewboost psql -U postgres -d postgres -v ON_ERROR_STOP=1 < m2.sql
```

After apply:

- 7-param overload gone; 9-param `rpc_create_stand(..., text, smallint)` present.
- Setter still dropped.
- All three pre-fix stands still present with the same missing/empty/space ciphertext.

### Create → reprint → fail-closed (on the upgraded DB)

Real application ciphertext (same `v1:<b64>:<b64>:<b64>` AES-256-GCM as `frontend/lib/server/crypto.ts encrypt()`), token `proof-stand-token-upgrade-001`:

`v1:OWxZuDRjENnlhMSd:4+K4KByqitQ5AwiaVqoVDw==:5yGmNXgvtKeo5w/KJTAn48xEGmQlQGEMhscP4Iw=`

| ID | Result | Detail |
|---|---|---|
| A1–A3 | PASS | 7-param dropped; 9-param present; setter stays dropped |
| A4–A6 | PASS | pre-fix NULL / empty / spaces survived upgrade |
| A7 | PASS | `rpc_create_stand` stored the real encrypt() payload atomically; stand `d6c578ce-3859-4d8f-9827-4e1a5be75999` |
| A8 | PASS | reprint/get of that row returned the same ciphertext |
| A9–A10 | PASS | empty ciphertext → `ciphertext_required`, no orphan row |
| A11–A12 | PASS | TAB (`chr(9)`) refused, no orphan |
| A13–A14 | PASS | garbage `not-a-ciphertext` refused, no orphan |
| A17–A18 | PASS | NBSP (`chr(160)`) refused, no orphan |
| A16 | PASS | pre-fix NULL remains unreprintable (do not invent a token) |
| A15 | PASS (residual) | shape-valid fake GCM **accepted by SQL** |

**SQL assertion count: 19 passed, 0 failed.**

Application `tryDecrypt` (same AES-256-GCM / key as `crypto.ts`):

| ID | Result | Detail |
|---|---|---|
| B1 | PASS | stored ciphertext decrypts to `proof-stand-token-upgrade-001` |
| B2 | PASS | stored payload equals the encrypt() input |
| B3–B5 | PASS | NULL / empty / spaces → `tryDecrypt` null (fail closed; rotate, do not reprint garbage) |
| B6 | PASS | fake GCM row decrypts to null (SQL residual; app fail-closed) |

**Reprint assertion count: 6 passed, 0 failed.**

### Frozen-tip automated suites (worktree at `fd806fb`, tip not moved)

```bash
git worktree add /tmp/pr56 fd806fbb8362fda3fef7a8dc278616281aa90bed
cd /tmp/pr56/frontend && npx vitest run tests/unit/create-stand-ciphertext.test.ts tests/unit/owner-api.test.ts
# Test Files  2 passed (2)
# Tests       63 passed (63)

cd /tmp/pr56 && npx --yes supabase@2.117.0 test db
# Files=8, Tests=351, Result: PASS
# including create_stand_ciphertext_test.sql
```

First `supabase test db` failed 2/88 in `customer_flow_test.sql` only because this audit left `public._probe` / `public._mission_a_proof` granted to anon. Those tables were dropped; the re-run is **351/351 PASS**. Not a #56 defect.

### Residual risk (accepted)

Shape-valid fake GCM (`v1:` + three base64-looking parts) still passes the SQL regex and inserts a stand. `tryDecrypt` then returns null, so owner reprint fail-closes at the app. SQL cannot authenticate GCM. Do not treat the regex as encryption.

#56 reprint on this tip still reads `review_stands.public_token_encrypted` via the Data API (`getStandTokenForReprint`). `rpc_get_stand_token_ciphertext` exists only on the #45/#48 privilege path, which is **blocked** (see below). Upgrade + create/get on this tip does not require that RPC.

---

## Mission B — `20260908000400` ownership (FREEZE #48 / #54)

### The collision

Same Supabase version, different filename, different blob:

| Claimant | File | Blob | Intent |
|---|---|---|---|
| **#48** | `20260908000400_privilege_attack_pass.sql` | `a2655bf6eccbe9e70c63b16042f2d3d3b160760b` | Rename of #45’s privilege pass (same blob as #45 `20260908000100_privilege_attack_pass.sql`) so it would not fight SMS `000100` |
| **#51 / #54** | `20260908000400_sms_reconcile_sid_conflict.sql` | `289b2f67937b11f8fa9ce8c175f2f590493f861d` | Same-body SID attach conflict (identical blob on #51 and #54) |

A combined merge train cannot apply both files. Supabase records **version**, not filename. Second apply of `20260908000400` is skipped or conflicts.

**FREEZE:** do not land #48 or #54 (or #51, same `000400`) until a human assigns this version to one owner.

**Do not renumber blindly.** #48 already moved once (`000100` → `000400`) to dodge SMS. A second silent rename can land on the next open slot another branch already claimed (`000200` is already drifting; `000300` is taken by #47).

### Ownership / order options (choose one; do not execute here)

**Option P — Privilege owns `000400`**

- #48 is the owner of `20260908000400`.
- SID conflict (#51/#54) waits. After #48 is on main, a *new* unused version is assigned to SID in a later commit (human-picked, not “next integer”).
- #45 must **not** land as `000100` (that slot is the SMS settle file on #41/#47). #48 already dropped `000100` on its tip.

**Option S — SID owns `000400`**

- #51/#54 keep `20260908000400_sms_reconcile_sid_conflict.sql`.
- #48 waits. Privilege pass gets a *new* unused version after SID’s `000400` is on main.
- Still does not authorize #54 merge: SMS product HOLD (below) remains.

**Option N — Neither owns `000400` until a merge-train owner assigns**

- Both stay frozen.
- First writer into `main` is chosen explicitly; the other rebases onto that assignment.
- Safest default while SMS product evidence is missing.

**Option X (rejected without a new audit):** auto-renumber either file to `20260908000500` / `20260908153000` / “now()”. #56 already uses `153000`/`164000`. Blind `000500` may collide with a branch not in this scan.

### Related version fights (why #45 / #47 are blocked)

`20260908000100` has **three** different files:

| PR | File | Blob |
|---|---|---|
| #41, #47, #50, #51, #52, #53, #54 | `20260908000100_sms_settle_quota_fixes.sql` | `732de2a0e8bc7689872bb7d233ed6457c241e59e` |
| #45 | `20260908000100_privilege_attack_pass.sql` | `a2655bf6…` (same bytes as #48’s `000400`) |
| #37 (C-V2 frozen) | `20260908000100_text_requests_settle_fixes.sql` | `8eea65d442a2861f63c46f9a651c1b6e7480df46` |

**#45 is blocked** until `000100` ownership is SMS vs privilege vs frozen C-V2. Landing #45 writes privilege into the SMS settle version.

**#47 is blocked** until:

1. `000100`/`000200` ownership is the SMS settle pair from #41, and
2. SMS product HOLD evidence exists (below), and
3. `000200` content drift is resolved: #41/#47/#50 blob `d6e9c1d4…` vs #51/#52/#53/#54 blob `373b3369…` (34-line mutation of an already-versioned file). If #41 or #47 lands first, later tips cannot rewrite `000200`.

`20260908000300_sms_provider_unknown_reconcile.sql` is the same blob (`21bd7275…`) on #47 and the #47 children.

### Open tips with **no** new `supabase/migrations` vs main

#9, #21, #23, #40, #42, #46, #55, #57.

C-V2 (#37/#44/#49) share `20260907000x` among themselves; **frozen**, not part of this train.

Stale #4 still has `20260814013400_praise_invoker_view_and_rating_decorrelation.sql` vs current main (historical, ignore for this train).

---

## Mission C — SMS product HOLD (do not start SMS merges)

Do not merge #41, #47, #51, #53, or #54 until there is evidence for all of:

1. **Concurrent SID claiming** — two workers, same provider SID / same body, one winner, no double-charge.
2. **Expiry → release/refund** — reserved quota returns on expiry; no leak and no double-refund.
3. **Upgrade from an existing DB** — same standard as #56: apply SMS migrations onto a main-like schema that already has text_requests / outbox / quota rows, not empty `db reset` only.

Migration-version ownership (#45/#47/#48/#54) is a separate gate. Clearing a timestamp fight does **not** clear this HOLD.

---

## Recommended relative order (migrations-only; not a merge authorization)

1. **#56** is the only open migrations tip whose versions (`20260908153000`, `20260908164000`) collide with nobody. Upgrade + create/reprint + fail-closed evidence is recorded above. **Still no merge this pass.**
2. Assign **`20260908000100`** (SMS #41 vs privilege #45 vs frozen C-V2 #37) before any of those land.
3. Assign **`20260908000400`** (privilege #48 vs SID #51/#54). Until then **#48 and #54 stay frozen**.
4. Resolve **`000200` blob drift** before stacking #51/#53/#54 on a landed #41/#47.
5. SMS product HOLD still sits in front of #41/#47/#51/#53/#54 after timestamps are clean.
6. Customer V2 (#37/#44/#49) stays frozen.

Suggested decision record when someone *does* assign `000400` (do not do it in this PR):

```
owner: privilege | sid | neither
chosen_file: <filename>
losing_pr: <number>
losing_file_gets_new_version: <human-assigned 14-digit version, after a fresh open-tip rescan>
```
