# Privileged surface review

Reviewed on the migrated head schema (62 migrations) with a local PostgreSQL
16 and `supabase db advisors` 2.117.0. The hosted project's advisor was **not**
re-run (no access); the previous audit reported callable SECURITY DEFINER
functions there, which is expected: the hosted schema is 26 migrations behind.

## Mechanically enforced

`supabase/tests/privilege_surface_test.sql` fails if any of these stops being
true, and was checked against a planted violation:

* no SECURITY DEFINER function is executable by `anon`;
* the definer functions executable by `authenticated` are exactly the 35
  reviewed below — a new one fails until reviewed and added;
* every definer pins `search_path = ''`;
* every browser-callable definer establishes the caller via `auth.uid()` or a
  named helper (`app.customer_page_authorize`, `app.create_organization_with_first_stand`);
* `anon` holds no table privilege; `authenticated` holds SELECT only;
* every public table has RLS; every view is `security_invoker`.

`frontend/tests/unit/service-role-containment.test.ts` does the same for the
service-role client in application code.

## Why each class must be DEFINER

| Class | Functions | Why not INVOKER + RLS | Caller identity | Tenant |
|---|---|---|---|---|
| RLS helpers | `app.is_org_member`, `app.has_org_role`, `app.shares_organization` | Policies call them; as INVOKER they would recurse through the membership table's own RLS | `auth.uid()` | derived from membership rows |
| Owner writes (35 `rpc_*`) | locations, Tags, staff, members, responses, praise, destinations, Customer Page, Customers (save, delete, record export; owner/admin only), Text Requests cancel, NFC record, org update/delete, balance | `authenticated` has **no** write grant on any table by design, so every write is a function that validates input, checks role, writes the row and the audit event in one transaction | `auth.uid()`; fails `42501` when null | `p_org_id` is accepted but every function checks `organization_members` for (org, caller, active[, role]) before touching it, and each row is re-scoped by `org_id` |
| Organization creation | `rpc_create_organization` → `app.create_organization_with_first_stand` | creates the org the caller is not yet a member of | `auth.uid()` | the new org; per-user org limit |
| Service-only (91) | billing, Stripe inbox, SMS pipeline, public review flow, rate limits, heartbeats, maintenance | called only by the server with the service role; `revoke … from public, anon, authenticated` | server | derived from capability tokens (public flow) or from Stripe/Twilio identifiers (webhooks) — never from a client-supplied org id |

Cross-tenant attacks on these are performed, not asserted, in
`cross_org_isolation_test.sql`, `praise_isolation_test.sql`,
`column_security_test.sql`, `security_hardening_test.sql`,
`customer_page_test.sql`, `account_deletion_test.sql`, `customer_contacts_test.sql`.

## Advisor findings on head

| Finding | Level | Disposition |
|---|---|---|
| `rls_enabled_no_policy` ×10 (`account_deletions`, `billing_customers`, `billing_plan_prices`, `idempotency_records`, `rate_limit_buckets`, `sms_outbox`, `sms_phone_optout`, `sms_reservation_slices`, `sms_webhook_inbox`, `stripe_webhook_events`) | INFO | Intended: service-role-only tables. RLS on with no policy = deny for everyone else |
| `multiple_permissive_policies` on `profiles` (SELECT: self, org peer) | WARN | Performance only (two policies evaluated). Acceptable at current scale; merge into one policy if `profiles` reads show in query stats |
| `unindexed_foreign_keys` ×30 | INFO | See SCALING.md — judged by query plans, not added wholesale |
| `unused_index` ×45 | INFO | Meaningless on an empty database; re-evaluate from production stats after 30 days |
| SECURITY DEFINER executable | — | Not reported locally because the shim has no PostgREST exposed-schema config; the allowlist test covers it. Expect the hosted advisor to list the 35 above as WARN — each is reviewed here |

## Other surfaces

| Surface | State |
|---|---|
| Webhook signatures | Stripe: `constructEvent` before any write, no bypass. Twilio: HMAC over URL + params; fake provider requires a shared secret outside development, and is refused in production |
| Rate limiting | Database-backed, fail-closed (`rpc_consume_rate_limit`) on public flow and SMS scheduling |
| Token rotation | Digest key versioning with lazy re-digest; production requires an independent digest key |
| Account deletion | Cancels the Stripe subscription before local deletion, then Auth Admin `deleteUser` if it was the last membership |
| Storage | `customer-page` public-read for published assets; uploads only via server-signed URLs; confirmation checks the object exists |
| MFA | **Not implemented.** See LAUNCH_GATE.md §7 |
| Auth sessions | Supabase: 1 h JWT, refresh rotation with reuse detection; per-IP sign-in/verify limits; no per-account lockout |
