# MFA proposal (not implemented)

Status: **PROPOSAL.** Nothing here exists yet. The product does not claim MFA
anywhere (enforced by `frontend/tests/unit/mfa-claims.test.ts`), so this is
not a release blocker. It is the design to build once the backend launch gate
is otherwise green.

## Goals

1. Owners can protect their account with an authenticator app (TOTP).
2. Sensitive actions require a recent second factor — enforced on the
   server, never only in the UI.
3. No existing owner is locked out, now or when enforcement tightens.

## Building blocks (Supabase Auth)

* `[auth.mfa.totp] enroll_enabled = true, verify_enabled = true` in
  `supabase/config.toml` and the hosted project.
* `supabase.auth.mfa.enroll({ factorType: 'totp' })` → QR / secret →
  `challenge` + `verify` to activate.
* Every access token carries `aal` (`aal1` = OTP email only, `aal2` = second
  factor verified in this session) and `amr` with timestamps.
* `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` tells the client the
  current and the achievable level.

## Enrollment

* Settings → Security → "Add an authenticator app". Optional at first.
* Enrollment requires a fresh email OTP sign-in (re-authentication within 10
  minutes), so a stolen session cannot silently add its own factor.
* Show and require confirmation of **recovery codes** (10 single-use codes,
  shown once). Supabase has no built-in recovery codes, so they are ours:
  `public.mfa_recovery_codes(user_id, code_hash, used_at)`, HMAC-digested with
  `TOKEN_DIGEST_KEY`, service-role only, consumed through a definer RPC that
  unenrolls the TOTP factor and records an audit event.
* Allow a second TOTP factor (backup device). `max_enrolled_factors` is 10.

## Step-up for sensitive actions (server-enforced)

A helper `requireRecentAal2(context, maxAgeSeconds = 900)` in
`lib/server/auth.ts` reads the verified JWT's `aal` and the `amr` entry for
`totp`, and throws `403 step_up_required` when the user **has a verified
factor** and the session is not `aal2` within the window.

Routes that call it:

| Action | Route |
|---|---|
| Billing changes (checkout, portal, plan change) | `POST /api/v1/billing` |
| Organization deletion / account deletion | `/api/v1/account/deletion` |
| Member administration (role change, remove, suspend) | member routes |
| API keys / integration credentials (when introduced) | — |
| PII export (when introduced) | — |

The database backs it for the most destructive path: `rpc_delete_organization`
and the member RPCs check `auth.jwt() ->> 'aal'` when the caller has a
verified factor (`auth.mfa_factors` where `status = 'verified'`), so a direct
PostgREST call with an `aal1` token cannot bypass the route.

The client handles `step_up_required` by opening a code prompt
(`mfa.challengeAndVerify`) and retrying — not by hiding buttons.

## Not locking anyone out

* **Phase 1 — optional.** Enrollment available; step-up enforced only for
  owners who enrolled. Owners without a factor are unaffected.
* **Phase 2 — encouraged.** Banner for owners of organizations with paid
  plans. Still optional.
* **Phase 3 — required for owners** (only if the product decides so): owners
  without a factor are sent to enrollment after sign-in, with a 14-day grace
  period, and recovery codes are mandatory before enrollment completes.
* Lost device: recovery code, or support-assisted reset after identity
  verification through the billing email, recorded as an audit event.

## Tests to write with it

* pgTAP: an `aal1` JWT for a user with a verified factor cannot call
  `rpc_delete_organization`; `aal2` can; a user without a factor can (phase 1).
* Unit: `requireRecentAal2` accepts fresh `aal2`, rejects stale and `aal1`,
  passes users without factors.
* Recovery code: single use, digested, unenrolls, audited, cross-user use fails.
* The MFA-claims test is flipped: copy may mention MFA only when the config
  enables it *and* the step-up helper is wired to the listed routes.
