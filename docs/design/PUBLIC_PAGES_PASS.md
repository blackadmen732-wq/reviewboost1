# Public website continuation — 13 October 2026

The user approved continuation after the centered serif homepage direction. Remote check: PR67 at 94aaf52, main at 0155948, newer Customers/OAuth/Connections branch at 6cf30ec, dependency PR78 at 958bdd0; none moved. No other branch is imported by this pass.

## Route and file plan, recorded before implementation

- Shared public navigation: `features/public/public-shell.tsx`, `styles/public-product.css`. Reuse the homepage header/disclosure and cream/forest tokens across public chrome; retain destinations, accessible focus and 320px access. Support/legal copy and reading typography remain intact.
- Public typography: move the existing local font declaration into `lib/fonts/public-editorial.ts` for reuse; remove the homepage-only duplicate declaration. Geist remains body/UI; the customer composition retains its own fonts.
- `/product`: `app/(public)/product/page.tsx`, `features/public/public-article.tsx`. Use an optional marketing presentation with a centered serif heading, existing product demonstration, grouped QR/NFC explanations and findable rotation details. Preserve working links and factual copy.
- `/how-it-works`: `app/(public)/how-it-works/page.tsx`, the same optional article presentation. Make the three-step sequence scan clearly, with setup and sample-entry links. Preserve equal Google opportunity and existing customer flow.
- `/pricing` and homepage pricing: `features/public/pricing-table.tsx`, `app/(public)/pricing/page.tsx`. Remove the forced dark band and ornamental lift/shadows, use refined 16px cards and the shared editorial heading. Keep all catalog values, Starter-only trial restrictions, credit wording and `startForPlan` destinations unchanged. No popularity claim or invented savings.

## Verification contract

Capture before/after at mobile, tablet and desktop. Check 320px, both themes, menu/focus, sample controls and jump links, pricing → sign-in with plan retained, rotation disclosure, reduced motion, console errors and axe. Include representative support/legal pages because their shared header changes. Run relevant public/plan tests, TypeScript, lint, production build and fixture exclusion. One batched browser inspection and one confirmation if corrections are needed. No production writes, SMS, merge, deployment or new PR.

## Implemented and preserved

- One cream/forest public shell and shared locally hosted display font. Active navigation and the native mobile menu now work consistently across public routes.
- Product keeps its original factual explanation, QR/NFC options, rotation instructions and real shared Customer Page sample. Grouped content and setup/pricing actions improve the first read.
- How it works presents the existing three-step flow with clearer hierarchy and a direct link to the interactive sample.
- Pricing removes the forced dark band, lift/glow and oversized prices. Comparable cards align paid allowances; the trial restriction remains explicit. All prices, quotas, trial rules and plan-preserving destinations are unchanged.
- Support/legal policy copy and reading typography, owner routes, backend contracts, billing, SMS consent and the approved customer save → Google flow are preserved. No new pages or integration functionality.

## Verification

- 41 focused public-copy, homepage, Product, pricing-catalog and plan-choice tests passed across six files.
- TypeScript and zero-warning ESLint passed.
- Final browser confirmation: 34 axe scans with zero detected violations, horizontal overflow or page errors. Product/How/Pricing checked at 320, 390, 768 and 1280px in both themes with reduced motion. Shared chrome checked on homepage, support, privacy, terms, integrity, security, account deletion and goodbye; support/privacy also checked in dark mode.
- Keyboard menu, active destination, sample five-star selection/reset without API writes, rotation disclosure and the How → Product sample link passed. Starter/Growth/Pro each retained the selected plan through sign-in.
- Visual inspection caught the longer Starter trial note offsetting paid allowance rows; the final confirmation captures the corrected alignment and mobile content sizing.
- Screenshots show the locally rendered PR67 implementation, with explicit sample data. They do not prove hosted deployment, live Stripe, Google review completion, Twilio, NFC hardware or App Store readiness.

Production build and production fixture-exclusion check passed. Production-preview smoke passed for loaded display fonts/product imagery, sample interaction, active navigation, plan-preserving sign-in and keyboard mobile menu. All 22 gallery images were fetched successfully. Browser checks wait for actual font/image/interactivity state; network-idle alone is not a reliable readiness condition with link prefetch. No merge, deployment, production migration or live messaging.

## Final upstream check

PR67, main and dependency PR78 stayed at their opening hashes. The separate Claude branch advanced to `c60a33c`: manual customers now use PR76's shared customer/source model (`rpc_customer_manual_save/delete`), with source labels and corresponding migration/pgTAP updates. Its service/doc contracts explicitly retain separate consent; removing a manual profile preserves another source, consent history and past texts. This is code inspection, not a new end-to-end verification of that branch. Its 14 changed files do not overlap this public UI pass, and no feature-branch code or migrations were imported.
