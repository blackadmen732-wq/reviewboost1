# ReviewBoost — Journey Log

This file is the append-only living journey log. Mistakes stay. Earlier entries
are not rewritten, summarised away, or “cleaned up.”

It is not product truth, capability status, or the engineering-rules sheet.

| Need | File |
|---|---|
| Product truth (approved / rejected / proposed) | [`SYSTEM_CONTEXT.md`](./SYSTEM_CONTEXT.md) |
| Capability (implemented / CI-tested / live-verified) | [`STATUS.md`](./STATUS.md) |
| Engineering rules (current short sheet on `main`) | [`LESSONS.md`](./LESSONS.md) |
| August 2026 retrospective (full archive, recovered) | [`docs/history/RETROSPECTIVE-2026-08.md`](./docs/history/RETROSPECTIVE-2026-08.md) |

---

## Part 0 — Lost first version (archive pointer)

The lost-first-version story already lives in git. This part points at it; it
does not invent a new founding myth.

`SYSTEM_CONTEXT.md` was written to a file rather than left in chat because the
project had already been lost once. Original commit `5877e81` (2026-08-05):

> Written to a file rather than left in a chat because this project has already
> been lost once.

The long August retrospective recorded the three process failures that cost real
damage. It was introduced as `LESSONS.md`, last lived on
`origin/docs/reviewboost-truth-baseline` @ `97d8fe8e` (blob
`2846543689e14eca1a3a74bccc054ccc733f81eb`, 469 lines), then deleted from the
mainline in `5060f7c` as “dead docs” and replaced by the short root
`LESSONS.md`. The recovered copy is
[`docs/history/RETROSPECTIVE-2026-08.md`](./docs/history/RETROSPECTIVE-2026-08.md)
(byte-identical to that blob). Do not revive it as the living log.

Excerpt from that file, Part 1 — Process failures that cost real damage
(not rewritten):

```
### 1. Work held in unpushed commits was lost

An entire working tree and its git object store were lost with nothing on the
remote. No reflog, no dangling objects, no snapshot.

> **RULE — Push before you build, not after.** Create the repository, push, then
> write code. An unpushed commit does not exist.

### 2. Live secrets were exposed three times

Twilio API key and secret in chat; a Resend key in chat; live `JWT_SECRET` and
`PII_ENCRYPTION_KEY` pasted into `.env.example`, which is a committed file.

### 3. Two AI agents wrote to the same repository simultaneously

Roughly a thousand lines changed in fifteen minutes while a review was in
progress. Files grew under the reader. Every edit matched a version that no
longer existed.

> **RULE — One writer at a time.** Separate branches or separate directories, or
> stop one.
```

Cite: [`docs/history/RETROSPECTIVE-2026-08.md`](./docs/history/RETROSPECTIVE-2026-08.md)
§ Part 1. Related archive (not on `main`): `docs/backend/GAPS.md` §2 on
`origin/backend/customer-flow-foundation` — “This project has already lost
almost all of its code once.”

---

## 2026-09-08 — Org thrash, #51 tip drift, #53 FIFO isolate dual-gated

Parallel cloud-agent fan-out the same day (FORGE / SENTINEL / JUDGE plus
inspect roles on the SMS quota and SID stack, alongside a separate research
pass). That is org thrash: many writers, moving tips, and verification aimed at
SHAs that were no longer the PR head. Same class of damage as Part 0 / retrospective
Part 1.3.

`main` stayed at `26320dd`. No merge.

### #51 tip drift

PR [#51](https://github.com/blackadmen732-wq/reviewboost1/pull/51)
(`sprint/forge-47-p0-sid-fifo`) is stacked on #47 @ `64e76371`. FIFO land was
`d280573`. While JUDGE was verifying that SHA, the remote tip moved to
`a342552` via two later same-body SID commits (`275a894`, `a342552`). Those
later commits were not dual-gated with the FIFO isolate.

### #53 FIFO-only isolate — dual-gated at `e0f21bef`

PR [#53](https://github.com/blackadmen732-wq/reviewboost1/pull/53)
(`sprint/forge-47-fifo-only-d280573`) rebuilt FIFO-only off `64e76371` so the
diff is exactly two files:

- `supabase/migrations/20260908000200_sms_receipt_quota_retry_hardening.sql`
- `supabase/tests/text_requests_test.sql`

Tip `e0f21bef08a101604b7d1616dbe33a18bfd5b0c6`. No SID-lock /
`sms-provider.test.ts`.

Dual gate on that tip:

- SENTINEL (`bc-3c3e5699`): **CONFIRM** — scope two files; ghost-capacity
  `fifo_used(B)=30`, available=`0`; pgTAP 138/138.
- JUDGE (`bc-1f1c8f54`): **PASS** — `#53 @ e0f21bef VERDICT: PASS`

### Same-body SID still open on #51

Same-body SID attach conflict remains on #51 @ `a342552`, unverified by the
#53 isolate. FIFO CONFIRM/PASS does not close it.

### Research pack path

Same-day backend research pack (not on `main`; not this PR):

`docs/backend/deep-research/` on
`origin/cursor/sms-economics-platform-phase-1-5112` @ `a616522`
(`00-synthesis.md` … `05-sms-economics-platform-design.md`). Header: research
pass completed 2026-09-08 against `main` at `26320dd`.

### Standing rule

No merge of #51 or #53 without Marc. This log PR does not merge them either.
