# ReviewBoost frontend and product-design audit

Audited 2026-09-26. Nothing has been changed yet: this report is for your approval.

**What I looked at**
- **PR #67** (`cursor/sprint-forge-owner-systems-v15-7042`, head `6e55810`). This is the product and logic branch.
- **`v0/customer-page-editor-layout`**. This is the source for the public website design. It is 20 commits ahead of #67 and 53 behind.
- **The v0 homepage, rendered.** I ran the v0 branch locally and screenshotted it at 1440, 390 and 320 wide. None of the three widths scrolls sideways. The desktop hero is saved as `docs/design/v0-home-hero-desktop.png`.
- **The #67 owner app and Customer Page editor**, from the code and from the screenshots taken during the earlier editor layout work.

**What I did not look at**
- Any page behind sign-in on v0.
- The live site. `reviewboost.fit` can't be reached from this sandbox.

---

## 1. What ReviewBoost sells

ReviewBoost sells a physical-to-digital review system, not a reputation suite:

> A Tag at the counter → the customer taps or scans it → the Customer Page opens → they pick 1–5 stars → the rating is saved privately → every rating gets the same Google opportunity → the owner sees what happened.

- The customer gives no account, app, name, phone number or email.
- The owner doesn't configure a website, a funnel or a campaign.
- ReviewBoost does not know whether a Google review was actually posted, and must never say that it does.

## 2. Who we are selling to

The buyers are owners and managers of busy physical businesses:
- barbers and salons
- restaurants and cafés
- HVAC and home services
- auto and detailing shops
- dental and other local practices

What they have in common:
- They buy between customers, often on a phone.
- They judge a product in seconds, by whether they understand the object on the counter.
- They will not learn software vocabulary such as NFC, token, funnel or analytics.

## 3. The customer's journey

Every step is on the customer's own phone, in its browser:

1. Tag
2. Scan or tap
3. `/q/{token}`: the business's photo on top, the ReviewBoost rating card underneath
4. They tap a star
5. Google opens at once, the same for every star; the rating is saved in that
   same moment, without anyone waiting for it
6. They are done

There is no Continue step, no note field and no routing by rating.

## 4. The owner's journey

1. Sign up with an emailed code.
2. Onboarding: four steps.
3. Home ("what needs me?").
4. Add a photo to the Customer Page, preview it, publish.
5. Create a Tag, then print its QR code or program its NFC chip.
6. Put the Tag where people pay.
7. Feedback: Needs you / Everything / Insights.
8. Text Requests, for people who left without tapping.
9. Settings: places, plan and billing, appearance, account.

## 5. Why the information architecture is the way it is

| Decision | Why it holds |
|---|---|
| Four destinations: Home · Feedback · Text Requests · Tags | Each one is a job the owner actually has. Settings is secondary. |
| Insights sits inside Feedback | It is a deeper look at the same ratings, not a separate job. |
| Customer Page: the top is the business's, the bottom is ReviewBoost's | Every business gets its own identity, and the rating interaction stays consistent and trustworthy. |
| Upload → preview → Publish | The owner is not building a website. |
| The phone frame appears only in the editor | On `/q`, the customer's own phone is the frame. |
| Every star gets the same Google opportunity | No review gating. It is a product commitment, not a setting. |
| One Tag carries both the QR code and the NFC chip | One object and one link, opened two ways. |
| Green is for the brand and actions; gold is only for ratings | A 1-star rating is not a danger state. |

**Verdict:** the architecture is sound. This pass should be surgical: fix the parts that look unfinished and leave the rest alone.

---

## 6. Public website audit (v0 as rendered, plus #67's secondary pages)

### What v0 gets right. Keep all of it.

- **The headline:** "A code on the counter. The same Google chance for every customer." It says what ReviewBoost is and why it's different, in one breath.
- **The Customer Page carousel:** "Looks like your business. Works like ReviewBoost." Five businesses, one rating card. The product explains itself.
- **The How it works handoff diagram:** five star rows all joining into one handoff screen. It is the clearest picture of "no gating" I have seen for this product.
- **The Text Requests section:** a real SMS thread carrying the same `/q` link.
- **The integrity statement** and a FAQ that answers real objections (free plan, card for the trial, rollover, hiding Google).
- **Mobile:** no sideways scrolling at 320 px.

### Problems

| # | Problem | Evidence |
|---|---|---|
| W1 | **The hero looks unfinished.** Three objects overlap: the owner "Get set up" card, the QR Tag and the phone. The owner card is clipped behind the phone, so you can read "2 o" and "Publis", and the blurred photo background reads as muddy. | Desktop screenshot, first screen |
| W2 | **Too many phones and one photo on repeat.** On desktop the pizza image appears five times (hero, carousel, two How it works scenes, the SMS thread), across 8+ phones. At 390 wide the page is about 14,000 px tall, mostly phone after phone. | `hero.tsx`, `customer-page-showcase.tsx`, `how-it-works-scenes.tsx`, `text-request-section.tsx` |
| W3 | **Two different phone drawings.** The public site uses `DemoPhone` and `PhoneFrame` side by side. The Text Requests phone is older and has a thick bezel, while the hero phone is newer. | `demo-phone.tsx` vs `phone-frame` |
| W4 | **The How it works step 1 scene is badly cropped.** The phone is rotated and cut off, and the large "R" disc is cut off at the bottom. | Desktop screenshot, How it works |
| W5 | **The Tag is shown the same way twice.** The same QR card appears in the hero and again in "A Tag is the thing they scan", which adds little. | Hero and Tag section |
| W6 | **Off-palette colours.** v0 introduces a mint `#32cf94` (the final CTA button), brand `#0a9d5f` and near-black ink as the action colour, replacing `#00A86B` / `#007A4D` globally. That conflicts with the canonical system. | `v0: styles/globals.css`, `public-showcase.css` |
| W7 | **Two heavy dark bands in a row.** Pricing is dark, the Integrity section is light, then the final CTA is dark again. Dark pricing is a good moment; a second dark band weakens it. | Desktop screenshot |
| W8 | **Generic copy in places.** "Start with what you need. Upgrade when your business needs more." and "Held the way a till should be held." | Pricing, Integrity |
| W9 | **v0 edits the customer-flow screens.** `handoff-screen.tsx`, `rating-screen.tsx`, `visit-stars.tsx` and 688 lines of `customer-page.css` are changed. The Customer Page is locked, so none of this may come across. | `git diff --stat` |

### Public page gap audit

- **Dedicated public "Customer Page" page: don't add it.** The homepage carousel already does this job fully. A separate page would repeat it and add one more nav item.
- **v0 `/examples`: redundant, drop it.** It is the same `CustomerPageShowcase` carousel under a new header, and the homepage's "See more examples" link points at it. Replace that link with the carousel's own business tabs, which already exist.
- **Existing pages** (How it works, Product, Integrity, Pricing, Security, Privacy, Terms, Support, Delete account, Goodbye) are enough for launch. The How it works and Pricing pages should take the v0 composition; the legal pages need no design work.

## 7. Owner app audit (#67)

| Surface | Quality | Problems | Keep / change / remove |
|---|---|---|---|
| Home | Good | None blocking. v0 has a quieter setup checklist, but it is built on v0's tokens. | Keep. Optionally port the checklist *layout* only. |
| Feedback: Needs you / Everything | Good | None | Keep |
| Feedback: Insights | Good, new | Already built at `/feedback/insights`. Not missing. | Keep |
| Feedback detail | Good | None | Keep |
| Text Requests | Good | None | Keep |
| Tags list / detail / QR / NFC | Good | The URL is `/stands`, which is legacy naming. Harmless, because owners never type it. | Keep. `/tags` is optional and low priority. |
| Customer Page editor | Workflow right, visuals weak | Phone shell, publish state, and a status bug (§9) | **Change** |
| Settings | Adequate | No People & Access (§10) | Keep, and add People later |
| Billing & Usage | Good | None | Keep |
| Appearance | Fine | None | Keep |
| Account deletion | Owner-only | See the iOS audit §6 | Needs your decision (already raised) |
| Sign in / code / onboarding / organization picker | Good | None found | Keep |

## 8. Customer Page audit (`/q/{token}`)

- **Design is locked and accepted.** The rating card, stars, footer and handoff stay as they are.
- **Loading, blocked, error, offline, Spanish and Haitian Creole states** are all covered by the 40 customer-flow e2e tests, which pass on #67.
- **No changes proposed.**

## 9. Phone frame and editor audit

### What is right. Keep it.

- The screen is the real `CustomerVisitView`, laid out at 390 × 844 and scaled into the frame.
- The editor workflow is **Add/Replace photo → preview → Publish** in one column.
- The empty state before a photo is uploaded is neutral.

### Problems with the device shell (`phone-frame.tsx`, `customer-page.css` lines 491–620)

| # | Problem | Why it reads as a CSS drawing |
|---|---|---|
| F1 | The bezel padding is 3.6% of the width, about 12 px on a 340 px frame | Modern iPhones have a bezel of about 1.5% of the width, so the black ring looks thick and toy-like. |
| F2 | The body is one diagonal `linear-gradient` from grey to black to grey, applied everywhere | That reads as fake chrome. A real titanium rail is a thin band with a light highlight on its edge, not a sheen across the whole back. |
| F3 | There is no separate outer rail and bezel | Real devices have a metal rail, then a black glass bezel, then the display. Here there are only two layers. |
| F4 | The corner radii are percentage pairs (`15.5% / 7.2%`) | The screen and body corners aren't concentric, so the bezel is thicker at the corners than along the sides. |
| F5 | The side buttons are flat 0.9%-wide bars with a gradient | They have no depth or edge highlight, and their positions are approximate. |
| F6 | No contact shadow and no display inset | The device floats rather than sitting on the page. |
| F7 | Two device components exist: `PhoneFrame` (#67) and `DemoPhone` (v0 public) | They look different, and they will drift apart. |

### Problems with the publish state (`customer-page-editor.tsx`)

| # | Problem |
|---|---|
| P1 | **Success is only a line of text,** "✓ Page is live!", under the button. It feels unfinished. |
| P2 | **Bug: the page can say two contradictory things.** After a successful publish, uploading a new photo does not clear "Page is live!". The page then shows both "Not published yet" (above the phone) and "Page is live!" (below Publish). The upload handler never resets the status. |
| P3 | **Publish is always enabled,** even when nothing has changed since the last publish, so there is no "Published ✓" resting state. |
| P4 | **Success is detected by comparing text:** `published = statusMsg === "Page is live!"`. Changing the copy would silently break the success styling. |
| P5 | **There is no way to see the live page.** "View live page" needs a Tag, because the page is reached through a Tag's `/q/{token}`. The editor would have to link to the first active Tag, or to Tags when the business has none. |
| P6 | **Upload shows only a button label** (Preparing… → Uploading… → Verifying…). That's acceptable, but "Verifying" is backend vocabulary. |

## 10. Missing-page audit

| Page | Status | Notes |
|---|---|---|
| Insights | **Built** (`/feedback/insights`) | Not missing |
| **Settings → People & Access** | **Missing, and it has no backend** | There is no invitation table, no member API, and no invite email. Writes to `organization_members` are revoked from `authenticated`. It needs: an invitations table plus RPC, an invite email, role changes, removal, and the account-deletion decision (iOS audit §6), because a removed or leaving member's notes hit the same `ON DELETE RESTRICT`. This is a backend feature first. It needs its own plan and your approval. |
| Locations page | Not needed | Places already work inside Settings. |
| Public Customer Page / `/examples` | Not needed | See §6. |

## 11. Legacy routes cleanup

| Route | What it is now | Recommendation |
|---|---|---|
| `/reviews` | Redirects to `/feedback/insights` | **Keep the redirect.** Old bookmarks and notifications still reach the right place. |
| `/praise` | A full "Team" page: staff named by customers, a matcher, a tally. It uses `/api/v1/team-praise*`. | **Redirect to `/feedback`,** and delete the page, `praise-matcher`, `praise-shared-button` and the owner `team-praise` API. The public `q/[token]/team-praise` route should return 410 Gone, or be removed if nothing calls it. Team Praise is a removed concept ("No Team Praise"). |
| `/customers` | A "visits" page with its own stats (Sparkles/Users icons), overlapping Feedback / Everything | **Redirect to `/feedback`** and delete it. It duplicates Feedback and can disagree with Insights, the same reason `/reviews` was retired. |

Risk: low. None of the three routes is in the navigation. Before deleting, check that no email or notification template links to them.

## 12. Mobile audit

- **Owner app:** the editor and bottom navigation were already checked at 320×568 through 430×932 in the earlier layout pass, and the nav no longer covers Publish.
- **Must re-check after the new frame:** the phone must stay a *preview*, at about 250–305 px wide, never full width.
- **Public site (v0):** no sideways scroll at 320 or 390. The page is very long on phones (W2), and the hero stacks the QR card over the phone, which is fine.
- **Customer page:** covered by e2e at small, common and large phone sizes; unchanged.

---

## 13. Recommended changes

Each change is listed as problem → reason → solution → benefit → risk.

### A. A premium, reusable device frame

- **Problem:** F1–F7.
- **Reason:** the owner's confidence in "this is what customers see" depends on the device looking real.
- **Solution:** build one `DeviceFrame` component, used by both the editor and the public site. `DemoPhone` gets deleted.
  - Layers: a graphite/titanium rail about 1% wide with a 1 px lighter edge highlight on the outer edge only; a black glass bezel about 1.4% wide; then the display.
  - Concentric radii computed from one base radius, so the bezel is even all the way round.
  - A Dynamic Island at about 126 × 37 pt, 11 pt from the top, which is roughly what we have now. Status bar spacing stays.
  - Side buttons in their real positions, 2 px deep, with a thin highlight.
  - A faint inset shadow at the display edge.
  - One soft, low contact shadow under the device.
  - Optionally, one very low-opacity diagonal glass highlight across the display.
  - No Apple logo, no photo of a phone, no exaggerated 3D.
  - The 390 × 844 scaled `CustomerVisitView` inside stays exactly as it is.
- **Benefit:** the editor and the marketing site show the same believable device.
- **Risk:** low. It is decorative and `aria-hidden`. The screen inside is untouched, and the existing preview-parity tests still apply.

### B. A finished publish state, and the status bug fixed

- **Problem:** P1–P5.
- **Reason:** the owner must know the photo is live, and must never see "live" and "not published" at once.
- **Solution:**
  - Replace the status string with an explicit state machine: `draft-changed | publishing | published | error`.
  - Any upload or new draft moves the state back to `draft-changed`, which fixes P2.
  - In the `published` state the button reads **Published ✓** and is disabled until the draft changes. Under it, one quiet confirmation block:
    > ✓ **Customer Page published**
    > Customers who tap or scan your Tags will now see this page.
    > **View live page →**

    The link goes to the first active Tag's `/q/{token}` in a new tab. With no Tags, it reads "Create a Tag →".
  - No modal, no confetti, no Continue button.
- **Benefit:** it feels finished, the page can no longer contradict itself, and the owner can check the live page.
- **Risk:** low. Editor component tests need updating. The server-side draft and publish logic is unchanged.

### C. Upload wording

- **Problem:** P6.
- **Solution:** "Preparing photo…" → "Uploading…" → "Almost done…", instead of "Verifying…". Everything underneath stays: normalization, orientation fixing, compression, the 5 MB limit and the server confirmation.
- **Benefit:** no backend vocabulary on screen.
- **Risk:** trivial.

### D. Desktop editor composition

- **Problem:** at 1024 px and wider, the phone stops at 340 px in a narrow `max-w-sm` column, so the editor looks small on a large screen.
- **Solution:** at `lg` and wider, a two-part layout. On the left: the title and description, Replace photo, Publish, and the confirmation. On the right: the device, about 380–400 px wide. Mobile stays in one column, at the current preview size.
- **Benefit:** the preview feels premium on desktop.
- **Risk:** medium-low. Screenshots are needed at 1024, 1280 and 1440, plus the six phone sizes.

### E. Port the v0 public site selectively

- **Problem:** #67's marketing site is weaker, but v0 carries off-palette tokens and edits to the locked customer flow.
- **Solution:**
  - Bring over **only** `features/public/*` (hero, showcase, how-it-works scenes, Tag section, Text Requests section, header, reveal, scale-to-fit, pricing table) and the five showcase images.
  - Re-map them to the canonical tokens: `#00A86B` for the logo and brand, `#007A4D` for actions, `#f6f7f5` for the canvas.
  - **Do not bring:** `globals.css` token changes, `customer-page.css`, the rating and handoff screens, `visit-stars`, owner-app components, or `/examples`.
- **Benefit:** the strongest marketing site, with no regression to the product.
- **Risk:** medium. The public pages' snapshot and contrast tests need updating. Owner and customer tests must stay unchanged, and that is how we prove nothing leaked in.

### F. Public homepage fixes (after E)

| Fix | Change |
|---|---|
| W1 hero | Keep the Tag and the phone. Drop the clipped owner card from the hero; the owner Home already has its own section. Swap the blurred photo background for the plain canvas, or a very soft gradient. |
| W2 repetition | Use a different business photo in each scene: carousel as is; How it works scan = barber; rate = salon; handoff = HVAC; SMS = auto. Pizza appears only in the hero. Drop the separate Tag section (W5), because the hero and How it works step 1 already show it. |
| W4 step-1 crop | Re-frame the scene so the phone and Tag are complete, with no rotation clipping. |
| W6/W7 colour | The final CTA goes on the light canvas with a `#007A4D` button, so pricing is the only dark moment. Remove `#32cf94`. |
| W8 copy | Replace the two generic lines with concrete ones ("Pick a plan by how many places and Tags you have." / "Owner pages need a sign-in. Customer pages take one rating and nothing else.") |

- **Benefit:** a shorter, clearer page. On phones, about 20–25% less scrolling.
- **Risk:** low.

### G. Legacy route cleanup

- **What:** the §11 table.
- **Risk:** low. Check email templates first.

### H. People & Access (plan only)

- **Status:** backend-first. A separate proposal after this pass, together with the account-deletion decision.
- **Not part of this visual pass.**

### Not proposed

- A Customer Page builder, fonts or colours.
- A new analytics nav item.
- A Locations page or a public Customer Page page.
- Pricing changes or a free plan.
- Testimonials or numbers we don't have.
- Changes to the rating sheet.

---

## Recommended implementation order

One focused commit each, with before-and-after screenshots at desktop 1440 and 1024, and phone 320, 375, 390 and 430.

1. **B:** publish state machine and bug fix. Smallest change, fixes a real bug.
2. **A:** `DeviceFrame` in the editor.
3. **D:** desktop editor composition around the new device.
4. **C:** upload wording.
5. **E:** port the v0 public site onto the canonical tokens, using `DeviceFrame` in place of `DemoPhone`.
6. **F:** homepage fixes.
7. **G:** legacy route redirects and deletions.
8. **H:** People & Access proposal (backend plus UI), for your approval.

Throughout, CI must stay green and the customer-flow e2e suite must be untouched, as proof that `/q` didn't change.
