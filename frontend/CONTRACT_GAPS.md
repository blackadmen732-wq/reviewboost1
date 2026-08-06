# Phase 1 backend and design gaps

Status recorded on 2026-08-06. This document describes required contracts; it
does not modify or adapt the legacy backend.

## Missing API source

The repository has no OpenAPI document or generated client. All five customer
endpoints required by the V1 specification are absent:

- `GET /api/v1/public/q/{token}`
- `POST /api/v1/public/q/{token}/sessions`
- `POST /api/v1/public/q/{token}/responses`
- `POST /api/v1/public/q/{token}/google-click`
- `POST /api/v1/public/q/{token}/team-praise`

The required frontend contract is recorded in
`contracts/customer-flow.openapi.yaml`. The backend must review and own that
contract before production integration. In particular, it must:

- return the same indistinguishable not-found response for unknown and inactive
  tokens;
- never return an account/organization id, rating threshold, or rating-based
  action;
- accept an optional private note for every rating;
- guarantee that `googleReviewUrl` is a validated Google review URL;
- persist each mutation idempotently using `Idempotency-Key` and allow that
  header through CORS;
- define polling/status semantics before returning `202` because the frontend
  will not treat `202` as completion;
- expose no phone, email, marketing-consent, bonus, payroll, or rating data in
  Team Praise.

The existing `/q/{publicId}` and `/q/{publicId}/rating` routes are intentionally
not used. They implement prohibited rating-threshold gating, accept contact
fields, and cannot satisfy the uniform Google-opportunity contract.

Existing printed stand URLs currently resolve to the backend-hosted `/q/*`
route. Production therefore also needs either an ingress rule that sends `/q/*`
to this frontend or newly issued stand URLs based on the public frontend origin.
That deployment/backend decision is intentionally not implemented here.

Development fixtures are available only when `NODE_ENV !== "production"` and
`NEXT_PUBLIC_USE_CUSTOMER_FIXTURES=true`. There is no automatic fallback from a
failed production API to fixtures.

## Missing visual sources

No `FRONTEND_VISION.md`, official ReviewBoost logo, warm customer-rating mockup,
or other image/design asset exists in the working tree, Git history, alternate
refs, reflogs, or the supplied attachment. The implementation therefore follows
the locked written tokens and interaction specification, uses plain text for the
required ReviewBoost attribution, and does not invent a replacement logo.
Pixel-level comparison to the absent selected mockup remains blocked until that
source is supplied; repository-owned visual baselines cover regression in the
meantime.
