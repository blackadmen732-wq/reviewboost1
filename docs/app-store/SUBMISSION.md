# ReviewBoost — App Store Submission Package

Everything App Review needs. Fill in the blanks marked **TODO** before submitting.

---

## App Identity

| Field | Value |
|---|---|
| **App name** | ReviewBoost |
| **Subtitle** | Get more Google reviews |
| **Bundle identifier** | `fit.reviewboost.app` |
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
- Ratings and written feedback from customers, visible only to you
- Text Requests: send a review reminder to a phone number with one tap
- Multiple Tags and locations on paid plans
- Works as a web app on any device, installs to the home screen like a native app

TAGS AND NFC

Bring your own blank NFC tags (NTAG213 or NTAG215). Tap a tag to your iPhone
and the app programmes it with your review page URL in seconds. No extra
hardware required — QR codes work on every smartphone too.

PRIVACY

We never ask customers for their name, phone number, or email. Ratings are
anonymous. Customer feedback is encrypted at rest — only you can read it.

PLANS

Monthly plans unlock customer-facing Tags and SMS sending. Cancel any time;
your data stays until you delete it.

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
| **Support URL** | `https://reviewboost.app/support` — TODO: create redirect or page |
| **Marketing URL** | `https://reviewboost.app` |
| **Privacy policy URL** | `https://reviewboost.app/privacy` |

---

## App Review information

### Demo account

**TODO:** Create a real demo account on the production Supabase project and fill in credentials here. Never commit real credentials — store them in App Store Connect only.

| Field | Value |
|---|---|
| Email | TODO |
| Password | TODO |
| Notes | See "App Review notes" below |

### App Review notes

```
ReviewBoost is a native iOS app that provides a business dashboard and NFC Tag
programming. The customer-facing review flow runs in the browser — no customer
download is required.

TO TEST THE CORE FLOW
1. Sign in with the demo credentials above.
2. From the Tags screen, tap "See what customers see" on any Tag.
3. Tap any star — you will be sent to the configured Google review URL.
   (The demo account points to a real but publicly known Google My Business
   listing — this is intentional so reviewers can see the destination.)

TO TEST NFC (requires iPhone 7+ with iOS 14+)
1. On the Tags screen, tap the Tag you want to programme.
2. Tap "Programme NFC tag" and hold a blank NTAG213 or NTAG215 tag to the
   top of the device.
3. The tag will be programmed with the review URL. Tap it with any NFC-capable
   phone to verify.
   NFC tags are not required to use the app — this feature is opt-in.

TO TEST TEXT REQUESTS
1. From the Text Requests screen, enter a phone number you control and tap Send.
2. You will receive an SMS with a link to the review page.
   (The demo account has a small SMS credit balance for review purposes.)

BILLING
The demo account is on an active paid plan. No card is required during the
App Review session.

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

### Data linked to identity

| Data type | Collected | Use |
|---|---|---|
| Email address | Yes | Account, app functionality |
| Name | Yes (business name only) | App functionality |
| Phone number | Yes — uploaded by owner for Text Requests | App functionality |
| Payment info | No — handled by Stripe, not collected by us | — |
| User ID | Yes | App functionality, analytics |

### Data not linked to identity

| Data type | Collected | Use |
|---|---|---|
| Product interaction | Yes | Analytics |
| Crash data | No | — |

### Data not collected

Customer ratings are anonymous. No customer name, phone, or email is collected.

---

## Permissions

| Permission | Reason shown to user |
|---|---|
| NFC (`NFCReaderUsageDescription`) | "ReviewBoost uses NFC to programme your physical review tags." |

No other system permissions are requested. No camera, microphone, location, contacts, or notifications.

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

Please report any issues to help@reviewboost.app — we read every message.
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
help@reviewboost.app
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
- [ ] Privacy policy live at `https://reviewboost.app/privacy`
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
