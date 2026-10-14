# Operations: monitoring, backup, recovery

Status of everything here: **written, not yet running.** No monitor, alert
route, backup verification or restore drill has been performed. See
LAUNCH_GATE.md for the state of each.

## 1. Monitoring

### The two endpoints

Both require `Authorization: Bearer $CRON_SECRET` and answer 404 without it.

| Endpoint | Healthy | Unhealthy |
|---|---|---|
| `GET /api/v1/internal/health` | 200, `data.ok = true` | **503**, `data.ok = false`, `data.problems[]` |
| `GET /api/v1/internal/readiness` | 200 | 503 with `data.problems[{subsystem, problem}]` |

A monitor must treat **anything but 200 with `data.ok === true`** as down.
Health returns 503 whenever `ok` is false precisely so status-code-only
monitors cannot read a broken product as fine.

Recommended: an uptime monitor (Better Stack, Checkly, UptimeRobot or
similar) polling health every minute with the bearer header and a JSON
assertion on `data.ok`, paging after 2 consecutive failures; readiness every
15 minutes.

### Health problems and thresholds

| Problem | Condition | Means | First action |
|---|---|---|---|
| `outbox_backlog` | oldest pending SMS job > 10 min | dispatcher not keeping up or not running | check `sms_dispatch_stale`; worker logs `sms.dispatch_*` |
| `sms_dispatch_stale` | no successful dispatch in 5 min (or never) | scheduler stopped / never configured / plan cadence | scheduler dashboard; call the dispatch URL by hand |
| `maintenance_stale` | no successful maintenance in 45 min | reconciliation, dead-letter release, allowance expiry not running | as above |
| `sms_dispatch_failing` / `maintenance_failing` | last run failed after last success | worker errors | `worker_heartbeats.last_error`; `maintenance.step_failed` logs |
| `provider_unknown_age` | oldest unconfirmed send > 1 h | Twilio callbacks not arriving | callback URL, Twilio console |
| `dead_letters` | any dead-lettered job | a message exhausted retries | inspect; credit is released by maintenance |
| `stripe_webhooks_unprocessed` | any unprocessed Stripe event | billing state not applied | `stripe_webhook_events.last_error`: `unknown_price` → map the price and resend; unknown customer → investigate |
| `sms_webhooks_unprocessed` | any unprocessed SMS webhook | delivery/STOP state not applied | inbox rows |
| `config_not_ready` | readiness config check failing | a variable was removed or broken after deploy | readiness endpoint names it |
| `worker_health_unavailable` | heartbeat RPC failed | database or migration problem | database status |

### Log-based alerts (Vercel log drain → the log tool)

| Event | Level | Alert |
|---|---|---|
| `billing.price_unmapped` | error | page immediately: a paying customer's plan is not applied |
| `billing.webhook_bad_signature` | warn | > 10 / 10 min (probe or wrong secret) |
| `maintenance.step_failed` | error | any |
| `sms.dispatch_claim_failed` | error | any |
| `http.*` 5xx | — | 5xx rate > 1% over 5 min, or > 20 in 5 min |
| `public.rate_limited` | warn | > 100 / 5 min (abuse or a broken client) |
| Supabase Auth failures | — | Supabase dashboard; > 3× the 7-day baseline |

Every log line is JSON with `event`, `requestId` and `at`. Redaction is by key
(tokens, auth headers, email, phone, notes, keys, PostgREST `details`) and by
value (E.164 numbers). Never log: raw phone numbers, tokens, auth headers,
message bodies, notes, encryption keys, Stripe or Twilio secrets.

## 2. Backup and disaster recovery

### What must be recoverable

| Asset | Where | Covered by Supabase DB backup? |
|---|---|---|
| Postgres (public, app schemas) | Supabase | yes |
| Migration ledger (`supabase_migrations`) | Supabase | yes |
| `auth.users`, identities | Supabase (auth schema) | yes (same database) |
| Customer Page images | Storage bucket `customer-page` | **no — objects are not in database backups** |
| `CUSTOMER_NOTE_ENCRYPTION_KEY` | secret store | **no** — without it every encrypted note, praise and phone is unreadable forever |
| `TOKEN_DIGEST_KEY` (+ `_PREVIOUS` during rotation) | secret store | **no** — without it every printed Tag stops resolving and must be reprinted |
| Stripe price IDs, webhook secret, keys | Stripe + secret store | re-creatable from Stripe |
| Twilio SID, token, messaging service | Twilio + secret store | re-creatable from Twilio |
| `CRON_SECRET` | secret store | re-generatable |

### Required before launch

1. **Database:** Supabase Pro daily backups (7-day retention) at minimum; PITR
   add-on if an RPO under 24 h is required. Verify in the dashboard that a
   backup from the last 24 h exists. *Unverified.*
2. **Independent copy:** nightly `supabase db dump` (schema + data + roles)
   to storage outside Supabase (e.g. an S3 bucket with versioning and a
   different account), encrypted. Protects against account-level loss.
3. **Storage:** nightly copy of bucket `customer-page` to the same external
   store (S3-compatible API or `supabase storage cp -r`). Object paths are
   stored in `customer_page_assets.storage_path`; restore must preserve them.
4. **Secrets:** the two keys above in a password manager / secret manager
   with at least two people able to retrieve them, **separately** from the
   database backups (a stolen backup must not come with its keys). Record key
   versions alongside.

### Restore drill (to perform on a non-production project)

1. Create a scratch Supabase project. Restore the latest dump (or a PITR
   point) into it.
2. `supabase migration list` — 62 = 62.
3. Copy the Storage backup into bucket `customer-page` (public).
4. Deploy the current build to a preview pointed at the scratch project, with
   **the production encryption and digest keys** and test-mode Stripe.
5. Prove, and record times for each:
   1. a Tag token from production resolves (digest key correct);
   2. an owner's encrypted note / text-request phone decrypts;
   3. an owner can sign in (OTP to a real mailbox);
   4. a published Customer Page renders its images;
   5. billing state matches production's rows;
   6. dispatch and maintenance run and heartbeat;
   7. the public review flow completes end to end.
6. RPO = age of the newest restored row; RTO = wall-clock from "start" to 5.7.
   Write both into this file. **Until this is done, RPO and RTO are
   undefined, and must not be stated as anything else.**

### When to restore production

Only for data loss or corruption that cannot be fixed forward. Restoring over
live data discards everything since the backup, including payments Stripe has
already taken; reconcile `billing_subscriptions` against Stripe afterwards by
resending events for the gap.
