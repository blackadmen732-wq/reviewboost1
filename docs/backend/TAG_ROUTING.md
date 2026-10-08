# Tag routing: the Tag is dumb, ReviewBoost is the routing layer

A physical Tag (a printed QR code or a programmed NFC chip) carries one thing:

```
{PUBLIC_FRONTEND_URL}/q/{public token}
```

Everything behind that URL is resolved by the server when a customer opens it:

```
physical Tag / QR
  → /q/{public token}
  → keyed digest of the token → review_stands row          (the routing record)
  → organization, location                                 (joined at request time)
  → published Customer Page + current destination          (joined at request time)
  → the same configured destination opens, on the tap itself
  → the rating (1–5, same flow for every rating) is recorded alongside, in one
    request (POST /ratings) that outlives the page
```

So an owner can change the Google link, publish a new Customer Page, move a Tag
to another location, rename, pause or resume it, and every Tag already in the
field follows on the next scan. Nothing is reprinted or reprogrammed.

## Invariants and where they are enforced

| # | Invariant | Enforced by | Proven by |
|---|---|---|---|
| 1 | QR, NFC and Text Request links use only the canonical Tag URL | `canonicalTagUrl` (`frontend/lib/server/tag-url.ts`), the only builder production code uses; it checks its own output | `tests/unit/tag-routing.test.ts` (the real QR route's SVG/PNG/JSON compared byte for byte with the canonical URL's QR) |
| 2 | No Google or other third-party URL is encoded onto a Tag | `isReviewBoostTagUrl` (`frontend/lib/security/tag-url.ts`, mirrored in `apps/mobile/lib/tag-url.ts`); both NFC writers refuse any other payload before writing | `tag-routing.test.ts`, `program-tag-sheet.test.tsx` ("never programs a chip with anything but a ReviewBoost /q/ link") |
| 3 | The destination is looked up server-side when `/q/{token}` resolves | `app.resolve_public_stand` joins `locations.destination_*`; `review_stands` has no destination column | `tag_routing_invariants_test.sql` §1 |
| 4–6 | Destination, Customer Page, location, label and status changes never alter the Tag, and the same Tag keeps working | Trigger `review_stands_guard_identity` refuses any change to the token digest, prefix or reprint ciphertext unless it is the explicit rotation or a key-version upgrade of the same token | `tag_routing_invariants_test.sql` §1–§4 |
| 7 | The public token is an opaque, high-entropy public identifier (256-bit, base64url), not a credential | It only selects which Tag is opened. Stored as a keyed digest (lookup) and AES-GCM ciphertext (reprint) as defence in depth | — |
| 8 | Changing what a Tag resolves to needs owner/admin authorization; opening one needs none | `rpc_update_location_destination`, `rpc_customer_page_*`, `rpc_rotate_stand_token` check membership and role; no direct `UPDATE` grant on `review_stands` | `tag_routing_invariants_test.sql` §5 |
| 9 | Rate limits and abuse protection stay behind the resolver | `rpc_public_resolve_stand` is `service_role` only; the public API applies `guardRead` / session and response limits before resolving | `tag_routing_invariants_test.sql` §5 (anon has no execute) |
| 10 | The Tag's URL is not rotated because something internal changed | Digest-key rotation re-hashes lazily on scan with the same token (`upgrade_stand_token_digest`). The only thing that changes the URL is the owner/admin action "Make a new code", which exists to revoke a leaked or copied Tag | `token_rotation_test.sql`, `tag_routing_invariants_test.sql` §4 |

## Why no new "public id → routing record" table

The audit found no coupling between internal credentials and the printed URL:
`review_stands` already *is* the routing record keyed by the public token, and
every mutable thing a Tag leads to (destination, page, location) is joined in
at resolution time. The key rotation that the architecture needs, the token
digest key, already runs without reprints. A separate table would add a join
and a second place for state to drift, and no behaviour. What was missing was
enforcement, which the identity trigger now provides.

## Destinations

A destination that is **set or changed** must open Google's review-writing box
for one place:

- `https://search.google.com/local/writereview?placeid=<place id>`
- `https://g.page/r/<profile id>/review`

The database (`public._is_google_review_writing_url`, trigger
`locations_writereview_destination`), the server (`isWritableDestinationUrl`)
and the owner's forms (`isGoogleReviewWritingUrl`) apply the same rule.

Maps listings and opaque short links (`maps.app.goo.gl`, `g.page/<name>`) are
refused for new writes. A destination saved before this rule **still
resolves**, so no Tag in the field goes dark. It stays until the owner next
edits it, and then it has to be a review link. Unknown providers and hosts
outside the allowlist fail closed: the Tag shows the same neutral inactive page
as an unknown token and never redirects.

The destination is server state. It reaches the customer's browser only in the
`/q/{token}` context response. The destination is loaded before the rating, so
it is provably the same for every rating from 1 to 5, and the handoff after a
tap is instant.
