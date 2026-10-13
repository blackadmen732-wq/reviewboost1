# ReviewBoost design system

An after-visit tool for local businesses: clear enough to use between customers, dependable enough to keep using. Refine the existing system. Public pages explain the physical Tag and show the actual customer experience; owner pages make the next useful action easy to find.

## Authority and references

Implementation authority: `frontend/styles/globals.css`, `customer-page.css`, `public-product.css`, `components/ui`, the shared `CustomerVisitView`, and `apps/mobile/theme.ts`. Explicit user requirements override older design notes. This document captures the existing system, informed by the user-selected Stripe template's disciplined hierarchy, legible monetary values and semantic tokens. It does **not** adopt Stripe's indigo, gradients, proprietary fonts or unrelated dashboard conventions.

shadcn's inspected Button, CSS-variable mapping and theme registry validate patterns already present: CVA variants, semantic foreground/background pairs, accessible focus and composable primitives. Keep ReviewBoost's larger touch targets and established components. Do not install shadcn's entire runtime or replace controls merely to match a template. Pinned references: `docs/design/reference-lock.json`.

## Color

| Role / token | Light | Dark |
|---|---|---|
| Canvas `--rb-canvas` | `#F6F7F5` | `#0C100E` |
| Surface `--rb-surface` | `#FFFFFF` | `#131816` |
| Quiet `--rb-quiet` | `#F0F2F0` | `#19201C` |
| Primary text `--rb-ink` | `#171A18` | `#F7F9F7` |
| Secondary text `--rb-muted` | `#66706A` | `#ABB5AF` |
| Border `--rb-border` | `#DCE2DE` | `#303A34` |
| Identity `--rb-brand` | `#00A86B` | `#00A86B` |
| Text/link green `--rb-brand-text` | `#007A4D` | `#45CF99` |
| Action `--rb-action` | `#007A4D` | `#32CF94` |
| On action `--rb-on-action` | `#FFFFFF` | `#071B13` |
| Selected stars `--rb-star` | `#B97D0C` | `#F2B94B` |
| Danger `--rb-danger` | `#B33A3A` | `#FF8F8F` |
| Focus `--rb-focus` | `#005FCC` | `#7AB8FF` |

Existing public pricing uses a dark green field. Deep forest `#064E3B` now appears in the scoped homepage direction; it is not the global or native action token. Brand green is an identity accent, not the background for small white labels. Use `action` for owner primary buttons and `brand-text` for small green text. Status includes words/icons, never color alone. Keep actual token definitions in CSS/native theme; do not create a competing token layer in a component.

## Typography and spacing

- App/public body: bundled Geist Sans. Homepage display: self-hosted Instrument Serif, regular/italic, selected from the user's Veyra/Midday references. Customer heading/footer: bundled Inter Tight; tracked instruction/promise: DM Sans. Font licenses stay with their files. Use tabular numerals for counts, prices and time comparisons.
- Base body 16px; secondary 14px; captions 12px; page title 24px; compact display 28px. Default public display scales 36–52px; the scoped homepage display uses 52–96px. Keep body readable rather than shrinking text to fit a fixed card.
- Existing spacing scale: 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96, 120, 144px. Group labels/fields tightly; separate tasks with space. Public bands use 48px mobile and 72px desktop vertical padding.
- Controls: 12px radius; ordinary cards: 16px; 56px standard input/button height, minimum 44px interactive target. Customer stars keep their existing responsive sizing and 48px minimum on the live canvas.
- Owner content is constrained around 800px; public content around 1080px. The desktop editor places controls beside the phone; mobile places Publish above the persistent tabs. A single column must remain usable at 320px.
- Hairline borders and restrained depth; no ornamental card nesting, floating gradient blobs, generic icon-card grids or decorative chart widgets.

## Components and behavior

Use existing `Button`, `InlineNotice`, `EmptyState`, dialog/sheet, PageHeader and shell patterns. Buttons perform actions; links navigate. Primary, secondary, ghost and destructive variants have distinct purposes. Destructive actions retain explicit confirmation. A disabled control explains the prerequisite nearby.

Forms retain input across errors. Loading prevents duplicate actions; failed saves do not announce success. Errors identify the failed action and offer recovery. A saved draft and published state are distinct. Avoid popup creation after an awaited request: prepare a native preview link first.

Lists carry meaningful labels and status, with dividers instead of nested cards. Recent SMS states distinguish queued, sending, sent, delivered, delivery unknown, failed and suppressed. Credit usage comes from the exact server-rendered message, not a character estimate in the client. Consent requires a separate, explicit evidence-backed action.

Feedback Insights already contains a real rating trend and distribution. Preserve fixed rating scale, missing-data gaps, sample-size guards, accessible values and filters. Never label a handoff as a completed Google review. Home is a brief with a next action, not another analytics wall.

## Customer Page: locked shared composition

- Optional business photo above the rounded lower rating panel. Without a photo, **the top is completely white in every theme**. No stock replacement, gradients, business initials or dark placeholder.
- Preserve “How was your visit?”, the approved instruction, five stars, and “REAL BUSINESSES. REAL FEEDBACK. A BRIGHTER TOMORROW.” from the existing localized copy source.
- Footer: small gray lightning bolt, gray “Powered by”, dark bold ReviewBoost. This is the explicit customer-page exception to the green owner/public logotype.
- The fixed lower sheet keeps its proportions; extra phone height belongs to the photo area. No theme builder, movable panel, extra Continue, public notes or Team Praise.
- Rating selection persists, then immediately hands off to the same Google destination for 1–5 stars. Failed persistence is recoverable; destination telemetry cannot block the handoff. Returning from Google must not loop.
- Owner preview and live page use **one component tree**. `PhoneFrame` draws a decorative device around the preview only. Verify photo/no-photo, loaded/error and small/tall screen states.
- Public sample is explicitly an example. Its sample rating changes only local visual state; it never writes a response or contacts Google.

## Navigation and motion

Home / Feedback / Texts / Tags are the four mobile tabs. Settings stays secondary; Insights stays under Feedback. Connections and retention are outside this frontend delivery. Legacy Reviews/Customers/Praise URLs redirect to maintained surfaces.

Retain 150ms control and 180ms page tokens, subtle row/status transitions, and visible focus. Prefer a specific transitioned property list. Respect `prefers-reduced-motion`; no delayed splash, mandatory animation, scroll-jacking or motion needed to understand state. Animation fill must not leave a transformed ancestor that breaks fixed mobile controls.

## Do / don't

| Do | Don't |
|---|---|
| Show the actual Tag, sample customer page and clear setup path | Invent testimonials, adoption counts or polished fake dashboards |
| Use real API, ledger and Stripe state | Infer a subscription from a success URL |
| Keep the approved forest-green identity and existing components | Rebuild every page or add a dependency for novelty |
| State exactly what each button will do | Show nonfunctional Connect, trial or checkout controls |
| Preserve tenant/role checks and equal review opportunity | Let design simplification bypass consent/security |
| Inspect loaded pages with mouse, keyboard and touch layouts | Treat HTTP 200, a screenshot of a loader or clean lint as UX proof |

## Verification and evidence

For affected routes: mobile 390px, tablet 768px, desktop 1280px, plus 320px reflow where controls are dense. Check light/dark, reduced motion, focus, error/retry, pending/success, empty/populated and photo/no-photo. Save browser evidence with route, viewport and state; label local fixture data. Run relevant tests and production build. Real Stripe/Twilio, physical NFC and App Store evidence remain separate from local browser checks.

## Homepage direction — implemented for review, 13 October 2026

The homepage header/hero now uses scoped warm cream `#F8F5F0`, white product surfaces, forest actions `#064E3B` / hover `#04382C`, charcoal `#171A18`, secondary `#52625A`, border `#D8DED9`, and the recognizable bright-green mark. The latest user-provided Veyra/Midday examples resolved the display direction: centered Instrument Serif, with an italic second line and real product proof below. Geist remains for body/controls; Customer Page typography and flow remain isolated. Dark homepage treatment uses `#0E1712` canvas and `#9ED5B9` actions with dark foreground, preserving contrast.

This first direction is limited to the header/hero and its existing sample component. It leads with the owner benefit, keeps setup as the primary action, and brings the full Tag/phone proof into the first mobile viewport. Native disclosure navigation retains every mobile destination. The opt-in `hero` presentation leaves the Product route's default sample appearance intact. Global tokens and owner surfaces have not migrated. See `docs/design/HOMEPAGE_DIRECTION.md` for scope and validation. Review this screen before wider rollout; the remaining recovery work in `docs/design/PR67_LAUNCH_GAPS.md` remains a separate task.
