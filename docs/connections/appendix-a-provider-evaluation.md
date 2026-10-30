# Appendix A. Provider evaluation and the first-provider choice

**Status: PROPOSED.** Research done on 2026-10-12 from provider documentation
and, where marked, secondary sources. Anything marked *verify in sandbox* must
be confirmed against the provider's sandbox before Phase 2 code depends on it.
Nothing here claims a provider is supported; none is.

## A.1 What ReviewBoost actually needs from a provider

Only three things, for one workflow (a one-to-one review request after a
visit):

1. A **customer** with a stable id, a name if given, and a phone number if
   given.
2. A **visit signal**: something that happened at a known location and time
   (a completed payment, a kept appointment).
3. **Location** identity, so the visit maps to one ReviewBoost location and its
   timezone.

ReviewBoost does not need menus, inventory, staff, payment amounts, card data,
order line items, or notes. Requesting them would violate least privilege.

No provider evaluated supplies **SMS consent**. That is the most important
finding in this appendix.

## A.2 Square (POS and Square Appointments) — recommended first

| Aspect | Finding | Source |
|---|---|---|
| Fit | Restaurants, cafés and quick service (Square POS); salons, barbers, spas (Square Appointments). Both target segments in one provider and one OAuth app | Product fit; `SYSTEM_CONTEXT.md` §8 already proposes "Square first" |
| Access | Self-serve developer account and OAuth application; sandbox provided. App Marketplace listing is optional for OAuth | Square OAuth docs |
| Auth | OAuth 2.0 authorization code flow. Code flow for confidential server apps; PKCE flow also supported | developer.squareup.com/docs/oauth-api/overview |
| Token lifetime | Access token expires in **30 days**; Square recommends refreshing every **7 days or less**. Code-flow refresh tokens are multi-use and do not expire. PKCE refresh tokens are **single-use** and expire in 90 days | Square OAuth docs, "OAuth best practices" |
| Revocation | `RevokeToken` revokes one token or all of a seller's tokens. A seller can also revoke from the Square Dashboard; recovery requires a full re-authorization | Square OAuth docs |
| Validity check | Square suggests calling `ListLocations` to confirm a token still works | Square OAuth docs |
| Permissions (least privilege) | `MERCHANT_PROFILE_READ` (locations, merchant id); `CUSTOMERS_READ`; `PAYMENTS_READ` (restaurant workflow); `APPOINTMENTS_READ` **and** `APPOINTMENTS_ALL_READ` (seller-level booking events, salon workflow) | Square permissions reference; `booking.*` webhook reference |
| Webhooks | One app-level subscription; each event carries `merchant_id`, `type`, `event_id`, `created_at`, `data`. Signed with `x-square-hmacsha256-signature`: HMAC-SHA-256 over the **exact notification URL** and the **raw body**, keyed by the subscription's signature key. Use Square's `WebhooksHelper` rather than hand-rolling the concatenation | developer.squareup.com/docs/webhooks/step3validate |
| Delivery | 2xx expected within **10 seconds**. Retries with exponential backoff for up to 24 hours (an older page says 72; *verify*). Retries carry `square-retry-number` and `square-retry-reason`. **No ordering guarantee.** Duplicates must be assumed. The Events API can recover missed events | Square webhooks overview |
| Useful events | `customer.created`, `customer.updated` (needs `CUSTOMERS_READ`); `payment.created`, `payment.updated` (needs `PAYMENTS_READ`); `booking.created`, `booking.updated` (seller level needs `APPOINTMENTS_READ` + `APPOINTMENTS_ALL_READ`) | Square webhook reference |
| Customer object | `id`, `version` (increments on change), `created_at`, `updated_at`, `given_name`, `family_name`, `phone_number`, `creation_source`, `preferences`. `preferences` contains only `email_unsubscribed`. **No SMS consent field** | Square `Customer`, `CustomerPreferences` reference |
| Payment object | Has `customer_id` (optional), `location_id`, `order_id`, `status` in `APPROVED`, `PENDING`, `COMPLETED`, `CANCELED`, `FAILED` | Square `Payment` reference |
| Booking object | `id`, `version`, `status`, `start_at`, `location_id`, `customer_id`, `appointment_segments`, `created_at`, `updated_at`. Statuses: `PENDING`, `ACCEPTED`, `DECLINED`, `CANCELLED_BY_CUSTOMER`, `CANCELLED_BY_SELLER`, `NO_SHOW`. **There is no `COMPLETED` status** | Square `Booking`, `BookingStatus` reference |
| Plan requirements | Seller-level booking *writes* need Appointments Plus or Premium. Whether seller-level *reads* and booking webhooks also need a paid plan is *verify in sandbox* (`RetrieveBusinessBookingProfile` reports support) | Square Bookings API docs |
| Versioning | Date-pinned `Square-Version` header | Square API docs |
| Rate limits | Returns HTTP 429 `RATE_LIMITED`; Square does not publish fixed numbers. Adapter backs off with jitter | Square API docs (*verify behaviour in sandbox*) |
| Regions | Bookings API available in the US, UK, Canada, Australia, Spain, Japan (2022 GA announcement) | Square developer blog |

**What "a completed visit" means on Square.** Square has no single "visit
completed" event, so ReviewBoost defines it per workflow and says so in the UI:

- *Restaurant / counter service:* a `payment.updated` reaching `COMPLETED`
  **with a `customer_id`**. Many counter payments have no customer attached;
  those produce no visit, and the sync summary reports how many payments were
  skipped for that reason. Coverage is unknown until a pilot measures it.
- *Appointments:* a booking in `ACCEPTED` whose `start_at` plus total segment
  duration is in the past, re-checked for `NO_SHOW` and cancellations before it
  is treated as completed. A later `NO_SHOW` update retracts the visit. This
  inference is labelled "appointment time passed" to the owner, not
  "completed".

**Maintenance cost.** Low to moderate. One OAuth app, one webhook subscription,
one signature key, a pinned API version to bump roughly yearly, a 7-day refresh
job, and a sandbox. Estimated ongoing load: about 1–2 engineer-days per quarter
for version bumps and incident handling once stable, plus the initial build.

**Why first.** Self-serve access with no partner approval gate, a real sandbox,
documented signatures, both target verticals in one integration, and it is
already the product's stated first choice. The cost of being wrong is small:
the adapter contract is provider-neutral.

## A.3 Other providers considered

| Provider | Vertical | Access model | Auth | Webhooks | Consent field | Maintenance / gate | Verdict |
|---|---|---|---|---|---|---|---|
| **Toast** | Restaurants | Partner Integrations program: written application, review and certification; Toast's team issues credentials. Standard API access is limited to a restaurant's own employees on RMS Essentials or higher | Partner client credentials issued by Toast | Exist for partners (*details not verified*) | Not found | High: approval gate, contractual terms, per-restaurant enablement | **Planned, not started.** Apply to the partner program in parallel only if pilot demand appears |
| **Clover** | Restaurants, retail | App must be approved and published on the Clover App Market for production merchants. Permission changes require merchants to reinstall | OAuth 2.0 (auth code; PKCE variant documented) | App-level webhooks authenticated with a static `X-Clover-Auth` code shown after URL verification, not an HMAC signature | Not found | Moderate to high: app review, regional base URLs, weaker webhook auth | **Planned, not started** |
| **Vagaro** | Salons, spas | Business enables "APIs & Webhooks" in settings; request form and approval (~5–7 business days). Reported to require a paid plan with Vagaro processing | OAuth 2.0 client id and secret | Yes; reported paid add-on (*third-party figure, verify*) | Not found | Moderate; access depends on the merchant's own plan | **Candidate second provider** for salons once verified directly with Vagaro |
| **Mindbody** | Fitness, wellness | Self-serve developer key; production needs a per-site activation by the business owner; per-call pricing above a free tier (figures conflict between sources) | API key + site activation + staff token | Webhooks API exists (*verify*) | Not found | Moderate; metered cost per call | Not a target vertical for V1 |
| **Boulevard** | Premium salons | Credentials via Boulevard support; access reported limited to upper tiers | API keys | *Not verified* | Not found | High: tier-gated | Not now |
| **Jobber** | Home services | Self-serve developer center; draft apps blocked beyond 5 paying accounts until Jobber reviews the app | OAuth 2.0, GraphQL | Yes (*details not verified*) | Not found | Moderate; review gate | Out of scope (service-at-home, not walk-in) |
| **Housecall Pro** | Home services | API key generated by an admin; full API and webhooks reported limited to the top (MAX) plan | API key (not OAuth) | Signed webhooks on MAX plan (third-party) | Not found | Moderate; key-based auth is a higher-risk credential (no scopes, owner pastes a secret) | Out of scope |
| **CSV upload** | Any | Built into ReviewBoost | None | None | Only what the owner attests | Low | Already proposed in #74. Not a "connection" in the directory; lives in the customer import flow |

Secondary sources (Supergood, Rollout, Ampersand, apis.io, AgentZap) were used
only where marked; their figures must be confirmed with the provider before a
provider moves from *planned* to *in setup*.

## A.4 Recommendation

Build **Square** as the only connectable provider in V1, with two workflows
the owner chooses between during setup:

1. **Payments → visits** (restaurants): `MERCHANT_PROFILE_READ`,
   `CUSTOMERS_READ`, `PAYMENTS_READ`.
2. **Appointments → visits** (salons): `MERCHANT_PROFILE_READ`,
   `CUSTOMERS_READ`, `APPOINTMENTS_READ`, `APPOINTMENTS_ALL_READ`.

Request only the scopes for the chosen workflow. Adding the other workflow
later is a re-authorization with the wider scope set, shown to the owner.

List Toast, Clover and Vagaro in the directory only as **Planned**, with no
Connect button, and only if the owner wants planned entries shown at all.
