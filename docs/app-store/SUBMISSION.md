# ReviewBoost — App Store Submission Package

Everything App Review needs. Fill in the blanks marked **TODO** before submitting.

---

## App Identity

| Field | Value |
|---|---|
| **App name** | ReviewBoost |
| **Subtitle** | Get more Google reviews |
| **Bundle identifier** | `fit.reviewboost.app` (must match `ios.bundleIdentifier` in `apps/mobile/app.json`; create the App Store Connect record with exactly this ID) |
| **SKU** | `reviewboost-ios-v1` |
| **Primary language** | English (U.S.) |
| **Category** | Business |
| **Secondary category** | Productivity |

---

## App Store description

**Promotional text** (170 chars, shown above description, can be updated without resubmit):

> Turn happy customers into Google reviews — instantly, with a tap. No app download required for them.

**Description** (4000 chars max):

```
ReviewBoost gives small businesses a simple way to collect more Google reviews
from real customers — without asking anyone to download an app, create an
account, or do anything complicated.

HOW IT WORKS

Print a QR code or tap an NFC tag. A customer scans it, taps a star, and gets
taken straight to your Google review page. That's the whole flow for them.
No sign-up. No form. No friction.

FOR THE BUSINESS

- One dashboard to see every rating as it comes in
- Every rating as it arrives, visible only to you
- Text Requests: send a review reminder to a phone number with one tap
- Multiple Tags and locations on paid plans
- Works as a web app on any device, installs to the home screen like a native app

TAGS AND NFC

Bring your own blank NFC tags (NTAG213 or NTAG215). Tap a tag to your iPhone
and the app programmes it with your review page URL in seconds. No extra
hardware required — QR codes work on every smartphone too.

PRIVACY

We never ask customers for their name, phone number, or email. A rating is
one tap and nothing else — there is no message box, so there is nothing to
attribute to anyone. Notes your own team writes on a rating are encrypted at
rest; only your business can read them.

PLANS

$49, $79 or $129 a month depending on how many locations and Tags you need.
Starter comes with a seven-day free trial: a card is required to start it and
nothing is charged until it ends. Growth and Pro are charged when you subscribe. Subscriptions are managed on the web at
reviewboost.fit — this app shows your plan and what is left of it.

---
Requires an internet connection for setup and to receive ratings in real time.
NFC Tag programming requires an iPhone 7 or later running iOS 14 or later.
QR codes work on any smartphone.
```

---

## Keywords

(100 chars max, comma-separated)

```
google reviews,review booster,NFC review,qr review,small business,customer reviews,reputation
```

---

## Support and legal URLs

| Field | Value |
|---|---|
| **Support URL** | `https://reviewboost.fit/support` — live (`frontend/app/support/page.tsx`) |
| **Marketing URL** | `https://reviewboost.fit` |
| **Privacy policy URL** | `https://reviewboost.fit/privacy` — live |
| **Account deletion URL** | `https://reviewboost.fit/delete-account` — live, and reachable signed out |

---

## App Review information

### Demo account

**TODO:** Create a real demo account on the production Supabase project and fill in credentials here. Never commit real credentials — store them in App Store Connect only.

| Field | Value |
|---|---|
| User name | The value of `REVIEW_SIGN_IN_EMAIL` |
| Password | The value of `REVIEW_SIGN_IN_CODE` (six digits). The app has no passwords: the reviewer types this where the emailed code normally goes |
| Notes | See "App Review notes" below. `docs/mobile/APP_STORE_METADATA.md` has the full setup and the notes to paste |

### App Review notes

```
ReviewBoost is a native iOS app that provides a business dashboard and NFC Tag
programming. The customer-facing review flow runs in the browser — no customer
download is required.

TO TEST THE CORE FLOW
1. Sign in with the demo credentials above.
2. Open any Tag from the Tags tab, then tap "Open customer page".
3. Tap any star — you will be sent to the configured Google review URL.
   (The demo account points to a real but publicly known Google My Business
   listing — this is intentional so reviewers can see the destination.)

TO TEST NFC (requires iPhone 7+ with iOS 14+)
1. On the Tags tab, tap the Tag you want to program.
2. Tap "Program NFC" and hold a blank NTAG213 or NTAG215 tag to the top of
   the device when the screen says "Hold near your Tag".
3. A green check and "Tag ready" means the tag carries the review URL. Tap it with
   any NFC-capable phone to verify.
   NFC tags are not required to use the app — this feature is opt-in, and the
   app is fully usable with printed QR codes alone.

TEXT REQUESTS
The Text Requests tab shows texts left and recent requests. Requests are
scheduled from the web app, not this one, and the demo business has sending
turned off, so no text is sent during review.

BILLING
Nothing is bought in this app. The demo business's plan is set up for the
review period on the web; no card is needed during the App Review session.

BACKGROUND OPERATION
The app does not run in the background and does not use background app refresh,
background fetch, or push notifications.
```

---

## Age rating

**4+** — No objectionable content. No user-generated content visible to other users. No gambling, violence, or adult material.

**Age rating questionnaire answers:**

| Question | Answer |
|---|---|
| Cartoon or fantasy violence | None |
| Realistic violence | None |
| Sexual content or nudity | None |
| Profanity or crude humor | None |
| Mature or suggestive themes | None |
| Simulated gambling | None |
| Horror or fear themes | None |
| Prolonged graphic or sadistic content | None |
| Medical or treatment information | No |
| Unrestricted web access | No |

---

## Privacy details (App Store data collection)

These are a legal declaration, not marketing, so each row below is what the
code does. The previous version declared "Product interaction — Analytics" and
"User ID — analytics"; there is no analytics SDK in this app or on the web —
not Firebase, Sentry, Amplitude, Segment, PostHog or Mixpanel — so both were
untrue. Declaring collection that does not happen is still a false label, and
it is the kind App Review checks by looking at the binary.

### Data linked to identity

| Data type | Collected | Use |
|---|---|---|
| Email address | Yes | Account, app functionality |
| Name | Yes (business name only) | App functionality |
| Phone number | Yes — uploaded by the owner for Text Requests | App functionality |
| Payment info | No — Stripe handles cards; we never see a card number | — |
| User ID | Yes | App functionality only. Not used for analytics or tracking. |

### Data not linked to identity

| Data type | Collected | Use |
|---|---|---|
| Product interaction | No | — |
| Crash data | No | — |
| Diagnostics | No | — |

### Tracking

None. No data is used to track across apps or websites, there is no advertising
identifier, and `NSUserTrackingUsageDescription` is deliberately absent — an ATT
prompt for an app that tracks nothing is its own kind of dishonesty.

### Data not collected

Customer ratings are anonymous. No customer name, phone, or email is collected
at any point in the customer flow.

---

## Account deletion (Guideline 5.1.1(v))

Required for any app that lets someone create an account, and checked by App
Review rather than taken on trust.

**Where it is:** Account tab → Delete account. Nothing is hidden behind a
support email, and it is reachable in three taps from launch.

**What it does:** asks the owner to type their business name, then deletes the
organization and everything in it — Tags, ratings, phone numbers, team
memberships — and cancels the Stripe subscription first. The sign-in itself is
removed too, unless the person owns another business on ReviewBoost. It is
immediate: no queue, no waiting period, no approval step.

**What survives, and why:** invoices already issued, because both parties are
required to keep records of money that has moved. This is stated on the public
page rather than implying Stripe forgets too.

**Public URL, for the listing field:** `https://reviewboost.fit/delete-account`
— reachable without signing in, which matters because the person who most needs
it is often the person who has already lost access.

**For the reviewer:** the demo account can be used to walk up to the
confirmation step safely. Typing anything other than the exact business name
leaves the button disabled and the account untouched.

---

## Payments and Guideline 3.1

ReviewBoost is a business service billed on the web through Stripe. The iOS app
contains **no purchase mechanism and no link to one** — no in-app purchase, no
checkout, no "upgrade" button, and no external URL that leads to a payment
page. The Account tab reads the current plan and the remaining message
allowance; it does not sell anything.

This is the posture 3.1.3(b) requires of an app whose subscription is acquired
elsewhere: showing what someone already bought is permitted, directing them to
buy is not. Two strings were changed to hold that line — "Buy more" on the Text
Requests screen and a "cancel your plan" instruction on the deletion screen
both told someone to do something this app cannot do, and each now states the
fact without pointing anywhere.

If App Review asks for IAP, the argument is that this is a multiplatform
business service whose value is the physical Tags and the web dashboard, not
digital content consumed in the app. Have that conversation before adding a
purchase button, not after.

---

## Permissions

| Permission | Reason shown to user |
|---|---|
| NFC (`NFCReaderUsageDescription`) | "ReviewBoost uses NFC to programme your physical review tags." |

No other system permissions are requested. No camera, microphone, location, contacts, or notifications.

---

## App icon

App Store Connect has no icon upload: the App Store icon is read from the
submitted build. The build's icon is `apps/mobile/assets/icon.png`
(`"icon"` in `app.json`), which Expo prebuild copies unchanged into
`ios/ReviewBoost/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png`.

| Check | Result |
|---|---|
| Size | 1024 × 1024 |
| Alpha | None (RGB PNG) |
| Corners | Square; iOS applies the mask |
| Generated from | `Branding/Mark.svg` by `scripts/brand/generate-brand-assets.mjs` |
| Verified in prebuild output | `docs/mobile/icon-previews/store-assets-qa.png` (`scripts/brand/render-store-qa.py`) |
| Reference copy (review notes, press) | `store-assets/app-store/app-icon-1024.png`, pixel-identical to the build icon |

To change the icon, change `Branding/Mark.svg`, rerun the generator, and ship
a new build. Replacing a PNG by hand is caught by
`frontend/tests/unit/brand-assets.test.ts`.

---

## Screenshots checklist

All screenshots must be taken on a real device or Simulator, not mocked.
Required sizes (App Store Connect will scale):

- [ ] iPhone 6.9" (iPhone 16 Pro Max) — 6 screenshots minimum
- [ ] iPhone 6.5" (iPhone 14 Plus / 13 Pro Max) — can reuse 6.9" art
- [ ] iPad 13" (optional but recommended for visibility)

**Shots to capture:**

1. Home screen — ratings card and "To read" stat, business name in header
2. Feedback list — real or realistic feedback entries
3. Tags screen — showing at least one Tag with QR preview
4. Text Requests — compose screen or recent sends list
5. Customer flow — star-tap screen (customer side, `/q/[token]`)
6. NFC programming sheet (if device available)

**App Preview video** (optional but increases conversion): 15–30 seconds, no
voiceover required. Show: scan → star tap → Google page.

---

## TestFlight

### What to tell beta testers

```
Thanks for testing ReviewBoost!

You're helping us make sure everything works before we launch.

What to try:
- Set up a Tag and scan your own QR code
- Leave a star rating and see where it sends you
- Try the Text Requests screen
- If you have a blank NFC tag, try programming it from the Tags screen

Known limitations in this build:
- SMS sending requires a real Twilio account — the demo account has limited credits
- Billing flows through Stripe test mode; no real charges will occur

Please report any issues to help@reviewboost.fit — we read every message.
```

### TestFlight groups

| Group | Purpose |
|---|---|
| Internal | Team, always gets latest build |
| External — trusted | ~10 friendly businesses, full beta |
| External — open | Link shared publicly when ready |

---

## Release notes (first public version)

```
Welcome to ReviewBoost.

Tap, scan, or text — your customers leave a review on Google in seconds.
No download required for them.

This is our first App Store release. We'd love your feedback:
help@reviewboost.fit
```

---

## Submission checklist

- [ ] EAS project linked (`eas init` run, `app.json` has `extra.eas.projectId`)
- [ ] `EXPO_PUBLIC_SUPABASE_ANON_KEY` set in EAS environment (not in git)
- [ ] Production Supabase project URL set in `eas.json` profiles
- [ ] Stripe live keys set in Vercel environment (not in git)
- [ ] Twilio credentials set in Vercel environment (not in git)
- [ ] `.p8` APNs key uploaded to App Store Connect (not in git)
- [ ] Demo account created in production Supabase
- [ ] Screenshots captured and uploaded
- [ ] App Store Connect record uses bundle ID `fit.reviewboost.app`
- [ ] Build's App Store icon checked on the TestFlight build's product page (source: `apps/mobile/assets/icon.png`)
- [ ] Privacy policy live at `https://reviewboost.fit/privacy`
- [ ] Account deletion URL live at `https://reviewboost.fit/delete-account`
- [ ] Deletion verified end to end on a throwaway account, on device
- [ ] Privacy labels match the tables above — no analytics declared
- [ ] Support URL live
- [ ] App Review notes filled in above with real demo credentials
- [ ] Age rating questionnaire completed in App Store Connect
- [ ] Privacy nutrition labels filled in App Store Connect
- [ ] `eas build --platform ios --profile production` succeeds
- [ ] Build uploaded via `eas submit --platform ios` or Transporter
- [ ] TestFlight internal test passed
- [ ] TestFlight external test passed (at least one week)
- [ ] App Store listing reviewed for typos
- [ ] Submit for review

---

*See also: `docs/mobile/MOBILE_RELEASE.md` for the full build and deploy runbook.*
