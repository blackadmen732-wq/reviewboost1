# ReviewBoost — Google Play Submission Package

The Play Console listing content, written against what the app actually does.
`docs/mobile/MOBILE_RELEASE.md` is the build-and-upload runbook; this is what
goes in the console once a build is there. Blanks marked **TODO** need a person
with account access.

The App Store package is `docs/app-store/SUBMISSION.md`. Where the two stores
ask the same question the answers here match it deliberately — a Data safety
form that disagrees with an App Store nutrition label means at least one of
them is wrong.

---

## App identity

| Field | Value | Source |
|---|---|---|
| **App name** | ReviewBoost | `apps/mobile/app.json` → `expo.name` |
| **Package name** | `fit.reviewboost.app` | `app.json` → `expo.android.package` |
| **Default language** | English (United States) | — |
| **App or game** | App | — |
| **Free or paid** | Free to install | Subscription is billed on the web; see *Payments* below |
| **Category** | Business | — |
| **Tags** | Reviews, Small business, Productivity | — |

Version is `1.0.0` in `app.json`, and the Play version code is managed by EAS
(`eas.json` → `production.autoIncrement`). Do not hand-edit it in the console.

---

## Store listing

**Short description** (80 characters max):

```
Turn happy customers into Google reviews with a tap. No app for them to install.
```

**Full description** (4000 characters max):

```
ReviewBoost gives small businesses a simple way to collect more Google reviews
from real customers — without asking anyone to download an app, create an
account, or do anything complicated.

HOW IT WORKS

Put a QR code on the counter or program an NFC Tag. A customer scans or taps
it, taps a star, and goes straight to your Google review page. That is the
whole flow for them. No sign-up, no form, no friction.

FOR THE BUSINESS

- Every rating as it arrives, visible only to you
- Text Requests: send a review reminder to a phone number in one tap
- Multiple Tags and locations on paid plans
- Your Tags keep working when you change where they point — same sticker, same
  chip, new destination

TAGS AND NFC

Bring your own blank NFC tags (NTAG213 or NTAG215). Hold one to the back of
your phone and the app writes your review page to it. QR codes work on every
smartphone, so NFC is optional.

EVERY RATING GETS THE SAME LINK

ReviewBoost never routes by rating. Someone who taps one star is offered the
same Google review page as someone who taps five, and there is no setting to
change that. We do not write, buy, filter, or suppress reviews.

PRIVACY

We never ask your customers for a name, phone number, or email. A rating is one
tap and nothing else — there is no message box, so there is nothing to attach
to anyone. Notes your own team writes on a rating are encrypted at rest and
readable only by your business.

PLANS

$49, $79 or $129 a month depending on how many locations and Tags you need.
Starter comes with a seven-day free trial: a card is required to start it and
nothing is charged until it ends. Growth and Pro are charged when you subscribe. Subscriptions are managed at reviewboost.fit; this app shows
your plan and what is left of it.

Requires an internet connection. NFC programming requires a phone with NFC
hardware; QR codes work everywhere.
```

**Note on the rating-routing paragraph:** it is in the listing on purpose.
Review-gating apps are a known category on both stores, and stating the
opposite plainly is cheaper than being mistaken for one.

---

## Graphics

| Asset | Requirement | Status |
|---|---|---|
| App icon | 512×512 PNG, 32-bit, ≤ 1 MB | **Ready:** `store-assets/google-play/icon-512.png` (7 KB, full-bleed square; Play adds the rounded mask) |
| Feature graphic | 1024×500 PNG or JPEG, no alpha | **TODO** — required, listing cannot publish without it |
| Phone screenshots | 2–8, min 320px, 16:9 or 9:16 | **TODO** — capture on device |
| Tablet screenshots | Optional | Optional |

Adaptive icon layers already exist and are declared in `app.json`:
`android-icon-foreground.png`, `android-icon-background.png`, and
`android-icon-monochrome.png` for themed icons on Android 13+. The background
colour is the one ReviewBoost green, `#00A86B` (see `Branding/README.md`).
All of these, and the listing icon, are generated from `Branding/Mark.svg` by
`scripts/brand/generate-brand-assets.mjs`; the prebuild output is checked
under circle, squircle, rounded-square and teardrop masks in
`docs/mobile/icon-previews/store-assets-qa.png`.

**Shots to capture** (same list as the App Store package, so one session covers
both):

1. Live Feed — ratings arriving
2. Feedback list
3. Tags — a Tag with its QR preview
4. Text Requests
5. The customer screen at `/q/[token]` — the star tap
6. NFC programming — the "Hold Near Reader" screen or the green check

---

## Data safety

Play's Data safety form and the App Store nutrition labels answer the same
questions. These match `docs/app-store/SUBMISSION.md`, and both are written
from the code rather than from what seems safe to say.

### Data collected

| Data type | Collected | Shared | Purpose | Optional? |
|---|---|---|---|---|
| Email address | Yes | No | Account management, app functionality | Required |
| Name (business name) | Yes | No | App functionality | Required |
| Phone numbers | Yes — uploaded by the owner for Text Requests | With Twilio, to deliver the message | App functionality | Optional feature |
| Payment info | No — Stripe processes cards; the app never sees a card number | — | — | — |
| User IDs | Yes | No | App functionality only | Required |

### Data not collected

- No location, contacts, calendar, photos, files, or microphone data.
- No app-activity analytics. There is no analytics or crash SDK in this app —
  not Firebase, Sentry, Amplitude, Segment, PostHog or Mixpanel. Answer "No" to
  every App activity and Diagnostics row; do not tick them defensively, because
  a Data safety form is a declaration Google can check against the APK.
- Nothing from customers. The customer flow collects a star and nothing else.

### Security practices

| Question | Answer |
|---|---|
| Is data encrypted in transit? | Yes — HTTPS everywhere |
| Can users request data deletion? | Yes — in the app, and via the URL below |
| Committed to Play Families policy? | Not a Families app |
| Independent security review | No — and the public security page says so rather than implying one |

---

## Account deletion

Play requires both an in-app route and a publicly reachable URL, and rejects
listings where the URL only explains how to email a request.

| Field | Value |
|---|---|
| **In-app path** | Account tab → Delete account |
| **Deletion URL** | `https://reviewboost.fit/delete-account` |
| **Requires sign-in to read the URL?** | No |

**What it deletes:** the organization and everything in it — Tags, ratings,
phone numbers and consent state, team memberships — plus the sign-in itself
unless the person owns another business on ReviewBoost. It is immediate: one
cascading delete, no queue and no approval step.

**What survives:** invoices already issued, because both parties are required to
keep records of money that has moved. Say this on the form rather than claiming
total erasure; the public page says it too.

**Partial deletion:** ReviewBoost offers account deletion only, not
data-without-account deletion. Select "Users can request that their account and
associated data be deleted".

---

## Content rating (IARC questionnaire)

Category: **Utility, Productivity, Communication or Other**.

| Question | Answer |
|---|---|
| Violence, sexuality, profanity, drugs, gambling | None |
| Does the app share a user's location with other users? | No |
| Does the app allow users to interact or exchange content? | No — ratings go to the business only; there is no user-to-user surface |
| Does the app allow purchases of digital goods? | No — see *Payments* |
| Does the app contain user-generated content visible to others? | No |

Expected outcome: **Everyone / PEGI 3**.

---

## Target audience and content

- **Target age group:** 18+ (business owners). The app is not designed for or
  appealing to children, so the Families policy does not apply.
- **Ads:** the app contains no ads. Answer "No".
- **News app:** No.
- **COVID-19 contact tracing:** No.

---

## Permissions

Declared in the manifest generated from `app.json`:

| Permission | Why | Play declaration |
|---|---|---|
| `android.permission.INTERNET` | The app is a client for the ReviewBoost API | No declaration form needed |
| `android.permission.NFC` | Writing the review URL to the owner's own Tags | No declaration form needed |

No sensitive permissions are requested. There is no `QUERY_ALL_PACKAGES`, no
location, no background location, no SMS or Call Log permission — the app does
not send SMS from the device; Text Requests are sent server-side through
Twilio, which is what keeps the SMS permission declaration out of this listing
entirely.

NFC is **not** declared as `required` via `uses-feature`, deliberately: a phone
without NFC hardware can still use the whole app with QR codes, and marking it
required would hide the listing from those devices.

---

## Payments

The subscription is sold on the web through Stripe. The Android app contains no
Play Billing integration, no purchase flow, and no link to one — the Account
tab reads the current plan and remaining message allowance and sells nothing.

Play's Payments policy requires Google Play Billing for in-app purchases of
digital content. It does not require it for a business service purchased
outside the app, provided the app does not sell or direct to a purchase. This
listing relies on that, so keep it true: adding an "Upgrade" button or a link
to checkout changes the answer and needs a decision before it ships, not after.

Two strings were changed to hold this line — "Buy more" on the Text Requests
screen and a "cancel your plan" instruction on the deletion screen — because
each told someone to take a step this app cannot offer.

---

## Testing tracks

| Track | Purpose | Build |
|---|---|---|
| Internal testing | Team, up to 100 testers, no review wait | `eas build -p android --profile preview` |
| Closed testing | Friendly businesses | Promote from internal |
| Production | Public | `eas build -p android --profile production` |

Google requires a period of closed testing with real testers before a new
personal developer account can publish to production. Check the current
requirement in the console; it has changed more than once and is not worth
quoting a number for here.

---

## Submission checklist

- [ ] Play Console app created for `fit.reviewboost.app` **[EXTERNAL]**
- [ ] Service account JSON at `credentials/google-play-service-account.json`, not in git
- [ ] `EXPO_PUBLIC_SUPABASE_ANON_KEY` set in EAS, not in git
- [ ] Listing icon uploaded: `store-assets/google-play/icon-512.png`
- [ ] Feature graphic produced (1024×500, no alpha)
- [ ] Phone screenshots captured on a real device
- [ ] Store listing text pasted from above
- [ ] Data safety form completed — every App activity and Diagnostics row "No"
- [ ] Account deletion URL entered: `https://reviewboost.fit/delete-account`
- [ ] Deletion verified end to end on a throwaway account, on device
- [ ] Content rating questionnaire completed
- [ ] Target audience set to 18+
- [ ] Ads declaration: no ads
- [ ] Privacy policy URL: `https://reviewboost.fit/privacy`
- [ ] `eas build -p android --profile production` succeeds
- [ ] `eas submit -p android --profile production` uploads the AAB
- [ ] Closed testing completed for the period Play currently requires
- [ ] Production release rolled out

---

*Build and credential mechanics: `docs/mobile/MOBILE_RELEASE.md`.
iOS equivalent: `docs/app-store/SUBMISSION.md`.*
