# Lessons Learned

Hard-won knowledge from building the ReviewBoost foundation. Each entry exists
because the mistake was made (or nearly made) and cost real time to diagnose.

## PostgreSQL / Supabase

**ENABLE vs FORCE RLS.** `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` is correct.
`FORCE ROW LEVEL SECURITY` also applies policies to the table owner (postgres),
which breaks SECURITY DEFINER functions that legitimately need to bypass RLS to
write audit events or perform cross-table operations.

**Cannot remove parameter defaults with CREATE OR REPLACE.** PostgreSQL error
42P13. You must DROP the function first, then CREATE it without defaults. This
applies even when the parameter types are identical.

**security_invoker on views.** A view with `security_invoker = false` (the
default) runs as the view owner (postgres), bypassing RLS entirely. Use
`security_invoker = true` so RLS applies to the querying user. Pair with
`security_barrier = true` to prevent optimizer predicate pushdown attacks that
can leak filtered rows through side channels.

**Column-level SELECT vs table-wide SELECT.** Revoking table-wide SELECT and
granting column-level SELECT on specific columns is how you exclude a column
(like `response_id`) from the Data API while still allowing RPCs to read it
internally via SECURITY DEFINER.

**FOR UPDATE prevents concurrent state corruption.** Without it, two concurrent
requests can both read "unresolved," both write "resolved," and produce duplicate
audit events. The lock is held for the duration of the transaction.

**Idempotent RPCs prevent duplicate audit events.** Check current state before
transitioning. If already in the target state, return without writing. This makes
retries and concurrent requests safe.

**Function overloads cause ambiguity.** When PostgreSQL has two functions with
the same name but different parameter counts (e.g., 6-param and 8-param with
defaults), calls can fail with "function is not unique" (42725). Drop the old
overload explicitly.

## Security

**Stand token indistinguishability.** Unknown tokens and inactive tokens must
produce the same response. If an attacker can distinguish "unknown" from
"inactive," they can enumerate valid token prefixes.

**Praise-to-rating correlation.** Any function that maps a response_id to
whether praise exists enables an attacker (or even the UI) to show which
specific ratings had praise, turning anonymous feedback into identifiable
patterns. Drop the function; aggregate counts are safe.

**Cursor injection.** If decodeCursor returns unvalidated strings that get
interpolated into PostgREST `.or()` filters, an attacker can inject filter
predicates. Validate that the ID is a UUID and the timestamp parses as a date
before using them.

**Direct UPDATE bypasses all RPC checks.** If a column-level UPDATE grant exists
on a table, the Data API lets any authenticated user bypass validation,
authorization, and audit that RPCs enforce. Revoke all UPDATE grants and route
everything through SECURITY DEFINER RPCs.

## Process

**Tests must perform the actual attack as the actual role.** A test that runs as
postgres proves nothing about what authenticated can do. Use `set_config('role',
'authenticated', true)` and `set_config('request.jwt.claims', ...)` to simulate
the real caller.

**Never trust comments in the repository.** A comment saying "this is safe
because X" is not a security proof. Write a malicious test that attempts the
attack the comment claims is blocked.

**Error handling is not optional.** A database query that silently returns `null`
on failure produces a 200 with empty data instead of a 503. Every `.from()`,
`.rpc()`, and `.select()` must check for errors. `dataFailure()` is the
project's convention.
