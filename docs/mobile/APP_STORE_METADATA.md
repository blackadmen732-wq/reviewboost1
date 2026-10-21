# App Store metadata and App Review pack — ReviewBoost for iPhone

Everything to type into App Store Connect for the first iOS submission, drafted from the
code on PR #67. Read it together with `APPLE_APP_STORE_AUDIT.md`, which holds the evidence.

Nothing has been entered in App Store Connect and nothing has been submitted. Items marked
**NEEDS OWNER INPUT** are facts only you can supply. Character counts were checked with a
script on 2026-09-26, not estimated.

## 1. App information

| Field | Value | Limit / note |
|---|---|---|
| Name | **ReviewBoost** | 11 / 30 |
| Subtitle | **Ratings, Tags, review requests** | 30 / 30 |
| Bundle ID | `fit.reviewboost.app` | Must match the App ID. The App ID needs the *NFC Tag Reading* capability |
| SKU | `reviewboost-ios` | Internal only; any unique string |
| Primary language | English (U.S.) | |
| Primary category | **Business** | |
| Secondary category | **Productivity** | Optional |
| Content rights | Does not contain, show or access third-party content | The app shows only the business's own data. "Google" appears only as the name of the destination the owner chose |
| Price | Free | No in-app purchases |
| Availability | NEEDS OWNER INPUT | Start with the countries where you can support customers and where Text Requests are allowed. The EU also needs trader status (§8) |
| Copyright | `2026 <legal entity name>` | **NEEDS OWNER INPUT:** the legal entity that owns ReviewBoost. Apple wants the owner's name, not the app's |

### URLs

| Field | URL | State |
|---|---|---|
| Support URL (required) | https://reviewboost.fit/support | The page is in the repo (`frontend/app/support/page.tsx`). It could not be fetched from this sandbox. Open it once before submitting |
| Privacy Policy URL (required) | https://reviewboost.fit/privacy | The page is in the repo. The same link is in the app under Account → Privacy |
| Marketing URL (optional) | https://reviewboost.fit | Optional. Leaving it blank is also fine |
| Account deletion info (not an App Store field, useful in Review notes) | https://reviewboost.fit/delete-account | Public and reachable without signing in |

## 2. Store listing text

### Promotional text (170 max; can change without a new build)

> See every rating the moment it arrives, keep track of what your team did about it, and
> program your ReviewBoost Tags from your iPhone.

### Description (4000 max)

The draft deliberately says nothing about prices, plans, trials or where to buy. A free
companion app under Guideline 3.1.3(f) must not include "calls to action for purchase
outside of the app", and that includes its store listing.

```text
ReviewBoost is the companion app for businesses that use ReviewBoost to collect customer ratings.

Your customers tap a ReviewBoost Tag or scan its QR code, rate their visit on a simple page in their own phone's browser, and are then offered your public review page. Every customer is offered the same page, whatever they chose. ReviewBoost keeps the rating for you, privately. This app is where you keep up with it.

LIVE FEED
See ratings arrive as they happen, from every Tag.

FEEDBACK
Read each rating as it comes in, with the Tag it came from. Unread feedback stands out.

TAGS
Program the NFC chip in a ReviewBoost Tag straight from your iPhone. ReviewBoost reads the chip before writing, never replaces something already on it without asking you first, and reads it back afterwards to confirm the write. You can also preview exactly what a customer sees, or share a Tag's link.

TEXTS
See the review requests your business has sent by text message, where each one got to, and how many messages you have left.

ACCOUNT
Your plan's status, the privacy policy, terms, support, sign out and account deletion, all in one place.

WHAT YOU NEED
A ReviewBoost account. Sign in with the email address on your account: ReviewBoost emails you a six-digit code, so there is no password to remember. Programming a Tag uses your iPhone's NFC.

HONEST BY DESIGN
ReviewBoost never writes, filters or hides reviews, and never sends unhappy customers somewhere different. It cannot see whether a customer goes on to post a review, and it does not pretend to.
```

### Keywords (100 max, comma-separated, no spaces after commas)

```text
ratings,feedback,customer feedback,nfc,nfc tag,qr code,review request,small business,local business
```

- No competitor names and no "Google" (Guideline 2.3.7 and trademark).
- Words already in the name ("ReviewBoost") or the subtitle are not repeated, because Apple
  indexes those anyway.
- Every term describes something the app does.

### What's New (version 1.0.0)

Not shown for a first version. Keep one line for later: "First release of ReviewBoost for
iPhone."

## 3. Age rating (2026 questionnaire)

Answered against Apple's current categories. Source: *Age ratings values and definitions*,
App Store Connect Help, read 2026-09-26.

| Section | Question | Answer | Why |
|---|---|---|---|
| In-app controls | Parental controls | **No** | None |
| In-app controls | Age assurance | **No** | None |
| Capabilities | Unrestricted web access | **No** | No in-app browser or WebView. Privacy, Terms, Support and "Open customer page" open fixed ReviewBoost URLs in Safari, outside the app (`Linking.openURL`) |
| Capabilities | User-generated content | **No** | Apple defines this as "broad distribution of content created by users". Customers give a star rating and nothing else; there is no box for them to write in. The only free text is a private note a business's own team adds to a rating, seen only by that team. Nothing is published, shared between businesses or discoverable. See the note below the table |
| Capabilities | Social media | **No** | No feed of other people's content, no likes, no shares |
| Capabilities | Messaging and chat | **No** | Users of the app cannot message each other. The Texts tab only shows the status of texts sent from the web app. There is no composer in the app |
| Capabilities | Advertising | **No** | No ads, no ad SDK |
| Mature themes | Profanity / crude humour; horror / fear; alcohol, tobacco or drugs | **None** | The app's own content has none. Team notes are private free text (see the note) |
| Medical or wellness | Medical or treatment information; health or wellness topics | **None** | |
| Sexuality or nudity | All three | **None** | |
| Violence | All four | **None** | |
| Chance-based activities | Gambling; simulated gambling; contests; loot boxes | **None** | |
| Age categories and override | | **Not Applicable** | Not made for kids. The Terms set no minimum age that would force an override. The privacy policy says the service is not directed at children under 13 |

**Expected result: 4+.**

On user-generated content: if App Review reads a team's private notes as user-generated
content, answering **Yes** still gives **4+** (Apple lists user-generated content under 4+).
The rating does not depend on this judgement. The honest answer is still No, because
Apple's definition is about broad distribution. Review Guideline 1.2's duties to filter,
report and block apply to social apps whose users can see each other's content, and that
does not happen here.

## 4. App Privacy (the "nutrition label")

Enter exactly what `APPLE_APP_STORE_AUDIT.md` §5 lists. Summary:

- Data collected: **Yes**.
- **Contact Info → Email Address:** linked to the user · not used for tracking · *App
  Functionality*.
- **Identifiers → User ID:** linked · not tracking · *App Functionality*.
- Everything else: **Not collected**. That includes phone numbers, customer content,
  purchases, location, diagnostics and usage data. The audit gives the evidence for each.
- Tracking: **No**. There is therefore no App Tracking Transparency prompt.

These answers match the privacy manifest in `app.json` (`NSPrivacyCollectedDataTypes`). If a
crash reporter or analytics SDK is ever added, the label, the manifest and the privacy
policy must all change together.

## 5. Export compliance

- `ITSAppUsesNonExemptEncryption` = **NO** is in the build's Info.plist, so App Store
  Connect will not ask on each upload.
- Why this is true: the app's only encryption is the operating system's (HTTPS through
  NSURLSession, and Keychain Services). `aes-js` was removed in this PR (audit §8).
- If App Store Connect ever asks anyway: *Does your app use encryption?* **Yes.** *Does it
  qualify for any exemptions?* **Yes:** it uses only encryption within Apple's operating
  system. No documentation upload is needed.
- Re-check this before every release that adds a dependency.

## 6. App Review information

### Contact

| Field | Value |
|---|---|
| First and last name | **NEEDS OWNER INPUT** |
| Phone | **NEEDS OWNER INPUT** (someone who answers during review) |
| Email | **NEEDS OWNER INPUT** (for example help@reviewboost.fit, if it is monitored) |

### Sign-in required: Yes

| Field | Value |
|---|---|
| User name | the value of `REVIEW_SIGN_IN_EMAIL` |
| Password | the value of `REVIEW_SIGN_IN_CODE` (six digits). This is typed where the emailed code normally goes |

These two values live only in Vercel's production environment. They are never in the app
binary or in the repository. The route answers 404 unless both are set
(`frontend/lib/server/review-sign-in.ts`).

### Before submitting: set up the reviewer account

Do this only after the production migration is live. The app's routes need it (audit
§1, Blocker 1).

1. Pick an address you control that is used for nothing else, for example
   `app-review@reviewboost.fit`. Pick a random six-digit code. Do not use a pattern
   like 123456.
2. Set `REVIEW_SIGN_IN_EMAIL` and `REVIEW_SIGN_IN_CODE` in Vercel → Production and redeploy.
3. Sign in once on the web with that address (normal emailed code). Create a demo business
   with **fictional data only**:
   - Business: "Harbor Street Coffee (Demo)". Location: "Main counter".
   - One Tag, "Front counter", printed or not.
   - Review destination: ReviewBoost's own Google review link, if it has a Business Profile.
     Never a third party's listing. **NEEDS OWNER INPUT.**
   - Text Requests: leave sending off for this business. No real phone numbers.
   - Entitlement: **NEEDS OWNER DECISION.** New businesses start `suspended` until
     checkout, and a suspended business's customer page does not load. Pick one, and test it
     on staging first:
     (a) a service-role `entitlement_snapshots` row with `status = 'trialing'`, a
     `trial_ends_at` that covers the review window, and `source` naming it as the App
     Review demo; or
     (b) a real checkout on a 100%-off coupon.
     Do not record a paid subscription that was not paid for.
4. Create some feedback the honest way: open the demo Tag's customer page on a phone and
   rate it about five times with a mix of stars. Customers only pick stars; there is
   nothing for them to type.
5. Create a **second, non-owner account** for the deletion check: invite a fictional team
   member to the demo business, sign in as them once, and keep its email and emailed code
   handy. App Review may ask to see that a team member can delete their own account.
6. On a TestFlight build, sign in with the email and code and confirm every tab loads.
7. After the review, rotate the code, or unset both variables if no review is pending.

### Attachments

Upload a photo or short screen recording showing a ReviewBoost Tag being programmed on an
iPhone. Also attach a PNG of the demo Tag's QR code, so the reviewer can scan it with a
second device, or with the Camera app, to see the customer page without any NFC hardware.

### Notes (paste into "Notes"; 4000 max)

```text
WHO THIS APP IS FOR
ReviewBoost is a free companion app for businesses that already use ReviewBoost. Customers never install it: they tap a ReviewBoost Tag (an NFC tag with a printed QR code) at the business, give a star rating in their phone's browser, and are offered the business's public review page. This app lets the business owner keep up with those ratings and program the Tags.

SIGNING IN
Sign-in normally uses a six-digit code sent by email. Enter the demo email on the first screen, tap Continue, then type the demo code from the Sign-In Information section where the emailed code would go. That signs in to a demo business with fictional data only. If an organization list appears, choose "Harbor Street Coffee (Demo)".

WHAT TO LOOK AT
- Feed: ratings as they arrive.
- Feedback: each rating, with the Tag it came from. Tap a row for detail.
- Texts: the status of review requests sent by text from the ReviewBoost web app, and the message balance. The app itself sends no messages.
- Tags: open "Front counter". "Open customer page" shows exactly what a customer sees. "Share Link" shares it.
- Account: plan status, Privacy, Terms, Support, Sign out, Delete account.

NFC
"Program NFC" (Tags > Front counter) writes the Tag's web link to a standard NDEF tag using Core NFC. Any blank, unlocked NDEF tag works (NTAG213/215/216). The app reads the tag first, asks before replacing anything already on it, writes, then reads it back to confirm. Without a tag you can still see the system NFC sheet and cancel it. The attached QR code opens the same customer page the tag would.

TEXT REQUESTS
A Text Request is a single text message a business sends to one customer, asking them to rate their visit. Each request has one recipient and is scheduled from the web app; there is no bulk or broadcast sending. A text is blocked unless consent for that number is recorded. Recipients can reply STOP, after which ReviewBoost will not text that number again, for any business, unless the recipient replies START. The customer is not anonymous to the business that texted them. The demo business has sending turned off.

PAYMENTS
The app sells nothing and has no purchase, upgrade or subscribe buttons and no links to buy. Subscriptions are set up and managed by businesses outside the app. The app only shows the current plan's status and message balance, under Guideline 3.1.3(f).

RATINGS AND REVIEWS
Every rating, one star or five, is offered the same review destination. ReviewBoost does not filter or hide reviews, and cannot know whether a customer goes on to post one.

ACCOUNT DELETION
Account > Delete account works for every account type. An owner deletes the business, its Tags and all its ratings after typing the business name; the subscription is cancelled first, and the login goes too if it was their last business. A team member, or someone who never created a business, deletes their own login after typing "delete"; the business they worked for is untouched. The only owner of a business is asked to delete that business first, so no business is left without an owner. The public page https://reviewboost.fit/delete-account explains the same thing.

PRIVACY
No tracking, no ads, no analytics SDKs. The only data the app collects is the user's email address and account ID, for sign-in.
```

> Before pasting, check that the account-deletion paragraph is still true for the build
> being submitted. Personal (non-owner) deletion was added for launch gap L1; confirm it on
> TestFlight with the second demo account from step 5 before submitting.

## 7. Screenshots

Requirement (App Store Connect Help, *Screenshot specifications*, read 2026-09-26):
iPhone **6.9"** portrait at **1320 × 2868**, **1290 × 2796** or **1260 × 2736**, JPEG or PNG,
**no alpha**, 1–10 images. Smaller iPhones are scaled from these. iPad screenshots are not
needed because the build is iPhone-only.

Capture them from a **TestFlight build on a real iPhone 17 Pro Max, 16 Pro Max or iPhone
Air**, signed in to the demo business. Web renders are not evidence of the iOS app and must
not be used. Guideline 2.3.3 requires screenshots that show the app in use.

| # | Screen | State to capture | Optional caption |
|---|---|---|---|
| 1 | Feed | Several fresh ratings, mixed stars | See every rating as it arrives |
| 2 | Feedback list | Unread and read rows, mixed stars | Every rating, from every Tag |
| 3 | Feedback detail | One rating with its Tag and time | See where each rating came from |
| 4 | Tag detail | "Front counter" with Program NFC visible | Program Tags from your iPhone |
| 5 | NFC sheet | The "Ready to write" sheet over the Tag | Checked before, verified after |
| 6 | Texts | Balance card and a few statuses. Use a staging business with fictional numbers if the demo business has none | Follow your review requests |
| 7 | Account | Plan status and the Privacy / Terms / Support rows | |

Rules for the captures:

- The real status bar. No mock-ups, no device frames that hide the UI, no invented
  numbers.
- No real customer data and no real phone numbers.
- No prices, no "free trial", no "subscribe" in captions (Guideline 3.1.3(f)).
- If you use captions, keep them to the short lines above, in the app's own font and
  colours.

## 8. EU Digital Services Act trader status

Required before the app can be distributed in the EU (App Store Connect → Business →
compliance). ReviewBoost is sold to businesses, so it is a **trader**. Apple will show the
trader's address, phone and email on the EU App Store page. **NEEDS OWNER INPUT:** legal
name, address, phone and email to publish. Until this is done, leave EU storefronts out of
availability.

## 9. NFC real-device test matrix

Run on a TestFlight build on at least one small iPhone (SE 3rd gen or 13 mini) and one large
one. Use NTAG213/215/216 stickers. Record pass/fail, the iOS version and the device model.

| # | Case | Setup | Expected |
|---|---|---|---|
| N1 | Blank tag | New NTAG, never written | "Program your Tag" → "Hold near your Tag" → "Writing Tag…" → "Tag ready"; read back; server confirms (the Tags list shows "NFC tag written") |
| N2 | Already this Tag | The tag from N1 | "Tag ready" with nothing written; server confirmation still recorded |
| N3 | Another ReviewBoost Tag's link | Tag programmed for a different Tag | "This Tag already has something on it", describing it; nothing written until Replace |
| N4 | Foreign content | Tag holding any other URL or text | Conflict screen; Replace writes only to *that* chip |
| N5 | Replace, different chip | After N4's Replace, present a different tag | Read and reported, not written |
| N6 | Locked / read-only | A tag made read-only | "This Tag can’t be programmed" and "Nothing on the Tag was changed"; nothing claims success |
| N7 | Pulled away mid-write | Remove the tag during the write | Failure copy; retry works; no false success |
| N8 | Timeout | Open the sheet, present nothing until iOS ends the session | "No Tag found" with Try again; nothing changed |
| N9 | Cancel | Tap Cancel on the system sheet | Back to Ready, not an error |
| N10 | Read-back mismatch | Hard to force. Covered by `nfc-program.test.ts` | Failure, never success |
| N11 | Server confirmation fails | Airplane mode after the write completes | "Your Tag works" (partial): the chip is correct; retry records it without touching the chip |
| N12 | Second phone | Tap the programmed tag with a different iPhone and an Android phone, apps closed | The customer page opens in the browser; the rating is recorded; the rating appears in Feed |
| N13 | NFC unavailable | The Simulator, or a device without NFC writing | "This phone cannot program Tags"; the QR code still works |
| N14 | Not an owner or admin | Sign in as a viewer | The Program section is replaced by "Only owners and admins can program Tags" |
| N15 | VoiceOver | Run N1 with VoiceOver on | Each state is announced; the sheet can be dismissed |

## 10. TestFlight plan

1. `eas init` (links the EAS project and commits `projectId`), then
   `eas build -p ios --profile production`. Confirm the build log shows **Xcode 26.6**.
2. `eas submit -p ios` to TestFlight **only** when you decide to. Internal testers need no
   Beta App Review.
3. Devices: one small iPhone (SE 3rd gen or 13 mini, 375 pt wide), one standard (iPhone 15
   or 16, 393 pt), one large (Pro Max or Air, 430–440 pt), on the newest iOS 26 release and
   on the oldest supported (iOS 16.4 or later), if a device exists.
4. On each device:
   - First launch: no white flash. The launch canvas matches the app background.
   - Sign in with an emailed code on a real account, and with the reviewer code.
   - Every tab, pull to refresh, feedback detail, the Tag screen.
   - The NFC matrix (§9).
   - Privacy / Terms / Support open in Safari.
   - Sign out, then sign in again.
   - Delete account on a throwaway business.
   - Delete the app, reinstall, and confirm you are signed out.
   - Larger Text at the largest accessibility size; Bold Text; VoiceOver pass on every tab;
     Reduce Motion with the NFC sheet.
5. **IPv6:** share a Mac's connection over Wi-Fi with *Create NAT64 Network* on (System
   Settings → General → Sharing → Internet Sharing, holding Option). Join it from the iPhone
   and repeat sign-in, Feed, Feedback and Tag load. This is the test Apple's reviewers
   effectively run.
6. **Inspect the archive:**
   - In Xcode Organizer, run *Generate Privacy Report* and confirm it matches audit §10.
   - Unzip the `.ipa` and run `plutil -p Info.plist`. Confirm there is no
     `NSFaceIDUsageDescription`, no `NSLocalNetworkUsageDescription` and no
     `NSBonjourServices`, and that `ITSAppUsesNonExemptEncryption` is false.
   - Confirm that `strings main.jsbundle` finds no server secrets (repeat audit §S4 on the
     real artifact).

## 11. Accessibility Nutrition Labels

These are optional, per feature, and claim that a user can complete the app's *common
tasks* with the feature on. **Claim nothing until the device pass in §10 step 4 has been
done.** Then:

| Feature | Candidate? | Evidence needed |
|---|---|---|
| VoiceOver | Yes, after test | Every tab, feedback detail and NFC programming completed with VoiceOver only |
| Voice Control | Yes, after test | Every button reachable by name |
| Larger Text | Yes, after test | Largest accessibility size: nothing clipped or overlapping |
| Sufficient Contrast | Yes, after test | Code now meets 4.5:1 for text (audit D8); confirm on device |
| Reduced Motion | Yes, after test | The NFC sheet animations stop (the code honours it) |
| Differentiate Without Color Alone | Yes, after test | Stars carry numbers in labels; status uses words, not colour alone |
| Dark Interface | **No** | Light-only V1 (audit §9) |
| Captions / Audio Descriptions | Not applicable | No audio or video |

## 12. Pre-submission checklist

- [ ] Production migration applied and verified (audit Blocker 1).
- [ ] Account deletion for every account type (audit Blocker 2 / §6): built for launch gap
      L1 (owner, team member, no business); still to confirm on TestFlight.
- [ ] `eas init` committed; App ID has NFC Tag Reading; production build on Xcode 26.6.
- [ ] Reviewer env vars set; demo business ready (§6); sign-in tested on TestFlight.
- [ ] §9 NFC matrix and §10 device pass recorded.
- [ ] Privacy report and `.ipa` Info.plist checked (§10 step 6).
- [ ] `https://reviewboost.fit/privacy`, `/terms`, `/support` and `/delete-account` open
      on a phone.
- [ ] App Privacy (§4), age rating (§3) and DSA trader status (§8) entered.
- [ ] Screenshots captured from TestFlight (§7).
- [ ] Owner inputs filled: copyright entity, review contact, demo review destination,
      entitlement choice.
- [ ] You have read this pack and decided to submit. No Apple submission was made while
      preparing it.
