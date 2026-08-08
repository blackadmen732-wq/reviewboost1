# Frontend handoff

Changes the backend needs in frontend-owned or shared files.

Item 1 was completed by the backend after the user explicitly lifted the lock on
`frontend/package.json`. Everything else below is a **request, not an edit** —
no component, page, layout, style, form, reducer, or copy string has been
touched.

Requested by: backend, on `backend/customer-flow-foundation`
Against: `codex/frontend-premium-redesign` @ `f64b519`

---

## 1. Supabase client — DONE, no action needed

Unblocked and completed by the backend after the lock on
`frontend/package.json` was lifted explicitly.

| | |
|---|---|
| File | `frontend/package.json` |
| Added | `"@supabase/supabase-js": "2.112.2"`, `"server-only": "0.0.1"` — both pinned |
| Status | Installed, lockfile committed, `npm audit` reports 0 vulnerabilities |

Nothing else in that file changed. If you have local changes to
`package.json` or the lockfile, expect a conflict on merge and take both
dependency additions.

**Security impact:** the package adds no browser exposure by itself. The
exposure to watch is the *key*, not the package:

- The **service-role key** must be read only inside `frontend/lib/server/**` and
  Route Handlers. It must never be named `NEXT_PUBLIC_*`, never imported into a
  client component, and never logged.
- The client bundle may contain only `NEXT_PUBLIC_SUPABASE_URL` and the
  publishable/anon key.

Please pin the exact version rather than a range if you prefer; the backend has
no constraint beyond v2.

### Environment variables to add (server-only)

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=      # server-only. Never NEXT_PUBLIC_*.
PUBLIC_FRONTEND_URL=            # origin printed into QR codes, e.g. https://app.reviewboost.com
CUSTOMER_NOTE_ENCRYPTION_KEY=   # base64, 32 bytes: openssl rand -base64 32
```

`.env.example` is a locked file, so the backend has not added them there.

---

## 2. Send no credentials on public requests — NON-BLOCKING

| | |
|---|---|
| File | `frontend/lib/api/production-customer-flow-api.ts` |
| Line | ~18, the `createClient` call |
| Change | `credentials: "include"` → `credentials: "omit"` |

```diff
 const client = createClient<paths>({
   baseUrl,
-  credentials: "include",
+  credentials: "omit",
   fetch: (request) => globalThis.fetch(request),
```

**Why:** the five public endpoints are anonymous. They use no cookies, no CSRF
token, and no owner session. Sending credentials widens what a cross-origin
response is allowed to carry and couples the customer flow to CORS credential
rules it does not need.

**Not blocking.** The backend does not require it: the public routes carry no
ambient authority and ignore cookies entirely, so the flow works either way.
This is hygiene.

One test asserts the current behaviour and will need the same one-word change:

| File | Test |
|---|---|
| `frontend/tests/unit/production-api.test.ts` | `"sends credentials and the stable idempotency key"` — `expect(request.credentials).toBe("include")` → `"omit"` |

---

## 3. Contract facts the backend is binding to — no change needed

Recorded so the two sides do not drift.

- **`googleReviewUrl` is required and non-nullable.** A stand whose location has
  no validated Google review URL therefore cannot serve the flow, and returns
  the same `404 review_link_inactive` as an unknown token. A business that has
  not yet added its Google link has a dead QR code until it does. If you would
  rather the page render with the Google action disabled, the contract needs to
  make the field nullable first — say so and the backend will follow.
- **`location.name` and `business.logoUrl` will be `null` initially.** The
  schema has the columns; no data populates them until the owner dashboard
  exists. The stand label is deliberately not substituted for a location name.
- **No endpoint returns 202.** Your client rejects it and the backend never
  emits it.
- **Replays return 200, new writes 201.** Google-click returns 204 both times,
  because the contract documents one success status for it.
- **Idempotency keys must be reused across an offline retry.** The current
  sessionStorage persistence in `recovery-storage.ts` does this correctly —
  please keep it. A fresh key on retry would create a duplicate record.

---

## 4. Nothing else

No component, page, layout, style, animation, form, reducer, or copy string
needs to change for the backend to work. The backend has modified none of them.
