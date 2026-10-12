# 14. Testing strategy

**Status: PROPOSED.** Uses the repository's existing gates (`TESTING.md`,
`docs/V1_COMPLETION_REPORT.md`): TypeScript strict, ESLint, Vitest (web and
mobile), Playwright with Axe in both colour schemes, migrations from empty,
pgTAP, the populated-upgrade test, and the concurrency proofs
(`scripts/backend/concurrency-proof.sh`). No new test framework.

CI-tested is not live-verified. Each phase's acceptance criteria (doc 13) name
which tests must exist; this document says what they cover.

## 14.1 Unit (Vitest)

| Area | Cases |
|---|---|
| Local-day windows | Week and month boundaries in `America/New_York` across both DST transitions, `Pacific/Auckland`, a location still on `UTC` |
| Sample rules | Each threshold at n−1, n, n+1 (doc 6 §6.6) |
| Observation catalogue | Each O-rule fires on a minimal fixture and does not fire just below; priority order; never more than three; next-step priority |
| Banned copy | Every template and UI string file scanned; a fixture containing "reviews generated" fails |
| Home status | Priority order with all combinations of conditions; exactly one status |
| Needs you predicate | Ratings 1–5 × flagged × resolved truth table |
| Churn rules | Each rule ID: fires, does not fire, minimum-data guard, quiet-period suppression, tenure guard |
| Reminder caps | Per-member daily and weekly caps; C-3 exception; quiet-period exceptions |
| Segment counts | Default templates with request link at sender-name lengths 1, 15, 30; curly-quote name → UCS-2 warning; normalisation (D-11.2) |
| Status mapping | Every `text_request_status` → owner label |
| Email rendering | Golden files per template; owner-supplied strings escaped; no customer identifier appears in rendered output for a fixture that contains them in the database |

## 14.2 Database (pgTAP)

| Suite | Assertions |
|---|---|
| `feedback_actions_test.sql` | Flag/unflag/assign/resolve/reopen idempotent; audit row per change; `assigned_to` must be same-org active member; viewer cannot act; member can act on own/unassigned only |
| `retention_isolation_test.sql` | Cross-tenant read/write attempts on every new table and RPC fail, from three directions (as the V1 isolation suites) |
| `report_metrics_test.sql` | Each M-ID on fixtures; RLS respected (SECURITY INVOKER paths); snapshot unique per period |
| `notifications_test.sql` | Idempotency keys; lease ownership; suppressed reasons recorded |
| `attribution_test.sql` | Ref from another org or Tag ignored; `response_id` set once; `sms_mark_flow_completed` creates suppression; no rating copied to `text_requests` |
| `integrity_test.sql` | No new function body that decides sending, eligibility, or destination references `rating` (catalogue inspection, as PR #76 doc 7 §7.6) |
| `retention_signals_test.sql` | One open signal per rule per org; clearing; only service role writes |
| Populated upgrade | Every new migration applied to the populated baseline; existing rows get correct `needs_attention` |

## 14.3 Integration (route handlers with a real local Postgres)

- Owner APIs for feedback actions: auth, role, CSRF, idempotency key replay.
- `/r/[ref]` → session → rating → request marked rated, end to end.
- Notifications worker against the `fake` email provider: retries, dead
  letter after 24 h, provider timeout after acceptance does not double-send
  (provider idempotency header asserted).
- Report job: run twice → one snapshot, one email per member.
- Stripe fixtures (signed): `customer.subscription.updated` with
  `cancel_at_period_end` raises X-1; `cancellation_details` stored; duplicate
  event ignored.

## 14.4 End-to-end (Playwright)

- Home: weekly number with arrow; quiet week copy; one status.
- Feedback: 5-star absent from Needs you; flag, assign, add note, mark done
  with category, reopen.
- Text Requests: send (fake provider) → status chips progress → rated after
  customer taps `/r/` link in a second browser context.
- Customer flow parity: `/q/{token}` and `/r/{ref}` render byte-identical
  content and hand off to the identical destination for every star 1–5
  (extends the existing V1 contract test).
- Settings → Notifications: toggle, unsubscribe link without login.
- Billing: cancellation path reaches the portal in one click; survey skippable.
- Axe on every new screen, light and dark, phone and desktop.

## 14.5 Billing and credits

The ledger is not changed by this design. Tests assert that new code never
writes to it except through existing functions:

- Reports read credits only from grants/ledger (no constant), so a #67-style
  `smsIncluded: 0` cannot reach a report (F-3/R-12).
- Automation (R6): concurrency proof with 8 runners on the last 5 credits →
  no overspend, monthly first; pause on exhaustion.

## 14.6 Consent and messaging

Reuse PR #76's suites. Add for R6: automation skip reasons per eligibility
code; stale event; visit cancelled before dispatch cancels the request;
pause at dispatch cancels and releases; daily cap under concurrency.

## 14.7 Failure recovery drills (pre-launch, preview environment)

| Drill | Expected |
|---|---|
| Kill the notifications worker mid-batch | Leases expire; each email sent once |
| Email provider returns 500 for an hour | Retries with backoff; no duplicates; health shows backlog; alert fires |
| Report job fails on day 1 | Retries hourly; Home does not claim a report exists |
| Scheduler stops | Heartbeat alert within threshold |
| Duplicate Twilio and Stripe webhooks replayed | No state change on replay |
| Flag turned off mid-run | New work stops; pending rows suppressed with `flag_off` |

## 14.8 Live verification (separate, needs credentials)

Not provable in CI and recorded separately with evidence, as the V1 program
did: a real email to a real inbox with working unsubscribe; a real SMS with
the request link rated from a phone; a real Stripe cancellation with a reason.
