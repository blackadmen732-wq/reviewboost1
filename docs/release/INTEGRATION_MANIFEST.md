# Integration manifest

## Scope and provenance

Baseline started from fetched `origin/main` **6b8adc54f2d8d98e970b4037afb9ed1eff6ed0b8** on 2026-09-12. This is the W0 integration handoff, not closure of F01–F40 or approval to deploy.

Current handoff branch: `devin/1789230975-integration-baseline`. Inventory refreshed at 16:34 UTC. During branch inspection, an earlier integration candidate was discovered at `devin/1789189752-integration-baseline` / `444bd4fb5dfcffb6087efa1d57aaa7d50edb6f19`. Its selected #66/#67 source composition and manifest were reviewed against the upstream heads and replayed onto current main; its old evidence report was not imported. This session excludes its Stripe acknowledgement stub, adds six integration regressions, and reruns checks independently. The old candidate branch is superseded as a handoff reference, not modified or deleted.

All **31 open PRs** were listed using the GitHub API (no builtin PR-list operation); details/comments were fetched with builtin PR views. The API base SHAs below are PR metadata snapshots: most report `26320dde3ed04115b759159497bfa4b33b6d768c`, while fetched main is `6b8adc54f2d8d98e970b4037afb9ed1eff6ed0b8`. That difference is preserved, not silently described as current main. The main delta adds Branding assets only.

Disposition describes this baseline or a named follow-up, never a merge/close action. No existing PR is merged, closed or rewritten.

## Every open PR

| PR | Head ref / SHA | Base ref / reported SHA | Disposition | Why / next owner |
|---|---|---|---|---|
| [#67](https://github.com/blackadmen732-wq/reviewboost1/pull/67) | `cursor/sprint-forge-owner-systems-v15-7042`<br>`6a4b30e165aacce66d70d4f5b49d9813e94701f6` | `main`<br>`26320dde3ed04115b759159497bfa4b33b6d768c` | incorporated (selected) | Owner routes, editor, shared view, Tags, catalog and additive 20260909000900 foundation. Customer controller/messages follow #66, with localized shared footer added. Mobile theme and Stripe acknowledgement stub omitted. Historical product-design documents retained because owner tests read them; current specification supersedes their conflicting instructions. Known publishing/NFC/billing defects remain assigned below. |
| [#66](https://github.com/blackadmen732-wq/reviewboost1/pull/66) | `feat/customer-experience-v2`<br>`77934da9f43f85d0ac40de070360d82145e4222e` | `main`<br>`26320dde3ed04115b759159497bfa4b33b6d768c` | incorporated (adapted) | One-tap controller, no note/Continue/Praise path, retry/idempotency and equal Google opportunity tests. Shared #67 presentation is composed around this controller. |
| [#65](https://github.com/blackadmen732-wq/reviewboost1/pull/65) | `cursor/docs-money-constitution-ef6c`<br>`4453a5764f9e6f09bba205040c4ce4325b85284b` | `main`<br>`26320dde3ed04115b759159497bfa4b33b6d768c` | candidate | Pricing constitution is reference for billing/SMS owners; do not turn conditional example SMS prices into live quotes. |
| [#64](https://github.com/blackadmen732-wq/reviewboost1/pull/64) | `cursor/forge-sms-correctness-overnight-9899`<br>`c58e08d031fed7339b88d113c4c0148a758ec415` | `cursor/atlas-integration-4cd5`<br>`d12ba74f74c5c0cce94f7c096efbc830828dbde7` | candidate | Most complete SMS correctness candidate, depends on #59. SMS owner must port final definitions as new 2026091205xxxx migrations, not import competing old versions or infer remote deployment. |
| [#63](https://github.com/blackadmen732-wq/reviewboost1/pull/63) | `overnight/beacon-runtime-scheduling-20260909`<br>`f7d4f1376c62bc8da2a390d5f1041dc6e9e48357` | `main`<br>`26320dde3ed04115b759159497bfa4b33b6d768c` | candidate | Fail-closed preview auth is useful to security owner; scheduler routes useful to SMS owner. Daily dispatch schedule is explicitly rejected by F29. Ancestor owner changes overlap #67. |
| [#61](https://github.com/blackadmen732-wq/reviewboost1/pull/61) | `cursor/runtime-sprint-beacon-59c6`<br>`2d4b7ffd0c24b7a62051b295a2e89639f3e56602` | `main`<br>`26320dde3ed04115b759159497bfa4b33b6d768c` | superseded | Replaced by #63. Its scheduler migration is not selected; no duplicate scheduling implementation. |
| [#60](https://github.com/blackadmen732-wq/reviewboost1/pull/60) | `cursor/atlas-overnight-integration-c55e`<br>`aba08e17bdf13e3b59757b635e2b79632a8047a9` | `main`<br>`26320dde3ed04115b759159497bfa4b33b6d768c` | superseded/conflicting | Replaced by #59; assigns privilege to 08000400 and SID to 08000500, the opposite of #59. Do not renumber any deployed copy. |
| [#59](https://github.com/blackadmen732-wq/reviewboost1/pull/59) | `cursor/atlas-integration-4cd5`<br>`d12ba74f74c5c0cce94f7c096efbc830828dbde7` | `main`<br>`26320dde3ed04115b759159497bfa4b33b6d768c` | candidate | Dependency reference for #64 and privilege work. SID=08000400, privilege=08000500; forward corrections 09000100–09000400. Not a verified production migration ledger. |
| [#58](https://github.com/blackadmen732-wq/reviewboost1/pull/58) | `cursor/marc-56-upgrade-audit-026a`<br>`3cdd81b1216c04580ada9b6447f4cb4d49e56749` | `main`<br>`26320dde3ed04115b759159497bfa4b33b6d768c` | deferred | Historical #56 populated-upgrade evidence and migration collision warning; its recorded passes were not rerun here and do not certify this baseline. |
| [#57](https://github.com/blackadmen732-wq/reviewboost1/pull/57) | `cursor/forge-pd-owner-home-tokens-b573`<br>`0ac3d3b6b580b44fdcd3a1aa44acff2be28eab56` | `main`<br>`26320dde3ed04115b759159497bfa4b33b6d768c` | superseded (selected ancestor retained) | Useful owner work inherited through #67; do not import latest 0ac3d3b6 proxy bypass. #67 branched from trusted 9a8b01bd. |
| [#56](https://github.com/blackadmen732-wq/reviewboost1/pull/56) | `cursor/forge-stand-ciphertext-24c6`<br>`fd806fbb8362fda3fef7a8dc278616281aa90bed` | `main`<br>`26320dde3ed04115b759159497bfa4b33b6d768c` | candidate | Stand ciphertext create/reprint hardening and upgrade tests for NFC/security owners. Two additive SQL files; preserve legacy stand token/data compatibility. |
| [#55](https://github.com/blackadmen732-wq/reviewboost1/pull/55) | `cursor/journey-log-sot-b014`<br>`2e2bad126e2d94f732444c6782b5e44f101f120b` | `main`<br>`26320dde3ed04115b759159497bfa4b33b6d768c` | deferred | Historical journey/retrospective restoration; not needed to compile integrated runtime. Historical holds do not override current implementation authorization. |
| [#54](https://github.com/blackadmen732-wq/reviewboost1/pull/54) | `sprint/forge-same-body-sid`<br>`e0115c390b924f55669acdf137cef6820d50b587` | `cursor/sms-reconcile-provider-unknown-1774`<br>`64e76371f4dd9c6b528139ba3cb7bdd8b3a4ed4b` | candidate via #64 | SID attach conflict branch depends on #47 and FIFO; migration 08000400 conflicts with #48. Consume final corrective semantics, not both histories. |
| [#53](https://github.com/blackadmen732-wq/reviewboost1/pull/53) | `sprint/forge-47-fifo-only-d280573`<br>`e0f21bef08a101604b7d1616dbe33a18bfd5b0c6` | `cursor/sms-reconcile-provider-unknown-1774`<br>`64e76371f4dd9c6b528139ba3cb7bdd8b3a4ed4b` | candidate via #64 | FIFO-only isolate on #47; avoid replaying older function definitions after #64 final corrections. |
| [#52](https://github.com/blackadmen732-wq/reviewboost1/pull/52) | `sprint/sentinel-retest-d280573`<br>`d3ace582b9b120b2b50209d0947448d2bfd7a8e7` | `main`<br>`26320dde3ed04115b759159497bfa4b33b6d768c` | deferred | Independent historical FIFO retest, not product implementation. Can inform SMS regression cases; its inherited migrations must not be blindly imported. |
| [#51](https://github.com/blackadmen732-wq/reviewboost1/pull/51) | `sprint/forge-47-p0-sid-fifo`<br>`a342552f1488647c002a190a0080ad7e0e1f05a2` | `cursor/sms-reconcile-provider-unknown-1774`<br>`64e76371f4dd9c6b528139ba3cb7bdd8b3a4ed4b` | superseded by selected SMS candidate | Combined FIFO/SID iteration; #53/#54 isolate work and #64 carries later fixes. |
| [#50](https://github.com/blackadmen732-wq/reviewboost1/pull/50) | `sprint/sentinel-47-p0-review`<br>`8153eb48cba01a8ad65ffba144ee8af8da1595cf` | `cursor/sms-reconcile-provider-unknown-1774`<br>`64e76371f4dd9c6b528139ba3cb7bdd8b3a4ed4b` | deferred | Independent historical #47 attack/review pack, no product fix. Useful regression input for SMS owner. |
| [#49](https://github.com/blackadmen732-wq/reviewboost1/pull/49) | `cursor/customer-page-high-defects-b5d9`<br>`ed7a84267710e08ee7692676b4817a232e6cc7c4` | `cursor/customer-page-v2-backend-f8b4`<br>`3e311fdcc211076a75e8c32601c669aa7dcaede7` | conflicting (design reference) | Hardens alternate customer_page_profiles/assets on #44. Explicit scope/asset ownership concepts useful to pilot, but duplicate authoritative store and incomplete upload signing must not be imported. |
| [#48](https://github.com/blackadmen732-wq/reviewboost1/pull/48) | `cursor/rename-privilege-migration-d919`<br>`1ab4eb682eedaec57aceca9d1ba28c05dbb965b9` | `cursor/rls-privilege-attack-pass-bf3f`<br>`de342a5b869bb809ca680c93b182ec778b6f6cc9` | conflicting (reference only) | Renames privilege migration to 08000400, colliding with #54/#59 SID. Security owner uses fresh 2026091206xxxx forward migration. |
| [#47](https://github.com/blackadmen732-wq/reviewboost1/pull/47) | `cursor/sms-reconcile-provider-unknown-1774`<br>`64e76371f4dd9c6b528139ba3cb7bdd8b3a4ed4b` | `main`<br>`26320dde3ed04115b759159497bfa4b33b6d768c` | candidate via #64 | Provider-unknown reconciliation depends on #41; older state-machine definitions need #64 follow-up. |
| [#46](https://github.com/blackadmen732-wq/reviewboost1/pull/46) | `cursor/fail-closed-money-paths-d86f`<br>`b8b6e70d3fcfb4e606515701137336572e25cfb1` | `main`<br>`26320dde3ed04115b759159497bfa4b33b6d768c` | candidate | Fail-closed rate limiter/config and timezone hardening; split application changes between security and SMS owners, preserve current API contracts. |
| [#45](https://github.com/blackadmen732-wq/reviewboost1/pull/45) | `cursor/rls-privilege-attack-pass-bf3f`<br>`de342a5b869bb809ca680c93b182ec778b6f6cc9` | `main`<br>`26320dde3ed04115b759159497bfa4b33b6d768c` | candidate (forward port) | Privilege/default EXECUTE and sensitive-column restrictions required by F33. Its 08000100 SQL conflicts with SMS #41; security owner writes new range after integrated schema. |
| [#44](https://github.com/blackadmen732-wq/reviewboost1/pull/44) | `cursor/customer-page-v2-backend-f8b4`<br>`3e311fdcc211076a75e8c32601c669aa7dcaede7` | `main`<br>`26320dde3ed04115b759159497bfa4b33b6d768c` | conflicting (design reference) | Alternate scoped profiles/assets RPC model; replaced as runtime choice by customer_page_settings. Consult #49 hardening rather than importing duplicate routes/service. |
| [#42](https://github.com/blackadmen732-wq/reviewboost1/pull/42) | `cursor/customer-page-one-tap-9a45`<br>`2509e39c57832398857161dadddd23fa4b157ea3` | `main`<br>`26320dde3ed04115b759159497bfa4b33b6d768c` | superseded | Earlier customer composition/owner designer. Selected #66 behavior and #67 view replace it without introducing another state machine. |
| [#41](https://github.com/blackadmen732-wq/reviewboost1/pull/41) | `fix/sms-settle-and-quota-fixes`<br>`26556d228eeee872b83989d28f400cda1f933e02` | `main`<br>`26320dde3ed04115b759159497bfa4b33b6d768c` | candidate via #64 | SMS settle/quota foundation dependency; port together with later receipt/FIFO/reconcile corrections. |
| [#40](https://github.com/blackadmen732-wq/reviewboost1/pull/40) | `cursor/sms-economics-platform-phase-1-5112`<br>`a61652245c173b2ad3c5d8199e76ca17ec0a9181` | `main`<br>`26320dde3ed04115b759159497bfa4b33b6d768c` | deferred | Backend/SMS research documentation; reference for SMS owner, not evidence of implemented pricing or paid packs. |
| [#37](https://github.com/blackadmen732-wq/reviewboost1/pull/37) | `claude/reviewboost-customer-page-v2-4kdkv8`<br>`d24a717d27b3ca26557a195268aafb895debd9da` | `main`<br>`d56e2c7e3836e6a7527099f4909d99aa3da4b135` | superseded/conflicting | Older customer_page_profiles foundation replaced by #44/#49 design reference; also carries unrelated text_requests_settle_fixes at colliding 08000100. |
| [#23](https://github.com/blackadmen732-wq/reviewboost1/pull/23) | `claude/fix-dark-customer-contrast`<br>`e1baa424a271a181a121ae65e297c9febb6bd633` | `main`<br>`411d477d97f50c5c0535e5420e1101ad3f81dd0e` | candidate (adapt) | Old customer contrast fix must be reassessed against #67 shared white card and tokens (F04), not transplanted assuming selectors still apply. |
| [#21](https://github.com/blackadmen732-wq/reviewboost1/pull/21) | `claude/customer-e2e-ci`<br>`5067b888582cdf91d8550779e059528aff8bc7ab` | `main`<br>`6e032667bfc5c23e439e562482240620284e69d8` | candidate (adapt) | Browser CI proposal requires integrated one-tap/shared-renderer tests and actual-backend coverage (F37); historical viewport tests do not verify Safari/devices. |
| [#9](https://github.com/blackadmen732-wq/reviewboost1/pull/9) | `coderabbitai/security-fix/depgrp-57ca89d8113e/401a1b6`<br>`ba24f2599b4b5195ba813b3c6a88089842df4f0e` | `main`<br>`401a1b6a563ce88e17ebf4d75b0b5cde4252827e` | deferred to security owner | Old image-size dependency remediation targets older tree/lockfile; evaluate current npm audit before porting. No blind dependency downgrades. |
| [#4](https://github.com/blackadmen732-wq/reviewboost1/pull/4) | `vercel/vercel-web-analytics-integrati-qfk5lf`<br>`d002decf92551eb5c5017a82ab54599e9bbdfac4` | `reviewboost`<br>`c9b1d6f4de052c79aa3a213434cefeb011e6223b` | deferred | Legacy reviewboost-base Vercel analytics branch is unrelated to pilot integration; obsolete migration history and privacy implications need separate review. |

## Migration dependencies by candidate

These are SQL deltas against each head's merge-base with fetched main, including inherited prerequisites. They describe repository contents, **not application in any database**. A/M/D are git change types. No committed migration is rewritten in this baseline.

### #67

Merge-base: `26320dde3ed04115b759159497bfa4b33b6d768c`. PR target: `main`.

```text
A	supabase/migrations/20260909000900_customer_page_and_entitlements.sql
```

### #64

Merge-base: `26320dde3ed04115b759159497bfa4b33b6d768c`. PR target: `cursor/atlas-integration-4cd5`.

```text
A	supabase/migrations/20260908000100_sms_settle_quota_fixes.sql
A	supabase/migrations/20260908000200_sms_receipt_quota_retry_hardening.sql
A	supabase/migrations/20260908000300_sms_provider_unknown_reconcile.sql
A	supabase/migrations/20260908000400_sms_reconcile_sid_conflict.sql
A	supabase/migrations/20260908000500_privilege_attack_pass.sql
A	supabase/migrations/20260908000600_sms_reconcile_atomic_sid_claim.sql
A	supabase/migrations/20260909000100_forward_sms_settle_non_superseded.sql
A	supabase/migrations/20260909000200_forward_sms_sid_conflict.sql
A	supabase/migrations/20260909000300_forward_sms_quota_fifo_remaining.sql
A	supabase/migrations/20260909000400_owner_dashboard_org_time_indexes.sql
A	supabase/migrations/20260909000600_sms_quota_expire_release_residual.sql
A	supabase/migrations/20260909000700_sms_reconcile_attach_sid_unique_violation.sql
A	supabase/migrations/20260909000800_sms_quota_additive_expire_residual.sql
```

### #61

Merge-base: `26320dde3ed04115b759159497bfa4b33b6d768c`. PR target: `main`.

```text
A	supabase/migrations/20260909030000_sms_scheduler_targets.sql
```

### #60

Merge-base: `26320dde3ed04115b759159497bfa4b33b6d768c`. PR target: `main`.

```text
A	supabase/migrations/20260908000100_sms_settle_quota_fixes.sql
A	supabase/migrations/20260908000200_sms_receipt_quota_retry_hardening.sql
A	supabase/migrations/20260908000300_sms_provider_unknown_reconcile.sql
A	supabase/migrations/20260908000400_privilege_attack_pass.sql
A	supabase/migrations/20260908000500_sms_reconcile_sid_conflict.sql
A	supabase/migrations/20260908000600_atlas_sid_privilege_collision_repair.sql
```

### #59

Merge-base: `26320dde3ed04115b759159497bfa4b33b6d768c`. PR target: `main`.

```text
A	supabase/migrations/20260908000100_sms_settle_quota_fixes.sql
A	supabase/migrations/20260908000200_sms_receipt_quota_retry_hardening.sql
A	supabase/migrations/20260908000300_sms_provider_unknown_reconcile.sql
A	supabase/migrations/20260908000400_sms_reconcile_sid_conflict.sql
A	supabase/migrations/20260908000500_privilege_attack_pass.sql
A	supabase/migrations/20260909000100_forward_sms_settle_non_superseded.sql
A	supabase/migrations/20260909000200_forward_sms_sid_conflict.sql
A	supabase/migrations/20260909000300_forward_sms_quota_fifo_remaining.sql
A	supabase/migrations/20260909000400_owner_dashboard_org_time_indexes.sql
```

### #56

Merge-base: `26320dde3ed04115b759159497bfa4b33b6d768c`. PR target: `main`.

```text
A	supabase/migrations/20260908153000_rpc_create_stand_ciphertext.sql
A	supabase/migrations/20260908164000_rpc_create_stand_ciphertext_format.sql
```

### #54

Merge-base: `26320dde3ed04115b759159497bfa4b33b6d768c`. PR target: `cursor/sms-reconcile-provider-unknown-1774`.

```text
A	supabase/migrations/20260908000100_sms_settle_quota_fixes.sql
A	supabase/migrations/20260908000200_sms_receipt_quota_retry_hardening.sql
A	supabase/migrations/20260908000300_sms_provider_unknown_reconcile.sql
A	supabase/migrations/20260908000400_sms_reconcile_sid_conflict.sql
```

### #53

Merge-base: `26320dde3ed04115b759159497bfa4b33b6d768c`. PR target: `cursor/sms-reconcile-provider-unknown-1774`.

```text
A	supabase/migrations/20260908000100_sms_settle_quota_fixes.sql
A	supabase/migrations/20260908000200_sms_receipt_quota_retry_hardening.sql
A	supabase/migrations/20260908000300_sms_provider_unknown_reconcile.sql
```

### #52

Merge-base: `26320dde3ed04115b759159497bfa4b33b6d768c`. PR target: `main`.

```text
A	supabase/migrations/20260908000100_sms_settle_quota_fixes.sql
A	supabase/migrations/20260908000200_sms_receipt_quota_retry_hardening.sql
A	supabase/migrations/20260908000300_sms_provider_unknown_reconcile.sql
```

### #51

Merge-base: `26320dde3ed04115b759159497bfa4b33b6d768c`. PR target: `cursor/sms-reconcile-provider-unknown-1774`.

```text
A	supabase/migrations/20260908000100_sms_settle_quota_fixes.sql
A	supabase/migrations/20260908000200_sms_receipt_quota_retry_hardening.sql
A	supabase/migrations/20260908000300_sms_provider_unknown_reconcile.sql
A	supabase/migrations/20260908000400_sms_reconcile_sid_conflict.sql
```

### #50

Merge-base: `26320dde3ed04115b759159497bfa4b33b6d768c`. PR target: `cursor/sms-reconcile-provider-unknown-1774`.

```text
A	supabase/migrations/20260908000100_sms_settle_quota_fixes.sql
A	supabase/migrations/20260908000200_sms_receipt_quota_retry_hardening.sql
A	supabase/migrations/20260908000300_sms_provider_unknown_reconcile.sql
```

### #49

Merge-base: `26320dde3ed04115b759159497bfa4b33b6d768c`. PR target: `cursor/customer-page-v2-backend-f8b4`.

```text
A	supabase/migrations/20260907000100_customer_page_profiles.sql
A	supabase/migrations/20260907000200_customer_page_assets.sql
A	supabase/migrations/20260907000300_customer_page_rpcs.sql
A	supabase/migrations/20260907000400_customer_page_authz_scope.sql
```

### #48

Merge-base: `26320dde3ed04115b759159497bfa4b33b6d768c`. PR target: `cursor/rls-privilege-attack-pass-bf3f`.

```text
A	supabase/migrations/20260908000400_privilege_attack_pass.sql
```

### #47

Merge-base: `26320dde3ed04115b759159497bfa4b33b6d768c`. PR target: `main`.

```text
A	supabase/migrations/20260908000100_sms_settle_quota_fixes.sql
A	supabase/migrations/20260908000200_sms_receipt_quota_retry_hardening.sql
A	supabase/migrations/20260908000300_sms_provider_unknown_reconcile.sql
```

### #45

Merge-base: `26320dde3ed04115b759159497bfa4b33b6d768c`. PR target: `main`.

```text
A	supabase/migrations/20260908000100_privilege_attack_pass.sql
```

### #44

Merge-base: `26320dde3ed04115b759159497bfa4b33b6d768c`. PR target: `main`.

```text
A	supabase/migrations/20260907000100_customer_page_profiles.sql
A	supabase/migrations/20260907000200_customer_page_assets.sql
A	supabase/migrations/20260907000300_customer_page_rpcs.sql
```

### #41

Merge-base: `26320dde3ed04115b759159497bfa4b33b6d768c`. PR target: `main`.

```text
A	supabase/migrations/20260908000100_sms_settle_quota_fixes.sql
A	supabase/migrations/20260908000200_sms_receipt_quota_retry_hardening.sql
```

### #37

Merge-base: `d56e2c7e3836e6a7527099f4909d99aa3da4b135`. PR target: `main`.

```text
A	supabase/migrations/20260907000100_customer_page_profiles.sql
A	supabase/migrations/20260907000200_customer_page_assets.sql
A	supabase/migrations/20260907000300_customer_page_rpcs.sql
A	supabase/migrations/20260908000100_text_requests_settle_fixes.sql
```

### #4

Merge-base: `cada03fc0fbd4c5993bf9688d5e251c5d5f170ca`. PR target: `reviewboost`.

```text
A	supabase/migrations/20260814013400_praise_invoker_view_and_rating_decorrelation.sql
```

## Current remote branches

Fetched branch heads at inventory time; branches without open PRs are not silently selected. `origin/HEAD` is a symbolic alias and omitted.

| Remote branch | SHA |
|---|---|
| `origin/backend/customer-flow-foundation` | `66bbb8d903eb8471f2f2b185d486ea17279cdd5a` |
| `origin/backend/customer-flow-v1` | `ab657a0c4c442d8818cfccf86721a5e33444bcac` |
| `origin/claude/cursor-setup-scripts-m7ptle` | `34accce6d7a764d8128bd86c780090c823c5f007` |
| `origin/claude/customer-e2e-ci` | `5067b888582cdf91d8550779e059528aff8bc7ab` |
| `origin/claude/fix-dark-customer-contrast` | `e1baa424a271a181a121ae65e297c9febb6bd633` |
| `origin/claude/live-feed-endpoint` | `55c345d33499d538d7ca8a991a8f2129ffc9b63f` |
| `origin/claude/mobile-app-foundation-a051bv` | `46852fa001fe8ad4c8601aa61ba77846de4a0866` |
| `origin/claude/mobile-ci` | `12a2479ea47adf63818c2ecdc85ab51dbff6cbbe` |
| `origin/claude/mobile-live-feed` | `74047df96768e79e950d7763c16ed05e2c0a9938` |
| `origin/claude/mobile-release-infra` | `a6352dd7805e471d271a0fde5ded3a6ba40d842a` |
| `origin/claude/reviewboost-customer-page-v2-4kdkv8` | `d24a717d27b3ca26557a195268aafb895debd9da` |
| `origin/claude/staging-stand-seed` | `b2c3023ecc3a4f0e159379fd0cd1c4dcd06b79b0` |
| `origin/claude/supabase-column-security-4wquyj` | `c282ac3a09ee8be350f4a06b5f19cd404bbda63d` |
| `origin/claude/text-requests-backend` | `fb13e595af81d2aaeb1adb602eada9dc722cbd0d` |
| `origin/claude/vercel-framework-preset` | `f5465ade528bf02a1deb41af611e91bf924e8895` |
| `origin/claude/wizardly-newton-r61jtv` | `0ac3d3b6b580b44fdcd3a1aa44acff2be28eab56` |
| `origin/coderabbitai/security-fix/depgrp-57ca89d8113e/401a1b6` | `ba24f2599b4b5195ba813b3c6a88089842df4f0e` |
| `origin/codex/frontend-premium-redesign` | `61ea0f0f7b98bdb8f673ec1644da46a9203d6d7c` |
| `origin/codex/update-documentation-for-accuracy` | `740dc439922eb705fc4e74cdc10fbf98f4f2fab8` |
| `origin/cursor/atlas-integration-4cd5` | `d12ba74f74c5c0cce94f7c096efbc830828dbde7` |
| `origin/cursor/atlas-overnight-integration-c55e` | `aba08e17bdf13e3b59757b635e2b79632a8047a9` |
| `origin/cursor/customer-page-high-defects-b5d9` | `ed7a84267710e08ee7692676b4817a232e6cc7c4` |
| `origin/cursor/customer-page-one-tap-9a45` | `2509e39c57832398857161dadddd23fa4b157ea3` |
| `origin/cursor/customer-page-v2-backend-f8b4` | `3e311fdcc211076a75e8c32601c669aa7dcaede7` |
| `origin/cursor/docs-money-constitution-ef6c` | `4453a5764f9e6f09bba205040c4ce4325b85284b` |
| `origin/cursor/fail-closed-money-paths-d86f` | `b8b6e70d3fcfb4e606515701137336572e25cfb1` |
| `origin/cursor/fix-cloud-agent-env-install-cb67` | `cc5b6d79f96f02fee80ca30e344ff821a4a80608` |
| `origin/cursor/forge-pd-owner-home-tokens-b573` | `0ac3d3b6b580b44fdcd3a1aa44acff2be28eab56` |
| `origin/cursor/forge-sms-correctness-overnight-9899` | `c58e08d031fed7339b88d113c4c0148a758ec415` |
| `origin/cursor/forge-stand-ciphertext-24c6` | `fd806fbb8362fda3fef7a8dc278616281aa90bed` |
| `origin/cursor/journey-log-sot-b014` | `2e2bad126e2d94f732444c6782b5e44f101f120b` |
| `origin/cursor/marc-56-upgrade-audit-026a` | `3cdd81b1216c04580ada9b6447f4cb4d49e56749` |
| `origin/cursor/pin-supabase-cli-6ec0` | `26556d228eeee872b83989d28f400cda1f933e02` |
| `origin/cursor/rename-privilege-migration-d919` | `1ab4eb682eedaec57aceca9d1ba28c05dbb965b9` |
| `origin/cursor/rls-privilege-attack-pass-bf3f` | `de342a5b869bb809ca680c93b182ec778b6f6cc9` |
| `origin/cursor/runtime-sprint-beacon-59c6` | `2d4b7ffd0c24b7a62051b295a2e89639f3e56602` |
| `origin/cursor/setup-cloud-agent-env-f05c` | `5e6f3596ef48cc298aca71642f227176d0eb4526` |
| `origin/cursor/sms-correctness-sprint-84cb` | `053649db02abdc6d8b5614e51feda42129b09c2b` |
| `origin/cursor/sms-economics-platform-phase-1-5112` | `a61652245c173b2ad3c5d8199e76ca17ec0a9181` |
| `origin/cursor/sms-reconcile-provider-unknown-1774` | `64e76371f4dd9c6b528139ba3cb7bdd8b3a4ed4b` |
| `origin/cursor/sms-settle-hardening-6ec0` | `26556d228eeee872b83989d28f400cda1f933e02` |
| `origin/cursor/sprint-forge-owner-systems-v15-7042` | `6a4b30e165aacce66d70d4f5b49d9813e94701f6` |
| `origin/docs/correct-status-drift` | `43e373c0355ec140c8db032650a21a02554e12b2` |
| `origin/docs/reviewboost-truth-baseline` | `97d8fe8e681e6ec2e677de88ed8c5707debb2314` |
| `origin/devin/1789189752-integration-baseline` | `444bd4fb5dfcffb6087efa1d57aaa7d50edb6f19` |
| `origin/feat/customer-experience-v2` | `77934da9f43f85d0ac40de070360d82145e4222e` |
| `origin/feat/mobile-api-helper` | `7e0c7f98b08fd3dbe69c71b4ff7096000f0b3fd4` |
| `origin/feat/mobile-auth` | `ac1dbc5f04d1c379d633d815a3daf7e252c9a608` |
| `origin/feat/mobile-feedback-list` | `a08e5e0bb4e85c8cf8758f545e53b903491fa815` |
| `origin/feat/mobile-foundation` | `ce340a4f6487629e8fbb075680cf6aff3f1bdde8` |
| `origin/feat/mobile-theme` | `bdcb86c3a7fa1c0c651f94cf12afd755df7749db` |
| `origin/fix/openapi-anonymous-security-scan` | `68a1f72029d64e8a750d0c16cd20ab2247a95e6d` |
| `origin/fix/sms-settle-and-quota-fixes` | `26556d228eeee872b83989d28f400cda1f933e02` |
| `origin/fix/token-rotation-continuity` | `3b0a31db60b8b12c1bdd92d355ad77a8ae07dc92` |
| `origin/main` | `6b8adc54f2d8d98e970b4037afb9ed1eff6ed0b8` |
| `origin/overnight/beacon-runtime-scheduling-20260909` | `f7d4f1376c62bc8da2a390d5f1041dc6e9e48357` |
| `origin/reviewboost` | `c9b1d6f4de052c79aa3a213434cefeb011e6223b` |
| `origin/sprint/forge-47-fifo-only-d280573` | `e0f21bef08a101604b7d1616dbe33a18bfd5b0c6` |
| `origin/sprint/forge-47-p0-sid-fifo` | `a342552f1488647c002a190a0080ad7e0e1f05a2` |
| `origin/sprint/forge-same-body-sid` | `e0115c390b924f55669acdf137cef6820d50b587` |
| `origin/sprint/sentinel-47-p0-review` | `8153eb48cba01a8ad65ffba144ee8af8da1595cf` |
| `origin/sprint/sentinel-retest-d280573` | `d3ace582b9b120b2b50209d0947448d2bfd7a8e7` |
| `origin/v0/blackadmen732-2273-2f07e0a4` | `554f2f10cf06fc4486479e1f04993ee0a820e602` |
| `origin/v0/blackadmen732-2273-e1834e17` | `554f2f10cf06fc4486479e1f04993ee0a820e602` |
| `origin/vercel/vercel-web-analytics-integrati-qfk5lf` | `d002decf92551eb5c5017a82ab54599e9bbdfac4` |

## Baseline migration file ledger

Main's 43 migration files are retained byte-for-byte. The selected owner foundation adds one unchanged file, `20260909000900_customer_page_and_entitlements.sql`. No profile-model migrations are imported.

| Migration file or version | Git blob |
|---|---|
| `20260808000100_core_tenancy.sql` | `15402426f971727c164f4d1b390cf16d9f53cfe9` |
| `20260808000200_customer_flow.sql` | `df96998b5bbfafb13881b663692619b56a1cba78` |
| `20260808000300_rls_policies.sql` | `cfe1a5db2766eda466e1689996d08c4793cbe1b7` |
| `20260808000400_public_flow_functions.sql` | `270d4087332957dd2d27647ab89fc9428e2a2f6d` |
| `20260808000500_rate_limits.sql` | `ab6b460902ff1ab42da534f867565eb6d48818d1` |
| `20260808000600_public_rpc_surface.sql` | `db9e6d46b50fc65c4c6fd257df2dd6d4be4e1659` |
| `20260808000700_grant_lockdown.sql` | `01160ee0c402bafa478a0002d4011a0c8f334f85` |
| `20260808000800_rotatable_token_digests.sql` | `1a707ec6fee0b86437019ac519f6c7b86b57a365` |
| `20260810000100_onboarding.sql` | `64b64bfdb29d3101926a87cbdaf00ca2955a3441` |
| `20260810000200_reprintable_stands.sql` | `2d00b51f5f3342e108c4625233dd1a4d4eda821d` |
| `20260810000300_fix_function_grants.sql` | `72087ff2e7022852c527fcc1f94fe5a65a84380e` |
| `20260810000400_feedback_workflow.sql` | `738fdce243c80afb47b74f19bfe99107a19c414e` |
| `20260810000500_team_roster.sql` | `32c6844a9d197331f6566fb4869b1eb50a2de226` |
| `20260811000100_column_level_security.sql` | `08da7e1c2330a53de89378f1847ca54ca583c8e6` |
| `20260811000200_rls_policy_tightening.sql` | `2febfac47f4b5222e069f8469a23755a396cdb95` |
| `20260811000300_revoke_app_schema_usage.sql` | `df3ad3abf5a9fa06279a68742ec57a3d88585bf8` |
| `20260811000400_column_restrict_entity_tables.sql` | `75984253f34482025c8d16ecf6a0339740bbab23` |
| `20260812000100_security_review_fixes.sql` | `df4b445471b3df22313c5e412e6b360c9fcebbce` |
| `20260813000100_security_hardening.sql` | `79d37b4392311461cb180f5ea7ec0ba9a9e0c3f6` |
| `20260813210557_foundation_hardening.sql` | `7d43b6a226a231d2f6e61ae1a39a5824c1047719` |
| `20260813215530_praise_view_and_state_machine.sql` | `9c3c0222e3175dc6a44a7994cb6aa592b630af7f` |
| `20260814182336_rpc_update_staff.sql` | `d6f792ddffdfe3cd6848a5a5f484abd20fcc7f9f` |
| `20260814182456_rpc_update_settings.sql` | `d7a63a41df5c58beb10b787acb89a4f534bf32cf` |
| `20260814182602_revoke_app_schema_usage.sql` | `58887e5380f0943c9a6b7b5b7a9b8897abd79ce7` |
| `20260814182627_revoke_direct_inserts.sql` | `5d088fe3c8f5eaa0ba297567353ff6b6dffa7073` |
| `20260814204603_fix_org_targeting_staff_auth.sql` | `f19e5b28638705be5542b6c26d9c55a39d52da98` |
| `20260814204733_validate_inputs_idempotent_audit.sql` | `940b96507d13304bbf1e39970fa299c9274e1966` |
| `20260814211327_fix_google_url_validator.sql` | `813d1cdf93ddd41badb10a77309112445c802fba` |
| `20260814211454_app_schema_lockdown.sql` | `841ec98672389e035a5611e016a2df347ade2b47` |
| `20260814211532_rpc_update_stand.sql` | `c3a5d90b7da7f1a096fa42e0a0870c2a9cc68e71` |
| `20260814211955_restore_rls_helper_grants.sql` | `d2b884a11b8ddf69a5caef30b180543d8dd367b7` |
| `20260814212400_fix_url_validator_reject_ports.sql` | `8a6004aefa5ecf4d3fd8c8a3acb559ef536d9f88` |
| `20260817005852_token_rotation_write_continuity.sql` | `66d0f55ef622bc915e0652e35cc82f62bd0f7e5c` |
| `20260831000100_nfc_provisioning.sql` | `5b718629651278cd266760f027c239b4e5ffbc3c` |
| `20260901120000_revoke_anon_nfc_provision.sql` | `9d983be5ec406f28c26301531e2ab19753c32bf2` |
| `20260901213000` (restore organization-creation definer) | `deea92e65f818ca9b44f216c547dee0179207c56` |
| `20260902000100_text_requests_consent.sql` | `9ca10a1317ba3b00854f19c7b89a7fce3b464b95` |
| `20260902000200_text_requests_suppression.sql` | `11f679eeffe503a15123edfc680cd119915fc8e7` |
| `20260902000300_text_requests_core.sql` | `3f4325d8b38b9e1a36ee6dab4277ffbbda268600` |
| `20260902000400_text_requests_outbox.sql` | `fb534e762bed22f64e5db921d53223a3333ce02f` |
| `20260902000500_text_requests_quota.sql` | `374fa636ae380ac8b52cf274a8c80101aa35ecfd` |
| `20260902000600_text_requests_pipeline.sql` | `e7fd5052111738b3c59f4d7fdecca32b63775d60` |
| `20260902000700_text_requests_service_rpcs.sql` | `b69f6024e0e1c06191bb4d85eedb8dc4b7abf693` |
| `20260909000900_customer_page_and_entitlements.sql` | `ba704e6ae0d86f94295359f3ebdada5df062a486` |

## Local versus remote migration matrix

| Set | Repository baseline | Local disposable Supabase | Remote development / staging | Production |
|---|---|---|---|---|
| 43 main files, `20260808000100` through `20260902000700` | Preserved byte-for-byte | Applied by current-session clean reset | Unknown; not connected | Unknown; no live access |
| #67 `20260909000900_customer_page_and_entitlements.sql` | Added unchanged from source SHA | Applied by clean reset; SQL ledger count 44, maximum `20260909000900` | Unknown; not connected | Unknown; no live access |
| #37/#44/#49 alternate page profiles and assets | Excluded | Not applied | Unknown | Unknown |
| #41/#45/#47/#48/#51/#53/#54/#56/#59/#60/#64 candidate fixes | Excluded | Not applied | Unknown | Unknown |
| #61 scheduler target migration | Excluded | Not applied | Unknown | Unknown |
| Reserved `20260912...` domain migrations below | Not created by baseline | Not applied | Unknown | Unknown |

Current-session clean reset and all 326 existing pgTAP assertions passed; details are recorded in `integration-evidence.md`. Baseline tests do **not** certify populated upgrades, the new owner RPCs, remote state or all privilege gaps. Before deployment, compare the actual destination ledger and definitions against the selected plan. Never repair a collision by editing/deleting/renumbering an applied file.

## Migration ownership and domain boundaries

Use 14-digit timestamps in the following disjoint reservations. The `xxxx` suffix is assigned by that domain; no other domain writes its range.

| Owner | Reserved range | Findings / handoff |
|---|---|---|
| Pilot / customer page | `2026091201xxxx` | F01–F06, F08–F13; shared composition, explicit org/location authorization, page revisions, asset lifecycle and public renderer. Own F37 integration gates and central PR. |
| Owner | `2026091202xxxx` | F07, F14, F20–F22; ratings terminology, tenant/location filters, durable history/pagination and lifecycle UX. Coordinate scope contract with pilot. |
| NFC | `2026091203xxxx` | F15–F19; exact read-back, overwrite confirmation, generation-bound receipt, hardware evidence. Mobile F38–F40 belongs to mobile/release follow-up coordinated by NFC/pilot; no independent SQL range. |
| Billing | `2026091204xxxx` | F23–F26; verified Stripe processing, explicit unpaid/past-due states, atomic entitlements. Prices remain $49/$79/$129, subscriptions include zero SMS. |
| SMS | `2026091205xxxx` | F27–F32; provider-derived packs, separate prepaid ledger, receipts/reconcile/FIFO fixes, timezone and frequent scheduler, owner Text Requests. |
| Privilege / security | `2026091206xxxx` | F33–F36; default EXECUTE/column restrictions, fail-closed limiting, headers, actual operating evidence. Apply after all new domain functions/tables exist. |

All F01–F40 have a follow-up owner; baseline selection closes no release gate. W0 is preparation for those domain fixes. Existing SQL ordering dependencies matter even with disjoint filename ranges: pilot page foundation before dependent owner changes, billing entitlement contract before SMS purchases, privilege pass after all functions. Each domain must test both fresh reset and upgrade from this baseline; populated older-environment upgrades require separate fixtures/evidence.

## Intentional composition and unresolved customer/API collisions

1. **One renderer, one customer controller.** Live `/q/[token]` renders #67's `CustomerVisitView` and `VisitStars`; the editor uses those same components. #66's response/session controller determines when the Google screen is reachable. No rating-dependent fork, visible note, Continue or Praise sequence is restored. Archived praise components, reducer/storage fields and historical `/api/v1/public/q/[token]/responses` optional-note and `/api/v1/public/q/[token]/team-praise` endpoints remain for compatibility, alongside owner `/api/v1/team-praise` APIs.
2. **Shared messages.** #66's one-tap instructions and Google copy are retained in EN/ES/HT; #67's `footerPromise` is added to all locales for both live and preview. #67's old `RatingScreen` props (`onRatingChange`, `onSubmit`) are not authoritative. Tests are adapted to `onRate`/`onRetry`, retaining all-rating, duplicate attempt, offline, recovery and Axe assertions.
3. **Public context is additive.** `getContext` keeps business, location, Google URL and locale fields, adding `presentation: {heroUrl, transform:{x,y,scale}, tagline}`. OpenAPI is regenerated using `npm run api:generate`. Missing presentation falls back to `EMPTY_PRESENTATION`; renderer does not print tenant identifiers. Preserve token digest rotation and all existing session/response/click endpoint shapes.
4. **Canonical page backend.** #67's `public.customer_page_settings` and `app.customer_page_artwork` are the only selected page store. Do not add `customer_page_profiles` from #37/#44/#49. Pilot must evolve settings with new scoped rows, revisions and durable assets, preserving published legacy rows and links.
5. **Explicit scope remains a blocker (F08/F14).** `getCustomerPageState`, `saveCustomerPageDraft`, `saveCustomerPageArtwork`, `publishCustomerPage` and artwork getters currently pass no org/location to their RPCs; SQL chooses oldest active owner/admin membership. Owner HTTP routes are `/api/v1/customer-page` and `/api/v1/customer-page/artwork`. Pilot must carry selected org/location through UI → authenticated handler → authorized RPC → row. Coordinate any new API contract with owner engineer before changing call sites.
6. **Assets/revisions remain blockers (F09–F13).** Upload places a `blob:` image into preview before success; Publish sends `{transform,publish:true}` and treats `response.ok` as live without expected revision/asset receipt. Reopened `<img src="/api/v1/customer-page/artwork?side=draft">` cannot supply the handler's Bearer token. Existing MIME/base64 bytea storage and public image read path remain. Replace with scoped authenticated asset intake, draft/published revisions and a durable publication receipt; no competing backend.
7. **Google handoff still needs pilot repair (F06).** #66's effect calls tracking before requesting an anchor click, uses `target="_blank"` and cancels a scheduled animation frame on dependency cleanup. It does not await tracking persistence before navigation, and its explicit fallback has no separate tracking callback. `VisitStars` radio `onChange` submits immediately, so keyboard arrow navigation can commit a choice without explicit activation. Strict Mode, blocked popups, denied storage and browser handoff timing are not proven. Six added component regressions cover all five delayed response receipts and inert owner preview/shared hero transforms; these are mocked component evidence, not real-browser navigation proof. Click rows mean handoff attempts only, never posted reviews. Preserve all-rating neutrality while making explicit activation, same-tab handoff and durable recovery reliable.
8. **Layout/identity remain pilot work (F03–F05).** Shared renderer removes the old header (owner preview has the same omission); business identity is not yet visible in the no-photo rating card. Fixed `390 / 844`, 56/44 card split, five 52px labels plus gaps and dark token cascade remain. Passing component assertions do not prove 320px, 200% text, browser zoom, light/dark or Safari.
9. **Other inherited risks are intentionally visible.** Web NFC `ProgramTagSheet` and active-Starter fallback from #67 remain for their domain owners, not called production-ready. The Stripe webhook stub is excluded: setting a secret or stub flag must not create a fake successful acknowledgement. There is no Stripe webhook route in this baseline; billing must implement verified processing and durable receipts. Baseline leaves main rate limiter, proxy and security controls unchanged; it does not import #57's later missing-env auth bypass.
10. **Dependency audit follow-up.** `npm ci` and `npm audit` report eight advisories against unchanged main dependencies (two moderate, five high, one critical), including Next 16.3.0. Security/pilot must review current advisories before release; no dependency range or lockfile was changed here. The critical Next findings include [AVIF image optimization](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4) and [Windows-hosted servers](https://github.com/advisories/GHSA-p293-qw3h-jr36); this inventory does not establish exploitability in the deployed environment.

## Handoff rules

- Branch from the pushed baseline rather than remerging #66/#67 or the alternative page branches.
- Preserve current main setup, digest rotation, historical responses/praise and printed tokens.
- Domain reports belong in `docs/release/<domain>-evidence.md`; do not overwrite another domain's report or shared STATUS/TESTING. Baseline evidence is `docs/release/integration-evidence.md`.
- Pilot owns the central implementation PR after domain fixes. This baseline intentionally has no PR.
- No production migration, Google posting, SMS delivery, card charge, physical device/store or remote deployment claim is made.
