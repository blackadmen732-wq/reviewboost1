# Apple App Store readiness audit — ReviewBoost iOS

Audited 2026-09-26 on PR #67 (`cursor/sprint-forge-owner-systems-v15-7042`), `apps/mobile`
at Expo SDK 57.0.14 / React Native 0.86.2, plus the web API the app calls.

Nothing here has been submitted to Apple. Nothing here guarantees approval: App Review
is a human judgement, and this document only removes the reasons we can find in advance.

## How this was checked

| Evidence | What it covers |
|---|---|
| Source read of every screen, hook and config file in `apps/mobile` | Behaviour, copy, network calls, storage |
| `npx expo prebuild --platform ios --no-install --clean` (Expo CLI, SDK 57) | The generated `Info.plist`, entitlements, asset catalog, launch storyboard, deployment target, device family |
| Scan of every `PrivacyInfo.xcprivacy` and every iOS native source in `node_modules` | Required-reason API use and what each SDK declares |
| `npx expo export --clear --platform ios` with the production env, then a byte search of the Hermes bundle | What JavaScript actually ships: no secrets, no cipher libraries, no tracking symbols |
| Apple's documentation read on 2026-09-26 (JSON feed of developer.apple.com) | Current guideline text, reason codes, export-compliance rules, upload requirements |
| Expo docs source (`expo/expo` repo, `docs/pages`, modified 2026-07-09) | Which Xcode the EAS `sdk-57` image runs; Expo's privacy-manifest guidance |

**What this environment cannot do**, and so what stays open until it is done elsewhere:
build or archive with Xcode, run Xcode's privacy report, run the iOS Simulator, install on
an iPhone, program a physical NFC Tag, sign in to App Store Connect or the Apple Developer
portal, or reach `reviewboost.fit` (blocked by this sandbox's network policy). Every row that
depends on one of those says so rather than guessing.

### Apple sources used

- App Review Guidelines — https://developer.apple.com/app-store/review/guidelines/
- Upcoming requirements — https://developer.apple.com/news/upcoming-requirements/
  (Xcode 26 + iOS 26 SDK for uploads since 2026-04-28; minimum target iOS 13 since
  2026-09-09; new age-rating questions since 2026-01-31; required-reason APIs since 2024-05-01)
- Describing use of required reason API —
  https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api
- `NSPrivacyAccessedAPIType` reason codes —
  https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype
- Complying with encryption export regulations —
  https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations
- Export compliance documentation for encryption —
  https://developer.apple.com/help/app-store-connect/reference/app-information/export-compliance-documentation-for-encryption
- Expo build images — https://docs.expo.dev/build-reference/infrastructure/
- Expo privacy manifests — https://docs.expo.dev/guides/apple-privacy/

Status legend: **PASS** · **NEEDS FIX** · **NEEDS REAL-DEVICE TEST** ·
**NEEDS APP STORE CONNECT SETUP** · **NOT APPLICABLE**. The "Before" column is what the
audit found on the branch as it stood; "Now" is after the fixes in this PR (see §11).

## 1. Blockers, in order

1. **The production backend cannot serve this app yet.** Every tab calls
   `reviewboost.fit/api/v1/*` routes (billing, text-requests, review-stands, nfc-provision,
   account/deletion) that depend on the September migrations production does not have
   (`docs/backend/PRODUCTION_MIGRATION_PLAN.md`). Guideline 2.1(a) requires the back end
   to be on during review. This is gated on the production-migration decisions, not on
   iOS work.
2. **Account deletion only works for business owners.** A team member (admin, member,
   viewer), or anyone who signed up with an email code and never joined a business, has an
   account and no way to delete it in the app. Guideline 5.1.1(v). Fixing it needs a data
   decision first (§6).
3. **App Review has no way in.** Sign-in is an emailed code; a reviewer cannot receive it.
   Guideline 2.1(a) requires working demo access (§7).
4. The code-level gaps in §2 marked NEEDS FIX — all addressed in this PR except those
   above.

## 2. Compliance matrix

### Safety (Guideline 1)

| # | Rule | Source | Finding | Before | Now |
|---|---|---|---|---|---|
| S1 | Objectionable content | 1.1 | A business tool. No public content, no feeds of strangers. | NOT APPLICABLE | NOT APPLICABLE |
| S2 | User-generated content | 1.2 | Customer notes are private feedback shown only to that business's members; nothing is published or shared between users, so 1.2's filtering/reporting/blocking duties for social content do not apply. | NOT APPLICABLE | NOT APPLICABLE |
| S3 | Developer contact in the app | 1.5 | No Support link anywhere in the app. | NEEDS FIX | PASS — Account → Support |
| S4 | Data security | 1.6 | ATS on (`NSAllowsArbitraryLoads = false`), HTTPS-only API and Supabase hosts, session kept in the iOS Keychain, every table behind RLS. Only `EXPO_PUBLIC_*` values are bundled; `scripts/check-no-service-secret.js` rejects a privileged JWT. Production iOS Hermes bundle exported (`expo export --clear --platform ios` with the `eas.json` production env) and searched as UTF-8 and UTF-16: no `service_role`, `sk_`/`rk_`/`whsec_`, `REVIEW_SIGN_IN*`, `TOKEN_DIGEST_KEY`, Stripe/Twilio secret names, private keys, JWT-shaped strings, `aes-js`/`node-forge`/`crypto-js`/`tweetnacl`, or IDFA/ATT symbols. The reviewer fallback path is present, which shows the scan read the current code. The signed `.ipa` has not been inspected. | PASS (source) | PASS (source + exported bundle) · NEEDS REAL-DEVICE TEST (inspect the TestFlight `.ipa`) |

### Performance (Guideline 2)

| # | Rule | Source | Finding | Before | Now |
|---|---|---|---|---|---|
| P1 | Final build, backend live | 2.1(a) | Production lacks the migrations the app's routes need (Blocker 1). | NEEDS FIX (backend) | BLOCKED on production migration |
| P2 | Demo account for a login app | 2.1(a) | Email-code sign-in only; no reviewer path. A throttled code email (429) also left the screen stuck on the email step. | NEEDS FIX | Reviewer sign-in built, off until configured (§7); throttled sends still reach the code step · NEEDS APP STORE CONNECT SETUP |
| P3 | Hardware needed to review | 2.1(a) | NFC programming needs a standard NDEF Tag. Review notes explain it and attach a sample QR for the customer flow. | NEEDS APP STORE CONNECT SETUP | NEEDS APP STORE CONNECT SETUP |
| P4 | Tested on device, no crashes | 2.1(a) | No TestFlight build yet. | NEEDS REAL-DEVICE TEST | NEEDS REAL-DEVICE TEST |
| P5 | Accurate metadata | 2.3 | Drafted in `APP_STORE_METADATA.md`. | NEEDS APP STORE CONNECT SETUP | NEEDS APP STORE CONNECT SETUP |
| P6 | Screenshots show the app in use | 2.3.3 | Plan written; real iPhone captures still needed. | NEEDS APP STORE CONNECT SETUP | NEEDS APP STORE CONNECT SETUP |
| P7 | App name ≤ 30, honest keywords | 2.3.7 | "ReviewBoost" (11). Keywords avoid competitor and Google trademarks. | PASS | PASS |
| P8 | iPad | 2.4.1 | `supportsTablet: true` → device family `1,2`, but no screen was designed or tested for iPad. | NEEDS FIX | PASS — iPhone only for V1 (§9) |
| P9 | Public APIs only | 2.5.1 | React Native, Expo modules, Core NFC. | PASS | PASS |
| P10 | No downloaded executable code | 2.5.2 | JS bundle ships in the binary; `expo-updates` is not installed. | PASS | PASS |
| P11 | Background modes | 2.5.4 | None declared. | PASS | PASS |
| P12 | IPv6-only networks | 2.5.5 | All traffic is `fetch` to hostnames through NSURLSession; no IP literals, no raw sockets. Apple's NAT64 test still has to run. | PASS (source) | PASS (source) · NEEDS REAL-DEVICE TEST |
| P13 | Recording / logging users | 2.5.14 | No camera, microphone, screen or input recording. | NOT APPLICABLE | NOT APPLICABLE |
| P14 | Build toolchain | Upcoming requirements, 2026-04-28 | EAS `sdk-57` image is `macos-tahoe-26.5-xcode-26.6` (Xcode 26.6, iOS 26 SDK). `eas.json` did not pin it. | PASS (implicit) | PASS — pinned in `eas.json` |
| P15 | Minimum iOS target | Upcoming requirements, 2026-09-09 | Deployment target 16.4 (≥ 13). | PASS | PASS |

### Business (Guideline 3)

| # | Rule | Source | Finding | Before | Now |
|---|---|---|---|---|---|
| B1 | In-app purchase for digital unlocks | 3.1.1 | Nothing is sold or unlocked in the app. | PASS | PASS |
| B2 | Free companion to a paid web tool | 3.1.3(f) | No purchase UI. But two sentences pointed at buying outside the app: *"Update your card on the web to keep it that way."* (past due) and *"…the same Tags work again when you subscribe."* (cancelled). | NEEDS FIX | PASS — both now state the fact only |
| B3 | Showing an existing plan/balance | 3.1.3(f) | Plan name, status, renewal date and message balance are shown read-only. No price, no upgrade, no link. | PASS | PASS |
| B4 | Other business-model rules | 3.2 | No ads, no rewards for reviews, no paid ranking. | PASS | PASS |
| B5 | Pages the app links to | 3.1.3(f) | Privacy, Terms and Support open `reviewboost.fit` in Safari. The public header there has "Pricing" and "Get started". The in-app rows are not calls to action for purchase, and they open outside the app, but a strict reviewer could object. Optional mitigation, not built: an `?app=1` variant of those three pages without the marketing header. | PASS (low risk, noted) | PASS (low risk, noted) |

### Design (Guideline 4 and the HIG)

| # | Rule | Source | Finding | Before | Now |
|---|---|---|---|---|---|
| D1 | Refined, app-like design | 4.0 | Tab bar used text glyphs (◉ ✉ ➤ ⬡ ☰) as icons. | NEEDS FIX | PASS — SF Symbols (§11) |
| D2 | Launch screen | HIG: Launching | Generated storyboard referenced an image not in the catalog and used white `systemBackground`, then the app painted `#F6F7F5`: a visible flash. | NEEDS FIX | PASS — plain canvas `#F6F7F5`, no logo, no text; root view matches |
| D3 | App icon | HIG: App icons | 1024×1024, RGB, no alpha, no baked corners, generated from `Branding/Mark.svg` by `scripts/brand/generate-brand-assets.mjs`. QA sheet in `docs/mobile/icon-previews/brand-qa.png`. | PASS | PASS · NEEDS REAL-DEVICE TEST (Home Screen tinting on iOS 26) |
| D4 | Minimum functionality | 4.2 | Native NFC Tag programming (Core NFC), secure persisted session, feedback inbox and detail, Tags, Text Request status, account controls. Not a WebView. | PASS | PASS |
| D5 | Works on its own | 4.2.3(i) | Needs only an account. | PASS | PASS |
| D6 | Login services | 4.8 | Only ReviewBoost's own email-code sign-in. 4.8 applies to third-party/social login, so Sign in with Apple is not required. | NOT APPLICABLE | NOT APPLICABLE |
| D7 | Accessibility: VoiceOver | HIG: Accessibility | Star ratings read as five "black star" glyphs; tappable rows did not announce as buttons. | NEEDS FIX | PASS (source) · NEEDS REAL-DEVICE TEST |
| D8 | Accessibility: contrast | HIG: Color & Accessibility | `inkFaint #9CA3AF` on white is 2.5:1 and was used for statuses, times and labels. | NEEDS FIX | PASS — 4.6:1+ |
| D9 | Accessibility: Dynamic Type, Bold Text, Reduce Motion | HIG | Text scales (no `allowFontScaling={false}` anywhere); NFC sheet honours Reduce Motion. Large-size layouts unverified on device. | NEEDS REAL-DEVICE TEST | NEEDS REAL-DEVICE TEST |
| D10 | Safe areas | HIG: Layout | Every screen uses `SafeAreaView`; the login "back" link was absolutely positioned at `top: 64`. | NEEDS FIX | PASS (source) · NEEDS REAL-DEVICE TEST |
| D11 | Appearance | HIG: Dark Mode | `userInterfaceStyle: "light"` — an intentional light-only V1 (§9). | PASS | PASS |

### Legal and privacy (Guideline 5)

| # | Rule | Source | Finding | Before | Now |
|---|---|---|---|---|---|
| L1 | Privacy policy link in App Store Connect | 5.1.1(i) | `https://reviewboost.fit/privacy`. | NEEDS APP STORE CONNECT SETUP | NEEDS APP STORE CONNECT SETUP |
| L2 | Privacy policy inside the app | 5.1.1(i) | No link in the app. | NEEDS FIX | PASS — Account → Privacy (plus Terms, Support) |
| L3 | Policy content | 5.1.1(i) | Covers collection, sharing, retention and in-app deletion. Its storage section described only a browser cookie. Support's "How do I delete my account?" said to email us, and `/delete-account` named only the web route. | NEEDS FIX | PASS — policy mentions the app's on-device session storage; Support and `/delete-account` name the in-app route |
| L4 | Purpose strings | 5.1.1(ii) | NFC string is specific. `NSFaceIDUsageDescription` ("Allow … to access your Face ID biometric data") was added by the secure-store plugin for a feature the app never uses. `NSLocalNetworkUsageDescription` ("Expo Dev Launcher uses the local network…") and `NSBonjourServices` were added by the dev client to every build. | NEEDS FIX | PASS — Face ID removed; dev-client keys stripped from production builds |
| L5 | Data minimisation | 5.1.1(iii) | The app asks for an email address and nothing else. | PASS | PASS |
| L6 | Account deletion in the app | 5.1.1(v) | Owners: typed-confirmation deletion that cancels billing, deletes the business and removes the login when it belongs to nothing else. Non-owners and business-less accounts: delete their own login after typing "delete"; the only owner of a business is asked to delete it first (§6, built for launch gap L1). | BUILT | Needs TestFlight check |
| L7 | Data use and sharing | 5.1.2 | No advertising, no data brokers, no third-party AI. Processors only (§5). | PASS | PASS |
| L8 | Kids | 5.1.4 | Not directed at children; not in the Kids category. | NOT APPLICABLE | NOT APPLICABLE |
| L9 | App Privacy ("nutrition label") | App Store Connect | Answers drafted from code (§5). | NEEDS APP STORE CONNECT SETUP | NEEDS APP STORE CONNECT SETUP |
| L10 | Privacy manifest | Required-reason APIs, 2024-05-01 | No app-level `PrivacyInfo.xcprivacy` in config. RN's `pod install` aggregation would create one, but Expo notes Apple does not reliably read static pods' manifests. | NEEDS FIX | PASS (config) · NEEDS REAL-DEVICE TEST (Xcode privacy report on the archive) |
| L11 | App Tracking Transparency | 5.1.2, ATT | No tracking, no IDFA: no `AdSupport`, `ASIdentifierManager` or `ATTrackingManager` in any native source; no analytics or crash SDK. No ATT prompt is correct. | PASS | PASS |
| L12 | Export compliance | Export regulations | Beyond HTTPS, the app bundled `aes-js` and encrypted the stored session with AES-CTR itself — "an industry standard algorithm, not provided within the Apple operating system", which needs a French encryption declaration for France. | NEEDS FIX | PASS — session now kept in the Keychain only; `aes-js` removed; `ITSAppUsesNonExemptEncryption = NO` is now true (§8) |
| L13 | Age rating | Upcoming requirements, 2026-01-31 | Answers drafted in `APP_STORE_METADATA.md`. | NEEDS APP STORE CONNECT SETUP | NEEDS APP STORE CONNECT SETUP |
| L14 | EU trader status (DSA) | Upcoming requirements | Required to distribute in the EU. | NEEDS APP STORE CONNECT SETUP | NEEDS APP STORE CONNECT SETUP |
| L15 | Intellectual property | 5.2 | Own name and mark. "Google" is mentioned only descriptively; no Google logos or trade dress. | PASS | PASS |

## 3. Build and SDK

- Expo SDK 57 · React Native 0.86.2 · Hermes · New Architecture (Expo default).
- EAS production image: `macos-tahoe-26.5-xcode-26.6` (Xcode 26.6 build 17F113, iOS 26 SDK),
  which is what the `sdk-57` alias resolves to per Expo's infrastructure page (modified
  2026-07-09). Now pinned explicitly in `eas.json` → `build.production.ios.image` so a
  future alias change cannot silently move the toolchain.
- Deployment target: iOS 16.4 (Podfile and project). Apple's floor from 2026-09-09 is iOS 13.
- **Needs external action:** the EAS project is not linked (`expo.extra.eas.projectId` is
  absent). Run `eas init` once, signed in to the owning Expo account, and commit the
  generated `projectId`. The first production build log must show `Xcode 26.6`.

## 4. Generated iOS project (`expo prebuild`, before → after)

| Item | Before | After |
|---|---|---|
| Bundle id | `fit.reviewboost.app` | unchanged |
| Device family | `1,2` (iPhone + iPad) | `1` (iPhone) |
| `NFCReaderUsageDescription` | "ReviewBoost uses NFC to program your Tags." | "ReviewBoost uses NFC to write your business's review link to your ReviewBoost Tags and to check what a Tag already holds before changing it." |
| NFC entitlement | `com.apple.developer.nfc.readersession.formats` = NDEF, TAG | unchanged (the app writes with `NfcTech.Ndef`; TAG is the NFC plugin's default and harmless — not changed without a device test) |
| `NSFaceIDUsageDescription` | present, generic | removed (`expo-secure-store` `faceIDPermission: false`) |
| `NSLocalNetworkUsageDescription`, `NSBonjourServices` | present in every build | stripped when `EAS_BUILD_PROFILE=production` (`plugins/with-production-info-plist.js`) |
| `ITSAppUsesNonExemptEncryption` | absent (questionnaire every upload) | `false`, justified in §8 |
| App icon | single 1024 universal, RGB | unchanged |
| Launch storyboard | missing image, white `systemBackground` | solid `#F6F7F5`, no image |
| Privacy manifest | none at app level | declared in `app.json` → `ios.privacyManifests` (§10) |
| ATS | arbitrary loads off; local networking on (dev) | unchanged |

**Needs external action:** the Apple Developer App ID `fit.reviewboost.app` must have
the *NFC Tag Reading* capability enabled, or signing fails. EAS will offer to enable it
when it manages credentials; confirm it in the portal.

## 5. Data inventory (from the code) and App Privacy answers

What the iOS app sends off the device, found by reading every network call in
`apps/mobile/data` and `apps/mobile/app`:

| Data | Where in code | Leaves device? | Linked to user | Tracking | Purpose | Retention | Recipients |
|---|---|---|---|---|---|---|---|
| Email address | `auth-context.tsx` `signInWithOtp` / `verifyOtp` | Yes | Yes | No | App functionality (sign-in) | Until account deletion | Supabase (auth), the email-delivery service Supabase Auth is configured to send through |
| User ID (Supabase auth id) and session tokens | `supabase.ts`, `api.ts` (Bearer token) | Yes | Yes | No | App functionality (authentication) | Session: until sign-out; id: until deletion | Supabase, ReviewBoost API on Vercel |
| Organization id / role | `api.ts` `X-Organization-Id`, `organization_members` read | Yes (as request context) | Yes | No | App functionality | Server-side business record | Supabase, Vercel |
| NFC programming confirmation (Tag id, time) | `stand/[id].tsx` → `nfc-provision` | Yes | Yes (business) | No | App functionality | Business record | Supabase, Vercel |
| Deletion confirmation (typed business name) | `delete-account.tsx` | Yes | Yes | No | App functionality | Not stored after the request | Vercel, Stripe (subscription cancel) |

Not collected by the iOS app, with the evidence:

- **Phone numbers.** The Text Requests tab only lists requests (last four digits returned by
  the server) and balances; there is no composer in the app.
- **Customer ratings and notes.** Collected on the public web page, not by this app; the
  app only displays them to the business.
- **Payment data.** Plans are bought and managed on the web; the app shows status only.
- **Location, contacts, photos, camera, microphone, health, browsing, search.** No such API
  is used and no purpose string exists for them.
- **Diagnostics and usage analytics.** No crash or analytics SDK; no `console` logging in
  app code. Standard server request logs on Vercel are not linked to an advertising
  profile and are not used for tracking.
- **Device identifiers for advertising.** None (L11).

**App Store Connect → App Privacy, proposed answers**

- Do you or your third-party partners collect data from this app? **Yes.**
- **Contact Info → Email Address:** collected · linked to the user · not used for tracking ·
  purpose: *App Functionality*.
- **Identifiers → User ID:** collected · linked · not tracking · *App Functionality*.
- Every other category: **not collected**, for the reasons above.

Re-answer these if a crash-reporting or analytics SDK is ever added.

## 6. Account deletion: the gap and a proposed fix (needs your decision)

Today `POST /api/v1/account/deletion` is owner-only and deletes a *business*. Apple's rule
is about *accounts*: anyone who can create one must be able to delete it in the app.
Two kinds of account have no path:

1. A team member (admin, member, viewer) — their login outlives their wish to leave.
2. A login with no business — `signInWithOtp` uses `shouldCreateUser: true`, so any
   email that completes a code creates an account. The org picker then shows
   "No organizations found" with only Sign out.

What blocks a simple "delete my login" endpoint: `response_notes.author_id` is
`REFERENCES auth.users ON DELETE RESTRICT`. A member who ever wrote an internal note on
feedback cannot be deleted without deciding what happens to those notes, which are part of
the business's records.

**Built 18 October 2026 (launch gap L1), using the first option below.** Migration
`20261018000100_personal_account_deletion.sql` (not applied to production), endpoint
`/api/v1/account/personal-deletion` (`GET` = may I, `POST {confirmation: "delete"}`),
web page `/settings/delete-my-account`, native `PersonalDeletion` in
`apps/mobile/app/delete-account.tsx`, and a "Delete my account" link in the empty org picker
and in onboarding. Tests: `supabase/tests/personal_account_deletion_test.sql`,
`personal-account-deletion-route.test.ts`, `personal-deletion-flow.test.tsx`,
`account-fetch.test.ts`. If you would rather delete a person's notes than keep them as
"Former team member", say so before the migration reaches production. Still to verify on
TestFlight.

The original proposal, for the record:

- Migration: `response_notes.author_id` becomes nullable with `ON DELETE SET NULL`; notes
  stay with the business as "Former team member". (Alternative: delete the person's notes.
  Pick one.)
- `DELETE /api/v1/account` (session only, no ids in the request): refuse if the caller is
  the *only* owner of any business ("Delete *X* first, or make someone else owner");
  otherwise remove their memberships and their `auth.users` row via the Auth Admin API.
- App: Account → "Delete account" routes owners to today's business deletion and everyone
  else to "Delete my login"; the org picker offers the same when there is no business.

## 7. App Review access

Apple has to be able to sign in without waiting for an email only you can read. Built in
this PR, **off unless configured**:

- `POST /api/v1/public/review-sign-in` (`frontend/lib/server/review-sign-in.ts`) accepts
  `{ email, code }`. It works only when `REVIEW_SIGN_IN_EMAIL` and `REVIEW_SIGN_IN_CODE`
  (six digits) are set on the server. They are never in the app binary. Unset or
  half-set, it answers 404.
  - It signs in only that one address. A wrong address and a wrong code get the same
    401, so the route does not reveal which address is the reviewer's.
  - It compares sha256 digests in constant time.
  - It is rate limited per client (5 per 15 minutes, keyed on a daily-rotating keyed digest
    of the IP, never the IP itself) and overall (200 per day). If the limiter cannot answer,
    it refuses.
  - It returns a one-time Supabase token hash, which the app exchanges for an ordinary
    session.
  - Tests: `frontend/tests/unit/review-sign-in-route.test.ts` (7) and
    `apps/mobile/data/__tests__/review-sign-in.test.ts` (3).
- The app's sign-in screen tries the normal email code first and falls back to this route,
  so the reviewer uses the same screen as everyone else.
- Supabase allows one code email per address per minute and caps sends per hour, and
  answers 429 when throttled. The login screen used to stay on the email step then, which
  would lock out a second reviewer trying within a minute. A 429 now moves on to the code
  step with "We can’t send another code just yet…" (`apps/mobile/data/send-code.ts`, 3
  tests). Any other failure still stays on the email step.
- Before submission: create a demo business for that email (fictional data only, no real
  customers, SMS disabled for it, never billed as paid). Set the two env vars in Vercel
  production. Put the email and code in App Review notes, and rotate the code after
  review. Step by step: `APP_STORE_METADATA.md` §6.

## 8. Export compliance

Before this PR the app contained two kinds of encryption:

1. HTTPS through the operating system (NSURLSession) — exempt.
2. `aes-js`, a JavaScript AES-CTR implementation bundled into the app, used by
   `LargeSecureStore` to encrypt the session before writing it to AsyncStorage, with the key in
   the Keychain. Apple's reference classifies "an industry standard algorithm, not provided
   within the Apple operating system" as needing a **French encryption declaration**
   (for distribution in France).

This PR removes (2): the session is split into Keychain-sized chunks and stored only in the
Keychain via `expo-secure-store`, so all encryption the app relies on is the operating
system's (TLS and Keychain Services). No other dependency implements a cipher (checked: no
`crypto-js`, `tweetnacl`, `libsodium`, OpenSSL or CommonCrypto calls in app or native module
code; `react-native-get-random-values` only reads the system RNG). On that basis
`ITSAppUsesNonExemptEncryption` is set to `NO`.

Re-check this whenever a dependency is added. If any library that implements encryption is
added, this key must go back to `YES` and the App Store Connect questionnaire answered.

## 9. Decisions: iPad and appearance

- **iPad → off for V1** (`supportsTablet: false`). No screen was designed for a 1024-point
  canvas or for split view, and App Store Connect would require iPad screenshots of a
  stretched phone layout. iPhone apps still run on iPad in compatibility mode. Revisit when
  there is an iPad layout to test.
- **Appearance → intentional light-only V1** (`userInterfaceStyle: "light"`). Dark Mode is
  not required by the guidelines. A half-built dark theme would mix dark system chrome with
  light surfaces. The web app's dark theme can be ported as its own piece of work.

## 10. Privacy manifest (declared in `app.json`)

Union of what the app and its bundled SDKs declare (Expo's guidance: Apple does not
reliably read manifests inside static CocoaPods, so the app repeats them):

| Category | Reasons | Declared by |
|---|---|---|
| UserDefaults | CA92.1 | react-native (React), expo-constants |
| FileTimestamp | C617.1, 0A2A.1, 3B52.1 | react-native (React, cxxreact), AsyncStorage, expo-file-system |
| SystemBootTime | 35F9.1 | react-native (timing) |
| DiskSpace | E174.1, 85F4.1 | expo-file-system |

`NSPrivacyTracking = false`, no tracking domains, collected data types matching §5
(email address and user ID, linked, app functionality, not tracking).

Every code comes from a manifest shipped by the SDK that uses the API; none was invented.
Verification still needed on the archive: Xcode → Organizer → *Generate Privacy Report*.

## 11. Fixes in this PR

| Area | Change | Files |
|---|---|---|
| Device family | iPhone only | `app.json` `supportsTablet: false` |
| Launch | Updated 14 October to user-selected `#005B3E` field and white script wordmark; native/JS startup share the artwork; real-device handoff unverified | `app.json` (`expo-splash-screen`, `expo-system-ui`), `assets/launch-wordmark.png`, `components/launch-screen.tsx`; see `LAUNCH_SCREEN.md` |
| Tab bar | SF Symbols instead of text glyphs | `app/(tabs)/_layout.tsx`, `expo-symbols` |
| Legal links | Privacy, Terms and Support rows, opening in Safari | `app/(tabs)/account.tsx`, `data/public-links.ts` |
| Payments copy | Past-due and cancelled copy states facts only; a test forbids purchase words in any status | `data/billing-view.ts`, `data/__tests__/billing-view.test.ts` |
| Accessibility | Stars read "N out of 5 stars"; rows and buttons have roles and hints; faint text 4.6:1 or better | `components/stars.tsx`, the tab screens, `theme.ts` |
| Safe area | Login back link placed under the status bar or Dynamic Island | `app/login.tsx` |
| Session storage | Keychain only, chunked under 2048 bytes, cleared on reinstall; `aes-js` removed | `data/supabase.ts`, `data/__tests__/keychain-session-store.test.ts` |
| Export compliance | `ITSAppUsesNonExemptEncryption: false` | `app.json` |
| Privacy manifest | App-level `PrivacyInfo.xcprivacy` from config | `app.json` `ios.privacyManifests` |
| Purpose strings | Face ID key gone; dev-client local-network and Bonjour keys stripped from production | `app.json`, `plugins/with-production-info-plist.js` |
| NFC string | Says what is written and why the Tag is read first | `app.json` |
| Toolchain | EAS production image pinned to Xcode 26.6 | `eas.json` |
| Reviewer access | Server-configured review sign-in, off by default | `frontend/lib/server/review-sign-in.ts`, `frontend/app/api/v1/public/review-sign-in/route.ts`, `data/review-sign-in.ts` |
| Sign-in throttling | A 429 on sending the code still reaches the code step | `data/send-code.ts`, `app/login.tsx`, `data/auth-context.tsx` |
| Public pages | Privacy mentions app storage; Support and Delete account name the in-app route | `frontend/app/(public)/privacy`, `frontend/app/support`, `frontend/app/(public)/delete-account` |

## 12. APPLE RELEASE GATE

| Gate | Status | Evidence / what is left |
|---|---|---|
| App icon | PASS | 1024 RGB no alpha, generated from `Branding/Mark.svg`; QA sheet in `docs/mobile/icon-previews/brand-qa.png` |
| Launch screen | PASS | Solid canvas storyboard; root view `#F6F7F5` |
| iPhone layouts | NEEDS EXTERNAL ACTION | Source reviewed; must be checked on TestFlight on small, standard and Pro Max iPhones |
| iPad decision | PASS | iPhone only (`supportsTablet: false`) |
| NFC | NEEDS EXTERNAL ACTION | Entitlement and string correct; real-device matrix in `APP_STORE_METADATA.md` §9 not run |
| Login | NEEDS EXTERNAL ACTION | Code reviewed and unit-tested (throttling, reviewer fallback); live OTP delivery untested from here |
| Account deletion | BLOCKED | Owners only; §6 needs your decision and a migration |
| Privacy policy | NEEDS EXTERNAL ACTION | In-app link added; page updated in the repo; live URL could not be fetched from this sandbox |
| App Privacy labels | NEEDS EXTERNAL ACTION | Answers in §5 to enter in App Store Connect |
| Privacy manifest | NEEDS EXTERNAL ACTION | Declared; confirm with Xcode's privacy report on the archive |
| ATT | PASS | No tracking, no IDFA, no prompt |
| Payments | PASS | No purchase UI, no outside-purchase call to action |
| Accessibility | NEEDS EXTERNAL ACTION | Source fixes done; VoiceOver / Dynamic Type pass on device |
| IPv6 | NEEDS EXTERNAL ACTION | Hostname-only networking; run on a NAT64 network |
| Metadata | NEEDS EXTERNAL ACTION | Drafted; enter in App Store Connect |
| Screenshots | NEEDS EXTERNAL ACTION | Plan written; capture from TestFlight on iPhone 6.9" |
| Age rating | NEEDS EXTERNAL ACTION | Answers drafted |
| Export compliance | PASS | OS-only encryption; `ITSAppUsesNonExemptEncryption = NO` (§8) |
| Reviewer account | NEEDS EXTERNAL ACTION | Endpoint built; configure env, demo business, notes |
| Review notes | PASS | Drafted in `APP_STORE_METADATA.md` |
| TestFlight real-device test | NEEDS EXTERNAL ACTION | No build yet |
| Xcode / iOS SDK version | PASS | Xcode 26.6 image pinned |
| Signing / capabilities | NEEDS EXTERNAL ACTION | `eas init`; NFC Tag Reading on the App ID |
| Production backend | BLOCKED | Production migration gate |
