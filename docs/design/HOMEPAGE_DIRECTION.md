# Homepage direction — 13 October 2026

Focused implementation follows the user's request to make the existing product feel more modern and intentional. PR67 remains f351424; the latest Customers/OAuth/Connections work is on a separate branch at 6cf30ec and is not merged by this pass.

Surface: Persuade. A local business owner should understand what ReviewBoost helps them learn, recognize the Tag/customer experience, and choose setup or try the sample. Product truth: a QR/NFC Tag collects a private rating and offers the same Google destination for every score. No claims about completed reviews, guaranteed growth or customer adoption.

## Exact implementation scope, recorded before edits

- `frontend/features/public/public-copy.ts`: shorter owner-benefit headline and explanation; retain actual destinations and offer.
- `frontend/features/public/public-home.tsx`: one primary setup action, a sample jump, tighter copy hierarchy, homepage-specific presentation.
- `frontend/features/public/public-shell.tsx`: opt-in homepage treatment and a native mobile disclosure menu with every existing public destination and sign-in.
- `frontend/features/public/product-demo.tsx`: opt-in hero display and clearer sample star controls; preserve the real shared customer renderer and local-only sample state.
- `frontend/styles/public-product.css`: scoped cream/forest palette, centered editorial display, product composition below the headline and responsive layout. Existing owner/customer tokens and Product-page layout remain authoritative.
- `frontend/lib/fonts/instrument-serif`: original self-hosted regular/italic font files and SIL OFL license. Used only for the homepage heading.

Warm cream #F8F5F0, forest #064E3B / hover #04382C, charcoal #171A18, Geist body/controls and a self-hosted Instrument Serif display. The user supplied Veyra/Midday example images during this pass; their centered serif composition superseded the first split/sans-serif treatment before it was committed. Keep recognizable bright-green brand marks and use the actual Tag and phone as visual proof. No fake dashboards, testimonials, decorative integrations, shader effects or new routes.

## Acceptance

Before/after at 390/768/1280px; extra 320px, both themes, keyboard/mobile navigation and sample interactions, reduced motion, axe and page errors. Check that phone artwork is loaded and the mobile viewport shows useful product proof sooner. Relevant tests, TypeScript, lint, production build and fixture exclusion. One batched inspection plus one confirmation after corrections; the next screen waits for review of this direction.

## Result

[Before-and-after gallery](homepage-direction/review.html) contains ten real browser screenshots. At 390px, the phone ends at approximately y=812px and its rating panel is visible in the initial viewport. Desktop deliberately places product proof beneath the centered headline, following the supplied examples. The first inspection exposed a crowded header at 320px despite a clean axe result; the header action now moves into the mobile menu at that width, and both menu and product fit.

- 28 related tests passed: 24 public/copy checks and 4 customer accessibility checks; final public rerun passed after the copy cleanup.
- TypeScript and zero-warning lint passed.
- Eleven browser axe scans passed: homepage in light/dark at 320/390/768/1280px plus neighboring Product/Pricing/Login; no layout overflow. Homepage captures had no page errors.
- Keyboard sample selection, business-switch reset, disclosure navigation/sign-in, sample jump and setup destination passed. Sample interactions made no API writes.
- Production webpack build and fixture exclusion passed. The production runtime also loaded the artwork, hydrated the sample and navigated through the mobile menu successfully.
- Gallery rendered with all ten images loaded. Root DESIGN remains under 32 KiB.

This is the first visual direction for review. It does not resolve the separate photo-draft/deletion/provider launch gaps, import the newer branch, change the shared rating flow or certify full accessibility. Review the homepage before extending its treatment to the owner app.
