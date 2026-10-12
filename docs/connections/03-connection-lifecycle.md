# 3. Connection lifecycle and state machine

**Status: PROPOSED.**

## 3.1 Three layers, not one long list

The brief names eleven states. Some are lifecycle facts (is this connection
usable at all?), one is an activity (a sync is running right now), and one is
a quality grade (it works, with warnings). Storing them in one column would
force impossible combinations, such as "syncing" erasing "has warnings". So:

| Layer | Stored as | Values |
|---|---|---|
| **Lifecycle** | `integration_connections.state`, transitions enforced in the database | `connecting`, `authorization_required`, `active`, `reauth_required`, `unavailable`, `error`, `disconnecting`, `disconnected` |
| **Health** (only meaningful when `active`) | `integration_connections.health`, recomputed after every run and event | `healthy`, `warning` |
| **Activity** | Derived: a `integration_sync_runs` row in `running` with a live lease | `syncing` or not |

How the brief's states map:

| Brief | Representation | Owner label |
|---|---|---|
| Not connected | No connection row, or `disconnected` | Not connected |
| Connecting | Unexpired `integration_oauth_states` row for this org and provider (before callback), or `connecting` (after callback, during configuration and test) | Setting up |
| Authorization required | `authorization_required` | Needs permission |
| Connected and healthy | `active` + `healthy` | Connected |
| Syncing | `active` + a running sync run | Updating… |
| Connected with warnings | `active` + `warning` | Connected, with a note |
| Reauthentication required | `reauth_required` | Sign in to Square again |
| Temporarily unavailable | `unavailable` | Square isn't responding |
| Disconnected | `disconnected` | Not connected |
| Revocation or cleanup in progress | `disconnecting` | Disconnecting… |
| Connection error | `error` | Something went wrong |

## 3.2 Transitions

Enforced by `app.integration_transition_allowed(from, to)` inside the only
function that changes state, `app.integration_set_state(connection_id, to,
reason_code, actor)`, which locks the row `FOR UPDATE`, is idempotent when
already in `to`, and writes an `integration_connection_events` row and an
`audit_events` row in the same transaction. No role has `UPDATE` on the table
(the pattern `LESSONS.md` requires).

| From | To | Trigger |
|---|---|---|
| (none) | `connecting` | OAuth callback validated; credentials stored; identity and scopes verified |
| (none) | `authorization_required` | Callback validated but granted permissions are short of the chosen workflow |
| `authorization_required` | `connecting` | Owner re-authorizes with the full set |
| `connecting` | `active` | Configuration saved **and** test sync passed **and** owner pressed Activate |
| `connecting` | `disconnected` | Owner cancels setup, or setup abandoned for 7 days (worker) |
| `active` | `reauth_required` | Refresh fails with an auth error (`invalid_grant`, 401 with revoked token), or provider reports revocation |
| `active` | `unavailable` | N consecutive transient failures (5xx, timeouts, network) over at least 15 minutes |
| `active` | `error` | A non-retryable, non-auth failure that needs a human (for example, the mapped provider location was deleted) |
| `unavailable` | `active` | A health check succeeds |
| `unavailable` | `reauth_required` | A probe returns an auth error |
| `reauth_required` | `active` | Owner re-authorizes the **same** provider account and the health check passes |
| `error` | `active` | Owner fixes configuration and a test passes |
| `active`, `authorization_required`, `reauth_required`, `unavailable`, `error`, `connecting` | `disconnecting` | Owner disconnects, or the provider tells us access was revoked, or the org is deleted |
| `disconnecting` | `disconnected` | Revocation attempted (success, or recorded failure after bounded retries), credentials deleted, cleanup scheduled |
| `disconnected` | — | Terminal. Reconnecting creates a **new** connection row, and re-links to existing customers through the stable external ids (doc 5) |

Health transitions (`active` only):

| To | When |
|---|---|
| `warning` | Last run finished `partial`; or webhook events stopped arriving while polling still finds changes; or token refresh is overdue but not failed; or a mapped location's timezone disagrees with the ReviewBoost location |
| `healthy` | Next clean run with none of the above |

## 3.3 What each state allows

| State | Webhooks accepted | Scheduled sync | Manual sync | Recipients usable in Text Requests |
|---|---|---|---|---|
| `connecting` | Recorded, held until active | No | Test only | No |
| `authorization_required` | Recorded, not processed | No | No | No |
| `active` | Yes | Yes | Yes | Yes |
| `reauth_required` | Recorded, processed after reauth | No | No | Already-synced records stay usable; the composer says the source needs attention |
| `unavailable` | Yes (Square pushes even if its API is degraded) | Backed off | Disabled | Yes, with a staleness note |
| `error` | Recorded, held | No | No | Yes, with a note |
| `disconnecting`, `disconnected` | Rejected with 200 and dropped (so the provider stops retrying), counted | No | No | Records from this source follow the disconnect policy (doc 5 §5.8) |

Records already synced are never silently hidden because a connection
degraded. Eligibility (doc 7) treats "source needs attention" as a warning,
not a block, because consent and opt-out live in ReviewBoost, not in Square.

## 3.4 Setup flow

Each step names what makes it pass. A step that fails does not advance.

1. **Explain.** Provider detail page: what it does, what it reads, what it
   cannot do (doc 12 §12.3). No network call.
2. **Explain the data and why.** The owner picks a workflow (Payments or
   Appointments); the page lists exactly the permissions that workflow
   requests and the reason for each.
3. **Choose organization and location.** Organization comes from the session
   (`requireOwner`). If the org has several locations, the owner can pick now
   or after authorization (Square locations are only known after). The
   location choice is confirmed in step 8.
4. **Redirect to the provider.** `POST …/authorize` checks role, MFA (decision
   3 in the README), rate limit, and that no other active connection exists
   for this org and provider. It stores a single-use `state` (256-bit random,
   stored as a keyed digest), the org, the user, the workflow, the requested
   scopes, and an expiry of 10 minutes; returns Square's authorize URL with
   `client_id`, `scope`, `state`, and the **registered** redirect URI (any
   further Square-specific parameters are confirmed against Square's current
   authorize reference during Phase 2). The browser navigates there. Nothing secret is in the URL.
5. **Validate the response.** The callback page posts `code` and `state` to
   `…/callback`. The server: looks up the state by digest; rejects if missing,
   expired, used, or belonging to a different user session; marks it used
   (single-use, in the same transaction); rejects any `error` parameter with a
   plain message; exchanges the code server-to-server with the client secret
   and the exact same redirect URI.
6. **Store credentials.** Access token, refresh token and expiry are encrypted
   (doc 4 §4.5) into `integration_credentials`, which no client role can read.
7. **Verify permissions and identity.** Compare the granted scopes in the token
   response with the requested set. Call `ListLocations` (Square's own
   validity check) and read `merchant_id`. Refuse if this merchant is already
   connected to another org. Short scopes → `authorization_required`.
8. **Configure.** Map Square locations to ReviewBoost locations (each
   ReviewBoost location at most once). Show each Square location's timezone
   next to the ReviewBoost one and flag a mismatch. Choose which events count
   as a visit (fixed per workflow in V1; there is no free-form field mapping
   UI, because the canonical model needs only a handful of fields and the
   adapter owns that mapping).
9. **Test.** `…/test` fetches a bounded sample (up to 25 customers and 25
   visit candidates from the last 7 days) through the real adapter and the
   real normalizer, and writes **nothing** to canonical tables. It returns
   counts: usable records, records with no phone, invalid phones, payments with
   no customer, unmapped locations.
10. **Show results.** The owner sees what would come in and what would not,
    with reasons and no raw personal data in the issue list beyond a name and
    last four digits.
11. **Activate.** Allowed only if steps 7–9 passed. `…/activate` transitions
    to `active`, then enqueues the initial backfill (doc 6 §6.6). The owner
    lands on the connected detail page showing the backfill's progress.

## 3.5 Re-authorization

Same flow from step 4, with `reconnect_connection_id` stored on the OAuth
state. The callback refuses if the returned `merchant_id` differs from the
connection's `external_account_id`: reconnecting must not silently swap a
business onto a different Square account. Switching accounts is a disconnect
followed by a new connection.

## 3.6 Disconnect

1. Owner confirms in a dialog that says what happens to the data (doc 5 §5.8).
2. `→ disconnecting`. Webhooks for this merchant are now dropped.
3. Call Square `RevokeToken` for this application and merchant. Up to 3
   attempts with backoff; a final failure is recorded on the connection event
   and surfaced in operations, not hidden.
4. Delete the `integration_credentials` row (hard delete; it is the only copy).
5. Schedule source-data cleanup per the retention policy.
6. `→ disconnected`.

If Square tells us access was revoked from its side (Dashboard disconnect),
the same path runs from step 2 without the revoke call.
