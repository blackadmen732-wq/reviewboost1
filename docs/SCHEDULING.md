# Who spins the workers

Two endpoints do work nobody triggers:

| Endpoint | What stops happening without it |
| --- | --- |
| `/api/v1/internal/sms/dispatch` | Text Requests are never handed to the provider. They sit in the outbox. |
| `/api/v1/internal/maintenance` | Sends whose outcome the provider never reported are never settled, dead-lettered messages never give their credit back, and monthly allowance never retires at its billing boundary. |

Both accept `GET` and `POST`, both require the worker secret
(`SMS_WORKER_SECRET`, or `CRON_SECRET` which is what Vercel Cron sends), and
both are idempotent — running them twice costs nothing, and a missed run is
caught by the next one. That is deliberate: it means *any* scheduler can drive
them, and the choice below is an operations decision, not an application one.

## The production cadence

```
dispatch:     * * * * *      (every minute)
maintenance:  */15 * * * *   (every fifteen minutes)
```

A review request that goes out an hour after the visit is a different product
from one that goes out while the customer is still in the parking lot. Every
minute is the cadence this system is designed for.

## What is committed in `frontend/vercel.json`, and why it is not that

```
dispatch:     0 19 * * *
maintenance:  0 8 * * *
```

**Vercel's Hobby plan refuses to deploy a project whose `vercel.json` declares
any cron that would fire more than once a day.** Not a warning at runtime — the
deployment itself fails, which means no application at all, not just no
scheduler. The committed schedules are therefore the fastest cadence that
deploys on every plan: a floor, not the product cadence.

`0 19 * * *` is 19:00 UTC, which is inside the 09:00–20:00 local send window
for every US timezone from Eastern to Pacific. That matters because dispatch
defers anything outside the recipient's window to the next permitted instant —
a once-a-day tick scheduled at an hour that falls outside a recipient's window
would defer the same message forever.

## Restoring the production cadence

On Vercel **Pro**, replace the `crons` block in `frontend/vercel.json` with:

```json
"crons": [
  { "path": "/api/v1/internal/sms/dispatch", "schedule": "* * * * *" },
  { "path": "/api/v1/internal/maintenance", "schedule": "*/15 * * * *" }
]
```

Off Vercel, point any scheduler at the two URLs with the worker secret as a
bearer token:

```
curl -fsS -X POST https://<host>/api/v1/internal/sms/dispatch \
  -H "Authorization: Bearer $SMS_WORKER_SECRET"
```

Vercel Cron only runs against production deployments, so preview deployments
never dispatch regardless of the schedule — which is what you want, because a
preview sharing the production database would otherwise send real texts.

## Until that is done

Text Requests are dispatched once a day, within the hour after 19:00 UTC.
Nothing is lost — messages queue, leases and idempotency keys hold, and the
next run drains them — but *late is a product defect here*, and this file is
the record that it is a deployment-plan decision rather than something the
code got wrong.
