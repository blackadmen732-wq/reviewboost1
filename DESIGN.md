# ReviewBoost — the whole app in one file

This is the one design document for ReviewBoost. Colours, type, layout, every screen, every state, the words on the buttons, and how each part connects to the others are all here. If a screen, component or decision is not described in this file, it is not part of the design yet.

Who it's for: a busy owner of a barbershop, salon, restaurant or shop who is not good with technology. They use the app between customers, one-handed, on a phone. Every screen has to make sense to that person in about three seconds.

Contents: 1 the one rule · 2 app map · 3 colour · 4 type and motion · 5 layout · 6 components · 7 screens · 8 customer side · 9 texting · 10 Connections · 11 money · 12 words · 13 rules · 14 checking · 15 checklist · 16 decisions.

---

## 1. The one rule: always show where you are, what's happening, and what's next

An Uber shows where the car is, when it arrives and the one thing you can do now. The Domino's tracker lights the current step: Order placed → Prep → Bake → Out for delivery. Nobody reads instructions.

ReviewBoost works the same way. **Every screen answers three questions, in this order, at the top:**

| Question | What the owner sees | Example on Home |
|---|---|---|
| **Where am I?** | Page title, plus the selected tab in the nav | "Home" |
| **What's happening?** | One status line, in words plus a dot or icon (never colour alone) | "All good · 3 ratings today" or "Needs you · Your Tag isn't programmed yet" |
| **What's next?** | **One** filled (black) button for the most useful next action. Everything else is a secondary or quiet button. | "Program your Tag" |

Rules that come from this:

- **One filled button per screen.** If two things seem equally important, the screen is doing too much.
- **Progress is shown as steps, never as a percentage.** Use steps 1 → 2 → 3 with a check on each finished one and the current step highlighted, like the pizza tracker. A step is ticked only when the data proves it is done (the Google link is saved, the Tag is programmed, a rating came in). Pressing a button never ticks a step.
- **Every wait says what it is waiting for.** Write "Sending 12 texts…", never just a spinner. A loading button keeps its own label and adds a spinner.
- **Every result says what happened and what to do next.** For example: "Added 48 people. 3 rows had no phone number: rows 4, 9, 17."
- **Nothing is ever empty without a reason and a way forward.** Every empty state gives the cause and an action (§6.9).
- **Live things look live.** A text being sent moves through Queued → Sent → Delivered (§9). A new rating shows up in Feedback without a refresh, and the unread badge updates.
- **Say what a button does before it's pressed.** Write "Send 12 texts", not "Submit". Write "Add these people", not "Import".

---

## 2. How everything connects (app map)

```
WEBSITE (public)                 SIGN IN               FIRST RUN               DAILY USE (owner app)
reviewboost.com ─────────────▶  /login  ───────────▶  /onboarding  ───────▶  ┌─ Home ─────────── status + one next action
 Home · Product · How it works   Google                1 Business name        │    │
 Pricing ─ Start free trial ──▶  Apple                 2 Google review link   ├─ Feedback ─────── ratings, Insights tab
 Privacy · Terms · Security      Email code              (or "I'll do it      │    └─ /feedback/[id]  one rating
 Support · Delete account                                 later")             ├─ Texts ────────── send review requests (consent-gated)
                                                        3 Done → Set up        ├─ Set up ───────── 1 Customer page 2 Tag 3 Test
                                                                               │    ├─ /customer-page  editor + live preview
                                                                               │    └─ /stands/[id]    one Tag: program / print
                                                                               └─ Settings ──────── business, Google link, theme,
                                                                                    ├─ Connections   Google Sheets · CSV · Square
                                                                                    ├─ Billing ─────▶ Stripe Checkout / Portal (web only)
                                                                                    └─ Delete account

CUSTOMER (no account, no app)
Tag on the counter ── tap (NFC) or scan (QR) ──▶ /q/[token]  "How was your visit?" ★★★★★ ──▶ Google review page
                                                     │                                    (every star goes to Google)
                                                     └── rating lands in the owner's Feedback + Home in seconds

IPHONE APP (free companion)
Same sign-in, Home, Feedback, Texts, Set up, Settings. No purchase button. Account deletion in Settings.
```

The connecting threads:

- **The Tag is the centre of everything.** Set up creates it. The customer taps it. Feedback shows what came from it. Home tells you when it needs attention (not programmed, needs rewriting).
- **The Google review link** is entered once (in onboarding or Settings). It is used by the customer page, checked on Home ("Your link is a listing, not a review link"), and is Set up step 1.
- **Customers** arrive from three places: a Tag rating, a Connections import, or a text request. Only **consent** decides who may be texted. An import never counts as consent.
- **Billing** decides the text allowance. Texts shows the remaining credit. Billing is only ever changed on the web.

---

## 3. Colour

**Warm white**, chosen by the owner on 18 October 2026. The calm, near-white background is modelled on Claude's. Black does the actions. Green is the brand and means "good", nothing else.

### 3.1 Tokens

The real values live in `frontend/styles/globals.css` (app), `public-product.css` (website) and `apps/mobile/theme.ts` (iPhone). This table must match them. Never hard-code a colour inside a component.

| Token | Job | Light | Dark |
|---|---|---|---|
| `--rb-canvas` | Page background | `#FCFCFB` | `#191918` |
| `--rb-surface` | Cards, inputs, sheets | `#FFFFFF` | `#212120` |
| `--rb-raised` | Menus, popovers | `#FFFFFF` | `#262624` |
| `--rb-quiet` | Selected row, chip, hover fill | `#EDECE8` | `#2C2C2A` |
| `--rb-ink` | Main text, icons | `#1A1A19` | `#F5F5F3` |
| `--rb-muted` | Secondary text, captions | `#6B6B67` | `#A8A8A2` |
| `--rb-border` | Hairlines between things | `#E2E2E1` | `#3A3A37` |
| `--rb-border-strong` | Input outlines, empty stars, checkboxes | `#8F8F8A` | `#75756F` |
| `--rb-action` | The one filled button | `#1A1A19` (hover `#333331`, pressed `#000000`) | `#F5F5F3` (hover `#FFFFFF`, pressed `#E2E2DF`) |
| `--rb-on-action` | Label on the filled button | `#FFFFFF` | `#1A1A19` |
| `--rb-brand` | Logo mark, success check (identity only, never text) | `#00A86B` | `#00A86B` |
| `--rb-brand-text` | Green text and links ("Connected", "All good") | `#00754A` | `#45CF99` |
| `--rb-brand-soft` | Success background | `#E3F5EC` | `#143729` |
| `--rb-star` | Selected stars | `#B97D0C` | `#F2B94B` |
| `--rb-warning` | "Needs you" | `#9A6415` | `#F0B45A` |
| `--rb-danger` | Errors, destructive actions | `#B33A3A` | `#FF8F8F` |
| `--rb-info` | Neutral information | `#2663A0` | `#78B5F4` |
| `--rb-focus` | Keyboard focus ring | `#005FCC` | `#7AB8FF` |
| Website demo band | Product proof band on the public site | forest `#064E3B` | same |

### 3.2 Contrast (WCAG 2.2 AA, measured)

Body text needs 4.5:1. Large text and UI outlines need 3:1.

| Pair | Light | Dark | Use allowed |
|---|---|---|---|
| ink on canvas | 16.97 | 16.12 | all text |
| muted on canvas | 5.21 | 7.36 | all text |
| muted on quiet | 4.53 | 6.74 (on surface) | all text, but nothing smaller than 14px on quiet |
| brand-text on canvas | 5.61 | 8.91 | all text |
| on-action on action | 17.42 | 15.96 | button labels |
| danger on canvas | 5.71 | 8.02 | all text |
| warning on canvas | 4.86 | 9.54 | all text |
| info on canvas | 6.06 | 8.14 | all text |
| border-strong on canvas | 3.16 | 3.80 | outlines only, never text |
| star on white | 3.50 | 9.07 | star shapes only, never text |
| brand `#00A86B` on canvas | 3.00 | — | **logo and icons only, never text** |
| white on forest band | 9.72 | — | all text |

### 3.3 Meaning

- **Black** = "do this". There is one filled black button per screen.
- **Green** = "this is good" or "this is done": a check, "Connected", "All good". It is never used for a button background or a selected tab.
- **Amber** = "needs you".
- **Red** = something failed, or the action can't be undone.
- Every status also has a **word and an icon**, so colour-blind owners and screen readers get the same meaning.

---

## 4. Type, spacing, shape, depth, motion

**Fonts.**
- The app body and controls use Geist Sans.
- Website headlines use Instrument Serif, with an italic second line in `--rb-brand-text`.
- The customer page uses Inter Tight for the heading and DM Sans for the small tracked line.
- Counts, prices and times use tabular numerals.

**Sizes.**

| Use | Size |
|---|---|
| Caption | 12px |
| Secondary | 14px |
| Body | 16px (never smaller for anything the owner must read) |
| Page title | 24px |
| Display | 28px |
| Website headlines | 48–96px |

Headings use `text-wrap: balance`; paragraphs use `text-wrap: pretty`.

**Spacing scale.** 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96, 120, 144px. Use tight spacing inside a group and generous spacing between tasks.

**Shape.**
- Controls have a 12px radius; cards have 16px.
- Rows, inputs and buttons are 56px tall.
- Nothing tappable is smaller than 44px.

**Depth.**
- Cards are flat with hairline borders and no shadows.
- The only control shadow is the filled button's glossy edge (`--shadow-button`: light top, dark bottom, 1–2px drop), a little stronger on hover.
- Popovers and sheets use `--shadow-float`.

**Motion.**
- Controls animate in 150ms; page changes in 180ms.
- Animate only named properties, such as colour, opacity and transform.
- With `prefers-reduced-motion`, nothing moves, and nothing depends on motion to be understood.
- Never use a splash delay or scroll-jacking.
- Tappables use `touch-action: manipulation`, so there is no 300ms tap delay.

---

## 5. Layout and navigation

**Phone (under 768px).**
- Content is a single column with 16px side gutters.
- A bottom bar holds **exactly four** tabs: **Home · Feedback · Texts · Set up**.
- Settings opens from the profile button at the top right.
- The selected tab is ink and semibold; the others are muted. Green is never used for the selected tab.
- Feedback carries the only badge (the unread count).
- The page's main action sits above the bottom bar when it must always be reachable, such as Publish in the editor.

**Desktop (1024px and up).**
- A left sidebar holds Home, Feedback, Text Requests, Set up and Settings.
- The selected item has a quiet fill and semibold ink; hover is a lighter quiet fill.
- Owner content is about 800px wide; the website is about 1080px.
- The customer-page editor puts its controls beside a live phone preview.

**Every owner page, top to bottom.**
1. **PageHeader**: title, then a one-line status (Where am I? What's happening?).
2. **The next action**: one filled button, or an attention card that holds it.
3. **The content**: lists, steps or forms.
4. **Quiet links**: help, "Show me how", secondary actions.

On a phone the explanation sits above the action; on a desktop the action sits to the right of the title.

All defined in `features/dashboard/nav-items.ts`. The bar and sidebar both read from it. Phone: exactly four tabs, never five.

---

## 6. Components

All of these exist in `frontend/components/ui` or `features/dashboard`. Use them; don't make look-alikes.

### 6.1 Button (`button.tsx`)

| Variant | Looks | Use |
|---|---|---|
| primary | Black fill, white label, glossy edge | The one next action on the screen |
| secondary | White with a hairline border | Other real actions |
| ghost | Text only, with a quiet fill on hover | Low-importance actions, "Cancel" |
| destructive | Red label or fill | Only inside a confirmation dialog |

States:
- Default.
- Hover.
- Pressed: darker, with a 1px press.
- Focus: a 2px focus ring.
- Loading: keeps its label (or `loadingLabel`), shows a spinner, and ignores repeat taps.
- Disabled: used only when something truly can't be done, with the reason shown next to it.

Don't pre-disable a submit button. Let the owner tap it, then say exactly what's missing.

Links go somewhere; buttons do something. Label every button with a verb and its object: "Publish page", "Send 12 texts", "Remove list".

### 6.2 PageHeader

Holds the title, the status line and an optional action slot. One per page.

### 6.3 Status line / status chip

Each status is a dot or icon plus a word.

| Status | Word | Colour |
|---|---|---|
| Good | "All good" | green |
| Needs you | "Needs you" | amber |
| Failed | "Failed" | red |
| Waiting | "Sending…" | muted, with a spinner |
| Coming | "Soon" / "Planned" | quiet chip |

### 6.4 Steps (the pizza tracker)

Used for Set up, onboarding and the per-text tracker.

- Numbered circles connected by a line.
- A finished step shows a green check with a short "done" sentence.
- The current step is ink and bold. It is the **only** step with a filled button, and it has a "Show me how" disclosure.
- A future step is muted, with its button hidden.

### 6.5 Cards and lists

- A card is white with a hairline border and 16px radius. Never put a card inside a card.
- A list is rows with dividers. Each row shows a title, one line of detail, a status chip on the right and a chevron if it opens.
- Rows are at least 56px tall.

### 6.6 Inputs

- 56px tall, with the label above and help text below.
- An error message replaces the help text and marks the field `aria-invalid`.
- An error never clears what the owner typed.
- Placeholders show the shape of the answer, such as `https://g.page/r/…`, and are never the label.

### 6.7 Dialog and sheet (Radix)

- Used for confirmations and NFC programming. Focus stays inside; Escape closes it.
- The title asks the question ("Remove this list?").
- The body says what will happen ("The 48 people it added will be removed. People who also came from somewhere else stay.").
- The buttons are Cancel and a specific destructive action ("Remove list").

### 6.8 Toast (`notify` / sonner)

Used only to confirm something that already happened ("Page published"). Toasts never carry errors the owner needs to act on; those go inline in an InlineNotice.

### 6.9 EmptyState

- Format: cause, then action. Write "Nothing yet. Ratings show up here after customers tap or scan your Tag." with a [Go to Set up] button.
- A filtered list that comes back empty says "No ratings match this filter." with [Clear filter].
- An empty to-do list says "All caught up."

### 6.10 InlineNotice and StatePanel

- InlineNotice shows a message next to the thing it is about (info, warning or error), with a recovery action.
- StatePanel is used for whole-page loading, error and offline states, always with "Try again".

### 6.11 Skeleton

Every owner page has a `loading.tsx` next to it (Home, Feedback, Insights, a rating, Set up, a Tag, Texts, Settings). The rules:

- Nav, title and data-free headings are real; only the data area is grey.
- Same paddings, radii, row heights and button sizes as the real page, so nothing jumps.
- Two or three rows, never a long fake list. A soft shimmer that stops under reduced motion.
- Check on Slow 3G: a blank page or a jump means the skeleton is wrong.

### 6.12 Stars

- Five stars, at least 48px on the customer page.
- Selected stars use the star colour; empty stars use a border-strong outline.
- Each star has a label: "3 stars of 5".

---

## 7. Every screen

Each screen follows the same pattern: what it's for, its status line, its one next action, and its states. The words in quotes are the exact text shown on screen.

### 7.1 Home `/home`

- **What it's for:** a quick daily check, not an analytics wall.
- **Status:** "All good" or "Needs you", followed by today's count ("3 ratings today").
- **Next action:** the first thing that needs attention, in this order:
  1. Tags off (no plan, cancelled, suspended) or a failed payment → "Choose a plan" / "Update payment" (owner only)
  2. Unread ratings → "Read feedback", saying how many are 3★ or lower
  3. No Tag → "Create a Tag"
  4. Google link missing → "Add Google link"
  5. Tag not programmed or needs rewriting → "Program a tag" or "Print your code"
- **Content:**
  - An attention card when something needs the owner.
  - "This week", comparing ratings this week with last week, in plain numbers.
  - Recent ratings, the newest three.
  - A link to Set up while setup isn't finished.
- **States:**
  - *New owner, no ratings:* Set up's three steps, small, with "Open Set up".
  - *Active:* the content above.
  - *Google link is a listing, not a review link:* a warning card with "Fix link".
  - *Error:* "Home didn't load." with [Try again].

### 7.2 Set up `/stands`

This is the one place an owner programs anything.

- **What it's for:** the full setup, in three steps, plus their Tags.
- **Status:** "Step 2 of 3" or "You're all set".
- **Steps** (`features/setup/setup-model.ts`):
  1. **Make your customer page.** Done when the Google review link is saved. The button is "Finish your business details", "Add your Google review link" or "Edit customer page", whichever applies. If there's no photo, it nudges: "Adding a photo of your business makes it feel like yours."
  2. **Set up your Tag.** Done when a Tag is programmed. Button: "Set up your Tag" or "Open your Tag". "Show me how" covers Android NFC, iPhone or no NFC (print the code), and that the Tag is locked once it's written.
  3. **Test it.** Done when the first rating arrives. "Tap your Tag or scan the code with your own phone, then tap a star." When done, the button is "Open Feedback".
- **Your Tags:** a list of Tags, each with its name, status ("Live", "Not programmed" or "Needs rewriting") and a chevron, plus "Add a Tag".
- **Empty:** "No tags yet. Create a Tag, print the code, and put it on the counter. Step 2 walks you through it."

### 7.3 One Tag `/stands/[id]`

- **Status:** "Ready", "NFC not programmed", or "Code changed: reprint and reprogram" (`tagReadinessLabel`). The Tags list shows the code and the chip separately: "QR ready" / "Reprint QR" and "NFC ready" / "Program NFC" / "Reprogram NFC".
- **Next action:**
  - Not programmed: "Program Tag" on Android with NFC, otherwise "Print code".
  - Live: "Print code" as a secondary action.
- **Program sheet:** full screen: "Program your Tag" → "Hold near your Tag" → "Tag ready". A failure says why, e.g. "Couldn’t program this Tag".
- **Other actions:** rename, rotate the code (inside "Advanced", with confirmation), and retire.

### 7.4 Customer page editor `/customer-page`

- **Status:** "Published", "Draft saved, not published" or "Saving…".
- **Next action:** "Publish page". The button sits above the bottom bar on a phone and beside the preview on a desktop.
- **Content:**
  - Photo: add, replace or remove.
  - A live preview built from the **same component tree** customers see.
- **Rules:**
  - If the owner leaves with unsaved or uploading changes, the browser warns them.
  - "Draft saved" and "Published" are two different states.

### 7.5 Feedback `/feedback` and Insights `/feedback/insights`

- **Status:** "4 unread" or "All caught up".
- **Next action:** open the newest unread rating.
- **Content:**
  - Tabs: **Needs you** (unread, or 3★ or lower and not sorted), **Everything**, **Insights**.
  - Each row shows stars, the time ("2 min ago"), the Tag when there are several, and Read/Sorted.
  - Insights shows a real rating trend and distribution. Missing days appear as gaps, and a small-sample warning shows when there's too little data.
- **One rating `/feedback/[id]`:** stars, time and Tag; opening it marks it read; "Mark as sorted" is black for 3★ or lower. Never labelled a Google review: we know a customer was **sent to** Google, not that they posted.
- **Empty:**
  - "Nothing yet. Ratings show up here after customers tap or scan your Tag." with [Go to Set up].
  - "No ratings match this filter." with [Clear filter].

### 7.6 Texts `/text-requests`

- **Status:** "142 texts left this month" plus any failures ("2 didn't deliver").
- **Next action:** "Send a review request". The form takes a phone number and the exact message preview; the credit cost comes from the server-rendered message.
- **Content:** recent texts, each with the tracker from §9.
- **Rules:**
  - Sending is allowed only to people with recorded consent.
  - The consent step is its own explicit action.
  - If someone has no consent, the screen explains why the text can't be sent and how consent is recorded.
- **Empty:** "No texts sent yet. Send one to a customer who just visited."

### 7.7 Settings `/settings`

Settings has these sections, in order:

1. **Business:** name, address and location. If the owner belongs to more than one business, a "Switch business" control appears here.
2. **Google review link:** the field plus a check ("Works · opens your review form" or "This is a listing link. Use the review link instead.").
3. **Connections:** see §10.
4. **Appearance:** System / Light / Dark.
5. **Billing (web only):** see §11.
6. **Account:** sign out, and "Delete account" in red at the bottom.

Saving shows "Saved" inline. A failed save says "Didn't save. Try again." and keeps what the owner typed.

### 7.8 Sign in `/login`

- **Status:** "Sign in to ReviewBoost".
- **Buttons:** three full-width, labelled buttons, each with its official mark:
  - "Continue with Google"
  - "Continue with Apple"
  - "Continue with email". This sends a 6-digit code, entered in `code-input`.
- **After signing in:** if the account has more than one business, the owner goes to `/select-org` first.
- **Errors:** errors name the problem, e.g. "That code expired. We sent a new one."

### 7.9 Onboarding `/onboarding`

- Steps 1 → 2 → 3 are shown as a tracker:
  1. "What's your business called?"
  2. "Paste your Google review link." This step has "Where do I find it?" and "I'll do this later".
  3. "You're in."
- The Continue button is always tappable. If something's missing, tapping it explains, e.g. "Enter your business name to continue." The field is marked invalid.
- Onboarding ends on Set up.

### 7.10 Account deletion `/settings/delete` (also the public `/delete-account`)

- Says plainly what is deleted and when.
- The owner types the business name to confirm, then taps "Delete account".
- This also works inside the iPhone app (Apple 5.1.1(v)).
- After deletion, the owner sees `/goodbye`.

### 7.11 Website (public)

- **Pages:** Home, Product, How it works, Pricing, Security, Integrity, Privacy, Terms, Support.
- **Home:**
  - A centred serif headline with an italic green second line.
  - The real Tag and phone proof in the first mobile screen.
  - The main action is "Start free trial".
- **How it works:** three numbered steps; advanced code rotation sits inside a disclosure.
- **Pricing:**
  - Bordered cards with tabular prices.
  - Starter's trial is the primary action.
  - The trial limit (one Tag, no texts) is shown beside its button.
- **Not allowed:** fake testimonials, fake counts and glowing "popular" badges.
- **Mobile navigation:** one native disclosure menu.

### 7.12 System pages

- **Not found:** "That page doesn't exist." with [Go to Home].
- **Error:** "Something went wrong." with [Try again].
- **Offline:** "You're offline. ReviewBoost will reload when you're back."

---

## 8. The customer's side (`/q/[token]`), locked

The customer has no account and no app. Customer experience is the product, so this screen is locked:

- An optional business photo sits above a rounded lower panel. With no photo, the top is **plain white** in every theme. No stock photos, gradients or initials.
- The panel shows "How was your visit?", the instruction line and five stars, then "REAL BUSINESSES. REAL FEEDBACK. A BRIGHTER TOMORROW."
- The footer is a small grey bolt, grey "Powered by" and a dark bold **ReviewBoost**.
- Tapping any star, 1 to 5, saves the rating and sends the customer straight to the **same** Google review page. **No review gating:** unhappy customers are never filtered away from Google.
- If saving fails, the customer can recover. Telemetry never blocks the handoff, and coming back from Google never loops.
- The owner's preview and the live page are one component.

---

## 9. Texting, shown like a delivery tracker

Each review request shows where it is, like a parcel:

```
Queued  ──▶  Sending  ──▶  Sent  ──▶  Delivered  ──▶  Tapped  ──▶  Rated ★4
                                  └──▶ Delivery unknown (carrier didn't say)
                                  └──▶ Failed: "Number can't get texts"    [Try another number]
Suppressed: "This person replied STOP. They won't get texts."             (no action)
```

- **Built now:** Queued, Sending, Sent, Delivered, Delivery unknown, Failed and Suppressed.
- **Planned:** Tapped and Rated. They need the link-click and rating join.
- Each row shows the customer's initials, the last 4 digits of their phone, the tracker with the current step bold, and the time of the last change ("Delivered · 2 min ago").
- A failure always says why and what to do. "Error" alone is never enough.
- Sending to many people at once (planned) shows one summary tracker: "Sending 48 · 31 delivered · 2 failed". Each person's row opens their own tracker.

---

## 10. Connections (bringing in customer lists)

This lives in Settings → Connections. Built on PR #79; see `docs/connections/google-sheets-setup.md`.

**The directory.**
- Two-column cards on a desktop, one column on a phone.
- Each card has the official logo in a tile, the name, a one-line description and a small "+" button.
- A connected card shows a green check and "Connected".
- Providers that aren't available yet show a "Soon" or "Planned" chip and no button.
- Logos are official files only, stored in `public/connections/logos/`.

**Google Sheets and CSV share one flow.**
1. **Pick:** Google's own picker or a file chooser.
2. **Check columns:** we guess the name and phone columns, and the owner can change the guess. The first rows are shown.
3. **"Add these people".**
4. **Result:** "Added 41, updated 5. 3 rows couldn't be used: rows 4, 9, 17 (no phone)."
5. **Lists:** each import is listed with "Remove list" (with confirmation).

**Rules.**
- Importing never counts as consent.
- Phone numbers are checked strictly and never guessed.
- No Google credential is kept.

**Square** (planned) will be a sign-in-and-sync connection. It needs the owner's Square developer app first.

---

## 11. Money: Stripe on the web, free iPhone app

**Web.**
- Settings → Billing shows the current plan, the next charge date and texts left.
- "Change plan" opens Stripe Checkout; "Manage billing" opens the Stripe Customer Portal.
- After paying, the app shows "Confirming payment…" until Stripe's webhook confirms it. The plan is **never** taken from the success URL.

**iPhone.**
- Free companion app (Apple 3.1.3(f)), the way Podium and Square Dashboard do it.
- No price, no purchase button and no link to buy.
- Billing shows the plan read-only: "Your plan: Growth. Plan changes happen on reviewboost.com" without a link.

**If App Review asks:** add Apple In-App Purchase alongside Stripe. Decided 18 October 2026: "Free first, Apple if asked".

---

## 12. Words: how the app talks

- Plain words, short sentences, written to "you". "Your Tag is ready. Put it where people pay."
- Use the owner's nouns:

| Say | Don't say |
|---|---|
| Tag | stand, device |
| customer page | landing page |
| rating | response |
| text | SMS, campaign |
| Set up | configuration |

- Button text is a verb and an object: "Publish page", "Print code", "Add these people".
- Name exact numbers and rows. Don't say "Some items failed".
- Never blame the owner. "That link isn't a review link. Here's how to get one."
- Don't claim what we don't know. Write "sent to Google", never "left a review".
- Numbers are tabular. Times are relative ("2 min ago") with the full date on hover or long-press.

---

## 13. Rules we must follow

| Rule | What it means on screen | Where |
|---|---|---|
| Google: no review gating | Every star leads to the same Google page | Customer page |
| Consent before texting (TCPA) | Only consented people can be texted; imports never count as consent | Texts, Connections |
| Apple 4.8 | Sign in with Apple wherever Google sign-in is offered | Sign in |
| Apple 5.1.1(v) | Account deletion inside the app | Settings → Delete account |
| Apple 3.1.3(f) | No purchase button in the iPhone app | Billing (iPhone) |
| Apple 2.1 | A working demo account for App Review | Release notes |
| WCAG 2.2 AA | Contrast as in §3.2; 44px targets; visible focus; labels on every control; status in words; works at 320px and with 200% text | Everywhere |
| Reduced motion | No essential animation | Everywhere |

---

## 14. How we check our work

For every screen that changes:

1. **Widths:** 390px phone, 768px tablet, 1280px desktop, and 320px for dense screens.
2. **States:** light and dark; empty, loading, error, success and populated; photo and no-photo; keyboard only; reduced motion.
3. **The three-question test:** cover everything but the top of the screen. Can you still tell where you are, what's happening and what to do next? If not, fix the header.
4. **Tests:** unit, component and end-to-end tests, plus typecheck, lint and a production build.
5. **Separate from browser checks:** real phones, real NFC, Stripe test mode and App Store review all need their own checks. A passing browser check doesn't prove them.

---

## 15. Build checklist

✅ done · 🔨 next · 👤 needs the owner

| # | Item | Status |
|---|---|---|
| 1 | Warm-white palette, glossy button, dark mode | ✅ PR #82 |
| 2 | Set up page with 3 steps and "Show me how" | ✅ PR #82 |
| 3 | Ink selected tab, never-dead buttons, labelled loading, empty states with actions, unsaved-changes warning | ✅ PR #82 |
| 4 | Google Sheets + CSV import, list removal | ✅ PR #79 (Google keys 👤) |
| 5 | Connections directory with official logos | ✅ PR #79 (logo files 👤) |
| 6 | Sign-in screen: labelled Google / Apple / Email + Sign in with Apple | 🔨 |
| 7 | One central "can this person be texted?" check | 🔨 |
| 8 | Text tracker rows (§9) as a shared component | 🔨 |
| 9 | Contacts list and send-to-many with summary tracker | 🔨 |
| 10 | Tapped / Rated steps on texts | 🔨 |
| 11 | Square connection | 🔨 after 👤 Square developer app |
| 12 | Google Sheets "keep in sync" | 🔨 after 👤 server OAuth secret |
| 13 | iPhone app: same tokens in `theme.ts` (warm white, black actions) | ✅ PR #82 |
| 14 | Production database backup and migration reconciliation | 👤 |
| 15 | Turn GitHub Actions back on (account setting) | 👤 |
| 16 | Legal check on the low-rating flow | 👤 |
| 17 | App Store demo account | 👤 |

---

## 16. Locked decisions and history

- **Palette, 18 Oct 2026:** warm white replaced the earlier cream (`#F8F5F0`) and forest-green buttons. Black is the action; green is identity and success.
- **Navigation:** four phone tabs, forever. "Tags" became "Set up"; the route stays `/stands` so printed and existing links keep working. Insights is a tab inside Feedback. The old Reviews, Customers and Praise URLs redirect.
- **Billing:** free iPhone app first; add Apple In-App Purchase only if App Review asks.
- **Website:** the Veyra/Midday-style serif headline, the real Tag and phone proof, and the forest demo band.
- **iPhone launch screen:** a flat `#005B3E` field with the white handwritten wordmark (320pt on iOS, 180dp on Android). It hands off as soon as the first screen is ready (`docs/mobile/LAUNCH_SCREEN.md`).
- **References:** Stripe for hierarchy and legible numbers (not its indigo or fonts); shadcn for button and token patterns (not its runtime). Pins: `docs/design/reference-lock.json`; evidence: `docs/design/`.
