# PR #67 visual-system audit and next-pass proposal

Update, 13 October: the focused homepage direction is now implemented for review following the user's request to improve the visual result. See [direction and validation](HOMEPAGE_DIRECTION.md). The original audit below records the decisions before that pass; wider owner/native rollout remains unimplemented.

12 October 2026. This audits the existing branch plus the already-authorized repair pass. **The new Pinterest palette/typography direction is proposed, not applied.** The user's latest instruction asks to see exact files and changes before visual editing and to review the first header/hero pass before a wider rollout.

## Audience and visual purpose

The buyer is a local business operator, not a designer looking for a dashboard. The public site needs to answer: what goes on my counter, what does my customer see, what do I learn, and what does it cost? The owner app needs quick recovery and clear next actions between visits. The customer page needs one confident star tap. These three contexts should share the brand without sharing every layout or type treatment.

This is inferred from repository product requirements and working flows, not from new customer interviews. Existing Insights already has rating trend/distribution charts. Creating additional charts or invented performance numbers would not make the offer more credible.

## What the references contribute

| Reference | Useful quality | ReviewBoost application |
|---|---|---|
| Supplied Midday screenshot | Generous breathing room, restrained navigation, a clear headline and real product proof | Reduce competing hero signals; keep the actual Tag/customer example. Do not copy its 14-day trial or business-stack claims. |
| Supplied Veyra screenshot | Warm neutrals, measured spacing, strong headline contrast | Try a warmer canvas and quieter supporting text. Its serif/italic display treatment is inspiration, not a requirement to replace app fonts. |
| Phone hardware and Mario comparison | Convincing device proportions; photo and lower panel alignment | Reuse PR75's existing hardware and shared renderer; compare editor/live composition. Do not bake screenshot text into the customer UI. |
| New visual-system PDF | Consistent screen hierarchy, restrained cards and practical page skeletons | Apply its discipline to existing routes. It recommends fonts that differ from the accompanying user text, so a font migration is not implicit. |
| New pasted editor brief | Photo ownership, white empty state, draft/publish distinction and recovery | Functional gaps are documented in the launch report before another editor change. |
| Stripe template / shadcn source | Hierarchy, semantic variants, composable accessible primitives | Keep existing CVA/Radix primitives; avoid wholesale replacement or Stripe branding. |

Attached documents are reference material. They do not authorize older page structures, Connections/retention platforms, production actions, or changes to the approved rating flow.

## Current exact files and findings

| File | Already good | Finding / next action |
|---|---|---|
| `frontend/styles/globals.css` | Semantic light/dark colors, readable action green, spacing/radius/motion tokens, focus/reduced-motion support | Current canvas `#F6F7F5`, action `#007A4D`, identity `#00A86B`. These are not yet the proposed cream/forest palette. Do not globally change them in the first hero pass. |
| `frontend/app/layout.tsx` | Bundled Geist and existing customer font variables | Retain while the conflicting font proposals are resolved. No remote-font dependency needed. |
| `frontend/features/public/public-shell.tsx` | Existing routes, desktop navigation and mobile links, working sign-in/start actions | Refine header spacing, link hierarchy and focus presentation after approval. Preserve every destination. |
| `frontend/features/public/public-home.tsx` | Explains Tag → private rating → equal Google opportunity; actual pricing and FAQ | Hero still has several similar entry actions and dense explanatory copy. Improve hierarchy and line breaks without inventing outcome claims. |
| `frontend/styles/public-product.css` | Scoped responsive Tag/phone composition and public bands | Use it for a homepage-only palette/spacing trial; keep responsive product visibility. Avoid a full-site token change before review. |
| `frontend/features/public/product-demo.tsx` | Actual shared Customer Page, clearly labeled business examples, local-only star sample | Retain. Clarify which part is interactive instead of adding more decorative controls. |
| `frontend/components/ui/button.tsx` | Reused CVA variants and target sizing | Reuse existing variants; no new button framework. Scope the first marketing color treatment to its parent. |
| `frontend/features/dashboard/owner-shell.tsx` | Four daily tabs and now a reachable mobile Settings entry | Preserve structure. A later token pass must verify selected/focus states and sticky/fixed positioning. |
| `frontend/features/customer-page/customer-visit-view.tsx` | One live/editor renderer, white no-photo hero, gray bolt, fixed approved text and stars | Preserve flow and composition. The lower panel is currently `#F9F9F9`; latest pasted brief requests pure white. Resolve this explicitly in the editor pass, not through a dashboard token change. |
| `frontend/styles/customer-page.css` | Responsive customer composition and reduced-motion support | Existing star easing is the sole Impeccable advisory. Keep the approved effect for this repair; do not restyle it merely to clear a heuristic. |
| `frontend/features/customer-page/phone-frame.tsx` | Reuses PR75's transparent hardware image | Retain. Full-page screenshots show fixed owner controls across scroll content; inspect viewport screenshots/scroll reachability as well. |
| `apps/mobile/theme.ts`, `apps/mobile/app.json` | Separate native primitives and launch background `#F6F7F5` | No native palette rewrite in a web hero pass. Native device validation is separate. |

## Recommended design decision

Use warm cream `#F8F5F0`, white surfaces, forest actions `#064E3B`, hover `#04382C`, charcoal `#171A18`, secondary `#52625A`, soft borders `#D8DED9`, and the existing bright green `#00A86B` only for identity accents. Retain Geist for public/owner UI in the first pass and retain Inter Tight/DM Sans in the customer composition. This gives the brand warmth without adding a third unrelated font system.

Keep the 4px grid, preferred 8/12/16/24/32/48 spacing, 12px buttons, 16px cards and 20px dialogs where dialogs exist. The proposal's 10px input radius differs from current 12px controls; defer that decision to the forms family rather than quietly changing every input. Motion stays subtle, 150–250ms, and optional under reduced motion.

## Exact first visual pass — proposed, not started

1. `public-shell.tsx`: tune header padding and navigation spacing; preserve destinations and mobile access. No replacement navigation model.
2. `public-home.tsx`: tighten the existing hero into a clear promise, one main setup action, and an accessible “try the example” link; keep sign-in in the header. Preserve truthful business/customer language and actual offer.
3. `public-product.css`: apply the proposed light palette **only to the homepage header/hero**, tune headline measure and product/copy balance at 390/768/1280px, and preserve a readable dark-mode equivalent. No global owner/customer recolor.
4. `DESIGN.md`: record the accepted first-pass values after review. Global `globals.css` adoption would be a later component-family pass, after the hero direction is accepted.

Acceptance: before/after screenshots in both themes and three widths; 320px reflow; keyboard/focus; sample stars and business selection; sign-in/start/plan links; reduced motion; axe; relevant TypeScript/lint/unit/build checks. No fake metrics or extra pages. Review this result before applying it to remaining public pages, then owner primitives, then individual owner screens.

## Reliability must precede further rollout

See [launch gaps](PR67_LAUNCH_GAPS.md): uploaded drafts can be lost on refresh, explicit removal is missing, and some native/auth/deletion failures need reconciliation. A more polished appearance must not imply those are solved.

The existing repair's [before/after gallery](frontend-repair/current-gallery.html) is real browser evidence. It is not a preview of the proposed new color system. Current competitor/Apple policy pages could not be fetched through the environment proxy; no current competitive superiority or App Store approval is claimed. Git source references were available and inspected.
