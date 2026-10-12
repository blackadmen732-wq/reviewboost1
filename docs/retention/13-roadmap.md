# 13. Phased implementation roadmap

**Status: PROPOSED.** Each phase is one reviewable PR (or a short stack),
CI-green on a branch, behind a feature flag. No phase merges, deploys, migrates
production, changes live billing, or enables customer messaging without the
owner's explicit authorization. Complexity is relative (S < M < L), not a
time estimate.

Phases are named R0–R6 to avoid confusion with PR #76's Connections phases
(P0–P5, `docs/connections/15-roadmap.md`).

## 13.1 Sequence

```
R0 Decisions + prerequisites
 ├─► R1 Feedback loop (Needs you, follow-up, Home number, Tag activity, activity record)
 │     └─► R2 Owner email channel (outbox, prefs, weekly summary, reminders)
 │            └─► R3 Reporting (Insights port, monthly snapshot, report email)
 │                   └─► R5 Retention rules (signals, prompts, cancellation reason, plan fit)
 └─► R4 Text Request outcomes (request link, completion, credits view)  [needs #76 P0]
                                                                         │
 Connections P1–P3 (#76) ──────────────────────────────────────────────► R6 Automation pilot
```

R1 and R4 can run in parallel after R0. R6 is gated on Connections and legal.

## R0 — Decisions and prerequisites

**Depends on:** approval of this design set.

| Work | Acceptance |
|---|---|
| Owner answers README decisions 1–7 and the D-items listed in §13.3 | Recorded in `docs/retention/README.md` |
| D-0: PR #76 Phase 0 (consent, sender, STOP, templates) lands; PR #67 rebased on it so it no longer records consent on send | Text Requests on `main` refuse unconsented numbers; #67's composer uses #76 templates |
| Scheduler at production cadence (Vercel Pro or #67 `production_scheduler.sql`) with heartbeats | Dispatch runs each minute in a preview environment; heartbeat gap alert fires in a drill |
| `feature_flags` table and `lib/server/flags.ts` | pgTAP: only service role writes; flags read server-side only |
| Update stale `SYSTEM_CONTEXT.md` §5, §6, §10 and `STATUS.md` to match `main` (R-8) | Docs say Stripe is in code, V1 flow has no note |

**Complexity:** S (code) + external decisions. **Risk:** #67 and #76 conflict
on the Text Requests screen; resolve by landing #76 Phase 0 first.

## R1 — Feedback loop

**Depends on:** R0 flags. **Flag:** `retention_needs_you_v2`.

| Work | Acceptance |
|---|---|
| Migration: follow-up, assignment, category columns; `needs_attention`; new RPCs with audit | Applies from empty and on the populated baseline (`supabase/upgrade/populated_upgrade_test.sql`); pgTAP isolation and role tests |
| Needs you v2, row actions, detail actions, category sheet | Playwright: 5-star never appears in Needs you unless flagged; flag/assign/done/reopen round-trip; Axe passes |
| Home: weekly number with arrow, status priority list | Unit tests for week boundaries across DST; one status at a time |
| Tags: opens, stars, last opened, unused hint | Unit tests on hint thresholds |
| `owner_activity_days` + recorder | One row per member per day under concurrent renders |
| Mobile: Done / Follow up on feedback detail | Mobile hook tests |

**Milestone:** owners can see what needs them and prove they acted.
**Complexity:** M. **Risk:** changing Needs you hides items owners used to
see; mitigated by Everything and a one-time in-app note.

## R2 — Owner email channel

**Depends on:** R1, ADR for email provider, sending domain DNS (operator).
**Flags:** `retention_weekly_email`, per rule.

| Work | Acceptance |
|---|---|
| ADR: Resend vs alternatives (durability, deliverability, cost, failure modes) | Approved ADR in `docs/backend/` |
| `lib/server/email/` provider interface, `fake` provider, fail-closed config | Unit tests; production refuses to start a send without config |
| `owner_notifications`, `notification_preferences`, `email_suppressions`; worker | Duplicate rule firing → one email; daily cap holds under 8 concurrent workers (concurrency proof like the credit race) |
| Settings → Notifications; unsubscribe links and headers | One-click unsubscribe works without login; preference respected at lease time |
| Weekly summary; reminders C-1…C-5 | Golden-file email rendering tests; quiet-week rule; quiet period suppression |
| Bounce/complaint webhook | Signed webhook test; suppressed address never mailed |

**Milestone:** an owner who never opens the app still hears what matters,
within caps. **Complexity:** M–L. **Risk:** deliverability; mitigate with
domain authentication and low volume.

## R3 — Reporting

**Depends on:** R2 (delivery), PR #67 Insights port. **Flag:**
`retention_monthly_report`; holdout E-1 assigned at enablement.

| Work | Acceptance |
|---|---|
| Port `rpc_feedback_insights`, `lib/owner/insights.ts`, Insights view from #67 | #67's tests pass on `main` |
| `app.report_metrics(org, start, end, tz)` SQL; metric functions per doc 6 | pgTAP per metric with fixtures, including DST month, partial month, multi-location |
| Sample rules and observation catalogue in pure TS | Unit tests per rule ID, including "below threshold → omitted" |
| `report_snapshots`, report job, monthly email, Insights · Monthly | Re-running the job produces no second snapshot or email; snapshot equals live recompute on the same data |
| 3/6/12-month views gated on history | Tests at 2, 3, 12, 13 months of data |
| Banned-copy lint | CI fails on a banned phrase in templates or UI strings |

**Milestone:** every paying business gets a correct monthly report.
**Complexity:** L. **Risk:** wrong numbers destroy trust; mitigated by
snapshot-vs-recompute test and a pilot read-through of real reports.

## R4 — Text Request outcomes and attribution

**Depends on:** R0 (#76 Phase 0), decision 2. **Flag:**
`text_request_attribution`.

| Work | Acceptance |
|---|---|
| `link_ref` minting, `/r/[ref]` route serving the same customer flow | Byte-identical rendered flow vs `/q` for the same Tag (existing contract test extended); unknown ref shows expired state |
| Session RPC accepts ref; rating RPC sets `response_id`, calls `sms_mark_flow_completed` | pgTAP: cross-org ref ignored; second rating impossible (one per session); suppression row created |
| Text Requests status chips, month strip, credits header | Unit tests mapping every `text_request_status` |
| Segment tests updated for request link | Default template with 30-char name = 1 segment |
| Credit packs (F-4) and F-8 trial fix | **Owned by #76 Phase 3**; R4 only displays packs once they exist |

**Milestone:** owners can see whether texting works and what it costs.
**Complexity:** M. **Risk:** public-flow change; mitigated by identical-UI
test and flag.

## R5 — Retention rules and interventions

**Depends on:** R1 activity data for ≥ 6 weeks (baseline), R2, R3.

| Work | Acceptance |
|---|---|
| `retention_signals`, `retention_prompts`, `org_quiet_periods` | pgTAP isolation; one open signal per rule per org |
| Rules A-*, N-1, S-*, E-*, B-1, X-1 as pure functions + SQL inputs | Unit test per rule incl. minimum-data guards; replay against pilot history reports precision |
| Home prompts, dismiss reasons, quiet period setting | Frequency caps hold across rules |
| Internal retention view (staff only) | Access audited; no customer identifiers |
| Cancellation reason survey + `cancellation_details` ingest; plan-fit line | Skip is equal weight; portal reached in one click (Playwright) |
| Holdout E-4 | Assignment logged; prompts suppressed for holdout |

**Milestone:** at-risk owners are noticed and helped, measurably.
**Complexity:** M.

## R6 — Automated post-visit follow-up (pilot)

**Depends on:** Connections P1–P3 (#76), R4 (rated + already-rated), credit
packs, MFA or explicit waiver, alerting, Counsel sign-off, 10DLC, explicit
pilot authorization.

| Work | Acceptance |
|---|---|
| `automations`, `automation_versions`, `automation_events`; runner | Replay/duplicate/late-event tests; one request per visit across manual and automatic |
| Eligibility additions (doc 5 §5.3.5) inside `app.messaging_eligibility` | pgTAP per code |
| Follow-ups section in Text Requests; dry run; test send; pause | Pause effective at dispatch; auto-pause rules |
| Pilot with 3–5 salons/restaurants on `SMS_PROVIDER=fake` first, then live with authorization | Opt-out < 1%, zero complaints, delivery ≥ 95% before widening |

**Complexity:** L. **Risk:** consent coverage too low to matter (PR #76 risk
table); measure in pilot before investing further.

## 13.2 Not on this roadmap

Customer service follow-up texts (`service_follow_up` purpose), customer
reminders after a first request (D-5.1), customer-facing opt-in on the Tag
page, bulk sends, auto-reload, AI messages, MMS, imports, ML churn models.
Each is a separate decision with its own review.

## 13.3 Decisions to record in R0

| ID | Question | Recommended default |
|---|---|---|
| README 1 | Which message classes ship first | A (exists), C, E; B later; D record-only |
| README 2 | Link ratings to Text Requests | Yes, via `/r/[ref]`, aggregate-only display |
| README 3 | Needs you = 1–3 stars + flagged | Yes |
| README 4 | Email channel | Resend with ADR |
| README 5 | Port Insights from #67 | Yes |
| README 6 | F-8 trial and F-4 packs | Fix both via #76 P3 after confirmation |
| README 7 | Scheduler cadence before any sending feature | Yes |
| D-5.1 | Customer reminder text | No |
| D-7.1 | Anonymised cancellation reasons after deletion | No (delete) |
| D-11.1 | Retention features in every plan | Yes |
| D-11.2 | Normalise curly quotes in sender name | Yes |
| D-12.1 | 10DLC: platform or per-business registration | Operations + Counsel |
| D-12.2 | Location-scoped admins | Later |
| D-12.3 | Email click tracking | Own redirect, no pixels |
| D-12.4 | Non-US owners | US only in V1 |

## 13.4 Top risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Reports show a wrong number | Medium | High | Snapshot-vs-recompute test; pilot read-through; operator correction path |
| Emails feel like spam and get unsubscribed | Medium | High | Caps, quiet-week rule, category unsubscribes, E-3 test |
| Needs you change confuses existing owners | Low | Medium | Everything tab unchanged; one-time note |
| Text attribution read as surveillance | Low | Medium | Aggregate-only, privacy policy, no recipient-level display |
| #67, #74, #76 land in a different order | High | Medium | Each R-phase rebases on what is on `main`; no parallel schema |
| Scheduler stays daily | Medium | High | R0 blocks R2+ sending features |
| Consent coverage too low for texting value | High | Medium | Value case does not depend on texting; reports work from Tags alone |
