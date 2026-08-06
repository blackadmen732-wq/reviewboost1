# Phase 0–1 implementation plan

1. Preserve the clean repository state and keep every new application file in
   `frontend/`.
2. Define the missing public customer API as a frontend-required OpenAPI
   contract, generate its TypeScript types, and keep fixtures development-only.
3. Establish the strict Next.js, token, font, theme, localization, query, form,
   animation, and testing foundations needed by the public route.
4. Build `/q/:token` as one recoverable state machine: rating and optional note,
   identical Google opportunity, optional private Team Praise, then completion.
5. Prove review integrity, accessibility, responsive behavior, offline retry,
   idempotency, translations, dark mode, reduced motion, and visual stability
   before any owner route is started.

