# Square: sandbox setup and verification

Status: **adapter built and unit-tested against Square's documented API; not
yet run against a real Square sandbox.** Square is not shown as connectable
anywhere until the settings below are present, and must not be described as
"connected" until the end-to-end check at the bottom has passed against a real
sandbox account.

Code: `frontend/lib/server/integrations/providers/square/` (adapter, config).
Tests: `frontend/tests/unit/square-adapter.test.ts` (recorded Square responses;
no network).

## What was confirmed in Square's documentation (2026-10-13)

| Topic | Confirmed | Source |
|---|---|---|
| API version | `Square-Version: 2026-09-16` (newest listed) | API reference version picker |
| Hosts | Sandbox `https://connect.squareupsandbox.com`; production `https://connect.squareup.com` | OAuth API overview |
| Authorize | `GET /oauth2/authorize?client_id&scope&state&redirect_uri`; `session=false` required in production, not supported in the sandbox. Codes expire after 5 minutes. Denial returns `error`, `error_description`. | Create authorization URLs; Receive and manage tokens |
| Token | `POST /oauth2/token` (`authorization_code` / `refresh_token`); returns `access_token`, `expires_at`, `merchant_id`, `refresh_token`. Scopes are **not** in the response. | ObtainToken reference |
| Granted scopes | `POST /oauth2/token/status` with the bearer token returns `scopes`, `client_id`, `merchant_id`. | RetrieveTokenStatus (SDK model docs) |
| Lifetimes | Access tokens expire after 30 days; refresh every 7 days or less. Code-flow refresh tokens don't expire; PKCE refresh tokens are single-use and expire after 90 days. ReviewBoost uses the code flow (server-side secret). | OAuth overview; Refresh and revoke |
| Revoke | `POST /oauth2/revoke`, header `Authorization: Client <application secret>`, body `client_id` + `access_token`; revokes the whole authorization unless `revoke_only_access_token`. | RevokeToken reference |
| Permissions | `MERCHANT_PROFILE_READ` (ListLocations, RetrieveMerchant); `PAYMENTS_READ` (ListPayments, GetPayment); `CUSTOMERS_READ` (BulkRetrieveCustomers, RetrieveCustomer); `APPOINTMENTS_READ` **and** `APPOINTMENTS_ALL_READ` for seller-level ListBookings / RetrieveBooking. | Permissions reference |
| Payments | `GET /v2/payments`: without `location_id` only the main location is returned, so ReviewBoost reads each chosen place. Max 100 per page. Filters by `created_at` or `updated_at_*`. Status `APPROVED`, `PENDING`, `COMPLETED`, `CANCELED`, `FAILED`. | ListPayments; Payment object |
| Bookings | `GET /v2/bookings`: `start_at_min`/`start_at_max`, at most 31 days. Status `PENDING`, `CANCELLED_BY_CUSTOMER`, `CANCELLED_BY_SELLER`, `DECLINED`, `ACCEPTED`, `NO_SHOW`. **There is no "completed" status.** | ListBookings; BookingStatus |
| Customers | `POST /v2/customers/bulk-retrieve`, 1–100 ids. A customer has `given_name`, `family_name`, `nickname`, `company_name`, `phone_number`, `version`. **No texting permission field**: `preferences` holds only `email_unsubscribed`. | BulkRetrieveCustomers; Customer object |
| Webhooks | Body: `merchant_id`, `type`, `event_id`, `created_at`, `data{type,id,object}`. Header `x-square-hmacsha256-signature` = base64 HMAC-SHA256 with the subscription's signature key over notification URL + raw body; compare in constant time. Answer 2xx; deduplicate by `event_id`; repeated failures disable the subscription. `oauth.authorization.revoked` when a seller removes access. | Validate notifications; Manage webhooks; event reference |

Still unconfirmed and to observe in the sandbox run: the exact retry window
and response deadline for webhooks, rate-limit headers on `429`, and whether a
sandbox seller needs Square Appointments turned on before bookings appear.

## What ReviewBoost does with it

- **A visit** is a `COMPLETED` payment, or an `ACCEPTED` booking whose end
  (start + segment durations) has passed, shown as "appointment time passed".
  Cancelled, declined and no-show bookings are kept with that status and never
  count as visits. A payment with no customer attached is a visit nobody can
  be texted about.
- **A customer** is matched to ReviewBoost's one customer model by phone
  number. Square's name is kept as Square's; an owner's own name for the same
  number is kept separately.
- **No consent is read or created.** Square has none to give. A Square customer
  appears in Customers with "No agreement recorded" until the owner records
  real, evidenced agreement in Text Requests.
- **Nothing is sent.** Syncing never schedules, queues or sends a message;
  every Text Request is still a deliberate one-at-a-time action by the owner,
  through the existing Twilio engine and its eligibility checks.

## Setup you need to do

1. **Square Developer account and app.** At developer.squareup.com, create an
   application. Switch the console to **Sandbox**.
2. **OAuth page (Sandbox):** copy the *Sandbox Application ID*
   (`sandbox-sq0idb-…`) and *Sandbox Application secret*. Set the Redirect URL
   to exactly `{PUBLIC_FRONTEND_URL}/settings/connections/square/callback`
   (Square allows `http://localhost` in the sandbox).
3. **Webhooks (Sandbox):** add a subscription with notification URL
   `{PUBLIC_FRONTEND_URL}/api/v1/webhooks/integrations/square`, API version
   `2026-09-16`, events `payment.created`, `payment.updated`,
   `booking.created`, `booking.updated`, `customer.created`,
   `customer.updated`, `customer.deleted`, `oauth.authorization.revoked`. Copy
   its *signature key*. The URL must be reachable from the internet (a Vercel
   preview, or a tunnel to local), and must match byte for byte.
4. **Environment** (preview or local, never production):

   ```sh
   SQUARE_ENVIRONMENT=sandbox
   SQUARE_APPLICATION_ID=sandbox-sq0idb-…
   SQUARE_APPLICATION_SECRET=…
   SQUARE_WEBHOOK_SIGNATURE_KEY=…
   INTEGRATION_CREDENTIAL_KEY=$(openssl rand -base64 32)
   ```

   Plus the database migrations on this branch applied to that (non-production)
   Supabase project.
5. **Test data.** In the console, open the sandbox *Default Test Account* in
   the Square Dashboard. Create a customer with a fictional number
   (e.g. `+1 202-555-0123`) and take a payment against that customer (API
   Explorer, `CreatePayment` with source `cnon:card-nonce-ok` and the
   `customer_id`). Optionally turn on Appointments and book that customer.
6. **Network.** The cloud environment this branch was built in blocks
   `connect.squareupsandbox.com` and `developer.squareup.com`; add them to the
   environment's allowed domains if the check below is run from it.

## End-to-end check (what "connected" will mean)

With the sandbox dashboard open in the same browser (Square's sandbox has no
sign-in page of its own):

1. Settings → Connections → Square → Connect → allow → back on ReviewBoost.
   Expect the account name and its locations.
2. Choose a place, run the test. Expect the sample payment counted as a visit
   with a reachable customer.
3. Turn it on and run the worker once
   (`POST /api/v1/internal/integrations/process` with the worker secret).
   Expect the customer in Text Requests → Customers, "From Square", "No
   agreement recorded", with the visit date, and **no Text Request created**.
4. Take another sandbox payment; expect the webhook to be accepted (200) and
   the visit to appear after the worker runs.
5. Disconnect; expect the token revoked at Square and the connection ended.
   Square's customers and visits stay for the 30-day grace period, then are
   purged; consent records, opt-outs and past Text Requests are never purged.

Only after all five pass may Square be called connected, and only in the
sandbox. Production needs its own application credentials, Square's app review
where it applies, and separate approval.
